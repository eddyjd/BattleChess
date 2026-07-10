import * as THREE from "three";

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  baseSize: number;
}

interface Wave {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxRadius: number;
}

/**
 * Spark bursts, debris and expanding shockwave rings — the visual punch of
 * a capture battle. All effects advance on scaled (slow-mo aware) delta.
 */
export class ParticleFX {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];
  private waves: Wave[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** A spray of glowing sparks from a point. */
  burst(
    pos: THREE.Vector3,
    opts: {
      count?: number;
      color?: number;
      speed?: number;
      spread?: number;
      size?: number;
      lifetime?: number;
      gravity?: number;
      upBias?: number;
    } = {},
  ): void {
    const count = opts.count ?? 36;
    const speed = opts.speed ?? 6;
    const spread = opts.spread ?? 1;
    const color = opts.color ?? 0xffce5c;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * spread,
        Math.random() * (opts.upBias ?? 1) + 0.1,
        (Math.random() - 0.5) * 2 * spread,
      ).normalize();
      const v = speed * (0.4 + Math.random() * 0.6);
      velocities[i * 3] = dir.x * v;
      velocities[i * 3 + 1] = dir.y * v;
      velocities[i * 3 + 2] = dir.z * v;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: opts.size ?? 0.16,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: opts.lifetime ?? 0.9,
      gravity: opts.gravity ?? 9,
      baseSize: opts.size ?? 0.16,
    });
  }

  /** An expanding, fading ring on the board surface. */
  shockwave(pos: THREE.Vector3, opts: { color?: number; maxRadius?: number; lifetime?: number } = {}): void {
    const geo = new THREE.RingGeometry(0.1, 0.25, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: opts.color ?? 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y = 0.08;
    this.group.add(mesh);
    this.waves.push({ mesh, life: 0, maxLife: opts.lifetime ?? 0.6, maxRadius: opts.maxRadius ?? 2.4 });
  }

  update(dt: number): void {
    // Sparks
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const k = b.life / b.maxLife;
      if (k >= 1) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let p = 0; p < arr.length / 3; p++) {
        b.velocities[p * 3 + 1] -= b.gravity * dt;
        arr[p * 3] += b.velocities[p * 3] * dt;
        arr[p * 3 + 1] += b.velocities[p * 3 + 1] * dt;
        arr[p * 3 + 2] += b.velocities[p * 3 + 2] * dt;
        if (arr[p * 3 + 1] < 0.02) {
          arr[p * 3 + 1] = 0.02;
          b.velocities[p * 3 + 1] *= -0.35; // little bounce
        }
      }
      pos.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity = 1 - k;
      mat.size = b.baseSize * (1 - k * 0.5);
    }

    // Shockwaves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life += dt;
      const k = w.life / w.maxLife;
      if (k >= 1) {
        this.group.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(i, 1);
        continue;
      }
      const r = 0.1 + k * w.maxRadius;
      w.mesh.scale.setScalar(r);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }
}
