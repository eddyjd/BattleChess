import * as THREE from "three";
import type { Stage } from "../../scene/Stage";
import type { PieceObject } from "../PieceFactory";
import { Easings } from "../../util/tween";
import { ParticleFX } from "./Particles";

/**
 * Choreographs a capture as a short cinematic: the camera dives in, the
 * world drops into slow motion, the attacker lunges and strikes the
 * defender with sparks, shockwaves and screen shake, and the loser is
 * destroyed in a shower of debris. The attacker always wins (chess rules).
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
    // Drive camera + decay shake every frame while a battle is running.
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

  private setGlow(piece: PieceObject, intensity: number): void {
    for (const m of piece.userData.materials) m.emissiveIntensity = intensity;
  }

  /**
   * Run the full battle. Resolves once the defender is destroyed and the
   * attacker stands on the captured square (defender removal is the
   * caller's responsibility once this resolves).
   */
  async fight(attacker: PieceObject, defender: PieceObject): Promise<void> {
    const stage = this.stage;
    const tw = stage.tweens;

    const attackerStart = attacker.position.clone();
    const defenderPos = defender.position.clone();
    const mid = attackerStart.clone().lerp(defenderPos, 0.5);
    this.focus.copy(mid).add(new THREE.Vector3(0, 0.55, 0));

    const attackDir = defenderPos.clone().sub(attackerStart).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(attackDir, new THREE.Vector3(0, 1, 0)).normalize();

    // --- Set up cinematic camera (driven manually) ---
    const prevPos = stage.camera.position.clone();
    const prevTarget = stage.controls.target.clone();
    stage.cameraLocked = true;
    this.driving = true;
    this.setCinematic(true);

    const cineTarget = this.focus
      .clone()
      .add(side.clone().multiplyScalar(2.6))
      .add(attackDir.clone().multiplyScalar(-1.2))
      .add(new THREE.Vector3(0, 1.7, 0));
    this.cineBase.copy(prevPos);

    // Face the attacker toward its prey.
    const faceAngle = Math.atan2(attackDir.x, attackDir.z);

    // 1) Dive in + wind up (gentle slow-mo).
    stage.timeScale = 0.8;
    await tw.to({
      duration: 0.45,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(prevPos, cineTarget, t);
        attacker.rotation.y = THREE.MathUtils.lerp(attacker.rotation.y, faceAngle, t * 0.6);
        const lift = Math.sin(t * Math.PI) * 0.25;
        attacker.position.copy(attackerStart).addScaledVector(attackDir, -0.15 * t);
        attacker.position.y = attackerStart.y + lift;
        this.setGlow(attacker, t * 0.9);
        attacker.scale.setScalar(1 + t * 0.08);
      },
    });

    // 2) The lunge — explosive dash into the defender.
    const contact = attackerStart.clone().lerp(defenderPos, 0.66);
    stage.timeScale = 1;
    await tw.to({
      duration: 0.16,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        attacker.position.lerpVectors(attackerStart, contact, t);
        attacker.position.y = attackerStart.y + Math.sin(t * Math.PI) * 0.35;
      },
    });

    // 3) IMPACT — heavy slow-mo, sparks, shockwave, shake, light flash.
    stage.timeScale = 0.32;
    this.impact(contact, defenderPos, 1.0);
    this.knock(defender, attackDir, 0.35);
    await tw.delay(0.12);

    // 4) Flurry of follow-up strikes.
    for (let i = 0; i < 2; i++) {
      await tw.to({
        duration: 0.09,
        easing: Easings.quadOut,
        onUpdate: (t) => {
          const back = attackerStart.clone().lerp(contact, 0.7);
          attacker.position.lerpVectors(contact, back, Math.sin(t * Math.PI));
        },
      });
      this.impact(contact, defenderPos, 0.7);
      this.knock(defender, attackDir, 0.18);
      await tw.delay(0.06);
    }

    // 5) Finisher + the defender is destroyed.
    stage.timeScale = 0.28;
    this.impact(defenderPos, defenderPos, 1.4);
    this.fx.burst(defenderPos.clone().add(new THREE.Vector3(0, defender.userData.height * 0.5, 0)), {
      count: 60,
      color: defender.userData.color === "w" ? 0xfff0c0 : 0x8ab4ff,
      speed: 9,
      spread: 1.2,
      size: 0.2,
      lifetime: 1.1,
    });
    stage.pulseKeyLight(7, 140);
    this.shake(0.9);

    await this.destroy(defender);

    // 6) Attacker plants itself on the captured square and powers down.
    stage.timeScale = 0.7;
    await tw.to({
      duration: 0.3,
      easing: Easings.cubicOut,
      onUpdate: (t) => {
        attacker.position.lerpVectors(contact, defenderPos, t);
        attacker.position.y = defenderPos.y + Math.sin((1 - t) * Math.PI) * 0.1;
        this.setGlow(attacker, 0.9 * (1 - t));
        attacker.scale.setScalar(1.08 - t * 0.08);
      },
    });
    attacker.position.copy(defenderPos);
    attacker.scale.setScalar(1);
    this.setGlow(attacker, 0);

    // 7) Restore the orbit camera.
    stage.timeScale = 1;
    await tw.to({
      duration: 0.4,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(cineTarget, prevPos, t);
        this.focus.lerpVectors(this.focus, prevTarget, t * 0.5);
      },
    });

    this.driving = false;
    stage.camera.position.copy(prevPos);
    stage.controls.target.copy(prevTarget);
    stage.cameraLocked = false;
    this.setCinematic(false);
  }

  /** Sparks + shockwave + shake at a point. */
  private impact(at: THREE.Vector3, ground: THREE.Vector3, power: number): void {
    this.fx.burst(at.clone().add(new THREE.Vector3(0, 0.4, 0)), {
      count: Math.round(28 * power),
      color: 0xffce5c,
      speed: 7 * power,
      spread: 1,
      size: 0.16,
      lifetime: 0.7,
    });
    this.fx.burst(at.clone().add(new THREE.Vector3(0, 0.4, 0)), {
      count: Math.round(14 * power),
      color: 0xffffff,
      speed: 9 * power,
      spread: 0.6,
      size: 0.1,
      lifetime: 0.4,
    });
    this.fx.shockwave(ground, { color: 0xffe6a0, maxRadius: 1.8 * power + 1, lifetime: 0.55 });
    this.shake(0.35 * power + 0.15);
    this.stage.pulseKeyLight(4 + power * 2, 90);
  }

  /** Knock the defender back and tilt it. */
  private knock(defender: PieceObject, dir: THREE.Vector3, amount: number): void {
    this.stage.tweens.to({
      duration: 0.14,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        const push = Math.sin(t * Math.PI) * amount;
        defender.position.x += dir.x * push * 0.15;
        defender.position.z += dir.z * push * 0.15;
        defender.rotation.z = -dir.x * push * 0.5;
        defender.rotation.x = dir.z * push * 0.5;
      },
    });
  }

  /** The losing piece spins, sinks, shatters and fades out. */
  private async destroy(defender: PieceObject): Promise<void> {
    for (const m of defender.userData.materials) {
      m.transparent = true;
      m.emissive.setHex(0xff5533);
    }
    const start = defender.position.clone();
    // Debris shards.
    this.fx.burst(start.clone().add(new THREE.Vector3(0, defender.userData.height * 0.4, 0)), {
      count: 40,
      color: defender.userData.color === "w" ? 0xe8d9b5 : 0x3a3f55,
      speed: 5,
      spread: 1.1,
      size: 0.18,
      lifetime: 1.2,
      gravity: 12,
    });
    await this.stage.tweens.to({
      duration: 0.5,
      easing: Easings.cubicIn,
      onUpdate: (t) => {
        defender.rotation.y += 0.5;
        defender.position.y = start.y - t * 1.2;
        defender.scale.setScalar(Math.max(0.001, 1 - t));
        for (const m of defender.userData.materials) {
          m.opacity = 1 - t;
          m.emissiveIntensity = (1 - t) * 1.5;
        }
      },
    });
  }
}
