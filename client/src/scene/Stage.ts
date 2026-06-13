import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { TweenManager } from "../util/tween";

/**
 * Owns the renderer, scene graph, camera, lighting and the main loop.
 * Game systems subscribe to `onFrame` for per-frame updates and use
 * `tweens` for animation. `timeScale` lets the battle director drop the
 * whole world into slow motion.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly tweens = new TweenManager();

  /** 1 = normal speed, <1 = slow motion. Animations use scaled time. */
  timeScale = 1;
  /** When true the orbit controls are suspended so a cinematic can drive the camera. */
  cameraLocked = false;

  private clock = new THREE.Clock();
  private frameCbs = new Set<(dt: number, scaledDt: number) => void>();
  private keyLight!: THREE.DirectionalLight;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;

  constructor(mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d1a);
    this.scene.fog = new THREE.Fog(0x0b0d1a, 18, 42);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.position.set(0, 9.5, 11);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 26;
    this.controls.maxPolarAngle = Math.PI / 2.05; // don't go under the board
    this.controls.target.set(0, 0.4, 0);

    // Image-based lighting: gives metals/marble real reflections instead of
    // the flat grey look you get from direct lights alone.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.setupLighting();
    this.setupEnvironment();
    this.setupComposer();

    window.addEventListener("resize", this.onResize);
    this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  private setupComposer(): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Soft glow on bright things (gold rail, battle sparks, emissive flashes).
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5, // strength
      0.5, // radius
      0.9, // threshold — only genuinely bright pixels bloom
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private setupLighting(): void {
    const ambient = new THREE.HemisphereLight(0x9bb0ff, 0x1a1530, 0.25);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff3d6, 1.5);
    key.position.set(8, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    const s = 12;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x6ea8ff, 0.8);
    rim.position.set(-9, 7, -10);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0xff8a5c, 0.35, 40);
    fill.position.set(0, 6, -6);
    this.scene.add(fill);
  }

  private setupEnvironment(): void {
    // Subtle ground plane far below to catch the board's shadow / glow.
    const groundGeo = new THREE.CircleGeometry(40, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x070812,
      roughness: 0.95,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // A faint starfield for atmosphere.
    const starCount = 600;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 30 + Math.random() * 50;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 4;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      starsGeo,
      new THREE.PointsMaterial({ color: 0xaab4ff, size: 0.13, transparent: true, opacity: 0.7 }),
    );
    this.scene.add(stars);
  }

  /** Point the camera at the board from White's or Black's side. */
  setViewpoint(color: "w" | "b"): void {
    const z = color === "w" ? 11 : -11;
    this.camera.position.set(0, 9.5, z);
    this.controls.target.set(0, 0.4, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  onFrame(cb: (dt: number, scaledDt: number) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  /** Flash the key light brighter (used on heavy battle hits). */
  pulseKeyLight(intensity: number, durationMs = 120): void {
    const base = 1.5;
    this.keyLight.intensity = intensity;
    setTimeout(() => (this.keyLight.intensity = base), durationMs);
  }

  private loop = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp huge tab-switch gaps
    const scaledDt = dt * this.timeScale;
    this.tweens.update(scaledDt);
    for (const cb of this.frameCbs) cb(dt, scaledDt);
    if (!this.cameraLocked) this.controls.update();
    this.composer.render();
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloom.setSize(window.innerWidth, window.innerHeight);
  };
}
