import * as THREE from "three";
import type { Stage } from "../../scene/Stage";
import { playLoop, playOnce, type PieceObject } from "../Characters";
import { Easings } from "../../util/tween";
import { ParticleFX } from "./Particles";

const UP = new THREE.Vector3(0, 1, 0);

/** Everything a finisher needs to stage the killing blow. */
interface FightCtx {
  attacker: PieceObject;
  defender: PieceObject;
  /** Unit vector from attacker toward defender (horizontal). */
  dir: THREE.Vector3;
  /** Unit vector perpendicular to the duel axis (camera side). */
  side: THREE.Vector3;
  /** The defender's square (world position). */
  dPos: THREE.Vector3;
}

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

    // EVERY attacker closes the distance, Battle Chess style — even casters
    // march up and duel toe-to-toe (they stop a step further out to cast).
    // The camera frames the DUEL midpoint so both fighters stay in shot.
    const standoff = dPos.clone().addScaledVector(dir, attacker.userData.caster ? -1.5 : -0.95);
    const duelMid = standoff.clone().lerp(dPos, 0.5);
    this.focus.copy(duelMid).add(new THREE.Vector3(0, 0.8, 0));

    // Film from the side of the duel that faces AWAY from the board centre —
    // fewer bystander pieces there to block the shot on a crowded rank.
    const outward = duelMid.clone().setY(0);
    if (side.dot(outward) < 0) side.negate();

    // --- cinematic camera ---
    const prevPos = cam.position.clone();
    const prevTarget = stage.controls.target.clone();
    const prevFov = cam.fov;
    stage.cameraLocked = true;
    this.driving = true;
    this.setCinematic(true);
    const cineTarget = this.focus
      .clone()
      .add(side.clone().multiplyScalar(3.6))
      .add(dir.clone().multiplyScalar(-1.2))
      .add(new THREE.Vector3(0, 2.2, 0));
    this.cineBase.copy(prevPos);

    attacker.rotation.y = faceA;
    defender.rotation.y = faceA + Math.PI;
    playLoop(defender, "Idle", 0.1);

    // The attacker marches in WHILE the camera dives — it arrives on screen
    // just as the shot settles, so the exchange always shows both fighters.
    const marchDist = aStart.distanceTo(standoff);
    const marchDur = THREE.MathUtils.clamp(0.22 + marchDist * 0.09, 0.3, 0.85);
    stage.timeScale = 1;
    playLoop(attacker, "Running_A", 0.1);
    const marching = tw.to({
      duration: marchDur,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        attacker.position.lerpVectors(aStart, standoff, t);
        attacker.position.y = 0;
      },
    });
    await tw.to({
      duration: Math.min(0.38, marchDur),
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(prevPos, cineTarget, t);
        cam.fov = THREE.MathUtils.lerp(prevFov, 44, t);
        cam.updateProjectionMatrix();
      },
    });
    await marching;
    attacker.position.copy(standoff);

    // --- Round 1: attacker opens; defender staggers but holds ---
    stage.timeScale = 0.75;
    playOnce(attacker, attacker.userData.attack, 0.06, 1.7);
    const impactT = 0.5;
    if (attacker.userData.caster) this.castProjectile(attacker, dPos, impactT);
    await tw.delay(impactT);
    this.impactAt(dPos, attacker.userData.color, 0.8);
    playOnce(defender, "Block_Hit", 0.05, 1.3);
    this.knock(defender, dir, 0.22);
    await tw.delay(0.22);

    // --- camera swings to the other shoulder for the counterattack ---
    const cineTarget2 = this.focus
      .clone()
      .add(side.clone().multiplyScalar(-3.2))
      .add(dir.clone().multiplyScalar(-2.0))
      .add(new THREE.Vector3(0, 2.1, 0));
    const swingFrom = this.cineBase.clone();
    void tw.to({
      duration: 0.45,
      easing: Easings.cubicInOut,
      onUpdate: (t) => this.cineBase.lerpVectors(swingFrom, cineTarget2, t),
    });

    // --- Round 2: the doomed defender fights back; attacker shrugs it off ---
    playOnce(defender, defender.userData.attack, 0.06, 1.6);
    if (defender.userData.caster) this.castProjectile(defender, attacker.position.clone(), 0.45);
    await tw.delay(0.45);
    playOnce(attacker, "Block_Hit", 0.05, 1.4);
    this.fx.burst(attacker.position.clone().add(new THREE.Vector3(0, 0.8, 0)), {
      count: 14,
      color: 0xffffff,
      speed: 5,
      spread: 0.7,
      size: 0.1,
      lifetime: 0.4,
    });
    this.shake(0.25);
    await tw.delay(0.3);

    // --- Killing blow: each piece type has its signature finisher ---
    await this.finish({ attacker, defender, dir, side, dPos });

    // --- remains ---
    stage.timeScale = 0.85;
    this.fx.burst(defender.position.clone().add(new THREE.Vector3(0, 0.5, 0)), {
      count: 34,
      color: defender.userData.color === "w" ? 0xb08050 : 0xcfc8b0,
      speed: 4.5,
      spread: 1,
      size: 0.14,
      lifetime: 1,
      gravity: 9,
    });
    await tw.delay(0.25);
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

    // --- restore camera (from wherever the swing left it) ---
    stage.timeScale = 1;
    const restoreFrom = this.cineBase.clone();
    await tw.to({
      duration: 0.35,
      easing: Easings.cubicInOut,
      onUpdate: (t) => {
        this.cineBase.lerpVectors(restoreFrom, prevPos, t);
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

  /* ---------------- signature finishers, one per piece type ---------------- */

  private finish(ctx: FightCtx): Promise<void> {
    switch (ctx.attacker.userData.type) {
      case "n": return this.finishKnight(ctx);
      case "b": return this.finishBishop(ctx);
      case "r": return this.finishRook(ctx);
      case "q": return this.finishQueen(ctx);
      case "k": return this.finishKing(ctx);
      default: return this.finishPawn(ctx);
    }
  }

  /** PAWN — scrappy three-hit flurry; the last stab sends the loser tumbling. */
  private async finishPawn(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dir, dPos } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.6;
    const combo = ["1H_Melee_Attack_Stab", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Chop"];
    for (let i = 0; i < combo.length; i++) {
      playOnce(attacker, combo[i], 0.05, 2.2);
      await tw.delay(0.26);
      this.impactAt(dPos, attacker.userData.color, 0.6 + i * 0.25);
      playOnce(defender, i < 2 ? "Block_Hit" : "Hit_A", 0.05, 1.5);
      this.knock(defender, dir, 0.15 + i * 0.1);
      await tw.delay(0.08);
    }
    this.stage.timeScale = 0.45;
    await this.launch(defender, dir, 1.4, 1.0, 0.5, true);
    playOnce(defender, defender.userData.death, 0.05, 1.4);
    await tw.delay(0.45);
  }

  /** KNIGHT — leaps skyward and crushes the defender with a ground pound. */
  private async finishKnight(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dir, dPos } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.6;
    playOnce(attacker, "2H_Melee_Attack_Spin", 0.06, 1.3);
    const from = attacker.position.clone();
    const landing = dPos.clone().addScaledVector(dir, -0.35);
    await tw.to({
      duration: 0.5,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        attacker.position.lerpVectors(from, landing, t);
        attacker.position.y = Math.sin(t * Math.PI) * 2.4;
      },
    });
    attacker.position.y = 0;
    this.stage.timeScale = 0.3;
    this.impactAt(dPos, attacker.userData.color, 1.8);
    this.fx.shockwave(dPos, { color: 0xffffff, maxRadius: 3.6, lifetime: 0.6 });
    this.shake(1.2);
    // The defender is squashed flat by the impact before collapsing.
    playOnce(defender, "Hit_A", 0.03);
    const squashFrom = defender.scale.y;
    await tw.to({
      duration: 0.18,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        defender.scale.y = squashFrom * (1 - 0.45 * Math.sin(t * Math.PI));
      },
    });
    playOnce(defender, defender.userData.death, 0.05, 1.4);
    await tw.delay(0.5);
  }

  /** BISHOP — calls down a pillar of holy light that lifts, then drops, the victim. */
  private async finishBishop(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dPos } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.5;
    playOnce(attacker, "Spellcast_Shoot", 0.06, 1.2);
    await tw.delay(0.35);
    const beamColor = attacker.userData.color === "w" ? 0xfff2b0 : 0xc490ff;
    this.beam(dPos, beamColor, 1.4);
    this.stage.pulseKeyLight(8, 400);
    // Victim levitates, helpless, spinning slowly inside the beam.
    const baseY = defender.position.y;
    playOnce(defender, "Hit_A", 0.05, 0.7);
    await tw.to({
      duration: 0.7,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        defender.position.y = baseY + t * 1.3;
        defender.rotation.y += 0.12;
      },
    });
    this.fx.burst(defender.position.clone(), {
      count: 30, color: beamColor, speed: 5, spread: 0.7, size: 0.13, lifetime: 0.7, upBias: 0.3,
    });
    // The light releases — the victim drops like a stone.
    this.stage.timeScale = 0.8;
    await tw.to({
      duration: 0.22,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        defender.position.y = baseY + 1.3 * (1 - t);
      },
    });
    defender.position.y = baseY;
    this.impactAt(defender.position.clone(), attacker.userData.color, 1.2);
    playOnce(defender, defender.userData.death, 0.05, 1.3);
    await tw.delay(0.5);
  }

  /** ROOK — a siege blow that launches the defender skyward to crash back down. */
  private async finishRook(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dPos } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.55;
    playOnce(attacker, "2H_Melee_Attack_Spin", 0.06, 1.5);
    await tw.delay(0.4);
    this.impactAt(dPos, attacker.userData.color, 1.3);
    playOnce(defender, "Hit_A", 0.03);
    // Straight up — the camera tilts to follow, then the crash.
    const baseY = defender.position.y;
    const focusY = this.focus.y;
    this.stage.timeScale = 0.6;
    await tw.to({
      duration: 0.55,
      easing: Easings.quadOut,
      onUpdate: (t) => {
        defender.position.y = baseY + t * 3.2;
        defender.rotation.z = t * 1.8;
        this.focus.y = focusY + t * 1.4;
      },
    });
    this.stage.timeScale = 0.9;
    await tw.to({
      duration: 0.3,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        defender.position.y = baseY + 3.2 * (1 - t);
        this.focus.y = focusY + 1.4 * (1 - t);
      },
    });
    defender.position.y = baseY;
    defender.rotation.z = 0;
    this.focus.y = focusY;
    this.impactAt(dPos, attacker.userData.color, 1.7);
    this.fx.shockwave(dPos, { color: 0xff9a4d, maxRadius: 3.8, lifetime: 0.7 });
    this.shake(1.3);
    playOnce(defender, defender.userData.death, 0.03, 1.5);
    await tw.delay(0.45);
  }

  /** QUEEN — a ring of arcane orbs converges and detonates all at once. */
  private async finishQueen(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dPos } = ctx;
    const tw = this.stage.tweens;
    this.stage.timeScale = 0.5;
    playOnce(attacker, "Spellcast_Shoot", 0.06, 1.1);
    const orbColor = attacker.userData.color === "w" ? 0x66ccff : 0xb060ff;
    const chest = dPos.clone().add(new THREE.Vector3(0, 0.85, 0));
    // Conjure a ring of orbs circling the victim...
    const orbs: THREE.Mesh[] = [];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: new THREE.Color(orbColor), emissiveIntensity: 6,
      });
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat);
      this.stage.scene.add(orb);
      orbs.push(orb);
    }
    const R = 1.15;
    await tw.to({
      duration: 0.55,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + t * 5;
          orbs[i].position.set(
            chest.x + Math.cos(a) * R,
            chest.y + Math.sin(t * Math.PI * 2 + i) * 0.25,
            chest.z + Math.sin(a) * R,
          );
        }
      },
    });
    playOnce(defender, "Hit_A", 0.05, 0.8);
    // ...then they converge and detonate as one.
    this.stage.timeScale = 0.35;
    const starts = orbs.map((o) => o.position.clone());
    await tw.to({
      duration: 0.28,
      easing: Easings.quadIn,
      onUpdate: (t) => {
        for (let i = 0; i < N; i++) orbs[i].position.lerpVectors(starts[i], chest, t);
      },
    });
    for (const o of orbs) {
      this.stage.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.impactAt(dPos, attacker.userData.color, 1.9);
    this.fx.burst(chest, { count: 50, color: orbColor, speed: 10, spread: 1, size: 0.16, lifetime: 0.8 });
    this.fx.shockwave(dPos, { color: orbColor, maxRadius: 3.4, lifetime: 0.6 });
    this.stage.pulseKeyLight(10, 160);
    this.shake(1.2);
    playOnce(defender, defender.userData.death, 0.03, 1.5);
    await tw.delay(0.5);
  }

  /** KING — a near-frozen moment, then one decisive blow and a blinding flash. */
  private async finishKing(ctx: FightCtx): Promise<void> {
    const { attacker, defender, dir, dPos } = ctx;
    const tw = this.stage.tweens;
    // Time all but stops for the execution.
    this.stage.timeScale = 0.18;
    playOnce(attacker, "1H_Melee_Attack_Chop", 0.04, 1.2);
    await tw.delay(0.28);
    this.stage.timeScale = 0.9;
    await tw.delay(0.06);
    // The blow lands: golden thunderclap.
    this.impactAt(dPos, attacker.userData.color, 2.0);
    this.fx.shockwave(dPos, { color: 0xffe27a, maxRadius: 4.5, lifetime: 0.8 });
    this.fx.shockwave(dPos, { color: 0xffffff, maxRadius: 2.8, lifetime: 0.5 });
    this.fx.burst(dPos.clone().add(new THREE.Vector3(0, 0.9, 0)), {
      count: 46, color: 0xffe27a, speed: 11, spread: 1, size: 0.15, lifetime: 0.8,
    });
    this.stage.pulseKeyLight(13, 200);
    this.shake(1.5);
    this.knock(defender, dir, 0.6);
    this.stage.timeScale = 0.5;
    playOnce(defender, defender.userData.death, 0.03, 1.2);
    await tw.delay(0.55);
  }

  /* ---------------------------- FX helpers ---------------------------- */

  /** Arc a piece backward through the air (tumbling if asked). */
  private launch(
    piece: PieceObject,
    dir: THREE.Vector3,
    dist: number,
    height: number,
    dur: number,
    tumble = false,
  ): Promise<void> {
    const start = piece.position.clone();
    const end = start.clone().addScaledVector(dir, dist);
    return this.stage.tweens
      .to({
        duration: dur,
        easing: Easings.linear,
        onUpdate: (t) => {
          piece.position.lerpVectors(start, end, t);
          piece.position.y = start.y + Math.sin(t * Math.PI) * height;
          if (tumble) piece.rotation.x = -t * Math.PI * 0.6;
        },
      })
      .then(() => {
        piece.position.y = start.y;
        piece.rotation.x = 0;
      });
  }

  /** A pillar of light over a square that swells and fades. */
  private beam(at: THREE.Vector3, color: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 9, 24, 1, true), mat);
    pillar.position.copy(at);
    pillar.position.y = 4.5;
    this.stage.scene.add(pillar);
    void this.stage.tweens.to({
      duration: life,
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        mat.opacity = 0.75 * Math.sin(t * Math.PI);
        pillar.rotation.y += 0.05;
      },
      onComplete: () => {
        this.stage.scene.remove(pillar);
        pillar.geometry.dispose();
        mat.dispose();
      },
    });
  }

  private impactAt(at: THREE.Vector3, attackerColor: "w" | "b", power = 1): void {
    const chest = at.clone().add(new THREE.Vector3(0, 0.85, 0));
    this.fx.burst(chest, {
      count: Math.round(26 * power),
      color: attackerColor === "w" ? 0xffce5c : 0x9b6bff,
      speed: 7 * power,
      spread: 1,
      size: 0.14,
      lifetime: 0.6,
    });
    this.fx.burst(chest, { count: Math.round(12 * power), color: 0xffffff, speed: 9 * power, spread: 0.6, size: 0.09, lifetime: 0.35 });
    this.fx.shockwave(at, { color: 0xffe6a0, maxRadius: 1.6 + power, lifetime: 0.5 });
    this.shake(0.35 + power * 0.25);
    this.stage.pulseKeyLight(4 + power * 3, 110);
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
