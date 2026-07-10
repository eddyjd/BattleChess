/**
 * BattleChess multiplayer server.
 *
 * A small authoritative relay: it owns one chess.js instance per room,
 * validates every move before broadcasting it, and reports game-over
 * conditions. Players connect over WebSocket and either:
 *   - create a private room (gets a short code to share),
 *   - join a room by code, or
 *   - quick-match against the next person in the queue.
 *
 * In production it also serves the built client from ../../client/dist,
 * so a single `npm start` hosts the whole game.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Chess } from "chess.js";
import {
  type ClientMessage,
  type ServerMessage,
  type Color,
  type GameOverReason,
  encode,
  decode,
} from "../../shared/protocol.js";

const PORT = Number(process.env.PORT ?? 8787);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Compiled file lives at <repo>/server/dist/server/src/index.js, so climb
// four levels to the repo root, then into the client build.
const CLIENT_DIR = join(__dirname, "..", "..", "..", "..", "client", "dist");

/* ------------------------------------------------------------------ */
/* Player + Room model                                                 */
/* ------------------------------------------------------------------ */

interface Player {
  socket: WebSocket;
  name: string;
  color: Color | null;
  room: Room | null;
}

class Room {
  readonly code: string;
  chess = new Chess();
  white: Player | null = null;
  black: Player | null = null;
  /** Used to flip colours on rematch so players alternate. */
  private rematchFlip = false;

  constructor(code: string) {
    this.code = code;
  }

  get players(): Player[] {
    return [this.white, this.black].filter((p): p is Player => p !== null);
  }

  get isFull(): boolean {
    return this.white !== null && this.black !== null;
  }

  seat(player: Player): Color {
    // Honour the rematch flip so the same person doesn't always play white.
    const wantWhiteFirst = !this.rematchFlip;
    if (wantWhiteFirst ? this.white === null : this.black === null) {
      if (wantWhiteFirst) {
        this.white = player;
        player.color = "w";
        return "w";
      }
      this.black = player;
      player.color = "b";
      return "b";
    }
    if (this.white === null) {
      this.white = player;
      player.color = "w";
      return "w";
    }
    this.black = player;
    player.color = "b";
    return "b";
  }

  remove(player: Player): void {
    if (this.white === player) this.white = null;
    if (this.black === player) this.black = null;
  }

  broadcast(msg: ServerMessage, except?: Player): void {
    const raw = encode(msg);
    for (const p of this.players) {
      if (p !== except && p.socket.readyState === WebSocket.OPEN) {
        p.socket.send(raw);
      }
    }
  }

  startGame(): void {
    this.chess = new Chess();
    this.broadcast({
      t: "start",
      fen: this.chess.fen(),
      white: this.white?.name ?? "White",
      black: this.black?.name ?? "Black",
    });
  }

