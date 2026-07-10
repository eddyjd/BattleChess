import { el, GLYPH } from "./dom";
import { GameController, type GameView, type GameOverInfo } from "../game/GameController";
import { Sfx } from "../audio/Sfx";

export interface HUDCallbacks {
  onResign: () => void;
  onMenu: () => void;
  onPlayAgain: () => void;
}

/**
 * In-game heads-up display: player name plates with captured-piece trays,
 * a status banner, control buttons, cinematic letterbox bars, a promotion
 * picker, toasts and the game-over screen. Pure DOM, no framework.
 */
export class HUD {
  private root: HTMLElement;
  private statusEl!: HTMLElement;
  private whiteTag!: HTMLElement;
  private blackTag!: HTMLElement;
  private whiteCap!: HTMLElement;
  private blackCap!: HTMLElement;
  private whiteName!: HTMLElement;
  private blackName!: HTMLElement;
  private toastEl!: HTMLElement;
  private overlay!: HTMLElement;
  private loadingEl!: HTMLElement;
  private loadingLabel!: HTMLElement;
  private body: HTMLElement;
  private callbacks: HUDCallbacks;

  constructor(mount: HTMLElement, callbacks: HUDCallbacks) {
    this.callbacks = callbacks;
    this.body = document.body;
    this.root = el("div", { class: "hud hidden" });
    this.build();
    mount.append(this.root);
    this.toastEl = el("div", { class: "toast" });
    mount.append(this.toastEl);
    this.overlay = el("div", { class: "overlay hidden" });
    mount.append(this.overlay);
    this.loadingEl = el("div", { class: "loading hidden" }, [
      el("div", { class: "spinner" }),
      (this.loadingLabel = el("div", {}, ["Summoning the armies…"])),
    ]);
    mount.append(this.loadingEl);
    // Cinematic bars
    mount.append(el("div", { class: "cinebar top" }));
    mount.append(el("div", { class: "cinebar bottom" }));
  }

  private build(): void {
    this.blackName = el("div", { class: "nm" }, ["Black"]);
    this.blackCap = el("div", { class: "cap" });
    this.blackTag = el("div", { class: "player-tag", id: "tag-black" }, [this.blackName, this.blackCap]);

    this.whiteName = el("div", { class: "nm" }, ["White"]);
    this.whiteCap = el("div", { class: "cap" });
    this.whiteTag = el("div", { class: "player-tag", id: "tag-white" }, [this.whiteName, this.whiteCap]);

    const soundBtn = el("button", {
      class: "icon-btn",
      title: "Sound on/off",
      onclick: () => {
        Sfx.setEnabled(!Sfx.enabled);
        soundBtn.textContent = Sfx.enabled ? "🔊" : "🔇";
        if (Sfx.enabled) Sfx.tick();
      },
    }, [Sfx.enabled ? "🔊" : "🔇"]);

    const controls = el("div", { class: "controls" }, [
      soundBtn,
      el("button", { class: "icon-btn", title: "Resign", onclick: () => this.callbacks.onResign() }, ["⚐"]),
      el("button", { class: "icon-btn", title: "Main menu", onclick: () => this.callbacks.onMenu() }, ["☰"]),
    ]);

    this.statusEl = el("div", { class: "status-banner" }, ["White to move"]);

    this.root.append(
      el("div", { class: "hud-top" }, [this.blackTag, controls]),
      this.statusEl,
      el("div", { class: "hud-bottom" }, [this.whiteTag, el("div")]),
    );
  }

  show(): void {
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.overlay.classList.add("hidden");
  }

  update(view: GameView): void {
    this.statusEl.textContent = view.status;
    this.statusEl.classList.toggle("check", view.check);
    this.whiteName.textContent = view.whiteName;
    this.blackName.textContent = view.blackName;
    // Captured-by-white are black pieces; captured-by-black are white pieces.
    this.whiteCap.textContent = view.capturedByWhite.map((t) => GLYPH[t].b).join(" ");
    this.blackCap.textContent = view.capturedByBlack.map((t) => GLYPH[t].w).join(" ");
    this.whiteTag.classList.toggle("turn", view.turn === "w" && !view.thinking);
    this.blackTag.classList.toggle("turn", view.turn === "b" && !view.thinking);
  }

  setCinematic(on: boolean): void {
    this.body.classList.toggle("cinebars-on", on);
  }

  showLoading(label = "Summoning the armies…"): void {
    this.loadingLabel.textContent = label;
    this.loadingEl.classList.remove("hidden");
  }
  setLoading(done: number, total: number): void {
    this.loadingLabel.textContent = `Summoning the armies… ${done}/${total}`;
  }
  hideLoading(): void {
    this.loadingEl.classList.add("hidden");
  }

  private toastTimer: number | null = null;
  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 3200);
  }

  choosePromotion(): Promise<"q" | "r" | "b" | "n"> {
    return new Promise((resolve) => {
      const pick = (p: "q" | "r" | "b" | "n") => {
        this.overlay.classList.add("hidden");
        this.overlay.replaceChildren();
        resolve(p);
      };
      const opt = (p: "q" | "r" | "b" | "n", label: string, glyph: string) =>
        el("button", { class: "btn", onclick: () => pick(p) }, [`${glyph}  ${label}`]);
      const card = el("div", { class: "card" }, [
        el("h2", { class: "title", style: "font-size:24px" }, ["Promote pawn"]),
        el("p", { class: "subtitle" }, ["Choose a piece"]),
        opt("q", "Queen", "♛"),
        opt("r", "Rook", "♜"),
        opt("b", "Bishop", "♝"),
        opt("n", "Knight", "♞"),
      ]);
      this.overlay.replaceChildren(card);
      this.overlay.classList.remove("hidden");
    });
  }

  showGameOver(info: GameOverInfo): void {
    Sfx.fanfare(info.youWin);
    const headline =
      info.youWin === true ? "Victory!" : info.youWin === false ? "Defeat" : GameController.describeReason(String(info.reason));
    const sub =
      info.winner === null
        ? GameController.describeReason(String(info.reason))
        : `${info.winner === "w" ? "White" : "Black"} wins by ${GameController.describeReason(String(info.reason)).toLowerCase()}`;

    const card = el("div", { class: "card", style: "text-align:center" }, [
      el("h1", { class: "title" }, [headline]),
      el("p", { class: "subtitle" }, [sub]),
      el("button", { class: "btn primary", onclick: () => this.callbacks.onPlayAgain() }, ["Play Again"]),
      el("button", { class: "btn ghost", onclick: () => this.callbacks.onMenu() }, ["Main Menu"]),
    ]);
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove("hidden");
  }

  dismissOverlay(): void {
    this.overlay.classList.add("hidden");
    this.overlay.replaceChildren();
  }
}
