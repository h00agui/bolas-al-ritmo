// Escena WebGL (three.js) del modo Plataformas 3D. Solo se carga en el navegador o en la app.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hexToRgb, type RGB } from '../color.ts';
import { ballAt3d, cameraTarget3d, recoilAt, type Plan3D } from '../modes/platforms3d.plan.ts';
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

interface Platform {
  group: THREE.Group; // placa + rótula (se mueve con el rebote)
  base: THREE.Vector3; // posición de reposo del grupo
  normal: THREE.Vector3;
  tile: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

export class Scene3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 9 / 16, 0.1, 200);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private floor: THREE.Mesh;
  private floorMat: THREE.MeshStandardMaterial;
  private ball: THREE.Mesh;
  private ballMat: THREE.MeshPhysicalMaterial;
  private platforms: Platform[] = [];
  private platformRoot = new THREE.Group();
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private labelCache = new Map<string, THREE.Texture>();
  private planKey = '';
  private planRef: Plan3D | null = null;
  private pmrem: THREE.PMREMGenerator;

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
    this.scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x335533, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x3d7a58, roughness: 1, metalness: 0 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.ballMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.ballMat);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.scene.add(this.platformRoot);

    this.sparkPos = new Float32Array(3 * 96);
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
  }

  setSize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private material(st: SceneStyle, color: RGB): THREE.MeshStandardMaterial {
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
    x.clearRect(0, 0, 256, 128);
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

  /** Construye (o reconstruye) las placas para un plan. */
  private build(plan: Plan3D, st: SceneStyle): void {
    for (const p of this.platforms) {
      p.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      p.mat.dispose();
    }
    this.platformRoot.clear();
    this.platforms = [];
    const { length: L, width: Wd, thickness: th } = plan.tile;
    const tileGeo = new RoundedBoxGeometry(L, th, Wd, 3, th * 0.45);
    const rodGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 12);
    const footGeo = new THREE.SphereGeometry(0.085, 20, 14);
    const jointGeo = new THREE.SphereGeometry(0.06, 16, 12);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.2, metalness: 1 });
    const labelGeo = new THREE.PlaneGeometry(L * 0.5, L * 0.25);
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < plan.N; k++) {
      const n = new THREE.Vector3(...plan.n[k]);
      const contact = new THREE.Vector3(...plan.P[k]).addScaledVector(n, -plan.r);
      const center = contact.clone().addScaledVector(n, -th / 2);
      const mat = this.material(st, plan.col[k]);
      const tile = new THREE.Mesh(tileGeo, mat);
      tile.castShadow = true;
      tile.receiveShadow = true;
      const group = new THREE.Group();
      group.position.copy(center);
      group.quaternion.setFromUnitVectors(up, n);
      group.add(tile);
      const joint = new THREE.Mesh(jointGeo, chrome);
      joint.position.y = -th / 2 - 0.03;
      joint.castShadow = true;
      group.add(joint);
      if (st.noteNames && plan.names[k]) {
        const lab = new THREE.Mesh(
          labelGeo,
          new THREE.MeshBasicMaterial({
            map: this.label(plan.names[k]),
            transparent: true,
            toneMapped: false,
            depthWrite: false,
          }),
        );
        lab.rotation.x = -Math.PI / 2;
        lab.position.y = th / 2 + 0.003;
        group.add(lab);
      }
      this.platformRoot.add(group);
      // varilla vertical desde el suelo hasta la rótula
      const topY = center.y - th / 2 - 0.06;
      const rod = new THREE.Mesh(rodGeo, chrome);
      rod.scale.y = Math.max(0.05, topY);
      rod.position.set(center.x, topY / 2, center.z);
      rod.castShadow = true;
      this.platformRoot.add(rod);
      const foot = new THREE.Mesh(footGeo, chrome);
      foot.position.set(center.x, 0.03, center.z);
      foot.castShadow = true;
      this.platformRoot.add(foot);
      this.platforms.push({ group, base: center, normal: n, tile, mat });
    }
    this.ball.scale.setScalar(plan.r);
  }

  /** Dibuja el instante t en el lienzo. */
  render(t: number, plan: Plan3D, st: SceneStyle, fps: number): void {
    const key = JSON.stringify([
      plan.T.length,
      plan.T[0],
      plan.T[plan.N - 1],
      plan.P[0],
      PLAN_STYLE_KEYS.map((k) => st[k]),
    ]);
    if (key !== this.planKey || this.planRef !== plan) {
      this.build(plan, st);
      this.planKey = key;
      this.planRef = plan;
    }
    this.floorMat.color.set(st.floorColor);
    const floorRgb = hexToRgb(st.floorColor);
    this.hemi.groundColor.setRGB(floorRgb[0] / 255 / 2, floorRgb[1] / 255 / 2, floorRgb[2] / 255 / 2);

    const k = visibleHit(plan.T, t, fps);
    const age = k >= 0 ? t - frameTime(plan.T[k], fps) : 99;
    const col = k >= 0 ? plan.col[k] : plan.startCol;

    // bola
    let bp = ballAt3d(plan, t);
    for (const j of [k, k + 1])
      if (j >= 0 && j < plan.N && Math.abs(t - plan.T[j]) < 0.5 / fps) bp = plan.P[j];
    this.ball.position.set(bp[0], bp[1], bp[2]);
    // la bola, más saturada y algo más oscura que el color plano (en 3D el brillo ya lo pone la luz)
    const hsl = { h: 0, s: 0, l: 0 };
    rgb(col).getHSL(hsl);
    this.ballMat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.05), hsl.l * 0.72);
    const flash = Math.exp(-age / 0.08);
    this.ballMat.emissive.copy(rgb(col)).multiplyScalar(0.6 * flash);

    // placas: rebote de muelle tras el golpe
    for (let j = Math.max(0, k - 25); j <= k && j < plan.N; j++) {
      const p = this.platforms[j];
      const a = t - frameTime(plan.T[j], fps);
      const d = recoilAt(a, plan.S[j], st.recoil);
      p.group.position.copy(p.base).addScaledVector(p.normal, -d);
    }
    if (k >= 26) {
      const p = this.platforms[k - 26];
      p.group.position.copy(p.base);
    }

    // chispas de los últimos choques
    let si = 0;
    for (let j = Math.max(0, k - 3); j <= k && j < plan.N; j++) {
      const a = t - frameTime(plan.T[j], fps);
      if (a < 0 || a > 0.35) continue;
      const n = plan.n[j];
      const c = plan.P[j];
      for (let i = 0; i < 14 && si < 96; i++, si++) {
        const ang = rnd(j, i) * Math.PI * 2;
        const spread = 0.3 + 0.5 * rnd(i, j + 3);
        const sp = 1 + 2 * rnd(j + 7, i);
        const dx = Math.cos(ang) * spread;
        const dz = Math.sin(ang) * spread;
        const vy = sp * (0.5 + n[1]);
        this.sparkPos[3 * si] = c[0] + dx * sp * a;
        this.sparkPos[3 * si + 1] = c[1] + vy * a - 6 * a * a;
        this.sparkPos[3 * si + 2] = c[2] + dz * sp * a;
      }
    }
    for (; si < 96; si++) this.sparkPos[3 * si + 1] = -100;
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).opacity =
      k >= 0 && age < 0.35 ? 0.85 * (1 - age / 0.35) : 0;

    // cámara: sigue el suelo bajo la bola desde el ángulo elegido
    const [cx, cz] = cameraTarget3d(plan, t);
    const target = new THREE.Vector3(cx, 0.9, cz - 2.2);
    const az = (st.cameraAzimuth * Math.PI) / 180;
    const el = (st.cameraElevation * Math.PI) / 180;
    const dist = st.cameraDistance;
    this.camera.position.set(
      target.x + dist * Math.sin(az) * Math.cos(el),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(az) * Math.cos(el),
    );
    this.camera.lookAt(target);
    this.floor.position.set(cx, 0, cz);

    // luz: dirección fija respecto al mundo, encuadre de sombras alrededor de la bola
    const la = (st.lightAngle * Math.PI) / 180;
    this.sun.position.set(cx + 9 * Math.sin(la), 11, cz + 9 * Math.cos(la));
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    const ext = 9;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.updateProjectionMatrix();
    this.sun.shadow.radius = 2 + 10 * st.shadowSoftness;
    this.sun.shadow.blurSamples = 8;

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.pmrem.dispose();
  }
}
