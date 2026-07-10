import * as THREE from "three";

/** World size of one board square. The board is 8x8 centred on the origin. */
export const SQUARE = 1.4;
export const BOARD_HALF = (SQUARE * 8) / 2;
/** Top surface of the board where pieces stand. */
export const BOARD_TOP = 0;

/** chess.js square (e.g. "e2") -> {file:0-7, rank:0-7}. */
export function squareToFileRank(square: string): { file: number; rank: number } {
  return {
    file: square.charCodeAt(0) - 97, // 'a' -> 0
    rank: Number(square[1]) - 1, // '1' -> 0
  };
}

export function fileRankToSquare(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + (rank + 1);
}

/**
 * Board square -> world position (centre of the square, on the surface).
 * White (rank 1) sits toward +Z so it faces the default camera.
 */
export function squareToWorld(square: string, y = BOARD_TOP): THREE.Vector3 {
  const { file, rank } = squareToFileRank(square);
  const x = (file - 3.5) * SQUARE;
  const z = (3.5 - rank) * SQUARE;
  return new THREE.Vector3(x, y, z);
}

/** Is this square light or dark? (a1 is dark in standard chess.) */
export function isLightSquare(file: number, rank: number): boolean {
  return (file + rank) % 2 === 1;
}
