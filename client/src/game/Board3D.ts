import * as THREE from "three";
import { SQUARE, BOARD_HALF, fileRankToSquare, isLightSquare, squareToWorld } from "./coords";

const LIGHT_COLOR = new THREE.Color(0xcdb98f); // aged ivory / sandstone
const DARK_COLOR = new THREE.Color(0x40301f); // dark walnut

interface SquareMesh extends THREE.Mesh {
  userData: { square: string; base: THREE.Color };
}

/**
 * The physical board: 64 square tiles, a frame, and a set of transient
 * highlight indicators (selection, legal moves, last move, check).
 */
export class Board3D {
  readonly group = new THREE.Group();
  private squares = new Map<string, SquareMesh>();
  private indicators = new THREE.Group();
  private lastMoveSquares: string[] = [];
  private checkSquare: string | null = null;

  constructor() {
    this.buildTiles();
    this.buildFrame();
    this.group.add(this.indicators);
  }

  private buildTiles(): void {
    const geo = new THREE.BoxGeometry(SQUARE, 0.3, SQUARE);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const light = isLightSquare(file, rank);
        const base = (light ? LIGHT_COLOR : DARK_COLOR).clone();
        const mat = new THREE.MeshStandardMaterial({
          color: base,
          roughness: light ? 0.55 : 0.45,
          metalness: 0.05,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 1,
        });
        const tile = new THREE.Mesh(geo, mat) as unknown as SquareMesh;
        const square = fileRankToSquare(file, rank);
        const pos = squareToWorld(square, -0.15);
        tile.position.copy(pos);
        tile.receiveShadow = true;
        tile.userData = { square, base };
        this.squares.set(square, tile);
        this.group.add(tile);
      }
    }
  }

  private buildFrame(): void {
    // Base slab beneath the tiles, extending out to form the board's edge.
    // Its top sits just below the tile tops so it never covers the squares.
    const outer = BOARD_HALF + 0.6;
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x2c2017,
      roughness: 0.55,
      metalness: 0.2,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(outer * 2, 0.6, outer * 2), baseMat);
    base.position.y = -0.36; // top at -0.06, tiles span -0.30..0.00
    base.receiveShadow = true;
    base.castShadow = true;
    this.group.add(base);

    // Decorative gold border rail around the playing area (outside the
    // squares, so it frames them without overlapping). Picks up the bloom.
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xc79a3a,
      roughness: 0.3,
      metalness: 1.0,
      emissive: new THREE.Color(0x3a2600),
      emissiveIntensity: 1,
    });
    const edge = BOARD_HALF + 0.18;
    const len = BOARD_HALF * 2 + 0.72;
    const th = 0.34;
    const h = 0.14;
    const bars: [number, number, number, number][] = [
      [0, edge, len, th], // far (+? -z)
      [0, -edge, len, th],
      [edge, 0, th, len],
      [-edge, 0, th, len],
    ];
    for (const [x, z, sx, sz] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), railMat);
      bar.position.set(x, 0.0, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.group.add(bar);
    }
  }

  getPickTargets(): THREE.Object3D[] {
    return [...this.squares.values()];
  }

  /* --------------------------- highlights --------------------------- */

  private setEmissive(square: string, color: number, intensity: number): void {
    const tile = this.squares.get(square);
    if (!tile) return;
    const mat = tile.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(color);
    mat.emissiveIntensity = intensity;
  }

  private resetEmissive(square: string): void {
    const tile = this.squares.get(square);
    if (!tile) return;
    const mat = tile.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 1;
    // Re-apply persistent last-move / check tints.
    if (this.lastMoveSquares.includes(square)) this.setEmissive(square, 0xffce5c, 0.32);
    if (this.checkSquare === square) this.setEmissive(square, 0xff3b3b, 0.6);
  }

  clearSelection(): void {
    for (const sq of this.squares.keys()) this.resetEmissive(sq);
    this.indicators.clear();
  }

  selectSquare(square: string): void {
    this.setEmissive(square, 0x6ee7ff, 0.55);
  }

  /** Show movement dots and capture rings for the given destinations. */
  showMoves(moves: { to: string; capture: boolean }[]): void {
    for (const m of moves) {
      const pos = squareToWorld(m.to, 0.06);
      if (m.capture) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(SQUARE * 0.42, 0.05, 12, 32),
          new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(pos);
        this.indicators.add(ring);
      } else {
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.18, 24),
          new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.85 }),
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.copy(pos);
        this.indicators.add(dot);
      }
    }
  }

  setLastMove(from: string, to: string): void {
    for (const sq of this.lastMoveSquares) {
      const wasCheck = this.checkSquare === sq;
      this.lastMoveSquares = this.lastMoveSquares.filter((s) => s !== sq);
      this.resetEmissive(sq);
      if (wasCheck) this.setEmissive(sq, 0xff3b3b, 0.6);
    }
    this.lastMoveSquares = [from, to];
    this.setEmissive(from, 0xffce5c, 0.32);
    this.setEmissive(to, 0xffce5c, 0.32);
  }

  setCheck(square: string | null): void {
    if (this.checkSquare && this.checkSquare !== square) {
      const prev = this.checkSquare;
      this.checkSquare = null;
      this.resetEmissive(prev);
    }
    this.checkSquare = square;
    if (square) this.setEmissive(square, 0xff3b3b, 0.6);
  }

  /** Pulse the highlight indicators (called each frame for a subtle glow). */
  update(t: number): void {
    const pulse = 0.7 + Math.sin(t * 4) * 0.3;
    this.indicators.children.forEach((c) => {
      const mesh = c as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = pulse;
    });
  }
}
