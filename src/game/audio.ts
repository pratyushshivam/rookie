/** Every sound is synthesised with WebAudio; there are no audio files. */
import { load, save } from "./storage";

type Ctor = typeof AudioContext;

export class Sound {
  muted = load("muted") === "1";
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  /** Browsers only allow sound after a gesture, so call this from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    save("muted", muted ? "1" : "0");
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  vibrate(pattern: number | number[]): void {
    if (this.muted) return;
    // Browsers refuse (and log) vibration before the first real tap.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }

  private tone(freq: number, start: number, length: number, peak: number, type: OscillatorType = "sine", slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.03);
  }

  /**
   * The engine note: two detuned oscillators through a low-pass filter. Pitch
   * and brightness follow `speed` (0 .. 1); `level` 0 fades it out.
   */
  hum(speed: number, level: number): void {
    if (!this.ctx || !this.master) return;
    if (!this.engine) {
      if (level <= 0) return;
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      sub.type = "triangle";
      filter.type = "lowpass";
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      sub.start();
      this.engine = { osc, sub, gain, filter };
    }
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    const pitch = 52 + s * 118;
    this.engine.osc.frequency.setTargetAtTime(pitch, t, 0.06);
    this.engine.sub.frequency.setTargetAtTime(pitch * 0.502, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(260 + s * 900, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(level * (0.028 + 0.03 * s), t, 0.1);
  }

  /** A new line is being drawn. */
  pen(): void {
    this.tone(660, 0, 0.06, 0.03, "triangle");
  }

  /** A drawing became a track. */
  built(): void {
    this.tone(392, 0, 0.16, 0.05, "triangle");
    this.tone(587, 0.09, 0.22, 0.05, "triangle");
    this.vibrate(10);
  }

  /** A drawing could not be used. */
  refuse(): void {
    this.tone(220, 0, 0.16, 0.05, "triangle", 170);
    this.vibrate(18);
  }

  /** One soft tick per generation, a little higher each time up to a point. */
  generation(n: number): void {
    this.tone(700 + Math.min(n, 24) * 14, 0, 0.05, 0.035, "triangle");
  }

  /** The first clean lap. */
  firstLap(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.09, 0.5, 0.07));
    this.tone(1318.5, 0.36, 0.9, 0.05);
    this.vibrate([18, 50, 30]);
  }

  beep(go: boolean): void {
    this.tone(go ? 880 : 440, 0, go ? 0.45 : 0.14, 0.09, "triangle");
    this.vibrate(go ? 30 : 8);
  }

  lap(): void {
    this.tone(784, 0, 0.12, 0.06, "triangle");
    this.tone(1175, 0.08, 0.2, 0.05, "triangle");
  }

  crash(): void {
    this.vibrate(45);
    if (!this.ctx || !this.master || this.muted) return;
    this.tone(130, 0, 0.3, 0.3, "sine", 48);
    const length = 0.18;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * length), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  finish(won: boolean): void {
    const notes = won ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 493.88, 440, 392];
    notes.forEach((f, i) => this.tone(f, i * 0.11, won ? 0.5 : 0.4, 0.07));
    this.vibrate(won ? [20, 40, 20, 40, 60] : 30);
  }
}
