import * as THREE from "three";
import type { Stage } from "../../scene/Stage";
import type { PieceObject, PieceType } from "../PieceFactory";
import { Easings, type Easing } from "../../util/tween";
import { ParticleFX } from "./Particles";

/** Per-attacker tuning so each piece's battle feels distinct. */
const ATTACK_COLOR: Record<PieceType, number> = {
  p: 0xffce5c, // sparks of steel
  n: 0xfff0c0, // dust of the charge
  b: 0xbf8bff, // arcane violet
  r: 0xff9a4d, // siege embers
  q: 0xff5ec7, // royal magenta
  k: 0xffe27a, // golden wrath
};
const FINISH_POWER: Record<PieceType, number> = {
  p: 0.9, n: 1.3, b: 1.1, r: 1.6, q: 1.4, k: 1.8,
};

interface FightCtx {
  attacker: PieceObject;
  defender: PieceObject;
  attackerStart: THREE.Vector3;
  defenderPos: THREE.Vector3;
  contact: THREE.Vector3;
  attackDir: THREE.Vector3;
  side: THREE.Vector3;
}

/**
 * Choreographs a capture as a short cinematic. The camera dives in, the
 * world drops into slow motion, and the attacker performs a piece-specific
 * battle routine — a pawn's quick stab, a knight's leaping charge, a
 * bishop's arcane dash, a rook's siege slam, the queen's flurry, the king's
 * overhead smash — before the loser is destroyed. The attacker always wins.
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

  private setGlow(piece: PieceObject, intensity: number): void {
    for (const m of piece.userData.materials) m.emissiveIntensity = intensity;
  }

  async fight(attacker: PieceObject, defender: PieceObject): Promise<void> {
    const stage = this.stage;
    const tw = stage.tweens;

    const attackerStart = attacker.position.clone();
    const defenderPos = defender.position.clone();
    const mid = attackerStart.clone().lerp(defenderPos, 0.5);
    this.focus.copy(mid).add(new THREE.Vector3(0, 0.55, 0));

    const attackDir = defenderPos.clone().sub(attackerStart).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(attackDir, new THREE.Vector3(0, 1, 0)).normalize();
    const contact = attackerStart.clone().lerp(defenderPos, 0.62);
    const ctx: FightCtx = { attacker, defender, attackerStart, defenderPos, contact, attackDir, side };

    // --- Cinematic camera (driven manually) ---
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

    const faceAngle = Math.atan2(attackDir.x, attackDir.z);

    // 1) Dive in + wind up.
    stage.timeScale = 0.8;
    await tw.to({
      duration: 0.42,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(prevPos, cineTarget, t);
        attacker.rotation.y = THREE.MathUtils.lerp(attacker.rotation.y, faceAngle, t * 0.6);
        attacker.position.copy(attackerStart).addScaledVector(attackDir, -0.18 * t);
        attacker.position.y = attackerStart.y + Math.sin(t * Math.PI) * 0.18;
        this.setGlow(attacker, t * 0.9);
        attacker.scale.setScalar(1 + t * 0.06);
      },
    });

    // 2) Piece-specific battle routine.
    await this.choreograph(attacker.userData.type, ctx);

    // 3) Finisher — defender is destroyed.
    const power = FINISH_POWER[attacker.userData.type];
    stage.timeScale = 0.26;
    this.impact(defenderPos, defenderPos, power, attacker.userData.type);
    this.fx.burst(defenderPos.clone().add(new THREE.Vector3(0, defender.userData.height * 0.5, 0)), {
      count: Math.round(50 * power),
      color: defender.userData.color === "w" ? 0xfff0c0 : 0x8ab4ff,
      speed: 8 + power * 2,
      spread: 1.2,
      size: 0.2,
      lifetime: 1.1,
    });
    stage.pulseKeyLight(6 + power * 2, 150);
    this.shake(0.6 + power * 0.3);
    await this.destroy(defender);

    // 4) Attacker plants on the captured square and powers down.
    stage.timeScale = 0.7;
    const from = attacker.position.clone();
    await tw.to({
      duration: 0.3,
      easing: Easings.cubicOut,
      onUpdate: (t) => {
        attacker.position.lerpVectors(from, defenderPos, t);
        attacker.position.y = defenderPos.y + Math.sin((1 - t) * Math.PI) * 0.1;
        this.setGlow(attacker, 0.9 * (1 - t));
        attacker.scale.setScalar(attacker.scale.x + (1 - attacker.scale.x) * t);
      },
    });
    attacker.position.copy(defenderPos);
    attacker.rotation.set(0, faceAngle, 0);
    attacker.scale.setScalar(1);
    this.setGlow(attacker, 0);

    // 5) Restore the orbit camera.
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

  /* ----------------- per-piece battle choreographies ----------------- */

  private choreograph(type: PieceType, ctx: FightCtx): Promise<void> {
    switch (type) {
      case "n": return this.knightCharge(ctx);
      case "b": return this.bishopDash(ctx);
      case "r": return this.rookSiege(ctx);
      case "q": return this.queenFlurry(ctx);
      case "k": return this.kingSmash(ctx);
      default: return this.pawnStab(ctx);
    }
  }

  /** A single sharp lunge — humble but deadly. */
  private async pawnStab(ctx: FightCtx): Promise<void> {
    const { attacker, defender, attackerStart, contact, attackDir, defenderPos } = ctx;
    this.stage.timeScale = 1;
    await this.lunge(attacker, attackerStart, contact, 0.14, Easings.quadIn, 0.3);
    this.stage.timeScale = 0.32;
    this.impact(contact, defenderPos, 0.9, "p");
    this.knock(defender, attackDir, 0.3);
    await this.stage.tweens.delay(0.12);
  }

  /** Rear up, then leap high and slam down with a ground pound. */
  private async knightCharge(ctx: FightCtx): Promise<void> {
    const { attacker, defender, attackerStart, defenderPos, attackDir } = ctx;
    const tw = this.stage.tweens;
    // Rear back.
    await tw.to({
      duration: 0.2,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        attacker.position.copy(attackerStart).addScaledVector(attackDir, -0.3 * t);
        attacker.position.y = attackerStart.y + 0.1 * t;
        attacker.rotation.x = -0.5 * t;
      },
    });
    // Leaping arc onto the defender.
    this.stage.timeScale = 1;
    const landing = defenderPos.clone();
    const launch = attacker.position.clone();
    await tw.to({
      duration: 0.34,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        attacker.position.lerpVectors(launch, landing, t);
        attacker.position.y = launch.y + Math.sin(t * Math.PI) * 2.2;
        attacker.rotation.x = -0.5 + t * 0.5;
      },
    });
    // Slam.
    this.stage.timeScale = 0.3;
    attacker.rotation.x = 0;
    this.impact(defenderPos, defenderPos, 1.3, "n");
    this.fx.shockwave(defenderPos, { color: 0xffe6a0, maxRadius: 3.2, lifetime: 0.6 });
    this.knock(defender, attackDir, 0.45);
    this.shake(0.8);
    await tw.delay(0.12);
  }

  /** Rise, spin up, and dash diagonally through the defender with a slash. */
  private async bishopDash(ctx: FightCtx): Promise<void> {
    const { attacker, defender, attackerStart, defenderPos, contact, attackDir } = ctx;
    const tw = this.stage.tweens;
    let spin = attacker.rotation.y;
    // Charge: rise + spin.
    await tw.to({
      duration: 0.24,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        attacker.position.copy(attackerStart);
        attacker.position.y = attackerStart.y + 0.5 * t;
        spin += 0.5;
        attacker.rotation.y = spin;
        this.fx.shockwave(attacker.position, { color: 0xbf8bff, maxRadius: 0.9, lifetime: 0.3 });
      },
    });
    // Dash through.
    this.stage.timeScale = 0.9;
    const start = attacker.position.clone();
    await tw.to({
      duration: 0.16,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        attacker.position.lerpVectors(start, contact, t);
        spin += 0.8;
        attacker.rotation.y = spin;
      },
    });
    this.stage.timeScale = 0.3;
    // Arcane slash: a colored streak across the defender.
    this.impact(contact, defenderPos, 1.0, "b");
    this.fx.burst(defenderPos.clone().add(new THREE.Vector3(0, defender.userData.height * 0.5, 0)), {
      count: 40, color: 0xbf8bff, speed: 11, spread: 0.3, size: 0.16, lifetime: 0.6, upBias: 0.2,
    });
    this.knock(defender, attackDir, 0.35);
    await tw.delay(0.12);
  }

  /** Slow grind, then a heavy battering ram with a huge shockwave. */
  private async rookSiege(ctx: FightCtx): Promise<void> {
    const { attacker, defender, attackerStart, contact, defenderPos, attackDir } = ctx;
    const tw = this.stage.tweens;
    // Grind backward, building weight (camera trembles).
    await tw.to({
      duration: 0.3,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        attacker.position.copy(attackerStart).addScaledVector(attackDir, -0.25 * t);
        this.shake(0.05 * t);
      },
    });
    // The ram.
    this.stage.timeScale = 1;
    const start = attacker.position.clone();
    await this.lunge(attacker, start, contact, 0.13, Easings.quadIn, 0.05);
    this.stage.timeScale = 0.28;
    this.impact(contact, defenderPos, 1.5, "r");
    this.fx.shockwave(defenderPos, { color: 0xff9a4d, maxRadius: 3.8, lifetime: 0.7 });
    this.fx.shockwave(defenderPos, { color: 0xffffff, maxRadius: 2.2, lifetime: 0.45 });
    this.knock(defender, attackDir, 0.55);
    this.shake(1.0);
    await tw.delay(0.14);
  }

  /** A rapid flurry of strikes from shifting angles, then a bright burst. */
  private async queenFlurry(ctx: FightCtx): Promise<void> {
    const { attacker, defender, defenderPos, contact, side, attackDir } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.55;
    for (let i = 0; i < 4; i++) {
      const lateral = (i % 2 === 0 ? 1 : -1) * 0.6;
      const approach = defenderPos
        .clone()
        .addScaledVector(attackDir, -1.0)
        .addScaledVector(side, lateral);
      approach.y = contact.y + 0.2;
      await tw.to({
        duration: 0.1,
        easing: Easings.quadOut,
        onUpdate: (t) => {
          attacker.position.lerpVectors(approach, contact, t);
          attacker.rotation.y += 0.25;
        },
      });
      this.impact(contact, defenderPos, 0.7, "q");
      this.knock(defender, attackDir, 0.16);
      await tw.delay(0.04);
    }
  }

  /** Rise up, grow, and bring down a devastating overhead smash. */
  private async kingSmash(ctx: FightCtx): Promise<void> {
    const { attacker, defender, attackerStart, defenderPos, contact, attackDir } = ctx;
    const tw = this.stage.tweens;
    // Raise high, swelling with power.
    await tw.to({
      duration: 0.32,
      easing: Easings.backOut,
      onUpdate: (t) => {
        attacker.position.copy(attackerStart).addScaledVector(attackDir, -0.2);
        attacker.position.y = attackerStart.y + 0.7 * t;
        attacker.scale.setScalar(1.06 + 0.25 * t);
        this.setGlow(attacker, 0.9 + t);
      },
    });
    // Overhead slam.
    this.stage.timeScale = 1;
    const start = attacker.position.clone();
    await tw.to({
      duration: 0.12,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        attacker.position.lerpVectors(start, contact, t);
      },
    });
    this.stage.timeScale = 0.24;
    this.impact(contact, defenderPos, 1.7, "k");
    this.fx.shockwave(defenderPos, { color: 0xffe27a, maxRadius: 4.5, lifetime: 0.8 });
    this.fx.shockwave(defenderPos, { color: 0xffffff, maxRadius: 2.6, lifetime: 0.5 });
    this.stage.pulseKeyLight(9, 180);
    this.knock(defender, attackDir, 0.6);
    this.shake(1.2);
    await tw.delay(0.16);
  }

  /* --------------------------- primitives --------------------------- */

  private lunge(
    piece: PieceObject,
    from: THREE.Vector3,
    to: THREE.Vector3,
    duration: number,
    easing: Easing,
    arc: number,
  ): Promise<void> {
    return this.stage.tweens.to({
      duration,
      easing,
      onUpdate: (t) => {
        piece.position.lerpVectors(from, to, t);
        piece.position.y = from.y + Math.sin(t * Math.PI) * arc;
      },
    });
  }

  private impact(at: THREE.Vector3, ground: THREE.Vector3, power: number, type: PieceType): void {
    this.fx.burst(at.clone().add(new THREE.Vector3(0, 0.4, 0)), {
      count: Math.round(26 * power),
      color: ATTACK_COLOR[type],
      speed: 7 * power,
      spread: 1,
      size: 0.16,
      lifetime: 0.7,
    });
    this.fx.burst(at.clone().add(new THREE.Vector3(0, 0.4, 0)), {
      count: Math.round(12 * power),
      color: 0xffffff,
      speed: 9 * power,
      spread: 0.6,
      size: 0.1,
      lifetime: 0.4,
    });
    this.fx.shockwave(ground, { color: 0xffe6a0, maxRadius: 1.6 * power + 1, lifetime: 0.5 });
    this.shake(0.3 * power + 0.12);
    this.stage.pulseKeyLight(4 + power * 2, 90);
  }

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

  private async destroy(defender: PieceObject): Promise<void> {
    for (const m of defender.userData.materials) {
      m.transparent = true;
      m.emissive.setHex(0xff5533);
    }
    const start = defender.position.clone();
    this.fx.burst(start.clone().add(new THREE.Vector3(0, defender.userData.height * 0.4, 0)), {
      count: 44,
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
