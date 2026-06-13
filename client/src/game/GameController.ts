import * as THREE from "three";
import { Chess, type Move } from "chess.js";
import type { Stage } from "../scene/Stage";
import { Board3D } from "./Board3D";
import { PieceManager } from "./PieceManager";
import { BattleDirector } from "./effects/BattleDirector";
import { AIController, type Difficulty } from "../ai/AIController";
import type { NetClient } from "../net/NetClient";
import type { PieceColor, PieceType } from "./PieceFactory";
import type { Color, GameOverReason, ServerMessage } from "../../../shared/protocol";

export type Mode = "local" | "ai" | "online";

export interface GameView {
  turn: Color;
  check: boolean;
  whiteName: string;
  blackName: string;
  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  status: string;
  thinking: boolean;
  myColor: Color | null;
}

export interface GameOverInfo {
  reason: GameOverReason | string;
  winner: Color | null;
  youWin: boolean | null;
}

export interface GameHooks {
  onUpdate(view: GameView): void;
  onGameOver(info: GameOverInfo): void;
  onToast(msg: string): void;
  choosePromotion(): Promise<"q" | "r" | "b" | "n">;
  setCinematic(on: boolean): void;
  dismiss(): void;
}

export interface NewGameConfig {
  mode: Mode;
  fen?: string;
  myColor?: Color;
  difficulty?: Difficulty;
  net?: NetClient;
  whiteName?: string;
  blackName?: string;
}

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

export class GameController {
  private chess = new Chess();
  private board: Board3D;
  private pieces: PieceManager;
  private battle: BattleDirector;
  private ai: AIController | null = null;
  private net: NetClient | null = null;
  private netUnsub: (() => void) | null = null;

  private mode: Mode = "local";
  private myColor: Color | null = null;
  private aiColor: Color | null = null;
  private whiteName = "White";
  private blackName = "Black";

  private selected: string | null = null;
  private legalForSelected: Move[] = [];
  private busy = false;
  private over = false;
  private thinking = false;
  private turnToken = 0;

  private capturedByWhite: PieceType[] = [];
  private capturedByBlack: PieceType[] = [];

  private raycaster = new THREE.Raycaster();
  private pointerDown = { x: 0, y: 0, t: 0 };

  constructor(private stage: Stage, private hooks: GameHooks) {
    this.board = new Board3D();
    stage.scene.add(this.board.group);
    this.pieces = new PieceManager(stage);
    this.battle = new BattleDirector(stage, hooks.setCinematic);

    stage.onFrame((dt) => {
      this.board.update(performance.now() / 1000);
      this.pieces.update(dt);
    });

    const dom = stage.renderer.domElement;
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointerup", this.onPointerUp);
  }

  /* ----------------------------- setup ----------------------------- */

  async newGame(config: NewGameConfig): Promise<void> {
    this.turnToken++;
    this.teardownNet();
    this.ai?.dispose();
    this.ai = null;

    this.mode = config.mode;
    this.chess = new Chess(config.fen || undefined);
    this.myColor = config.myColor ?? null;
    this.whiteName = config.whiteName ?? "White";
    this.blackName = config.blackName ?? "Black";
    this.over = false;
    this.busy = false;
    this.thinking = false;
    this.selected = null;
    this.capturedByWhite = [];
    this.capturedByBlack = [];

    if (config.mode === "ai") {
      this.myColor = config.myColor ?? "w";
      this.aiColor = this.myColor === "w" ? "b" : "w";
      this.ai = new AIController(config.difficulty ?? "medium");
      this.whiteName = this.myColor === "w" ? "You" : "Computer";
      this.blackName = this.myColor === "b" ? "You" : "Computer";
    } else {
      this.aiColor = null;
    }

    if (config.mode === "online" && config.net) {
      this.net = config.net;
      this.netUnsub = this.net.on((m) => this.onServerMessage(m));
    }

    this.board.clearSelection();
    this.board.setCheck(null);
    await this.pieces.setupFrom(this.chess);

    this.stage.setViewpoint(this.myColor ?? "w");
    this.board.setLastMove("", ""); // clear
    this.emit();
    this.afterMove(false);
  }

  /* --------------------------- input ------------------------------- */

  private get canInput(): boolean {
    if (this.busy || this.over || this.thinking) return false;
    const turn = this.chess.turn();
    if (this.mode === "local") return true;
    return turn === this.myColor;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    const moved = Math.hypot(dx, dy);
    const dt = performance.now() - this.pointerDown.t;
    if (moved > 8 || dt > 500) return; // it was a camera drag, not a tap
    if (!this.canInput) return;
    const square = this.pickSquare(e.clientX, e.clientY);
    if (square) this.onSquareClicked(square);
  };

  private pickSquare(clientX: number, clientY: number): string | null {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const hits = this.raycaster.intersectObjects(this.board.getPickTargets(), false);
    return hits.length ? (hits[0].object.userData.square as string) : null;
  }

