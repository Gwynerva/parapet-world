/**
 * Our own small Web Audio synthesiser: every sound is generated, nothing is loaded. Footsteps per
 * material sound family, jump, landing, roll, find, checkpoint, finish, death, a UI tick, and an
 * ambience loop per district that cross-fades when the district changes. The context starts on
 * the first user gesture (browsers refuse audio before one).
 */
import type { MaterialDef } from '@parapet-world/schemas';

export type SoundFamily = MaterialDef['sound'];

/** A footstep's character: band-pass noise (centre, Q, decay) plus a tonal knock. */
const STEP: Readonly<Record<SoundFamily, [number, number, number, number, number, number]>> = {
  // centre Hz, Q, decay s, tone Hz, tone decay s, level
  concrete: [1300, 1.1, 0.05, 95, 0.04, 0.55],
  brick: [950, 1.0, 0.055, 85, 0.05, 0.55],
  tar: [520, 0.8, 0.045, 70, 0.04, 0.35],
  wood: [650, 2.2, 0.07, 190, 0.07, 0.55],
  metal: [2900, 5.0, 0.09, 880, 0.12, 0.42],
  grate: [3600, 3.5, 0.05, 1240, 0.06, 0.4],
  wet: [2400, 0.7, 0.14, 120, 0.05, 0.45],
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private amb: { district: string; gain: GainNode; stop: () => void } | null = null;
  private ambWant: string | null = null;
  private volume: number;

  constructor(volume: number) {
    this.volume = volume;
    const unlock = (): void => {
      this.start();
      if (this.ctx && this.ctx.state === 'running') {
        removeEventListener('pointerdown', unlock);
        removeEventListener('keydown', unlock);
        removeEventListener('touchend', unlock);
      }
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    addEventListener('touchend', unlock);
  }

  /** Creates or resumes the context (call from a user gesture). */
  start(): void {
    if (!this.ctx) {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      const n = ctx.sampleRate * 2,
        buf = ctx.createBuffer(1, n, ctx.sampleRate),
        d = buf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x3fffffff - 1) * 0.9;
      }
      this.noise = buf;
      if (this.ambWant) this.ambience(this.ambWant);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Suspends everything (pause, hidden tab) or resumes. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && this.master ? this.ctx : null;
  }

  /** A noise burst through a filter with an attack-decay envelope. */
  private burst(
    type: BiquadFilterType,
    freq: number,
    q: number,
    decay: number,
    level: number,
    at = 0,
    sweepTo = 0,
  ): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + at,
      src = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.02);
  }

  /** A tone with an exponential decay, optionally gliding to another pitch. */
  private tone(
    type: OscillatorType,
    freq: number,
    decay: number,
    level: number,
    at = 0,
    glideTo = 0,
  ): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + at,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  footstep(family: SoundFamily, loud = 1): void {
    const [fc, q, dec, tf, td, lv] = STEP[family] ?? STEP.concrete,
      k = 0.9 + Math.random() * 0.2;
    this.burst('bandpass', fc * k, q, dec, lv * 0.5 * loud);
    this.tone('sine', tf * k, td, lv * 0.35 * loud);
    if (family === 'grate') this.burst('bandpass', fc * 1.3 * k, q, dec * 0.8, lv * 0.3, 0.03);
    if (family === 'wet') this.burst('lowpass', 1800, 0.7, 0.18, lv * 0.25, 0.02, 400);
  }

  jump(): void {
    this.burst('bandpass', 700, 1.2, 0.18, 0.25, 0, 2200);
    this.tone('triangle', 260, 0.12, 0.12, 0, 420);
  }

  land(hard: boolean, family: SoundFamily): void {
    this.tone('sine', hard ? 140 : 110, hard ? 0.22 : 0.12, hard ? 0.6 : 0.35, 0, 45);
    this.burst('lowpass', hard ? 900 : 700, 0.8, hard ? 0.16 : 0.09, hard ? 0.5 : 0.3);
    this.footstep(family, hard ? 1.2 : 0.8);
  }

  roll(): void {
    for (let i = 0; i < 4; i++) this.burst('lowpass', 900 - i * 120, 0.9, 0.12, 0.22, i * 0.09);
  }

  death(): void {
    this.tone('sawtooth', 420, 0.6, 0.18, 0, 70);
    this.burst('lowpass', 600, 0.7, 0.4, 0.35);
  }

  find(): void {
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => this.tone('triangle', f, 0.45, 0.22, i * 0.08));
    this.tone('sine', 2093, 0.9, 0.08, 0.32);
  }

  checkpoint(): void {
    this.tone('sine', 880, 0.35, 0.25);
    this.tone('sine', 1320, 0.35, 0.18, 0.09);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone('square', f, 0.25, 0.08, i * 0.09));
    for (const f of [523.25, 659.25, 783.99]) this.tone('triangle', f, 1.1, 0.12, 0.5);
  }

  unlock(): void {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone('triangle', f, 0.3, 0.14, i * 0.06));
  }

  tick(): void {
    this.tone('square', 1800, 0.03, 0.05);
  }

  /** Cross-fades to a district's ambience loop (null: silence). */
  ambience(district: string | null): void {
    this.ambWant = district;
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (this.amb && this.amb.district === district) return;
    const old = this.amb;
    if (old) {
      old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
      setTimeout(old.stop, 3000);
    }
    this.amb = null;
    if (!district) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    gain.connect(this.master);
    this.amb = { district, gain, stop: this.loop(district, gain) };
  }

  /** Builds a district's loop into `out`; returns how to stop it. */
  private loop(district: string, out: GainNode): () => void {
    const ctx = this.ctx!,
      nodes: AudioScheduledSourceNode[] = [];
    const noise = (
      type: BiquadFilterType,
      freq: number,
      q: number,
      level: number,
    ): BiquadFilterNode => {
      const src = ctx.createBufferSource(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain();
      src.buffer = this.noise;
      src.loop = true;
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      g.gain.value = level;
      src.connect(f).connect(g).connect(out);
      src.start();
      nodes.push(src);
      return f;
    };
    const lfo = (target: AudioParam, rate: number, depth: number): void => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = rate;
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      nodes.push(o);
    };
    const drone = (type: OscillatorType, freq: number, cutoff: number, level: number): void => {
      const o = ctx.createOscillator(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      g.gain.value = level;
      o.connect(f).connect(g).connect(out);
      o.start();
      nodes.push(o);
    };
    // occasional sounds: drips, clanks, distant traffic
    let timer = 0;
    const every = (min: number, max: number, fn: () => void): void => {
      const tick = (): void => {
        fn();
        timer = window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000);
      };
      timer = window.setTimeout(tick, min * 1000);
    };
    const kind = district.split('.')[0];
    if (kind === 'rooftops') {
      const f = noise('bandpass', 420, 0.6, 0.16);
      lfo(f.frequency, 0.07, 160);
      noise('lowpass', 160, 0.5, 0.12);
      every(5, 11, () => this.tone('sine', 380 + Math.random() * 120, 1.4, 0.015));
    } else if (kind === 'warehouses') {
      drone('sine', 55, 200, 0.05);
      noise('lowpass', 300, 0.7, 0.07);
      every(3, 8, () => {
        this.tone('triangle', 160 + Math.random() * 60, 0.5, 0.04);
        this.burst('bandpass', 1800, 6, 0.4, 0.03);
      });
    } else if (kind === 'factory') {
      drone('sawtooth', 70, 260, 0.05);
      drone('square', 35, 120, 0.03);
      const f = noise('bandpass', 900, 1.5, 0.05);
      lfo(f.Q, 1.6, 1.2);
      every(0.9, 1.1, () => this.burst('lowpass', 220, 0.8, 0.25, 0.12));
    } else {
      noise('lowpass', 320, 0.7, 0.14);
      const f = noise('bandpass', 1400, 2, 0.03);
      lfo(f.frequency, 0.3, 500);
      every(0.6, 2.4, () => this.tone('sine', 1400 + Math.random() * 900, 0.12, 0.05, 0, 600));
    }
    return () => {
      window.clearTimeout(timer);
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          // already stopped
        }
      }
      out.disconnect();
    };
  }
}
