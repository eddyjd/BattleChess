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

  /**
   * A stack of FIXED-pitch decaying partials — how struck metal and wood
   * actually ring (an anvil's overtones don't glide; sweeping them is what
   * makes synth hits sound like lasers). Ratios ~[1, 2.76, 5.4, 8.9] give
   * bell/anvil metal; low ratios like [1, 1.5, 2.3] give wood/thud bodies.
   */
  private ring(opts: {
    base: number;
    ratios: number[];
    dur: number;
    gain: number;
    type?: OscillatorType;
    delay?: number;
  }): void {
    for (let i = 0; i < opts.ratios.length; i++) {
      const detune = 1 + (Math.random() - 0.5) * 0.01;
      this.tone({
        freq: opts.base * opts.ratios[i] * detune,
        dur: opts.dur * (1 - i * 0.12),
        type: opts.type ?? "sine",
        gain: opts.gain / (1 + i * 0.9),
        delay: opts.delay ?? 0,
      });
    }
  }

  /* ------------------------------ effects ------------------------------ */

  /** UI tick: a dry woodblock tap (fixed pitch, instant decay). */
  tick(): void {
    this.ring({ base: 950, ratios: [1, 1.59], dur: 0.045, gain: 0.14, type: "triangle" });
    this.noise({ dur: 0.02, freq: 4000, q: 1, gain: 0.08 });
  }

  /** A piece walking to its square: soft footstep taps, no tone at all. */
  move(): void {
    this.noise({ dur: 0.07, freq: 260, type: "lowpass", q: 0.7, gain: 0.25 });
    this.noise({ dur: 0.07, freq: 220, type: "lowpass", q: 0.7, gain: 0.2, delay: 0.13 });
  }

  /** Weapon whoosh: breathy air, wide-band noise only. */
  swoosh(rate = 1): void {
    this.noise({ dur: 0.24 / rate, freq: 900 * rate, endFreq: 220 * rate, q: 0.5, gain: 0.28 });
  }

  /** Melee hit: anvil-like metallic ring + noise thud. No pitch glides. */
  hit(power = 1, rate = 1): void {
    // The strike transient: a hard, short click of high noise.
    this.noise({ dur: 0.03, freq: 5200, q: 0.8, gain: 0.3 * power });
    // Metal ringing at fixed inharmonic partials (anvil ratios).
    this.ring({ base: 640 * rate, ratios: [1, 2.76, 5.4, 8.9], dur: 0.24, gain: 0.2 * power });
    // Body of the blow: lowpassed noise thud + a short fixed sub knock.
    this.noise({ dur: 0.13, freq: 240, endFreq: 70, type: "lowpass", q: 0.6, gain: 0.55 * power });
    this.tone({ freq: 68 * rate, dur: 0.1, gain: 0.4 * power });
  }

  /** Spell being conjured: harp-like plucked arpeggio (discrete notes,
   *  never glides) over a faint air shimmer. */
  magic(rate = 1): void {
    const scale = [523, 659, 784, 988, 1175]; // pentatonic-ish, fixed pitches
    scale.forEach((f, i) => {
      this.ring({ base: f * rate, ratios: [1, 2], dur: 0.16, gain: 0.1, delay: i * 0.06 });
    });
    this.noise({ dur: 0.4, freq: 6500, q: 0.4, gain: 0.05 });
  }

  /** Explosion / heavy landing: almost all noise, like a real blast. */
  boom(power = 1, rate = 1): void {
    this.noise({ dur: 0.55, freq: 420 * rate, endFreq: 55, type: "lowpass", q: 0.5, gain: 0.65 * power });
    this.noise({ dur: 0.09, freq: 2200, q: 0.5, gain: 0.25 * power });
    // Fixed low sub-drum note, not a dive-bomb sweep.
    this.tone({ freq: 52, dur: 0.32, gain: 0.5 * power });
    this.ring({ base: 190 * rate, ratios: [1, 1.5, 2.2], dur: 0.2, gain: 0.16 * power });
  }

  /** Skeleton collapsing: dry clattering sticks — clicks + tiny wood rings. */
  bones(): void {
    for (let i = 0; i < 8; i++) {
      const d = i * 0.05 + Math.random() * 0.04;
      this.noise({ dur: 0.025, freq: 2600 + Math.random() * 1500, q: 2, gain: 0.18, delay: d });
      this.ring({
        base: 700 + Math.random() * 700,
        ratios: [1, 1.47],
        dur: 0.05,
        gain: 0.07,
        type: "triangle",
        delay: d,
      });
    }
  }

  /** Check! warning: two low horn blasts at fixed pitch. */
  sting(): void {
    this.ring({ base: 220, ratios: [1, 2, 3], dur: 0.16, gain: 0.14, type: "triangle" });
    this.ring({ base: 208, ratios: [1, 2, 3], dur: 0.3, gain: 0.14, type: "triangle", delay: 0.16 });
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