  private async onSquareClicked(square: string): Promise<void> {
    const turn = this.chess.turn();

    // Already have a selection?
    if (this.selected) {
      const target = this.legalForSelected.find((m) => m.to === square);
      if (target) {
        await this.commitMove(this.selected, square, target);
        return;
      }
      // Clicking another own piece reselects; anything else clears.
      const piece = this.chess.get(square as never);
      if (piece && piece.color === turn) {
        this.select(square);
      } else {
        this.clearSelection();
      }
      return;
    }

    // Fresh selection.
    const piece = this.chess.get(square as never);
    if (piece && piece.color === turn) this.select(square);
  }

  private select(square: string): void {
    this.selected = square;
    this.legalForSelected = this.chess.moves({ square: square as never, verbose: true }) as Move[];
    this.board.clearSelection();
    this.board.selectSquare(square);
    this.pieces.setSelected(square);
    this.board.showMoves(
      this.legalForSelected.map((m) => ({ to: m.to, capture: m.flags.includes("c") || m.flags.includes("e") })),
    );
  }

  private clearSelection(): void {
    this.selected = null;
    this.legalForSelected = [];
    this.board.clearSelection();
    this.pieces.setSelected(null);
    // Re-apply persistent highlights.
    const hist = this.chess.history({ verbose: true }) as Move[];
    const last = hist[hist.length - 1];
    if (last) this.board.setLastMove(last.from, last.to);
    this.refreshCheck();
  }

  /* --------------------------- moves ------------------------------- */

  private async commitMove(from: string, to: string, sample: Move): Promise<void> {
    let promotion: "q" | "r" | "b" | "n" | undefined;
    if (sample.flags.includes("p")) {
      promotion = await this.hooks.choosePromotion();
    }
    this.clearSelection();

    if (this.mode === "online") {
      // Server is authoritative; send and wait for the broadcast.
      this.net?.send({ t: "move", move: { from, to, promotion } });
      return;
    }

    const detail = this.chess.move({ from, to, promotion: promotion ?? "q" });
    if (!detail) return;
    await this.applyDetailedMove(detail);
  }

  /** Animate a move that has *already* been applied to `this.chess`. */
  private async applyDetailedMove(detail: Move): Promise<void> {
    this.busy = true;
    this.pieces.setSelected(null);
    this.board.clearSelection();

    const { from, to, flags, color } = detail;
    const isEnPassant = flags.includes("e");
    const isCapture = flags.includes("c") || isEnPassant;

    if (isCapture) {
      const capSquare = isEnPassant ? `${to[0]}${from[1]}` : to;
      const attacker = this.pieces.pieceAt(from);
      const defender = this.pieces.detach(capSquare);
      this.pieces.detach(from);
      if (attacker && defender) {
        await this.battle.fight(attacker, defender);
        this.pieces.disposePiece(defender);
        this.pieces.place(attacker, to);
      } else {
        if (defender) this.pieces.disposePiece(defender);
        if (attacker) this.pieces.place(attacker, to);
      }
    } else {
      await this.pieces.move(from, to);
    }

    // Castling: relocate the rook with a slide.
    if (flags.includes("k") || flags.includes("q")) {
      const rank = from[1];
      const rookFrom = `${flags.includes("k") ? "h" : "a"}${rank}`;
      const rookTo = `${flags.includes("k") ? "f" : "d"}${rank}`;
      await this.pieces.move(rookFrom, rookTo);
    }

    // Promotion: swap the pawn mesh for the chosen piece.
    if (flags.includes("p") && detail.promotion) {
      await this.pieces.promote(to, detail.promotion as PieceType, color as PieceColor);
    }

    if (detail.captured) {
      if (color === "w") this.capturedByWhite.push(detail.captured as PieceType);
      else this.capturedByBlack.push(detail.captured as PieceType);
    }

    this.board.setLastMove(from, to);
    this.refreshCheck();
    this.busy = false;
    this.afterMove(true);
  }

  private afterMove(announce: boolean): void {
    this.emit();
    if (this.checkGameOver(announce)) return;
    if (this.mode === "ai" && this.chess.turn() === this.aiColor) {
      void this.runAI();
    }
  }

