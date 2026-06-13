import "./style.css";
import { Stage } from "./scene/Stage";
import { GameController, type GameHooks, type NewGameConfig } from "./game/GameController";
import { HUD } from "./ui/HUD";
import { Menu } from "./ui/Menu";

/**
 * Application shell: builds the 3D stage, the game controller and the UI,
 * then routes between the menu and an in-progress game. A single Stage and
 * GameController live for the whole session and are reused across games.
 */
class App {
  private stage: Stage;
  private game: GameController;
  private hud: HUD;
  private menu: Menu;
  private lastConfig: NewGameConfig | null = null;

  constructor(mount: HTMLElement) {
    this.stage = new Stage(mount);

    this.hud = new HUD(mount, {
      onResign: () => this.game.resign(),
      onMenu: () => this.toMenu(),
      onPlayAgain: () => this.playAgain(),
    });

    const hooks: GameHooks = {
      onUpdate: (v) => this.hud.update(v),
      onGameOver: (info) => this.hud.showGameOver(info),
      onToast: (m) => this.hud.toast(m),
      choosePromotion: () => this.hud.choosePromotion(),
      setCinematic: (on) => this.hud.setCinematic(on),
      dismiss: () => this.hud.dismissOverlay(),
    };
    this.game = new GameController(this.stage, hooks);

    this.menu = new Menu(mount, (config) => this.startGame(config));
  }

  private async startGame(config: NewGameConfig): Promise<void> {
    this.lastConfig = config;
    this.menu.hide();
    this.hud.dismissOverlay();
    this.hud.show();
    await this.game.newGame(config);
  }

  private playAgain(): void {
    if (!this.lastConfig) return this.toMenu();
    if (this.lastConfig.mode === "online") {
      this.game.requestRematch();
      this.hud.toast("Rematch requested…");
    } else {
      void this.startGame(this.lastConfig);
    }
  }

  private toMenu(): void {
    this.hud.hide();
    this.menu.show();
  }

  /** Test/debug hook used by the screenshot harness (and handy in console). */
  get controller(): GameController {
    return this.game;
  }
}

const mount = document.getElementById("app");
if (mount) {
  const app = new App(mount);
  (window as unknown as { __bc: App }).__bc = app;
}
