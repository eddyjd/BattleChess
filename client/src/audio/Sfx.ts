/**
 * Procedural sound effects via the Web Audio API — no audio files needed.
 * Every effect is synthesized from oscillators and filtered noise, so the
 * whole soundscape adds zero download weight and works offline.
 *
 * The AudioContext is created lazily inside a user gesture (mobile browsers
 * require this) and every effect checks `enabled`, which persists across
 * sessions. Pass a `rate` < 1 to pitch an effect down during slow motion.
 */

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = localStorage.getItem("bc_sound") !== "off";

  setEnabled(on: boolean): void {
    this.enabled = on;
    localStorage.setItem("bc_sound", on ? "on" : "off");
  }

  /** Create/resume the context. Safe to call from any handler. */
  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // 1s of white noise, reused by every noise-based effect.
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Filtered noise burst (hits, whooshes, rattles). */
  private noise(opts: {
    dur: number;
    freq: number;
    endFreq?: number;
    q?: number;
    type?: BiquadFilterType;
    gain?: number;
    delay?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.endFreq), t0 + opts.dur);
    filter.Q.value = opts.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain ?? 0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  /** Pitched tone (pings, stings, fanfares). */
  private tone(opts: {
    freq: number;
    endFreq?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t0 + opts.dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain ?? 0.25, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  /* ------------------------------ effects ------------------------------ */

  /** UI tick: selecting a piece / pressing a button. */
  tick(): void {
    this.tone({ freq: 660, endFreq: 880, dur: 0.06, type: "triangle", gain: 0.15 });
  }

  /** A piece sliding/walking to its square. */
  move(): void {
    this.noise({ dur: 0.18, freq: 900, endFreq: 300, q: 0.8, gain: 0.18 });
  }

  /** Weapon whoosh before a strike. */
  swoosh(rate = 1): void {
    this.noise({ dur: 0.22 / rate, freq: 1400 * rate, endFreq: 250 * rate, q: 1.2, gain: 0.3 });
  }

  /** Melee hit: metallic clang + body thump. */
  hit(power = 1, rate = 1): void {
    this.tone({ freq: 2400 * rate, endFreq: 900 * rate, dur: 0.09, type: "square", gain: 0.12 * power });
    this.tone({ freq: 3100 * rate, endFreq: 1400 * rate, dur: 0.05, type: "square", gain: 0.08 * power, delay: 0.01 });
    this.noise({ dur: 0.16, freq: 220 * rate, endFreq: 60, type: "lowpass", q: 0.7, gain: 0.5 * power });
    this.tone({ freq: 130 * rate, endFreq: 45, dur: 0.22, gain: 0.4 * power });
  }

  /** Spell being conjured: rising shimmer. */
  magic(rate = 1): void {
    for (let i = 0; i < 4; i++) {
      this.tone({
        freq: (500 + i * 260) * rate,
        endFreq: (900 + i * 380) * rate,
        dur: 0.28,
        type: "sine",
        gain: 0.07,
        delay: i * 0.05,
      });
    }
    this.noise({ dur: 0.35, freq: 3000 * rate, endFreq: 6000 * rate, q: 2, gain: 0.08 });
  }

  /** Explosion / heavy landing. */
  boom(power = 1, rate = 1): void {
    this.tone({ freq: 160 * rate, endFreq: 32, dur: 0.5, gain: 0.55 * power });
    this.noise({ dur: 0.45, freq: 500 * rate, endFreq: 80, type: "lowpass", q: 0.5, gain: 0.5 * power });
    this.noise({ dur: 0.12, freq: 2500, q: 0.6, gain: 0.2 * power });
  }

  /** Skeleton collapsing into a pile of bones. */
  bones(): void {
    for (let i = 0; i < 7; i++) {
      this.noise({
        dur: 0.05,
        freq: 1500 + Math.random() * 1800,
        q: 6,
        gain: 0.16,
        delay: i * 0.05 + Math.random() * 0.03,
      });
    }
  }

  /** Check! warning sting. */
  sting(): void {
    this.tone({ freq: 440, dur: 0.14, type: "sawtooth", gain: 0.12 });
    this.tone({ freq: 466, dur: 0.22, type: "sawtooth", gain: 0.12, delay: 0.12 });
  }

  /** March drums as the attacker closes in. */
  march(): void {
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.1, freq: 180, endFreq: 70, type: "lowpass", q: 1, gain: 0.3, delay: i * 0.16 });
    }
  }

  /** Victor's short flourish after a kill. */
  flourish(): void {
    this.tone({ freq: 523, dur: 0.1, type: "triangle", gain: 0.12 });
    this.tone({ freq: 659, dur: 0.14, type: "triangle", gain: 0.12, delay: 0.09 });
  }

  /** Game over: victory or defeat phrase. */
  fanfare(win: boolean | null): void {
    const seq = win === false ? [392, 370, 349, 311] : [523, 659, 784, 1047];
    seq.forEach((f, i) =>
      this.tone({ freq: f, dur: i === seq.length - 1 ? 0.5 : 0.16, type: "triangle", gain: 0.16, delay: i * 0.15 }),
    );
  }
}

export const Sfx = new SfxEngine();