  prepareRematch(): void {
    this.rematchFlip = !this.rematchFlip;
    // Swap seats so colours alternate between games.
    const a = this.white;
    const b = this.black;
    this.white = b;
    this.black = a;
    if (this.white) this.white.color = "w";
    if (this.black) this.black.color = "b";
    this.chess = new Chess();
    this.broadcast({
      t: "rematch",
      fen: this.chess.fen(),
      white: this.white?.name ?? "White",
      black: this.black?.name ?? "Black",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Server state                                                        */
/* ------------------------------------------------------------------ */

const rooms = new Map<string, Room>();
/** Quick-match waiting player (at most one parked here at a time). */
let waitingPlayer: Player | null = null;

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(player: Player, msg: ServerMessage): void {
  if (player.socket.readyState === WebSocket.OPEN) {
    player.socket.send(encode(msg));
  }
}

/** Map a chess.js terminal position to our wire reason. */
function detectGameOver(chess: Chess): { reason: GameOverReason; winner: Color | null } | null {
  if (chess.isCheckmate()) {
    // The side to move is checkmated, so the other side won.
    const winner: Color = chess.turn() === "w" ? "b" : "w";
    return { reason: "checkmate", winner };
  }
  if (chess.isStalemate()) return { reason: "stalemate", winner: null };
  if (chess.isInsufficientMaterial()) return { reason: "insufficient", winner: null };
  if (chess.isThreefoldRepetition()) return { reason: "threefold", winner: null };
  if (chess.isDraw()) return { reason: "fiftymove", winner: null };
  return null;
}

/* ------------------------------------------------------------------ */
/* Message handling                                                    */
/* ------------------------------------------------------------------ */

function handleMessage(player: Player, msg: ClientMessage): void {
  switch (msg.t) {
    case "create": {
      leaveRoom(player);
      if (msg.name) player.name = msg.name.slice(0, 24);
      const room = new Room(makeRoomCode());
      rooms.set(room.code, room);
      const color = room.seat(player);
      player.room = room;
      send(player, { t: "joined", room: room.code, color, you: player.name });
      send(player, { t: "waiting", room: room.code });
      break;
    }

    case "join": {
      leaveRoom(player);
      if (msg.name) player.name = msg.name.slice(0, 24);
      const room = rooms.get(msg.room.toUpperCase().trim());
      if (!room) {
        send(player, { t: "error", message: "Room not found." });
        return;
      }
      if (room.isFull) {
        send(player, { t: "error", message: "That room is already full." });
        return;
      }
      const color = room.seat(player);
      player.room = room;
      send(player, { t: "joined", room: room.code, color, you: player.name });
      if (room.isFull) room.startGame();
      break;
    }

    case "quickmatch": {
      leaveRoom(player);
      if (msg.name) player.name = msg.name.slice(0, 24);
      if (waitingPlayer && waitingPlayer !== player && waitingPlayer.socket.readyState === WebSocket.OPEN) {
        const room = new Room(makeRoomCode());
        rooms.set(room.code, room);
        const opponent = waitingPlayer;
        waitingPlayer = null;
        const c1 = room.seat(opponent);
        opponent.room = room;
        send(opponent, { t: "joined", room: room.code, color: c1, you: opponent.name });
        const c2 = room.seat(player);
        player.room = room;
        send(player, { t: "joined", room: room.code, color: c2, you: player.name });
        room.startGame();
      } else {
        waitingPlayer = player;
        send(player, { t: "waiting", room: "matchmaking" });
      }
      break;
    }

    case "move": {
      const room = player.room;
      if (!room || !room.isFull) {
        send(player, { t: "error", message: "No active game." });
        return;
      }
      if (room.chess.turn() !== player.color) {
        send(player, { t: "error", message: "Not your turn." });
        return;
      }
      try {
        const result = room.chess.move({
          from: msg.move.from,
          to: msg.move.to,
          promotion: msg.move.promotion ?? "q",
        });
        if (!result) throw new Error("illegal");
        const fen = room.chess.fen();
        room.broadcast({ t: "move", move: msg.move, fen, by: player.color! });
        const over = detectGameOver(room.chess);
        if (over) {
          room.broadcast({ t: "over", reason: over.reason, winner: over.winner, fen });
        }
      } catch {
        send(player, { t: "error", message: "Illegal move." });
      }
      break;
    }

    case "resign": {
      const room = player.room;
      if (!room || !room.isFull) return;
      const winner: Color = player.color === "w" ? "b" : "w";
      room.broadcast({ t: "over", reason: "resign", winner, fen: room.chess.fen() });
      break;
    }

    case "rematch": {
      const room = player.room;
      if (!room || !room.isFull) return;
      room.prepareRematch();
      break;
    }

    case "chat": {
      const room = player.room;
      if (!room) return;
      room.broadcast({ t: "chat", from: player.name, text: msg.text.slice(0, 240) }, player);
      break;
    }

    case "ping":
      send(player, { t: "pong" });
      break;
  }
}

function leaveRoom(player: Player): void {
  if (waitingPlayer === player) waitingPlayer = null;
  const room = player.room;
  if (!room) return;
  room.remove(player);
  player.room = null;
  player.color = null;
  room.broadcast({ t: "opponentLeft" });
  if (room.players.length === 0) rooms.delete(room.code);
}

/* ------------------------------------------------------------------ */
/* Static file serving (production) + HTTP                             */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (!existsSync(CLIENT_DIR)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("BattleChess server is running. Build the client (npm run build) to serve it here.");
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let filePath = normalize(join(CLIENT_DIR, urlPath));
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (urlPath === "/" || !existsSync(filePath)) {
    filePath = join(CLIENT_DIR, "index.html"); // SPA fallback
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res).catch(() => {
    res.writeHead(500);
    res.end("server error");
  });
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
  const player: Player = { socket, name: "Player", color: null, room: null };

  socket.on("message", (raw) => {
    const msg = decode<ClientMessage>(raw.toString());
    if (!msg) return;
    try {
      handleMessage(player, msg);
    } catch (err) {
      console.error("handler error", err);
      send(player, { t: "error", message: "Server error." });
    }
  });

  socket.on("close", () => leaveRoom(player));
  socket.on("error", () => leaveRoom(player));
});

httpServer.listen(PORT, () => {
  console.log(`BattleChess server listening on http://localhost:${PORT}  (ws on /ws)`);
});
