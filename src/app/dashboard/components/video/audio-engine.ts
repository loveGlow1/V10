"use client";

/* The editor's sound, played the way an editing app plays it: every voice
 * line and the music are fetched and decoded into memory ahead of time, then
 * laid on ONE audio clock (Web Audio) with sample-exact start and stop times.
 *
 * What it replaced: an <audio> element whose source was swapped at every
 * scene (a fresh load at each cut — the sound stopped), and that was seeked
 * back whenever it drifted from the picture (each seek a click). Here nothing
 * loads at a cut and nothing is ever seeked while playing: the lines are
 * already in memory and already scheduled.
 *
 * The audio clock is the editor's clock while playing (position()), so the
 * picture follows the sound rather than the sound chasing the picture. When
 * the picture really cannot keep up (a clip still loading), hold() suspends
 * the whole clock — sound and picture pause together, cleanly — and release()
 * carries on from the same sample.
 *
 * A file that cannot be fetched or decoded here (a storage link that does not
 * allow it) is reported by failed(), and the editor plays that one the old
 * way, with an <audio> element. */

export type ScheduledVoice = {
  url: string;
  /** Timeline seconds where the line starts. */
  at: number;
  /** Timeline seconds where it is cut off (its scene ends). */
  until: number;
  volume: number;
};

export type ScheduledMusic = {
  url: string;
  /** Seconds into the music file at timeline 0. */
  offset: number;
  /** The music's level from each timeline moment on (ducked under speech). */
  levels: { at: number; gain: number }[];
};

export type Schedule = { voices: ScheduledVoice[]; music: ScheduledMusic | null };

/** The storage link changes on every load (it is signed); the file does not. */
const keyOf = (url: string) => url.split("?")[0];

/** A short fade at every start and stop, so no line begins or ends on a click. */
const FADE = 0.012;

