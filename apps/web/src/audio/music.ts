/** What the sequencer needs from the audio engine (the live Sfx, or an offline render). */
export interface MusicOutput {
  readonly context: BaseAudioContext | null;
  readonly musicOut: AudioNode | null;
  readonly noiseBuffer: AudioBuffer | null;
}

// A tiny chiptune sequencer: songs are chord progressions plus a hand-written lead, played
// by square/triangle oscillators and noise drums, scheduled slightly ahead on the WebAudio
// clock. Everything is generated in code, so there are no audio files to ship.

export type SongId = 'menu' | 'match';

/** A lead note: start step (16ths within the loop), MIDI note, length in steps. */
type Note = [number, number, number];

interface Song {
  bpm: number;
  /** One chord (root MIDI note + minor/major) per bar. */
  chords: [number, 'm' | 'M'][];
  lead: Note[];
  /** Drum pattern over one bar of 16ths: k kick, s snare, h hat, '.' rest. */
  drums: string;
  /** Drums at intensity 2. */
  drumsHot: string;
}

const MENU: Song = {
  bpm: 118,
  chords: [
    [57, 'm'],
    [53, 'M'],
    [48, 'M'],
    [55, 'M'],
  ],
  lead: [
    [0, 69, 2],
    [2, 72, 2],
    [4, 76, 4],
    [8, 74, 2],
    [10, 72, 2],
    [12, 71, 2],
    [14, 72, 2],
    [16, 72, 2],
    [18, 69, 2],
    [20, 65, 4],
    [24, 69, 2],
    [26, 72, 2],
    [28, 77, 4],
    [32, 76, 4],
    [36, 74, 2],
    [38, 72, 2],
    [40, 67, 4],
    [44, 72, 2],
    [46, 76, 2],
    [48, 74, 6],
    [54, 71, 2],
    [56, 67, 4],
    [60, 71, 2],
    [62, 74, 2],
  ],
  drums: 'k...s...k.k.s...',
  drumsHot: 'k.h.s.h.k.k.s.hh',
};

const MATCH: Song = {
  bpm: 140,
  chords: [
    [52, 'm'],
    [48, 'M'],
    [50, 'M'],
    [52, 'm'],
    [52, 'm'],
    [48, 'M'],
    [47, 'M'],
    [47, 'M'],
  ],
  // A sparse riff that leaves room for the effects.
  lead: [
    [0, 76, 2],
    [3, 79, 1],
    [4, 76, 2],
    [6, 74, 2],
    [8, 71, 4],
    [16, 72, 2],
    [19, 76, 1],
    [20, 72, 2],
    [22, 71, 2],
    [24, 67, 4],
    [32, 74, 2],
    [35, 78, 1],
    [36, 74, 2],
    [38, 72, 2],
    [40, 69, 4],
    [48, 71, 8],
    [64, 76, 2],
    [67, 79, 1],
    [68, 76, 2],
    [70, 74, 2],
    [72, 71, 4],
    [80, 72, 2],
    [83, 76, 1],
    [84, 79, 2],
    [86, 81, 2],
    [88, 79, 4],
    [96, 78, 4],
    [100, 75, 4],
    [104, 71, 4],
    [108, 75, 4],
    [112, 71, 8],
  ],
  drums: 'k.h.s.h.k.h.s.h.',
  drumsHot: 'khhhskhhkhhhskhs',
};

const SONGS: Record<SongId, Song> = { menu: MENU, match: MATCH };
const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  private song: SongId | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 0 calm, 1 tense, 2 decisive (match point, sudden death, Revenge Turn). */
  intensity = 0;

  constructor(private readonly audio: MusicOutput) {}

  play(song: SongId | null): void {
    if (song === this.song && (this.timer !== null || song === null)) return;
    this.song = song;
    this.step = 0;
    this.stopTimer();
    if (song === null) return;
    const ctx = this.audio.context;
    if (!ctx) return; // Starts on unlock (first click or key press).
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  /** Re-starts the current song once audio is unlocked. */
  resume(): void {
    const song = this.song;
    this.song = null;
    this.play(song);
  }

  /** Renders a song without playing it (previews and checks). */
  static async renderOffline(
    song: SongId,
    seconds: number,
    intensity: number,
    sampleRate = 22050,
  ): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
    const noise = ctx.createBuffer(1, sampleRate, sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    gain.connect(ctx.destination);
    const music = new Music({ context: ctx, musicOut: gain, noiseBuffer: noise });
    music.intensity = intensity;
    const def = SONGS[song];
    const stepDur = 60 / def.bpm / 4;
    const loopSteps = def.chords.length * 16;
    for (let step = 0, t = 0.05; t < seconds; step++, t += stepDur)
      music.playStep(ctx, gain, def, step % loopSteps, t, stepDur);
    return ctx.startRendering();
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.audio.context;
    const out = this.audio.musicOut;
    if (!ctx || !out || !this.song) return;
    const song = SONGS[this.song];
    const stepDur = 60 / song.bpm / 4;
    const loopSteps = song.chords.length * 16;
    // Never schedule a backlog after the tab was in the background.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(ctx, out, song, this.step % loopSteps, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private playStep(
    ctx: BaseAudioContext,
    out: AudioNode,
    song: Song,
    step: number,
    t: number,
    dur: number,
  ): void {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const [root, quality] = song.chords[bar]!;
    const third = quality === 'm' ? 3 : 4;
    const hot = this.intensity >= 2;

    // Bass: driving eighths with an octave bounce.
    if (inBar % 2 === 0) {
      const note = root - 12 + (inBar % 4 === 2 ? 12 : 0);
      this.voice(ctx, out, 'triangle', freq(note), t, dur * 1.8, 0.5);
    }
    // Arpeggio when the match gets tense.
    if (this.intensity >= 1) {
      const chord = [0, third, 7, 12];
      const note = root + 12 + chord[inBar % 4]!;
      this.voice(ctx, out, 'square', freq(note), t, dur * 0.8, hot ? 0.09 : 0.06);
    }
    // Lead.
    for (const [at, midi, len] of song.lead)
      if (at === step) this.voice(ctx, out, 'square', freq(midi), t, dur * len * 0.92, 0.14, true);
    // Drums.
    const hit = (hot ? song.drumsHot : song.drums)[inBar];
    if (hit === 'k') this.kick(ctx, out, t);
    if (hit === 's') this.snare(ctx, out, t);
    if (hit === 'h') this.hat(ctx, out, t);
  }

  private voice(
    ctx: BaseAudioContext,
    out: AudioNode,
    type: OscillatorType,
    f: number,
    t: number,
    dur: number,
    vol: number,
    vibrato = false,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (vibrato && dur > 0.25) {
      osc.frequency.setValueAtTime(f, t + 0.15);
      osc.frequency.linearRampToValueAtTime(f * 1.01, t + dur * 0.7);
    }
    gain.gain.setValueAtTime(vol, t);
    gain.gain.setValueAtTime(vol, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private kick(ctx: BaseAudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private noise(
    ctx: BaseAudioContext,
    out: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    f: number,
    vol: number,
  ): void {
    const buf = this.audio.noiseBuffer;
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(out);
    // Random offset so consecutive hits don't sound identical.
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private snare(ctx: BaseAudioContext, out: AudioNode, t: number): void {
    this.noise(ctx, out, t, 0.12, 'bandpass', 1800, 0.6);
    this.voice(ctx, out, 'triangle', 190, t, 0.07, 0.3);
  }

  private hat(ctx: BaseAudioContext, out: AudioNode, t: number): void {
    this.noise(ctx, out, t, 0.035, 'highpass', 7000, 0.25);
  }
}
