// Escena WebGL (three.js) del Circuito 3D. Solo se carga en el navegador o en la app.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hexToRgb, type RGB } from '../color.ts';
import { drawTheme, themeBase } from './themes.ts';
import {
  ballActive,
  ballAtPlan,
  cameraAt,
  recoilAt,
  type CircuitPlan,
  type Piece,
} from '../modes/circuit.plan.ts';
import { frameTime, rnd, visibleHit } from '../scene/draw.ts';
import type { SceneStyle } from '../scene/style.ts';

const rgb = (c: RGB) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
const PLAN_STYLE_KEYS: (keyof SceneStyle)[] = [
  'colorMode',
  'palette',
  'colors',
  'tileSize',
  'floorColor',
  'ballStyle3d',
  'ballSize3d',
  'ballColorFixed',
  'ballColor2',
  'seed',
];
const TRAIL_N = 40; // muestras de la estela
const WALL_W = 36; // tamaño de la pared de fondo (sigue a la cámara; así los degradados se ven)
const WALL_H = 64;

interface PieceObj {
  piece: Piece;
  group: THREE.Group; // parte que se mueve con el golpe
  base: THREE.Vector3;
  normal: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[]; // materiales que se iluminan
  baseCol: THREE.Color[]; // color original de cada material
  pivot?: THREE.Group; // teclas: giran sobre su bisagra en vez de hundirse
  lever?: number; // distancia bisagra → punto de contacto
}