type Ctor = typeof AudioContext;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private broken = new Set<string>();
  private playing: { ctxStart: number; from: number; schedule: Schedule } | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private held = false;

  /** Whether this browser can play the sound this way at all. */
  get available(): boolean {
    return typeof window !== "undefined" && Boolean(window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);
  }

  /** Made (and woken) from a tap or key press: a browser only lets sound start from one. */
  unlock(): void {
    if (!this.available) return;
    if (!this.ctx) {
      const C = (window.AudioContext || (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext) as Ctor;
      this.ctx = new C({ latencyHint: "playback" });
      /* An iPhone's silent switch mutes Web Audio unless the page says it is playback. */
      try {
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = "playback";
      } catch {
        /* Older Safari. */
      }
    }
    if (this.ctx.state === "suspended" && !this.held) void this.ctx.resume().catch(() => {});
  }

  /** A file that could not be fetched or decoded here: the editor plays it the old way. */
  failed(url: string | null | undefined): boolean {
    return Boolean(url && this.broken.has(keyOf(url)));
  }

  /** Fetches and decodes these files in the background, a few at a time. */
  preload(urls: (string | null | undefined)[]): void {
    for (const url of urls) if (url) void this.load(url);
  }

  private load(url: string): Promise<AudioBuffer | null> {
    const key = keyOf(url);
    const have = this.buffers.get(key);
    if (have) return Promise.resolve(have);
    if (this.broken.has(key)) return Promise.resolve(null);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const job = (async () => {
      try {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) throw new Error(String(response.status));
        const bytes = await response.arrayBuffer();
        /* Decoding needs a context; one made just for it if playback has not started. */
        const ctx = this.ctx ?? this.decoder();
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
          const result = ctx.decodeAudioData(bytes, resolve, reject);
          if (result && typeof (result as Promise<AudioBuffer>).then === "function") (result as Promise<AudioBuffer>).then(resolve, reject);
        });
        this.buffers.set(key, buffer);
        /* Arrived while playing: laid on the clock at once, from where it should be by now. */
        if (this.playing) this.place(key, buffer);
        return buffer;
      } catch {
        this.broken.add(key);
        return null;
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, job);
    return job;
  }

  private decodeOnly: BaseAudioContext | null = null;
  private decoder(): BaseAudioContext {
    if (!this.decodeOnly) {
      const C = (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext) as typeof OfflineAudioContext;
      this.decodeOnly = new C(2, 44100, 44100);
    }
    return this.decodeOnly;
  }

  /** Starts the sound from timeline second `from`. Anything already playing is stopped first. */
  play(from: number, schedule: Schedule): void {
    this.stop();
    if (!this.ctx) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    this.held = false;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    /* A hair in the future, so the first line is scheduled, not late. */
    this.playing = { ctxStart: ctx.currentTime + 0.05, from, schedule };
    const keys = new Set([...schedule.voices.map((v) => keyOf(v.url)), ...(schedule.music ? [keyOf(schedule.music.url)] : [])]);
    for (const key of keys) {
      const buffer = this.buffers.get(key);
      if (buffer) this.place(key, buffer);
    }
    this.preload([...schedule.voices.map((v) => v.url), schedule.music?.url]);
  }

  /** Lays every use of one file on the clock, from the current position. */
  private place(key: string, buffer: AudioBuffer): void {
    const ctx = this.ctx;
    const run = this.playing;
    if (!ctx || !run) return;
    const position = this.position() ?? run.from;
    /* When timeline second `t` sounds, on the context's clock. */
    const when = (t: number) => run.ctxStart + (t - run.from);
    for (const voice of run.schedule.voices) {
      if (keyOf(voice.url) !== key) continue;
      const end = Math.min(voice.until, voice.at + buffer.duration);
      if (end <= position + 0.02) continue;
      const startAt = Math.max(voice.at, position);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const t0 = Math.max(ctx.currentTime, when(startAt));
      const t1 = Math.max(t0 + FADE * 2, when(end));
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(voice.volume, t0 + FADE);
      gain.gain.setValueAtTime(voice.volume, Math.max(t0 + FADE, t1 - FADE));
      gain.gain.linearRampToValueAtTime(0, t1);
      source.connect(gain).connect(ctx.destination);
      source.start(t0, startAt - voice.at);
      source.stop(t1 + 0.01);
      this.track(source);
    }
    const music = run.schedule.music;
    if (music && keyOf(music.url) === key) {
      const into = music.offset + position;
      if (into < buffer.duration - 0.05) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        const t0 = Math.max(ctx.currentTime, when(position));
        const levels = music.levels.length ? music.levels : [{ at: 0, gain: 0.7 }];
        const levelAt = (t: number) => [...levels].reverse().find((l) => l.at <= t + 1e-6)?.gain ?? levels[0].gain;
        const first = levelAt(position);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(first, t0 + FADE * 4);
        /* The ducking: each change eased over a tenth of a second, never a jump. */
        for (const level of levels) {
          if (level.at <= position + 0.01) continue;
          const at = when(level.at);
          gain.gain.setTargetAtTime(level.gain, at - 0.05, 0.04);
        }
        source.connect(gain).connect(ctx.destination);
        source.start(t0, into);
        this.track(source);
      }
    }
  }

  private track(node: AudioScheduledSourceNode) {
    this.nodes.push(node);
    node.onended = () => {
      this.nodes = this.nodes.filter((n) => n !== node);
    };
  }

  /** Timeline seconds now, while playing (null when not). Pauses with hold(). */
  position(): number | null {
    const ctx = this.ctx;
    const run = this.playing;
    if (!ctx || !run) return null;
    return run.from + Math.max(0, ctx.currentTime - run.ctxStart);
  }

  /** Whether the audio clock is running (the editor's clock while playing). */
  get running(): boolean {
    return Boolean(this.ctx && this.playing && this.ctx.state === "running");
  }

  /** Pauses sound and clock together — the picture is catching up. */
  hold(): void {
    if (!this.ctx || !this.playing || this.held) return;
    this.held = true;
    void this.ctx.suspend().catch(() => {});
  }

  /** Carries on from the same sample. */
  release(): void {
    if (!this.ctx || !this.held) return;
    this.held = false;
    void this.ctx.resume().catch(() => {});
  }

  get holding(): boolean {
    return this.held;
  }

  /** Stops every sound, at once and cleanly. */
  stop(): void {
    for (const node of this.nodes) {
      try {
        node.onended = null;
        node.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.nodes = [];
    this.playing = null;
    if (this.held && this.ctx) {
      this.held = false;
      void this.ctx.resume().catch(() => {});
    }
  }

  close(): void {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
