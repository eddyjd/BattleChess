import { el } from "./dom";
import { NetClient } from "../net/NetClient";
import type { Difficulty } from "../ai/AIController";
import type { NewGameConfig } from "../game/GameController";
import type { Color } from "../../../shared/protocol";

type Screen = "home" | "ai" | "online" | "join" | "waiting";

/**
 * Front-end menu + online lobby. Collects the player's choices and, once a
 * game is ready, hands a fully-formed config to `onStart`. For online play
 * it owns the WebSocket connection through the lobby handshake and passes
 * the live socket into the game.
 */
export class Menu {
  private overlay: HTMLElement;
  private card: HTMLElement;
  private name: string;
  private difficulty: Difficulty = "medium";
  private aiSide: "w" | "b" | "r" = "w";

  private net: NetClient | null = null;
  private netUnsub: (() => void) | null = null;
  private myColor: Color = "w";

  constructor(mount: HTMLElement, private onStart: (config: NewGameConfig) => void) {
    this.name = localStorage.getItem("bc_name") || "Player";
    this.card = el("div", { class: "card" });
    this.overlay = el("div", { class: "overlay" }, [this.card]);
    mount.append(this.overlay);
    this.render("home");
  }

  show(): void {
    this.overlay.classList.remove("hidden");
    this.render("home");
  }

  hide(): void {
    this.overlay.classList.add("hidden");
  }

  private title(text: string, sub: string): HTMLElement[] {
    return [el("h1", { class: "title" }, [text]), el("p", { class: "subtitle" }, [sub])];
  }

  private back(to: Screen): HTMLElement {
    return el("button", { class: "btn ghost back", onclick: () => this.render(to) }, ["← Back"]);
  }

  private segmented<T extends string>(
    options: { value: T; label: string }[],
    current: T,
    onPick: (v: T) => void,
  ): HTMLElement {
    const seg = el("div", { class: "seg" });
    const buttons = new Map<T, HTMLElement>();
    for (const o of options) {
      const b = el("button", {
        class: o.value === current ? "active" : "",
        onclick: () => {
          onPick(o.value);
          buttons.forEach((btn, val) => btn.classList.toggle("active", val === o.value));
        },
      }, [o.label]);
      buttons.set(o.value, b);
      seg.append(b);
    }
    return seg;
  }

  private render(screen: Screen): void {
    if (screen !== "waiting") this.teardownNet();
    this.card.replaceChildren();
    switch (screen) {
      case "home":
        this.renderHome();
        break;
      case "ai":
        this.renderAI();
        break;
      case "online":
        this.renderOnline();
        break;
      case "join":
        this.renderJoin();
        break;
    }
  }

  private renderHome(): void {
    this.card.append(
      ...this.title("BattleChess", "3D chess where captured pieces fight to the death"),
      el("button", { class: "btn primary", onclick: () => this.render("ai") }, ["♟  Play vs Computer"]),
      el("button", { class: "btn", onclick: () => this.render("online") }, ["🌐  Play Online"]),
      el("button", {
        class: "btn",
        onclick: () => this.onStart({ mode: "local", whiteName: "White", blackName: "Black" }),
      }, ["👥  Local 2-Player"]),
      el("p", { class: "hint" }, ["Drag to orbit the board · tap a piece to move · captures trigger a battle"]),
    );
  }

  private renderAI(): void {
    this.card.append(
      ...this.title("Vs Computer", "Pick your side and the engine strength"),
      el("div", { class: "section-label" }, ["Play as"]),
      this.segmented(
        [
          { value: "w" as const, label: "White" },
          { value: "b" as const, label: "Black" },
          { value: "r" as const, label: "Random" },
        ],
        this.aiSide,
        (v) => (this.aiSide = v),
      ),
      el("div", { class: "section-label" }, ["Difficulty"]),
      this.segmented(
        [
          { value: "easy" as const, label: "Easy" },
          { value: "medium" as const, label: "Medium" },
          { value: "hard" as const, label: "Hard" },
          { value: "master" as const, label: "Master" },
        ],
        this.difficulty,
        (v) => (this.difficulty = v),
      ),
      el("button", {
        class: "btn primary",
        style: "margin-top:16px",
        onclick: () => {
          const color: Color = this.aiSide === "r" ? (Math.random() < 0.5 ? "w" : "b") : this.aiSide;
          this.onStart({ mode: "ai", myColor: color, difficulty: this.difficulty });
        },
      }, ["Start Game"]),
      this.back("home"),
    );
  }