/** Estela de una bola: cinta orientada a cámara con el color de la bola, que se desvanece hacia atrás. */
class Trail {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.col = new Float32Array(TRAIL_N * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  /** points: del más reciente al más antiguo; width: anchura en la cabeza. */
  update(
    points: THREE.Vector3[],
    camPos: THREE.Vector3,
    width: number,
    color: THREE.Color,
    strength: number,
  ): void {
    const n = points.length;
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const view = new THREE.Vector3();
    for (let i = 0; i < TRAIL_N; i++) {
      const p = points[Math.min(i, n - 1)];
      const q = points[Math.min(i + 1, n - 1)];
      dir.subVectors(i + 1 < n ? q : p, i + 1 < n ? p : points[Math.max(0, n - 2)]);
      if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
      view.subVectors(camPos, p).normalize();
      side.crossVectors(dir.normalize(), view).normalize();
      const f = 1 - i / (n - 1 || 1);
      const w = width * (0.15 + 0.85 * f) * (i < n ? 1 : 0);
      const o = i * 6;
      this.pos[o] = p.x + side.x * w;
      this.pos[o + 1] = p.y + side.y * w;
      this.pos[o + 2] = p.z + side.z * w;
      this.pos[o + 3] = p.x - side.x * w;
      this.pos[o + 4] = p.y - side.y * w;
      this.pos[o + 5] = p.z - side.z * w;
      const a = strength * f * f * 0.9;
      for (let v = 0; v < 2; v++) {
        this.col[o + v * 3] = color.r * a;
        this.col[o + v * 3 + 1] = color.g * a;
        this.col[o + v * 3 + 2] = color.b * a;
      }
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Scene3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 9 / 16, 0.1, 200);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private floor: THREE.Mesh;
  private floorMat: THREE.MeshStandardMaterial;
  private balls: THREE.Object3D[] = [];
  private ballMats: THREE.MeshStandardMaterial[] = []; // material cuyo color es el de la bola
  private swirlTex: THREE.CanvasTexture[] = [];
  private trails: Trail[] = [];
  private trailPts: THREE.Vector3[] = Array.from({ length: TRAIL_N }, () => new THREE.Vector3());
  private lastK: number[] = []; // último choque dibujado por bola (para limpiar al retroceder)
  private pieces: PieceObj[] = [];
  private root = new THREE.Group();
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private planKey = '';
  private planRef: CircuitPlan | null = null;
  private pmrem: THREE.PMREMGenerator;
  private chrome = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.42, metalness: 0.9 });
  private dark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.3 });

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x335533, 0.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    // fondo: pared vertical detrás de las piezas (recibe las sombras); sigue a la cámara y lleva el tema
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), this.floorMat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.scene.add(this.root);

    this.sparkPos = new Float32Array(3 * 128);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.045,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // solo los brillos realmente intensos (destellos y bolas al golpear): umbral por encima del blanco
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1080, 1920), 0.3, 0.35, 1.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Textura sutil de suelo (ruido fino) para que las sombras no se vean sobre un color plano. */
  private wallKey = '';
  private wallTex: THREE.CanvasTexture | null = null;
  /** Pone el tema del fondo (textura generada) y la luz de rebote que le va. */
  private applyTheme(st: SceneStyle): void {
    const key = `${st.theme3d}|${st.floorColor}|${st.seed}`;
    if (key === this.wallKey) return;
    this.wallKey = key;
    const c = document.createElement('canvas');
    c.width = 1536;
    c.height = 1536;
    drawTheme(c, st.theme3d, st.floorColor, st.seed);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.wallTex?.dispose();
    this.wallTex = t;
    this.floorMat.map = t;
    this.floorMat.needsUpdate = true;
    const base = themeBase(st.theme3d, st.floorColor);
    this.hemi.groundColor.setRGB(base[0] / 510, base[1] / 510, base[2] / 510);
    const lum = (0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2]) / 255;
    this.hemi.intensity = 0.3 + 0.25 * lum;
  }

  setSize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private clear(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const p of this.pieces) for (const m of p.mats) m.dispose();
    this.root.clear();
    this.pieces = [];
    for (const b of this.balls) this.scene.remove(b);
    for (const tr of this.trails) {
      this.scene.remove(tr.mesh);
      tr.mesh.geometry.dispose();
    }
    for (const tx of this.swirlTex) tx.dispose();
    this.swirlTex = [];
    this.balls = [];
    this.ballMats = [];
    this.trails = [];
    this.lastK = [];
  }

  /** Construye las piezas (colgadas de la pared) y las bolas de un plan. */
  private build(plan: CircuitPlan, st: SceneStyle): void {
    this.clear();
    const rodGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 12);
    const mountGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20);
    const ivory = new THREE.MeshPhysicalMaterial({
      color: 0xf0ece2,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.4,
    });
    const ebony = new THREE.MeshPhysicalMaterial({
      color: 0x17171c,
      roughness: 0.28,
      metalness: 0.05,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    });
    // soporte: varilla horizontal desde el punto dado hasta la pared, con una base redonda en la pared
    const addBracket = (x: number, y: number, z: number) => {
      const len = z - plan.wallZ;
      const rod = new THREE.Mesh(rodGeo, this.chrome);
      rod.rotation.x = Math.PI / 2;
      rod.scale.y = Math.max(0.05, len);
      rod.position.set(x, y, plan.wallZ + len / 2);
      rod.castShadow = true;
      this.root.add(rod);
      const mount = new THREE.Mesh(mountGeo, this.chrome);
      mount.rotation.x = Math.PI / 2;
      mount.position.set(x, y, plan.wallZ + 0.025);
      mount.castShadow = true;
      this.root.add(mount);
    };
    for (const piece of plan.pieces) {
      // tecla con volumen: sale de la pared hacia la cámara (bisagra atrás, punta delante); su cara superior
      // mira según la normal (inclinada hacia dentro en el pozo) y lleva un pequeño giro estético
      const n = new THREE.Vector3(...piece.n);
      const contact = new THREE.Vector3(...piece.P).addScaledVector(n, -plan.r);
      const len = piece.size;
      const wd = st.tileSize * (piece.black ? 0.2 : 0.3); // anchura
      const th = st.tileSize * (piece.black ? 0.26 : 0.2); // grosor (a lo largo de la normal)
      const mat = (piece.black ? ebony : ivory).clone();
      const group = new THREE.Group();
      group.position.copy(contact).addScaledVector(n, -th / 2);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      group.rotateY(piece.yaw);
      // la bola pisa a 0,42·len del borde delantero; la bisagra queda en el extremo de atrás (hacia la pared)
      const pivot = new THREE.Group();
      pivot.position.z = -0.58 * len;
      const key = new THREE.Mesh(new RoundedBoxGeometry(wd, th, len, 2, th * 0.18), mat);
      key.position.z = len / 2;
      key.castShadow = true;
      key.receiveShadow = true;
      pivot.add(key);
      group.add(pivot);
      const hinge = new THREE.Mesh(
        new THREE.CylinderGeometry(th * 0.4, th * 0.4, wd * 1.25, 14),
        this.chrome,
      );
      hinge.rotation.z = Math.PI / 2;
      hinge.position.z = -0.58 * len + 0.04;
      hinge.castShadow = true;
      group.add(hinge);
      this.root.add(group);
      // soporte a la pared desde la bisagra (las teclas del pozo cuelgan de la barra de su pared)
      const back = contact.clone().addScaledVector(n, -th / 2);
      const backWorld = group.localToWorld(new THREE.Vector3(0, -th / 2 - 0.03, -0.58 * len + 0.04));
      if (!piece.shaft) addBracket(backWorld.x, backWorld.y, backWorld.z);
      this.pieces.push({
        piece,
        group,
        base: back.clone(),
        normal: n,
        mats: [mat],
        baseCol: [mat.color.clone()],
        pivot,
        lever: 0.58 * len,
      });
    }
    // pozos: una barra vertical cromada a cada lado, de la que cuelgan las teclas de las paredes
    for (const sh of plan.shafts) {
      const h = Math.max(0.5, sh.yTop - sh.yBottom);
      for (const x of [sh.xL, sh.xR]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 14), this.chrome);
        bar.position.set(x, (sh.yTop + sh.yBottom) / 2, 0.02);
        bar.castShadow = true;
        bar.receiveShadow = true;
        this.root.add(bar);
        for (let y = sh.yBottom + 0.3; y < sh.yTop; y += 2.2) addBracket(x, y, 0.02);
      }
    }
    // carriles: dos tubos cromados por debajo de la trayectoria, con soportes a la pared
    const railGeoCache: THREE.BufferGeometry[] = [];
    for (const rail of plan.rails) {
      const pts = rail.pts;
      if (pts.length < 2) continue;
      const step = Math.max(1, Math.floor(pts.length / 160));
      for (const dz of [-0.55 * plan.r, 0.55 * plan.r]) {
        const curve = new THREE.CatmullRomCurve3(
          pts
            .filter((_, i) => i % step === 0 || i === pts.length - 1)
            .map((p) => new THREE.Vector3(p[0], p[1] - 0.72 * plan.r, p[2] + dz)),
        );
        const geo = new THREE.TubeGeometry(curve, Math.min(400, pts.length), 0.032, 10, false);
        railGeoCache.push(geo);
        const tube = new THREE.Mesh(geo, this.chrome);
        tube.castShadow = true;
        tube.receiveShadow = true;
        this.root.add(tube);
      }
      // soportes cada ~1.3 unidades de recorrido
      let acc = 1.3;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        if (acc >= 1.3) {
          acc = 0;
          addBracket(pts[i][0], pts[i][1] - 0.72 * plan.r, pts[i][2] - 0.55 * plan.r);
        }
      }
    }
    for (let b = 0; b < plan.balls.length; b++) {
      const { obj, mat } = this.makeBall(st, plan.r, b);
      this.scene.add(obj);
      this.balls.push(obj);
      this.ballMats.push(mat);
      const trail = new Trail();
      this.scene.add(trail.mesh);
      this.trails.push(trail);
    }
  }

  /** Devuelve una pieza a su estado de reposo (sin luz ni hundimiento). */
  private resetPiece(po: PieceObj): void {
    po.group.position.copy(po.base);
    po.group.scale.setScalar(1);
    if (po.pivot) po.pivot.rotation.x = 0;
    for (let mi = 0; mi < po.mats.length; mi++) {
      po.mats[mi].color.copy(po.baseCol[mi]);
      po.mats[mi].emissiveIntensity = 0;
    }
  }

  /** Textura de vetas para la canica: cintas onduladas blancas sobre fondo transparente. */
  private swirlTexture(seed: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, 512, 256);
    x.lineCap = 'round';
    for (let band = 0; band < 3; band++) {
      const v0 = 60 + 70 * band + 20 * rnd(seed, band);
      const amp = 22 + 26 * rnd(seed + 1, band);
      const freq = 1 + Math.floor(2 * rnd(seed + 2, band));
      const ph = Math.PI * 2 * rnd(seed + 3, band);
      for (const [w, alpha] of [
        [34, 0.35],
        [20, 0.6],
        [9, 1],
      ]) {
        x.strokeStyle = `rgba(255,255,255,${alpha})`;
        x.lineWidth = w;
        x.beginPath();
        for (let u = -40; u <= 552; u += 8) {
          const v = v0 + amp * Math.sin((u / 512) * Math.PI * 2 * freq + ph);
          if (u === -40) x.moveTo(u, v);
          else x.lineTo(u, v);
        }
        x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    this.swirlTex.push(t);
    return t;
  }

  /** Construye la bola según el aspecto elegido; devuelve el objeto y el material que lleva su color. */
  private makeBall(
    st: SceneStyle,
    r: number,
    index: number,
  ): { obj: THREE.Object3D; mat: THREE.MeshStandardMaterial } {
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    if (st.ballStyle3d === 'canica') {
      // canica de cristal: esfera transparente con refracción y, dentro, dos cintas de vetas y un núcleo
      const group = new THREE.Group();
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.03,
        metalness: 0,
        transmission: 1,
        thickness: r * 1.6,
        ior: 1.5,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        attenuationColor: new THREE.Color(0xf4f7ff),
        attenuationDistance: 4,
        specularIntensity: 1,
      });
      const outer = new THREE.Mesh(sphere, glass);
      outer.scale.setScalar(r);
      outer.castShadow = true;
      group.add(outer);
      const ribbon = (scale: number, tex: THREE.Texture, color: THREE.Color, rot: number) => {
        // recorte por alfa (no transparencia): así las vetas se ven a través del cristal con refracción
        const m = new THREE.MeshStandardMaterial({
          map: tex,
          alphaMap: tex,
          alphaTest: 0.45,
          color,
          emissive: color,
          emissiveIntensity: 0.12,
          roughness: 0.4,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(sphere, m);
        mesh.scale.setScalar(r * scale);
        mesh.rotation.set(rot, rot * 0.7, 0);
        group.add(mesh);
        return m;
      };
      const main = rgb(hexToRgb(st.ballColorFixed));
      const second = rgb(hexToRgb(st.ballColor2));
      const mat = ribbon(0.86, this.swirlTexture(st.seed * 3 + index), main, 0.4);
      ribbon(0.79, this.swirlTexture(st.seed * 5 + index + 11), second, 1.9);
      const core = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({ color: main.clone().lerp(second, 0.35), roughness: 0.5 }),
      );
      core.scale.setScalar(r * 0.42);
      group.add(core);
      return { obj: group, mat };
    }
    let mat: THREE.MeshPhysicalMaterial;
    switch (st.ballStyle3d) {
      case 'cromo':
        mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 1 });
        break;
      case 'cristal':
        mat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.05,
          metalness: 0,
          transmission: 0.85,
          thickness: r * 1.2,
          ior: 1.5,
          clearcoat: 1,
        });
        break;
      case 'mate':
        mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
        break;
      case 'neon':
        mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0 });
        break;
      default:
        mat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          metalness: 0.05,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        });
    }
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.scale.setScalar(r);
    mesh.castShadow = true;
    return { obj: mesh, mat };
  }

  /** Dibuja el instante t en el lienzo. */
  render(t: number, plan: CircuitPlan, st: SceneStyle, fps: number): void {
    const key = JSON.stringify([
      plan.pieces.length,
      plan.balls.length,
      plan.duration,
      plan.seed,
      PLAN_STYLE_KEYS.map((k) => st[k]),
    ]);
    if (key !== this.planKey || this.planRef !== plan) {
      this.build(plan, st);
      this.planKey = key;
      this.planRef = plan;
    }
    this.applyTheme(st);
    this.bloom.strength = 0.6 * st.bloom;
    this.bloom.enabled = st.bloom > 0.01;

    // cámara (distancia fija; sin vibración: todo el vídeo es suave)
    const cam = cameraAt(plan, t);
    this.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    this.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }

    // bolas, estelas y piezas golpeadas recientemente
    const fixedCol = rgb(hexToRgb(st.ballColorFixed));
    for (let b = 0; b < plan.balls.length; b++) {
      const bp = plan.balls[b];
      const active = ballActive(bp, t);
      this.balls[b].visible = active;
      const k = visibleHit(bp.T, t, fps);
      // al retroceder en el tiempo (o al saltar hacia delante) las piezas que ya no tocan vuelven al reposo
      const prevK = this.lastK[b] ?? -1;
      if (k < prevK || k > prevK + 26)
        for (let j = Math.max(0, prevK - 26); j <= prevK; j++) this.resetPiece(this.pieces[bp.pieces[j]]);
      this.lastK[b] = k;
      let pos = ballAtPlan(bp, plan, t);
      for (const j of [k, k + 1])
        if (j >= 0 && j < bp.T.length && Math.abs(t - bp.T[j]) < 0.5 / fps) pos = bp.P[j];
      this.balls[b].position.set(pos[0], pos[1], pos[2]);
      const noteCol = rgb(k >= 0 ? bp.col[k] : (bp.col[0] ?? plan.startCol));
      const col = st.ballColor3d === 'fija' ? fixedCol : noteCol;
      const mat = this.ballMats[b];
      if (st.ballColor3d !== 'fija' || st.ballStyle3d !== 'canica') {
        // la bola no cambia de aspecto al golpear: solo toma su color (fijo o el de la nota)
        const hsl = { h: 0, s: 0, l: 0 };
        col.getHSL(hsl);
        switch (st.ballStyle3d) {
          case 'canica':
            mat.color.copy(col);
            break;
          case 'cromo':
            mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 0.9), 0.55 + 0.3 * hsl.l);
            break;
          case 'cristal':
            mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), 0.75);
            mat.emissive.copy(col).multiplyScalar(0.25);
            break;
          case 'neon':
            mat.color.setHSL(hsl.h, 1, 0.5);
            mat.emissive.copy(col).multiplyScalar(1.8);
            break;
          case 'mate':
            mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.4 + 0.1), hsl.l * 0.6);
            break;
          default:
            mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.5 + 0.1), hsl.l * 0.55);
            mat.emissive.copy(col).multiplyScalar(0.08);
        }
      }
      // estela: posiciones pasadas de la bola (hasta trail3d segundos), de la más reciente a la más antigua
      const trail = this.trails[b];
      const span = 0.08 + 0.6 * st.trail3d;
      trail.mesh.visible = active && st.trail3d > 0.01 && t > bp.pre!.tRel + 0.05;
      if (trail.mesh.visible) {
        const n = TRAIL_N;
        for (let i = 0; i < n; i++) {
          const tt = Math.max(bp.pre!.tRel, t - (span * i) / (n - 1));
          const q = ballAtPlan(bp, plan, tt);
          this.trailPts[i].set(q[0], q[1], q[2]);
        }
        this.trailPts[0].set(pos[0], pos[1], pos[2]);
        trail.update(
          this.trailPts,
          this.camera.position,
          plan.r * (0.4 + 0.3 * st.trail3d),
          col,
          st.ballStyle3d === 'neon' ? 0.9 : 0.5,
        );
      }
      for (let j = Math.max(0, k - 25); j <= k && j < bp.T.length; j++) {
        const po = this.pieces[bp.pieces[j]];
        const a = t - frameTime(bp.T[j], fps);
        const d = recoilAt(a, bp.S[j], st.recoil);
        // la tecla se hunde sobre su bisagra (la punta baja)
        if (po.pivot && po.lever) po.pivot.rotation.x = Math.max(0, d) / po.lever;
        // y se ilumina del color de su nota: sube en un suspiro, se apaga despacio y queda un rescoldo
        // que se va con las notas siguientes
        const attack = Math.min(1, a / 0.06);
        const flashP = attack * Math.exp(-a / 0.55);
        const sustain = Math.max(0, 1 - (k - j) / 22) * attack;
        // color de la nota, algo más vivo que el de la paleta para que la tecla se vea encendida
        const pc = rgb(po.piece.col);
        const hsl = { h: 0, s: 0, l: 0 };
        pc.getHSL(hsl);
        pc.setHSL(hsl.h, Math.min(1, hsl.s * 1.6 + 0.15), Math.min(0.62, hsl.l));
        for (let mi = 0; mi < po.mats.length; mi++) {
          const m = po.mats[mi];
          m.color.copy(po.baseCol[mi]).lerp(pc, Math.min(1, 0.5 * sustain + 0.5 * flashP));
          m.emissive.copy(pc);
          m.emissiveIntensity = 0.3 * sustain + 0.8 * flashP;
        }
      }
      if (k >= 26) this.resetPiece(this.pieces[bp.pieces[k - 26]]);
    }

    // chispas de los últimos choques (todas las bolas)
    let si = 0;
    const kh = visibleHit(plan.audioT, t, fps);
    for (let j = Math.max(0, kh - 4); j <= kh && j < plan.audioHits.length; j++) {
      const a = t - frameTime(plan.audioT[j], fps);
      if (a < 0 || a > 0.35) continue;
      const piece = plan.pieces.find((p) => Math.abs(p.t - plan.audioT[j]) < 1e-6);
      if (!piece) continue;
      const n = piece.n;
      const c = piece.P;
      for (let i = 0; i < 14 && si < 128; i++, si++) {
        const ang = rnd(j, i) * Math.PI * 2;
        const spread = 0.3 + 0.5 * rnd(i, j + 3);
        const sp = 1 + 2 * rnd(j + 7, i);
        this.sparkPos[3 * si] = c[0] + Math.cos(ang) * spread * sp * a;
        this.sparkPos[3 * si + 1] = c[1] + sp * (0.5 + n[1]) * a - 6 * a * a;
        this.sparkPos[3 * si + 2] = c[2] + Math.sin(ang) * spread * sp * a;
      }
    }
    for (; si < 128; si++) this.sparkPos[3 * si + 1] = -100;
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const ageH = kh >= 0 ? t - frameTime(plan.audioT[kh], fps) : 99;
    (this.sparks.material as THREE.PointsMaterial).opacity = ageH < 0.35 ? 0.85 * (1 - ageH / 0.35) : 0;

    const focusX = cam.look[0];
    const focusY = cam.look[1];
    this.floor.position.set(focusX, focusY, plan.wallZ);

    // luz: desde delante y arriba (la dirección la decide el ajuste), sombras sobre la pared
    const la = (st.lightAngle * Math.PI) / 180;
    this.sun.position.set(focusX + 7 * Math.sin(la), focusY + 8, 8 * Math.cos(la) + 4);
    this.sun.target.position.set(focusX, focusY, plan.wallZ);
    const sc = this.sun.shadow.camera;
    const ext = 9 + 2 * plan.balls.length;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.updateProjectionMatrix();
    this.sun.shadow.radius = 2 + 10 * st.shadowSoftness;
    this.sun.shadow.blurSamples = 8;

    if (this.bloom.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clear();
    this.renderer.dispose();
    this.pmrem.dispose();
  }
}
