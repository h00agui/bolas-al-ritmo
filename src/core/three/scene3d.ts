// Escena WebGL (three.js) del Circuito 3D. Solo se carga en el navegador o en la app.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hexToRgb, type RGB } from '../color.ts';
import {
  ballActive,
  ballAtPlan,
  cameraAt,
  recoilAt,
  shakeAt,
  type CircuitPlan,
  type Piece,
} from '../modes/circuit.plan.ts';
import { frameTime, rnd, visibleHit } from '../scene/draw.ts';
import type { SceneStyle } from '../scene/style.ts';

const rgb = (c: RGB) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
const PLAN_STYLE_KEYS: (keyof SceneStyle)[] = [
  'material3d',
  'colorMode',
  'palette',
  'colors',
  'noteNames',
  'tileSize',
  'floorColor',
];

interface PieceObj {
  piece: Piece;
  group: THREE.Group; // parte que se mueve con el golpe
  base: THREE.Vector3;
  normal: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[]; // materiales que destellan
  pivot?: THREE.Group; // teclas: giran sobre su bisagra en vez de hundirse
  lever?: number; // distancia bisagra → punto de contacto
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
  private balls: THREE.Mesh[] = [];
  private ballMats: THREE.MeshPhysicalMaterial[] = [];
  private pieces: PieceObj[] = [];
  private root = new THREE.Group();
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private labelCache = new Map<string, THREE.Texture>();
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

    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x3d7a58,
      roughness: 1,
      metalness: 0,
      map: this.floorTexture(),
    });
    // fondo: pared vertical detrás de las piezas (recibe las sombras)
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.floorMat);
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
  private floorTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const x = c.getContext('2d')!;
    const img = x.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 238 + Math.round(17 * (rnd(i % 256, (i / 256) | 0) - 0.5));
      img.data[4 * i] = v;
      img.data[4 * i + 1] = v;
      img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120, 120);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setSize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private surfaceMaterial(st: SceneStyle, color: RGB): THREE.MeshStandardMaterial {
    if (st.material3d === 'color')
      return new THREE.MeshStandardMaterial({ color: rgb(color), roughness: 0.32, metalness: 0.15 });
    if (st.material3d === 'mate')
      return new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.85, metalness: 0 });
    return new THREE.MeshStandardMaterial({ color: 0xd2d6da, roughness: 0.22, metalness: 1 });
  }

  private label(name: string): THREE.Texture {
    let t = this.labelCache.get(name);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(20,20,26,0.82)';
    x.font = '700 92px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(name, 128, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.labelCache.set(name, t);
    return t;
  }

  private addLabel(group: THREE.Group, name: string, size: number, y: number): void {
    group.add(this.makeLabel(name, size, y));
  }

  private makeLabel(name: string, size: number, y: number): THREE.Mesh {
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.5, size * 0.25),
      new THREE.MeshBasicMaterial({
        map: this.label(name),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    lab.rotation.x = -Math.PI / 2;
    lab.position.y = y;
    return lab;
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
    this.balls = [];
    this.ballMats = [];
  }

  /** Construye las piezas (colgadas de la pared) y las bolas de un plan. */
  private build(plan: CircuitPlan, st: SceneStyle): void {
    this.clear();
    const up = new THREE.Vector3(0, 1, 0);
    const T = st.tileSize * 0.075;
    const rodGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 12);
    const mountGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20);
    const jointGeo = new THREE.SphereGeometry(0.06, 16, 12);
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
      const n = new THREE.Vector3(...piece.n);
      const contact = new THREE.Vector3(...piece.P).addScaledVector(n, -plan.r);
      const group = new THREE.Group();
      const mats: THREE.MeshStandardMaterial[] = [];
      let center: THREE.Vector3;
      let pieceExtra: { pivot: THREE.Group; lever: number } | undefined;
      switch (piece.kind) {
        case 'key': {
          // tecla de piano con grosor: blanca (natural) o negra (sostenido); la bola pisa cerca del borde delantero
          const len = piece.size;
          const wd = st.tileSize * (piece.black ? 0.2 : 0.3);
          const th = st.tileSize * (piece.black ? 0.26 : 0.2);
          center = contact.clone().addScaledVector(n, -th / 2);
          const mat = (piece.black ? ebony : ivory).clone();
          mats.push(mat);
          const key = new THREE.Mesh(new RoundedBoxGeometry(wd, th, len, 2, th * 0.18), mat);
          key.castShadow = true;
          key.receiveShadow = true;
          // la tecla va de la pared (bisagra, atrás) hacia la cámara; la bola pisa a 0.42·len del borde delantero
          const pivot = new THREE.Group();
          pivot.position.z = -0.58 * len;
          key.position.z = len / 2;
          pivot.add(key);
          if (st.noteNames && piece.name) {
            const lab = this.makeLabel(piece.name, wd * 2.2, th / 2 + 0.003);
            lab.position.z = 0.58 * len;
            pivot.add(lab);
          }
          group.add(pivot);
          pieceExtra = { pivot, lever: 0.58 * len };
          addBracket(center.x, center.y - th / 2 - 0.03, center.z - len * 0.4);
          break;
        }
        case 'bar': {
          const len = piece.size;
          const wd = st.tileSize * 0.36;
          const h = T * 1.6;
          center = contact.clone().addScaledVector(n, -h / 2);
          const mat = new THREE.MeshStandardMaterial({
            color: rgb(piece.col),
            roughness: 0.35,
            metalness: 0.1,
          });
          mats.push(mat);
          const bar = new THREE.Mesh(new RoundedBoxGeometry(len, h, wd, 3, h * 0.3), mat);
          bar.castShadow = true;
          bar.receiveShadow = true;
          group.add(bar);
          if (st.noteNames && piece.name) this.addLabel(group, piece.name, len, h / 2 + 0.003);
          for (const sx of [-0.3, 0.3]) addBracket(center.x + sx * len, center.y - h / 2 - 0.02, center.z);
          break;
        }
        case 'drum': {
          const R = piece.size;
          const H = 0.3;
          center = contact.clone().addScaledVector(n, -0.01);
          const skin = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.75, metalness: 0 });
          mats.push(skin);
          const head = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 32), skin);
          head.rotation.x = -Math.PI / 2;
          head.receiveShadow = true;
          group.add(head);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.025, 10, 40), this.chrome);
          rim.rotation.x = Math.PI / 2;
          rim.castShadow = true;
          group.add(rim);
          const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 32, 1, true), this.dark);
          shell.castShadow = true;
          shell.receiveShadow = true;
          shell.position.y = -H / 2;
          const body = new THREE.Group();
          body.position.copy(center);
          body.quaternion.setFromUnitVectors(up, n);
          body.add(shell);
          const bottom = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.02, 32), this.dark);
          bottom.position.y = -H;
          body.add(bottom);
          this.root.add(body);
          if (st.noteNames && piece.name) this.addLabel(group, piece.name, R * 2, 0.004);
          addBracket(center.x, center.y - H / 2, center.z);
          break;
        }
        case 'bumper': {
          const R = piece.size;
          const H = 0.26;
          center = contact.clone().addScaledVector(n, -H / 2);
          const ring = new THREE.MeshStandardMaterial({
            color: rgb(piece.col),
            roughness: 0.45,
            metalness: 0,
            emissive: rgb(piece.col),
            emissiveIntensity: 0.1,
          });
          mats.push(ring);
          const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, R, H, 28), ring);
          body.castShadow = true;
          body.receiveShadow = true;
          group.add(body);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.06, 28), this.chrome);
          cap.position.y = H / 2 + 0.03;
          cap.castShadow = true;
          group.add(cap);
          addBracket(center.x, center.y - H / 2 - 0.02, center.z);
          break;
        }
        default: {
          const L = piece.size;
          center = contact.clone().addScaledVector(n, -T / 2);
          const mat = this.surfaceMaterial(st, piece.col);
          mats.push(mat);
          const tile = new THREE.Mesh(new RoundedBoxGeometry(L, T, L * 0.66, 3, T * 0.45), mat);
          tile.castShadow = true;
          tile.receiveShadow = true;
          group.add(tile);
          const joint = new THREE.Mesh(jointGeo, this.chrome);
          joint.position.y = -T / 2 - 0.03;
          joint.castShadow = true;
          group.add(joint);
          if (st.noteNames && piece.name) this.addLabel(group, piece.name, L, T / 2 + 0.003);
          addBracket(center.x, center.y - T / 2 - 0.06, center.z);
        }
      }
      group.position.copy(center);
      group.quaternion.setFromUnitVectors(up, n);
      this.root.add(group);
      this.pieces.push({ piece, group, base: center.clone(), normal: n, mats, ...pieceExtra });
    }
    for (let b = 0; b < plan.balls.length; b++) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.12,
        metalness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
      mesh.scale.setScalar(plan.r);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.balls.push(mesh);
      this.ballMats.push(mat);
    }
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
    this.floorMat.color.set(st.floorColor);
    const fl = hexToRgb(st.floorColor);
    this.hemi.groundColor.setRGB(fl[0] / 510, fl[1] / 510, fl[2] / 510);
    this.bloom.strength = 0.6 * st.bloom;
    this.bloom.enabled = st.bloom > 0.01;

    // bolas y piezas golpeadas recientemente
    for (let b = 0; b < plan.balls.length; b++) {
      const bp = plan.balls[b];
      this.balls[b].visible = ballActive(bp, t);
      const k = visibleHit(bp.T, t, fps);
      const age = k >= 0 ? t - frameTime(bp.T[k], fps) : 99;
      let pos = ballAtPlan(bp, plan, t);
      for (const j of [k, k + 1])
        if (j >= 0 && j < bp.T.length && Math.abs(t - bp.T[j]) < 0.5 / fps) pos = bp.P[j];
      this.balls[b].position.set(pos[0], pos[1], pos[2]);
      const col = k >= 0 ? bp.col[k] : (bp.col[0] ?? plan.startCol);
      const hsl = { h: 0, s: 0, l: 0 };
      rgb(col).getHSL(hsl);
      this.ballMats[b].color.setHSL(hsl.h, Math.min(1, hsl.s * 1.5 + 0.1), hsl.l * 0.55);
      this.ballMats[b].emissive.copy(rgb(col)).multiplyScalar(0.1 + 0.5 * Math.exp(-age / 0.08));
      for (let j = Math.max(0, k - 25); j <= k && j < bp.T.length; j++) {
        const po = this.pieces[bp.pieces[j]];
        const a = t - frameTime(bp.T[j], fps);
        const d = recoilAt(a, bp.S[j], st.recoil) * (po.piece.kind === 'drum' ? 0.5 : 1);
        if (po.pivot && po.lever) po.pivot.rotation.x = Math.max(0, d) / po.lever;
        else po.group.position.copy(po.base).addScaledVector(po.normal, -d);
        const glow = Math.exp(-a / 0.18);
        for (const m of po.mats) {
          m.emissive.copy(
            po.piece.kind === 'plate' && st.material3d === 'cromo'
              ? new THREE.Color(0xffffff)
              : rgb(po.piece.col),
          );
          m.emissiveIntensity =
            (po.piece.kind === 'bumper' ? 0.1 : 0) + (po.piece.kind === 'plate' ? 0.3 : 0.35) * glow;
        }
        if (po.piece.kind === 'drum') po.group.scale.setScalar(1 + 0.06 * glow);
      }
      if (k >= 26) {
        const po = this.pieces[bp.pieces[k - 26]];
        po.group.position.copy(po.base);
        po.group.scale.setScalar(1);
        if (po.pivot) po.pivot.rotation.x = 0;
        for (const m of po.mats) m.emissiveIntensity = po.piece.kind === 'bumper' ? 0.1 : 0;
      }
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

    // cámara del director (+ vibración en los golpes fuertes)
    const cam = cameraAt(plan, t);
    const sh = shakeAt(plan, t) * 0.12;
    const jx = sh * (rnd(Math.floor(t * 60), 1) - 0.5);
    const jy = sh * (rnd(Math.floor(t * 60), 2) - 0.5);
    this.camera.position.set(cam.pos[0] + jx, cam.pos[1] + jy, cam.pos[2]);
    this.camera.lookAt(cam.look[0] + jx, cam.look[1] + jy, cam.look[2]);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
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
