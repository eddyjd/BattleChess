/// <reference lib="webworker" />
import { Chess, type Move } from "chess.js";

/**
 * Chess AI running off the main thread. Negamax + alpha-beta with
 * material and piece-square evaluation and MVV-LVA capture ordering.
 * Difficulty maps to search depth (+ a touch of randomness on Easy so it
 * is genuinely beatable for newcomers).
 */

type Req = { fen: string; depth: number; randomness: number; id: number };
type Res = { id: number; move: { from: string; to: string; promotion?: string } | null };

const MATE = 1_000_000;

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables, written rank 1 (white home) first, file a..h.
// index = rank * 8 + file, with rank 0 = rank 1.
// prettier-ignore
const PST: Record<string, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10,-20,-20, 10, 10,  5,
     5, -5,-10,  0,  0,-10, -5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5,  5, 10, 25, 25, 10,  5,  5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  5,  5,  0,  0,  0,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     5, 10, 10, 10, 10, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -10,  5,  5,  5,  5,  5,  0,-10,
      0,  0,  5,  5,  5,  5,  0, -5,
     -5,  0,  5,  5,  5,  5,  0, -5,
    -10,  0,  5,  5,  5,  5,  0,-10,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
     20, 30, 10,  0,  0, 10, 30, 20,
     20, 20,  0,  0,  0,  0, 20, 20,
    -10,-20,-20,-20,-20,-20,-20,-10,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
  ],
};

/** Static evaluation in centipawns, from White's perspective. */
function evaluate(chess: Chess): number {
  const board = chess.board(); // board[0] = rank 8, board[7] = rank 1
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const rank = 7 - r; // rank 0 = rank 1
      const idx = rank * 8 + c;
      const base = VALUE[sq.type];
      if (sq.color === "w") {
        score += base + PST[sq.type][idx];
      } else {
        // Mirror the table vertically for black.
        const mirrored = (7 - rank) * 8 + c;
        score -= base + PST[sq.type][mirrored];
      }
    }
  }
  return score;
}

/** MVV-LVA-ish ordering: try captures (big victim, small attacker) first. */
function orderMoves(moves: Move[]): Move[] {
  return moves
    .map((m) => {
      let s = 0;
      if (m.captured) s += 10 * VALUE[m.captured] - VALUE[m.piece];
      if (m.promotion) s += VALUE[m.promotion];
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  if (chess.isCheckmate()) return -MATE + ply; // side to move is mated
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition()) return 0;
  if (depth === 0) {
    const e = evaluate(chess);
    return chess.turn() === "w" ? e : -e;
  }
  const moves = orderMoves(chess.moves({ verbose: true }) as Move[]);
  let best = -Infinity;
  for (const m of moves) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -beta, -alpha, ply + 1);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

function chooseMove(fen: string, depth: number, randomness: number): Res["move"] {
  const chess = new Chess(fen);
  const moves = orderMoves(chess.moves({ verbose: true }) as Move[]);
  if (moves.length === 0) return null;

  const scored: { m: Move; score: number }[] = [];
  let alpha = -Infinity;
  for (const m of moves) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -Infinity, -alpha, 1);
    chess.undo();
    scored.push({ m, score });
    if (score > alpha) alpha = score;
  }
  scored.sort((a, b) => b.score - a.score);

  // On lower difficulties, sometimes pick from near-best moves to feel human.
  let pick = 0;
  if (randomness > 0 && scored.length > 1) {
    const window = scored.filter((s) => s.score >= scored[0].score - 60 * randomness);
    if (Math.random() < randomness) {
      pick = Math.floor(Math.random() * Math.min(window.length, 4));
    }
  }
  const chosen = scored[pick].m;
  return { from: chosen.from, to: chosen.to, promotion: chosen.promotion };
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { fen, depth, randomness, id } = e.data;
  const move = chooseMove(fen, depth, randomness);
  const res: Res = { id, move };
  (self as unknown as Worker).postMessage(res);
};
