/**
 * Wire protocol shared between the client and the WebSocket server.
 *
 * Both sides import these types so the message shapes never drift apart.
 * Keep this file dependency-free (pure types + tiny helpers) so it can be
 * imported from the browser bundle and the Node server alike.
 */

/** Chess colours, matching chess.js conventions ('w' | 'b'). */
export type Color = "w" | "b";

/** A move in the compact form chess.js understands. */
export interface WireMove {
  from: string; // e.g. "e2"
  to: string; // e.g. "e4"
  promotion?: "q" | "r" | "b" | "n";
}

/* ------------------------------------------------------------------ */
/* Client -> Server                                                    */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  | { t: "create"; name?: string }
  | { t: "join"; room: string; name?: string }
  | { t: "quickmatch"; name?: string }
  | { t: "move"; move: WireMove }
  | { t: "resign" }
  | { t: "rematch" }
  | { t: "chat"; text: string }
  | { t: "ping" };

/* ------------------------------------------------------------------ */
/* Server -> Client                                                    */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  /** Sent right after create/join succeeds, before the game starts. */
  | { t: "joined"; room: string; color: Color; you: string }
  /** Both players present; game is live. Carries the authoritative FEN. */
  | { t: "start"; fen: string; white: string; black: string }
  /** A validated move from the opponent (or echoed for confirmation). */
  | { t: "move"; move: WireMove; fen: string; by: Color }
  /** Game over for any reason. */
  | { t: "over"; reason: GameOverReason; winner: Color | null; fen: string }
  /** Opponent (re)queued a rematch; flips colours. */
  | { t: "rematch"; fen: string; white: string; black: string }
  | { t: "opponentLeft" }
  | { t: "chat"; from: string; text: string }
  | { t: "waiting"; room: string }
  | { t: "error"; message: string }
  | { t: "pong" };

export type GameOverReason =
  | "checkmate"
  | "stalemate"
  | "resign"
  | "timeout"
  | "threefold"
  | "insufficient"
  | "fiftymove"
  | "draw";

/** Tiny type-safe JSON helpers (avoid `JSON.parse(...) as any` everywhere). */
export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode<T = ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
