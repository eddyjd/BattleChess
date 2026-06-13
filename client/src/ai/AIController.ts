import type { WireMove } from "../../../shared/protocol";

export type Difficulty = "easy" | "medium" | "hard" | "master";

const SETTINGS: Record<Difficulty, { depth: number; randomness: number }> = {
  easy: { depth: 2, randomness: 0.8 },
  medium: { depth: 3, randomness: 0.25 },
  hard: { depth: 4, randomness: 0.05 },
  master: { depth: 5, randomness: 0 },
};

/**
 * Main-thread handle around the AI web worker. Call `bestMove(fen)` and
 * await the engine's reply without ever blocking the render loop.
 */
export class AIController {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (m: WireMove | null) => void>();

  constructor(public difficulty: Difficulty = "medium") {
    this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<{ id: number; move: WireMove | null }>) => {
      const resolve = this.pending.get(e.data.id);
      if (resolve) {
        this.pending.delete(e.data.id);
        resolve(e.data.move);
      }
    };
  }

  bestMove(fen: string): Promise<WireMove | null> {
    const { depth, randomness } = SETTINGS[this.difficulty];
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ fen, depth, randomness, id });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