  private async runAI(): Promise<void> {
    if (!this.ai) return;
    const token = this.turnToken;
    this.thinking = true;
    this.emit();
    const mv = await this.ai.bestMove(this.chess.fen());
    if (token !== this.turnToken || this.over) return;
    this.thinking = false;
    if (!mv) {
      this.emit();
      return;
    }
    const detail = this.chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? "q" });
    if (detail) await this.applyDetailedMove(detail);
  }

  /* ------------------------ game over / status --------------------- */

  private checkGameOver(announce: boolean): boolean {
    if (!this.chess.isGameOver()) return false;
    this.over = true;
    let reason: GameOverReason = "draw";
    let winner: Color | null = null;
    if (this.chess.isCheckmate()) {
      reason = "checkmate";
      winner = this.chess.turn() === "w" ? "b" : "w";
    } else if (this.chess.isStalemate()) reason = "stalemate";
    else if (this.chess.isInsufficientMaterial()) reason = "insufficient";
    else if (this.chess.isThreefoldRepetition()) reason = "threefold";
    else reason = "fiftymove";

    if (announce) {
      this.hooks.onGameOver({
        reason,
        winner,
        youWin: this.myColor ? winner === this.myColor : null,
      });
    }
    return true;
  }

  private refreshCheck(): void {
    if (this.chess.inCheck()) {
      const turn = this.chess.turn();
      const board = this.chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = board[r][c];
          if (cell && cell.type === "k" && cell.color === turn) {
            this.board.setCheck(`${String.fromCharCode(97 + c)}${8 - r}`);
          }
        }
      }
    } else {
      this.board.setCheck(null);
    }
  }

  private statusText(): string {
    if (this.over) return "Game over";
    if (this.thinking) return "Computer is thinking…";
    const turn = this.chess.turn();
    const name = turn === "w" ? this.whiteName : this.blackName;
    const check = this.chess.inCheck() ? " — Check!" : "";
    if (this.mode === "local") return `${name} to move${check}`;
    if (turn === this.myColor) return `Your move${check}`;
    return `${name}'s move${check}`;
  }

  private emit(): void {
    this.hooks.onUpdate({
      turn: this.chess.turn(),
      check: this.chess.inCheck(),
      whiteName: this.whiteName,
      blackName: this.blackName,
      capturedByWhite: this.capturedByWhite,
      capturedByBlack: this.capturedByBlack,
      status: this.statusText(),
      thinking: this.thinking,
      myColor: this.myColor,
    });
  }

  /* --------------------------- network ----------------------------- */

  private async onServerMessage(msg: ServerMessage): Promise<void> {
    switch (msg.t) {
      case "move": {
        const detail = this.chess.move({
          from: msg.move.from,
          to: msg.move.to,
          promotion: msg.move.promotion ?? "q",
        });
        if (detail) await this.applyDetailedMove(detail);
        break;
      }
      case "over": {
        this.over = true;
        this.hooks.onGameOver({
          reason: msg.reason,
          winner: msg.winner,
          youWin: this.myColor ? msg.winner === this.myColor : null,
        });
        break;
      }
      case "rematch": {
        this.handleRematch(msg.fen, msg.white, msg.black);
        break;
      }
      case "opponentLeft":
        this.hooks.onToast("Your opponent left the game.");
        this.over = true;
        break;
      case "chat":
        this.hooks.onToast(`${msg.from}: ${msg.text}`);
        break;
      case "error":
        this.hooks.onToast(msg.message);
        break;
    }
  }

  private async handleRematch(fen: string, white: string, black: string): Promise<void> {
    this.turnToken++;
    this.chess = new Chess(fen);
    this.whiteName = white;
    this.blackName = black;
    // Our colour may have flipped; recompute from names ("You" marker not used online).
    this.myColor = this.myColor === "w" ? "b" : "w";
    this.over = false;
    this.busy = false;
    this.selected = null;
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.board.clearSelection();
    this.board.setCheck(null);
    await this.pieces.setupFrom(this.chess);
    this.stage.setViewpoint(this.myColor);
    this.hooks.dismiss();
    this.emit();
  }

  private teardownNet(): void {
    this.netUnsub?.();
    this.netUnsub = null;
    this.net = null;
  }

  /* --------------------------- public API -------------------------- */

  resign(): void {
    if (this.over) return;
    if (this.mode === "online") {
      this.net?.send({ t: "resign" });
      return;
    }
    this.over = true;
    const winner: Color = this.chess.turn() === "w" ? "b" : "w";
    this.hooks.onGameOver({ reason: "resign", winner, youWin: this.myColor ? winner === this.myColor : false });
  }

  requestRematch(): void {
    if (this.mode === "online") this.net?.send({ t: "rematch" });
  }

  /** Drive a move programmatically (screenshot harness / console testing). */
  async testMove(from: string, to: string): Promise<void> {
    const sample = (this.chess.moves({ square: from as never, verbose: true }) as Move[]).find(
      (m) => m.to === to,
    );
    if (!sample) return;
    const detail = this.chess.move({ from, to, promotion: "q" });
    if (detail) await this.applyDetailedMove(detail);
  }

  dispose(): void {
    this.turnToken++;
    this.teardownNet();
    this.ai?.dispose();
    const dom = this.stage.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointerup", this.onPointerUp);
    this.pieces.clear();
  }

  static describeReason(reason: string): string {
    switch (reason) {
      case "checkmate": return "Checkmate";
      case "stalemate": return "Stalemate — draw";
      case "resign": return "Resignation";
      case "threefold": return "Threefold repetition — draw";
      case "insufficient": return "Insufficient material — draw";
      case "fiftymove": return "Fifty-move rule — draw";
      case "timeout": return "Timeout";
      default: return "Draw";
    }
  }

  static pieceName(type: string): string {
    return PIECE_NAMES[type] ?? type;
  }
}
