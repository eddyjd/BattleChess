/**
 * A tiny promise-based tween manager. Every animated thing in the game
 * (piece slides, battle lunges, camera moves) is expressed as a tween that
 * advances by a delta time each frame. Because the manager is fed a
 * *scaled* delta, a single `timeScale` knob gives us cinematic slow-motion
 * for free during capture battles.
 */

export type Easing = (t: number) => number;

export const Easings = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicIn: (t: number) => t * t * t,
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  backOut: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

interface TweenSpec {
  duration: number; // seconds (in scaled time)
  onUpdate: (t: number) => void; // t = eased progress 0..1
  easing?: Easing;
  onComplete?: () => void;
}

interface ActiveTween extends TweenSpec {
  elapsed: number;
  resolve: () => void;
}

export class TweenManager {
  private tweens: ActiveTween[] = [];

  /** Advance all active tweens by `dt` seconds (already time-scaled). */
  update(dt: number): void {
    if (this.tweens.length === 0) return;
    // Iterate over a snapshot so completions can safely queue new tweens.
    const current = this.tweens;
    this.tweens = [];
    for (const tw of current) {
      tw.elapsed += dt;
      const raw = tw.duration <= 0 ? 1 : Math.min(tw.elapsed / tw.duration, 1);
      const eased = (tw.easing ?? Easings.linear)(raw);
      tw.onUpdate(eased);
      if (raw >= 1) {
        tw.onComplete?.();
        tw.resolve();
      } else {
        this.tweens.push(tw);
      }
    }
  }

  /** Run a tween and resolve when it finishes. */
  to(spec: TweenSpec): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ ...spec, elapsed: 0, resolve });
    });
  }

  /** Convenience: wait `seconds` of scaled time. */
  delay(seconds: number): Promise<void> {
    return this.to({ duration: seconds, onUpdate: () => {} });
  }

  clear(): void {
    // Resolve outstanding promises so awaiters don't hang on teardown.
    for (const tw of this.tweens) tw.resolve();
    this.tweens = [];
  }
}

/** Real-time (unscaled) wait, handy for UI-only timing. */
export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