  private nameInput(): HTMLInputElement {
    const input = el("input", {
      type: "text",
      class: "name",
      value: this.name,
      maxlength: "24",
      placeholder: "Your name",
      oninput: (e: Event) => {
        this.name = (e.target as HTMLInputElement).value || "Player";
        localStorage.setItem("bc_name", this.name);
      },
    }) as HTMLInputElement;
    return input;
  }

  private renderOnline(): void {
    this.card.append(
      ...this.title("Play Online", "Match against a friend or a random opponent"),
      el("div", { class: "section-label" }, ["Display name"]),
      this.nameInput(),
      el("button", { class: "btn primary", style: "margin-top:14px", onclick: () => this.startOnline("quickmatch") }, [
        "⚡  Quick Match",
      ]),
      el("button", { class: "btn", onclick: () => this.startOnline("create") }, ["➕  Create Private Room"]),
      el("button", { class: "btn", onclick: () => this.render("join") }, ["🔑  Join with Code"]),
      this.back("home"),
    );
  }

  private renderJoin(): void {
    const codeInput = el("input", {
      type: "text",
      maxlength: "4",
      placeholder: "ROOM CODE",
    }) as HTMLInputElement;
    this.card.append(
      ...this.title("Join Room", "Enter the 4-letter code from your friend"),
      this.nameInput(),
      codeInput,
      el("button", {
        class: "btn primary",
        onclick: () => {
          const code = codeInput.value.trim().toUpperCase();
          if (code.length === 4) this.startOnline("join", code);
        },
      }, ["Join Game"]),
      this.back("online"),
    );
  }

  private renderWaiting(message: string, code?: string): void {
    this.card.replaceChildren(
      ...this.title("Waiting…", message),
      ...(code
        ? [
            el("div", { class: "section-label" }, ["Share this code"]),
            el("div", {
              class: "title",
              style: "letter-spacing:8px;font-size:48px;margin:6px 0",
            }, [code]),
          ]
        : [el("div", { class: "spinner", style: "margin:20px auto" })]),
      el("button", { class: "btn ghost", onclick: () => this.render("online") }, ["Cancel"]),
    );
  }

  private async startOnline(action: "quickmatch" | "create" | "join", code?: string): Promise<void> {
    this.renderWaiting("Connecting to server…");
    this.net = new NetClient();
    try {
      await this.net.connect();
    } catch {
      this.card.replaceChildren(
        ...this.title("Connection failed", "Could not reach the game server."),
        el("p", { class: "hint" }, ["Start it with `npm run dev` (or `npm start`) and try again."]),
        this.back("online"),
      );
      return;
    }
    this.netUnsub = this.net.on((msg) => {
      switch (msg.t) {
        case "joined":
          this.myColor = msg.color;
          break;
        case "waiting":
          if (msg.room === "matchmaking") this.renderWaiting("Finding an opponent…");
          else this.renderWaiting("Waiting for your friend to join…", msg.room);
          break;
        case "start":
          this.netUnsub?.();
          this.netUnsub = null;
          this.onStart({
            mode: "online",
            net: this.net!,
            myColor: this.myColor,
            fen: msg.fen,
            whiteName: msg.white,
            blackName: msg.black,
          });
          break;
        case "error":
          this.card.replaceChildren(
            ...this.title("Oops", msg.message),
            this.back("online"),
          );
          break;
      }
    });

    if (action === "quickmatch") this.net.send({ t: "quickmatch", name: this.name });
    else if (action === "create") this.net.send({ t: "create", name: this.name });
    else this.net.send({ t: "join", room: code!, name: this.name });
  }

  private teardownNet(): void {
    // Closes the lobby socket. When a game starts we hand the socket to the
    // game and clear netUnsub *before* this runs, so returning to the menu
    // here cleanly tears down whatever connection is still open.
    this.netUnsub?.();
    this.netUnsub = null;
    this.net?.close();
    this.net = null;
  }
}
