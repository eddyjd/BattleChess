import * as THREE from "three";
import type { Stage } from "../../scene/Stage";
import { playLoop, playOnce, type PieceObject } from "../Characters";
import { Easings } from "../../util/tween";
import { ParticleFX } from "./Particles";

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Battle Chess-style capture: the camera dives into a slow-motion close-up,
 * the attacker closes in and strikes with its real attack animation, the
 * defender is hit and dies (skeletons crumble to bones), and the victor
 * advances onto the square with a cheer.
 */
export class BattleDirector {
  private fx: ParticleFX;
  private shakeAmp = 0;
  private cineBase = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private driving = false;

  constructor(
    private stage: Stage,
    private setCinematic: (on: boolean) => void,
  ) {
    this.fx = new ParticleFX(stage.scene);
    stage.onFrame((dt) => {
      this.fx.update(dt * stage.timeScale);
      if (!this.driving) return;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 6 * this.shakeAmp - dt * 0.4);
      const cam = this.stage.camera;
      if (this.shakeAmp > 0.0005) {
        cam.position.set(
          this.cineBase.x + (Math.random() - 0.5) * this.shakeAmp,
          this.cineBase.y + (Math.random() - 0.5) * this.shakeAmp,
          this.cineBase.z + (Math.random() - 0.5) * this.shakeAmp,
        );
      } else {
        cam.position.copy(this.cineBase);
      }
      cam.lookAt(this.focus);
    });
  }

  private shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  async fight(attacker: PieceObject, defender: PieceObject): Promise<void> {
    const stage = this.stage;
    const tw = stage.tweens;
    const cam = stage.camera;

    const aStart = attacker.position.clone();
    const dPos = defender.position.clone();
    const dir = dPos.clone().sub(aStart).setY(0).normalize();
    const faceA = Math.atan2(dir.x, dir.z);
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    // Aim between the two fighters, a bit above the ground, so both are framed.
    this.focus.copy(dPos).addScaledVector(dir, -0.5).add(new THREE.Vector3(0, 0.85, 0));

    // --- cinematic camera ---
    const prevPos = cam.position.clone();
    const prevTarget = stage.controls.target.clone();
    const prevFov = cam.fov;
    stage.cameraLocked = true;
    this.driving = true;
    this.setCinematic(true);
    const cineTarget = this.focus
      .clone()
      .add(side.clone().multiplyScalar(3.4))
      .add(dir.clone().multiplyScalar(-2.6))
      .add(new THREE.Vector3(0, 2.0, 0));
    this.cineBase.copy(prevPos);

    attacker.rotation.y = faceA;
    defender.rotation.y = faceA + Math.PI;
    playLoop(defender, "Idle", 0.1);

    stage.timeScale = 0.95;
    await tw.to({
      duration: 0.32,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(prevPos, cineTarget, t);
        cam.fov = THREE.MathUtils.lerp(prevFov, 44, t);
        cam.updateProjectionMatrix();
      },
    });

    // --- melee close the distance ---
    const standoff = dPos.clone().addScaledVector(dir, -0.95);
    if (!attacker.userData.caster) {
      stage.timeScale = 1;
      playLoop(attacker, "Running_A", 0.1);
      await tw.to({
        duration: 0.26,
        easing: Easings.quadOut,
        onUpdate: (t) => attacker.position.lerpVectors(aStart, standoff, t),
      });
      attacker.position.copy(standoff);
    }

    // --- the strike (sped up so the swing lands fast) ---
    stage.timeScale = 0.75;
    playOnce(attacker, attacker.userData.attack, 0.06, 1.7);
    const impactT = 0.5;
    if (attacker.userData.caster) this.castProjectile(attacker, dPos, impactT);
    await tw.delay(impactT);

    // --- impact ---
    this.impactAt(dPos, attacker.userData.color);
    playOnce(defender, "Hit_A", 0.05);
    this.knock(defender, dir, 0.35);
    await tw.delay(0.14);

    // --- death ---
    stage.timeScale = 0.85;
    playOnce(defender, defender.userData.death, 0.1, 1.2);
    this.fx.burst(dPos.clone().add(new THREE.Vector3(0, 0.5, 0)), {
      count: 30,
      color: defender.userData.color === "w" ? 0xb08050 : 0xcfc8b0,
      speed: 4,
      spread: 1,
      size: 0.14,
      lifetime: 1,
      gravity: 9,
    });
    await tw.delay(0.3);
    await this.fadeOut(defender, 0.5);

    // --- victor advances onto the square ---
    stage.timeScale = 1;
    playLoop(attacker, "Walking_A", 0.1);
    const from = attacker.position.clone();
    await tw.to({
      duration: 0.24,
      easing: Easings.cubicInOut,
      onUpdate: (t) => attacker.position.lerpVectors(from, dPos, t),
    });
    attacker.position.copy(dPos);
    attacker.rotation.y = attacker.userData.color === "w" ? Math.PI : 0;
    playOnce(attacker, "Cheer", 0.12);
    await tw.delay(0.3);
    playLoop(attacker, "Idle", 0.2);

    // --- restore camera ---
    stage.timeScale = 1;
    await tw.to({
      duration: 0.35,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(cineTarget, prevPos, t);
        cam.fov = THREE.MathUtils.lerp(44, prevFov, t);
        cam.updateProjectionMatrix();
      },
    });
    this.driving = false;
    cam.position.copy(prevPos);
    cam.fov = prevFov;
    cam.updateProjectionMatrix();
    stage.controls.target.copy(prevTarget);
    stage.cameraLocked = false;
    this.setCinematic(false);
  }

  private impactAt(at: THREE.Vector3, attackerColor: "w" | "b"): void {
    const chest = at.clone().add(new THREE.Vector3(0, 0.85, 0));
    this.fx.burst(chest, {
      count: 26,
      color: attackerColor === "w" ? 0xffce5c : 0x9b6bff,
      speed: 7,
      spread: 1,
      size: 0.14,
      lifetime: 0.6,
    });
    this.fx.burst(chest, { count: 12, color: 0xffffff, speed: 9, spread: 0.6, size: 0.09, lifetime: 0.35 });
    this.fx.shockwave(at, { color: 0xffe6a0, maxRadius: 2.2, lifetime: 0.5 });
    this.shake(0.5);
    this.stage.pulseKeyLight(6, 110);
  }

  private knock(defender: PieceObject, dir: THREE.Vector3, amount: number): void {
    const base = defender.position.clone();
    this.stage.tweens.to({
      duration: 0.16,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        const push = Math.sin(t * Math.PI) * amount;
        defender.position.x = base.x + dir.x * push * 0.4;
        defender.position.z = base.z + dir.z * push * 0.4;
      },
    });
  }

  private castProjectile(attacker: PieceObject, target: THREE.Vector3, travel: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(attacker.userData.color === "w" ? 0x66ccff : 0xb060ff),
      emissiveIntensity: 6,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat);
    const start = attacker.position.clone().add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(
      new THREE.Vector3(Math.sin(attacker.rotation.y), 0, Math.cos(attacker.rotation.y)),
      0.4,
    );
    const end = target.clone().add(new THREE.Vector3(0, 0.85, 0));
    orb.position.copy(start);
    this.stage.scene.add(orb);
    this.stage.tweens.to({
      duration: travel,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        orb.position.lerpVectors(start, end, t);
      },
      onComplete: () => {
        this.stage.scene.remove(orb);
        orb.geometry.dispose();
        mat.dispose();
      },
    });
  }

  private async fadeOut(piece: PieceObject, duration: number): Promise<void> {
    for (const m of piece.userData.materials) {
      m.transparent = true;
      (m as THREE.Material & { depthWrite?: boolean }).depthWrite = false;
    }
    const startY = piece.position.y;
    await this.stage.tweens.to({
      duration,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        piece.position.y = startY - t * 0.4;
        for (const m of piece.userData.materials) (m as THREE.Material).opacity = 1 - t;
      },
    });
  }
}
