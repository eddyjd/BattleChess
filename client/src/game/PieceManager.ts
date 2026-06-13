import * as THREE from "three";
import type { Chess } from "chess.js";
import { createPiece, orientPiece, type PieceColor, type PieceObject, type PieceType } from "./PieceFactory";
import { squareToWorld } from "./coords";
import type { Stage } from "../scene/Stage";
import { Easings } from "../util/tween";

/**
 * Owns the 3D piece meshes and keeps them in sync with the logical board.
 * Tracks one mesh per occupied square and provides the slide / hop / spawn
 * / remove animations the game controller drives.
 */
export class PieceManager {
  readonly group = new THREE.Group();
  private bySquare = new Map<string, PieceObject>();
  private selected: PieceObject | null = null;
  private hoverPhase = 0;

  constructor(private stage: Stage) {
    stage.scene.add(this.group);
  }

  pieceAt(square: string): PieceObject | undefined {
    return this.bySquare.get(square);
  }

  /** Rebuild every piece from a chess.js position (used on new game / sync). */
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
  }

  private placeInstant(piece: PieceObject, square: string): void {
    piece.position.copy(squareToWorld(square));
    piece.userData.square = square;
    this.bySquare.set(square, piece);
  }

  /** Slide a piece between squares (knights hop in an arc). */
  async move(from: string, to: string): Promise<void> {
    const piece = this.bySquare.get(from);
    if (!piece) return;
    this.bySquare.delete(from);
    const start = piece.position.clone();
    const end = squareToWorld(to);
    const isKnight = piece.userData.type === "n";
    await this.stage.tweens.to({
      duration: isKnight ? 0.42 : 0.34,
      easing: isKnight ? Easings.quadInOut : Easings.cubicInOut,
      onUpdate: (t) => {
        piece.position.lerpVectors(start, end, t);
        piece.position.y = start.y + Math.sin(t * Math.PI) * (isKnight ? 0.9 : 0.12);
      },
    });
    piece.position.copy(end);
    piece.userData.square = to;
    this.bySquare.set(to, piece);
  }

  /** Remove (and dispose) a piece by square. */
  remove(square: string): void {
    const piece = this.bySquare.get(square);
    if (!piece) return;
    this.bySquare.delete(square);
    this.disposePiece(piece);
  }

  /** Detach a piece's mesh from the board map without disposing it
   *  (used so the battle director can animate it, then we dispose). */
  detach(square: string): PieceObject | undefined {
    const piece = this.bySquare.get(square);
    if (piece) this.bySquare.delete(square);
    return piece;
  }

  disposePiece(piece: PieceObject): void {
    this.group.remove(piece);
    piece.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  /** Promote: swap a pawn mesh for the promoted piece on the same square. */
  async promote(square: string, type: PieceType, color: PieceColor): Promise<void> {
    const existing = this.bySquare.get(square);
    if (existing) {
      this.bySquare.delete(square);
      this.disposePiece(existing);
    }
    await this.spawn(type, color, square);
  }

  /** Instantly position + register a (possibly detached) piece on a square. */
  place(piece: PieceObject, square: string): void {
    this.placeInstant(piece, square);
  }

  /** Manually relocate a mesh's logical square (e.g. castled rook). */
  relocate(from: string, to: string): void {
    const piece = this.bySquare.get(from);
    if (!piece) return;
    this.bySquare.delete(from);
    this.placeInstant(piece, to);
  }

  setSelected(square: string | null): void {
    if (this.selected) {
      this.selected.position.y = squareToWorld(this.selected.userData.square).y;
    }
    this.selected = square ? this.bySquare.get(square) ?? null : null;
  }

  /** Gentle hover bob on the selected piece. */
  update(_dt: number): void {
    this.hoverPhase += _dt * 5;
    if (this.selected) {
      const base = squareToWorld(this.selected.userData.square).y;
      this.selected.position.y = base + 0.18 + Math.sin(this.hoverPhase) * 0.06;
      this.selected.rotation.y += _dt * 0.6 * (this.selected.userData.type === "n" ? 0 : 1);
    }
  }

  raycastPieces(raycaster: THREE.Raycaster): PieceObject | null {
    const hits = raycaster.intersectObjects(this.group.children, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !(obj.userData && "type" in obj.userData && "color" in obj.userData)) {
      obj = obj.parent;
    }
    return (obj as PieceObject) ?? null;
  }

  clear(): void {
    for (const piece of this.bySquare.values()) this.disposePiece(piece);
    this.bySquare.clear();
    this.selected = null;
  }
}
