import * as THREE from "three";
import type { Chess } from "chess.js";
import {
  createPiece,
  orientPiece,
  playLoop,
  playOnce,
  updateMixer,
  type PieceColor,
  type PieceObject,
  type PieceType,
} from "./Characters";
import { squareToWorld } from "./coords";
import type { Stage } from "../scene/Stage";
import { Easings } from "../util/tween";

/**
 * Owns the animated character pieces and keeps them in sync with the logical
 * board: spawning, walking on a move, capturing, promoting. Each piece runs
 * its own animation mixer, advanced every frame.
 */
export class PieceManager {
  readonly group = new THREE.Group();
  private bySquare = new Map<string, PieceObject>();
  private all = new Set<PieceObject>();

  constructor(private stage: Stage) {
    stage.scene.add(this.group);
  }

  pieceAt(square: string): PieceObject | undefined {
    return this.bySquare.get(square);
  }

  async setupFrom(chess: Chess): Promise<void> {
    this.clear();
    const board = chess.board();
    const jobs: Promise<void>[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (!cell) continue;
        const square = String.fromCharCode(97 + c) + (8 - r);
        jobs.push(this.spawn(cell.type as PieceType, cell.color as PieceColor, square));
      }
    }
    await Promise.all(jobs);
  }

  private async spawn(type: PieceType, color: PieceColor, square: string): Promise<void> {
    const piece = await createPiece(type, color);
    piece.position.copy(squareToWorld(square));
    piece.userData.square = square;
    orientPiece(piece);
    this.group.add(piece);
    this.bySquare.set(square, piece);
    this.all.add(piece);
  }

  private register(piece: PieceObject, square: string): void {
    piece.position.copy(squareToWorld(square));
    piece.userData.square = square;
    this.bySquare.set(square, piece);
  }

  /** Walk a piece between squares with the proper locomotion animation. */
  async move(from: string, to: string): Promise<void> {
    const piece = this.bySquare.get(from);
    if (!piece) return;
    this.bySquare.delete(from);
    const start = piece.position.clone();
    const end = squareToWorld(to);
    const dist = start.distanceTo(end);
    const dir = end.clone().sub(start).setY(0).normalize();
    const facing = Math.atan2(dir.x, dir.z);
    piece.rotation.y = facing;

    const running = dist > 3.2;
    playLoop(piece, running ? "Running_A" : "Walking_A", 0.15);
    await this.stage.tweens.to({
      duration: Math.min(0.28 + dist * 0.12, 0.8),
      easing: Easings.quadInOut,
      onUpdate: (t) => {
        piece.position.lerpVectors(start, end, t);
      },
    });
    piece.position.copy(end);
    piece.userData.square = to;
    this.bySquare.set(to, piece);
    orientPiece(piece);
    playLoop(piece, "Idle", 0.2);
  }

  remove(square: string): void {
    const piece = this.bySquare.get(square);
    if (!piece) return;
    this.bySquare.delete(square);
    this.disposePiece(piece);
  }

  detach(square: string): PieceObject | undefined {
    const piece = this.bySquare.get(square);
    if (piece) this.bySquare.delete(square);
    return piece;
  }

  place(piece: PieceObject, square: string): void {
    this.register(piece, square);
  }

  disposePiece(piece: PieceObject): void {
    this.group.remove(piece);
    this.all.delete(piece);
    piece.userData.mixer.stopAllAction();
    piece.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  async promote(square: string, type: PieceType, color: PieceColor): Promise<void> {
    const existing = this.bySquare.get(square);
    if (existing) {
      this.bySquare.delete(square);
      this.disposePiece(existing);
    }
    await this.spawn(type, color, square);
  }

  relocate(from: string, to: string): void {
    const piece = this.bySquare.get(from);
    if (!piece) return;
    this.bySquare.delete(from);
    this.register(piece, to);
    orientPiece(piece);
  }

  // Selection cue is shown on the board tile; the character keeps idling.
  setSelected(_square: string | null): void {}

  /** Advance every character's animation. `dt` is time-scaled for slow-mo. */
  update(dt: number): void {
    for (const piece of this.all) updateMixer(piece, dt);
  }

  raycastPieces(_raycaster: THREE.Raycaster): PieceObject | null {
    return null; // selection is done via board tiles
  }

  /** Helpers for the battle director. */
  playOnce(piece: PieceObject, clip: string, fade = 0.1): number {
    return playOnce(piece, clip, fade);
  }
  playLoop(piece: PieceObject, clip: string, fade = 0.2): void {
    playLoop(piece, clip, fade);
  }

  clear(): void {
    for (const piece of this.all) this.disposePiece(piece);
    this.bySquare.clear();
    this.all.clear();
  }
}
