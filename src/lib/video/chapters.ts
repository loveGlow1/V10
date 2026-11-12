/* A long cut, made in chapters — so a film of up to an hour is stitched on
 * servers whose every run has five minutes and half a gigabyte of disk.
 *
 *   split     the scenes, in order, into chapters of about two minutes,
 *             breaking only between scenes and never inside a run of
 *             scenes that carry on from each other (when it can help it)
 *   each      a chapter is cut like a short video — its scenes, their
 *             transitions, its stretch of the music, one loudness — in its
 *             own run, all chapters at once, and stored as part-<k>.mp4.
 *             Every part is encoded the same way (size, frame rate, codec,
 *             48 kHz stereo AAC), so they join without encoding again
 *   join      the parts, end to end, copied rather than encoded: read from
 *             storage, written as one MP4 straight back into storage while
 *             it is made (it never sits on this server's disk, which a film
 *             of an hour would not fit). Plays in any browser and player.
 *
 * If the one file cannot be stored, the film stays as its parts, played one
 * after another as one film, each downloadable.
 *
 * Pure: the cut (compose-local.ts) and its checks read it. */

/** The longest a cut is made in one run; longer is made in chapters. */
export const ONE_RUN_SECONDS = 150;
/** About how long a chapter is. */
export const CHAPTER_SECONDS = 120;
/** The longest film this studio makes. */
export const MAX_FILM_SECONDS = 60 * 60;

type SceneLike = { n: number; duration: number; continues?: boolean };

/** The scenes of each chapter, by scene number. One chapter when the cut is short. Pure. */
export function chaptersOf(scenes: readonly SceneLike[], target = CHAPTER_SECONDS, oneRun = ONE_RUN_SECONDS): number[][] {
  const total = scenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.duration) || 0), 0);
  if (total <= oneRun || scenes.length <= 1) return [scenes.map((scene) => scene.n)];
  const chapters: number[][] = [];
  let current: number[] = [];
  let seconds = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    current.push(scene.n);
    seconds += Math.max(0, Number(scene.duration) || 0);
    const next = scenes[i + 1];
    if (!next) break;
    /* Long enough: close it, unless the next scene carries straight on from
       this one — then wait for a better place, up to half a chapter more. */
    const linked = next.continues === true;
    if (seconds >= target && (!linked || seconds >= target * 1.5)) {
      chapters.push(current);
      current = [];
      seconds = 0;
    }
  }
  if (current.length) {
    /* A last chapter of a few seconds is folded into the one before. */
    const tail = current.reduce((sum, n) => sum + (Number(scenes.find((s) => s.n === n)?.duration) || 0), 0);
    if (chapters.length && tail < target / 4) chapters[chapters.length - 1].push(...current);
    else chapters.push(current);
  }
  return chapters;
}

/** Where each chapter starts in the film, by planned length (seconds). Pure. */
export function chapterStarts(scenes: readonly SceneLike[], chapters: number[][]): number[] {
  const length = new Map(scenes.map((scene) => [scene.n, Math.max(0, Number(scene.duration) || 0)]));
  const starts: number[] = [];
  let at = 0;
  for (const chapter of chapters) {
    starts.push(at);
    at += chapter.reduce((sum, n) => sum + (length.get(n) ?? 0), 0);
  }
  return starts;
}

/** Where in the music a chapter starts, wrapping round a song shorter than the film. Pure. */
export function musicOffset(start: number, chapterStart: number, musicSeconds: number): number {
  const at = Math.max(0, start) + Math.max(0, chapterStart);
  if (!(musicSeconds > 1)) return at;
  return Math.round((at % musicSeconds) * 100) / 100;
}

/** The part's place in storage. Pure. */
export const partPath = (base: string, k: number) => `${base}/part-${String(k).padStart(3, "0")}.mp4`;

/** A part row's provider, which says which part it is: "part:3". */
export const partProvider = (k: number) => `part:${k}`;
export const partOf = (provider: string | null | undefined): number | null => {
  const match = provider?.match(/^part:(\d+)$/);
  return match ? Number(match[1]) : null;
};

/** The compose row's output while the film is only its parts: "parts:<count>:<base>". */
export const partsOutput = (count: number, base: string) => `parts:${count}:${base}`;
export function readPartsOutput(output: string | null | undefined): { count: number; base: string } | null {
  const match = output?.match(/^parts:(\d+):(.+)$/);
  return match ? { count: Number(match[1]), base: match[2] } : null;
}

/** The concat list that joins the parts, by address. Pure. */
export function concatList(urls: readonly string[]): string {
  return urls.map((url) => `file '${url.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/** ffmpeg: the parts, end to end, copied, as one MP4 written to stdout as it is made. Pure. */
export function streamJoinArgs(input: { list: string }): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
    "-i", input.list,
    "-map", "0", "-c", "copy",
    /* Written front to back with no seeking, so it can be streamed; every
       player opens it. */
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4", "pipe:1",
  ];
}

/** "Part 3 of 24". Pure. */
export const partLabel = (k: number, count: number) => `Part ${k} of ${count}`;
