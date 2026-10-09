// Procedural sound effects (sfxr-style) with WebAudio, so the MVP needs no audio assets.

type Sound = 'swing' | 'hit' | 'smash' | 'net' | 'land' | 'body' | 'point' | 'win' | 'serve';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(sound: Sound, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (sound) {
      case 'swing':
        this.noiseBurst(t, 0.09, 900, 2600, 0.12);
        break;
      case 'serve':
      case 'hit':
        this.noiseBurst(t, 0.05, 2200, 1200, 0.5 * intensity);
        this.tone(t, 'triangle', 720, 380, 0.08, 0.35 * intensity);
        break;
      case 'smash':
        this.noiseBurst(t, 0.12, 1800, 400, 0.9);
        this.tone(t, 'square', 260, 70, 0.16, 0.3);
        break;
      case 'net':
        this.tone(t, 'sine', 140, 70, 0.18, 0.5);
        break;
      case 'land':
        this.noiseBurst(t, 0.06, 600, 300, 0.25);
        break;
      case 'body':
        this.tone(t, 'square', 180, 90, 0.15, 0.4);
        this.noiseBurst(t, 0.08, 500, 200, 0.4);
        break;
      case 'point':
        this.tone(t, 'square', 660, 660, 0.09, 0.18);
        this.tone(t + 0.1, 'square', 880, 880, 0.14, 0.18);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.12, 'square', f, f, 0.16, 0.2));
        break;
    }
  }

  private tone(
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
