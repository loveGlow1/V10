/* The ffmpeg for one cut, as pure functions of the video settings
 * (cut-settings.ts) — so every setting can be checked offline
 * (tools/check-video.mjs) and run as written by compose-local.ts.
 *
 *   sceneVideoFilter   one scene's picture: fitted to the frame (fill, fit on
 *                      a blurred copy of itself, or fit on black), at its
 *                      speed, graded, at the frame rate, held on its last
 *                      frame while a longer line finishes, words set in clean
 *                      type, and faded where the cut fades
 *   stillVideoFilter   a picture as a scene: the same fit, moving gently
 *   sceneAudioFilter   one scene's sound: the clip's own (at its speed and
 *                      level), the voice line over it, both cut to the scene
 *   joinArgs           every scene joined: a straight join, or one
 *                      transition between each pair (xfade + acrossfade)
 *   musicMixArgs       the music under the joined cut, ducked under the voice
 *
 * Pure. */

import { colorFilter, type CaptionPosition, type CaptionSize, type CaptionStyle, type Fit, type StillMotion, type Transition } from "./cut-settings";

/** The fit of a picture into a W×H frame, as a filter that can follow "[0:v]". Pure. */
export function fitFilter(fit: Fit, width: number, height: number): string {
  if (fit === "fit-black") {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  if (fit === "fit-blur") {
    /* The fill is a small, blurred, darkened copy of the picture itself,
       scaled back up: the look of a phone video posted landscape. */
    const sw = Math.max(16, Math.round(width / 4 / 2) * 2);
    const sh = Math.max(16, Math.round(height / 4 / 2) * 2);
    return (
      `split=2[fitbg][fitfg];` +
      `[fitbg]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},boxblur=8:2,eq=brightness=-0.08,scale=${width}:${height}[fitb];` +
      `[fitfg]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2[fitf];` +
      `[fitb][fitf]overlay=(W-w)/2:(H-h)/2`
    );
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/** atempo for any speed from 0.25 to 4 (one atempo takes 0.5 to 2). Pure. */
export function atempoChain(speed: number): string {
  let s = Math.min(4, Math.max(0.25, speed));
  if (Math.abs(s - 1) < 0.001) return "";
  const parts: string[] = [];
  while (s > 2) {
    parts.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(",");
}

export type Words = {
  fontPath: string;
  dir: string;
  n: number;
  /** A title card's words, set large on a darkened screen. */
  title?: string | null;
  /** Words at the top: the scene's on-screen text, or the end card. */
  headline?: string | null;
  /** The spoken line, as a caption. */
  caption?: string | null;
  captionPosition?: CaptionPosition;
  captionSize?: CaptionSize;
  captionStyle?: CaptionStyle;
  /** The brand's name in one corner, white (Cut.brandMark). */
  brand?: string | null;
  brandPosition?: "top-left" | "bottom-left" | "top-right" | "bottom-right";
};

/** drawtext for a scene's words, in the caption style asked for. Pure. */
export function wordsFilter(words: Words, width: number, height: number): string[] {
  const small = Math.min(width, height);
  const file = (kind: string) => `${words.dir}/${kind}-${words.n}.txt`;
  const parts: string[] = [];
  if (words.title) {
    parts.push("drawbox=x=0:y=0:w=iw:h=ih:color=black@0.97:t=fill");
    parts.push(`drawtext=fontfile=${words.fontPath}:textfile=${file("title")}:fontcolor=white:fontsize=${Math.round(small * 0.085)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`);
  }
  const top = words.captionPosition === "top";
  if (words.headline) {
    parts.push(
      `drawtext=fontfile=${words.fontPath}:textfile=${file("headline")}:fontcolor=white:fontsize=${Math.round(small * 0.055)}:x=(w-text_w)/2:y=${top ? "h*0.80-text_h/2" : "h*0.11"}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(small * 0.02)}:line_spacing=8`,
    );
  }
  if (words.caption) {
    const size = Math.round(small * (words.captionSize === "small" ? 0.045 : words.captionSize === "large" ? 0.072 : 0.058));
    const y = words.captionPosition === "top" ? "h*0.12" : words.captionPosition === "middle" ? "(h-text_h)/2" : "h*0.80-text_h/2";
    const style =
      words.captionStyle === "outline"
        ? `fontcolor=white:borderw=${Math.max(2, Math.round(size * 0.09))}:bordercolor=black`
        : words.captionStyle === "highlight"
          ? `fontcolor=0xFFE14D:borderw=${Math.max(2, Math.round(size * 0.1))}:bordercolor=black`
          : `fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=${Math.round(small * 0.024)}`;
    parts.push(`drawtext=fontfile=${words.fontPath}:textfile=${file("caption")}:${style}:fontsize=${size}:x=(w-text_w)/2:y=${y}:line_spacing=10`);
  }
  if (words.brand) {
    /* Pure white, small, in its corner, with a soft shadow so it reads on
       any picture — never coloured, never moved. */
    const pad = Math.round(small * 0.05);
    const pos = words.brandPosition ?? "top-left";
    const x = pos.endsWith("left") ? `${pad}` : `w-text_w-${pad}`;
    const y = pos.startsWith("top") ? `${pad}` : `h-text_h-${pad}`;
    parts.push(`drawtext=fontfile=${words.fontPath}:textfile=${file("brand")}:fontcolor=white:fontsize=${Math.round(small * 0.042)}:x=${x}:y=${y}:shadowcolor=black@0.45:shadowx=2:shadowy=2`);
  }
  return parts;
}

export type Edges = {
  /** A quick dip in and out of every scene (the "dip" transition). */
  dip?: boolean;
  /** The whole video fades in here (the first scene). */
  fadeIn?: boolean;
  /** The whole video fades out here (the last scene). */
  fadeOut?: boolean;
};

function edgeFades(seconds: number, edges: Edges): string[] {
  const parts: string[] = [];
  const dip = edges.dip ? Math.min(0.2, seconds / 6) : 0;
  const inD = edges.fadeIn ? Math.min(0.8, seconds / 3) : dip;
  const outD = edges.fadeOut ? Math.min(1, seconds / 3) : dip;
  if (inD > 0) parts.push(`fade=t=in:st=0:d=${inD.toFixed(2)}`);
  if (outD > 0) parts.push(`fade=t=out:st=${Math.max(0, seconds - outD).toFixed(2)}:d=${outD.toFixed(2)}`);
  return parts;
}

/** One clip's picture as a scene. Follows "[0:v]"; sceneArgs labels it. Pure. */
export function sceneVideoFilter(input: {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  fit: Fit;
  color?: Parameters<typeof colorFilter>[0];
  /** Uploaded footage at another speed: 2 is twice as fast. */
  speed?: number;
  /** A generated clip slowed to fill its scene (at most 1.4). */
  stretch?: number;
  words?: Words | null;
  edges?: Edges;
}): string {
  const { width, height, seconds } = input;
  const parts = [fitFilter(input.fit, width, height), "setsar=1"];
  if (input.speed && Math.abs(input.speed - 1) > 0.001) parts.push(`setpts=PTS/${input.speed.toFixed(4)}`);
  else if (input.stretch && input.stretch > 1.001) parts.push(`setpts=PTS*${input.stretch.toFixed(4)}`);
  const grade = colorFilter(input.color ?? "none");
  if (grade) parts.push(grade);
  parts.push(`fps=${input.fps}`, `tpad=stop_mode=clone:stop_duration=${seconds}`);
  if (input.words) parts.push(...wordsFilter(input.words, width, height));
  parts.push(...edgeFades(seconds, input.edges ?? {}));
  parts.push("format=yuv420p");
  return parts.join(",");
}

/** A picture as a scene: fitted at twice the size, then moved gently over it. Pure. */
export function stillVideoFilter(input: {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  fit: Fit;
  motion: StillMotion;
  color?: Parameters<typeof colorFilter>[0];
  words?: Words | null;
  edges?: Edges;
}): string {
  const { width, height, seconds, fps } = input;
  const frames = Math.max(1, Math.round(seconds * fps));
  const zoom =
    input.motion === "zoom-in"
      ? `z='1+0.12*on/${frames}'`
      : input.motion === "zoom-out"
        ? `z='1.12-0.12*on/${frames}'`
        : input.motion === "pan"
          ? "z='1.12'"
          : "z='1'";
  const x = input.motion === "pan" ? `x='(iw-iw/zoom)*on/${frames}'` : "x='iw/2-(iw/zoom/2)'";
  const parts = [
    fitFilter(input.fit, width * 2, height * 2),
    "setsar=1",
    `zoompan=${zoom}:${x}:y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
  ];
  const grade = colorFilter(input.color ?? "none");
  if (grade) parts.push(grade);
  parts.push(`tpad=stop_mode=clone:stop_duration=${seconds}`);
  if (input.words) parts.push(...wordsFilter(input.words, width, height));
  parts.push(...edgeFades(seconds, input.edges ?? {}));
  parts.push("format=yuv420p");
  return parts.join(",");
}

/**
 * One scene's sound. Inputs: 0 the clip, 1 silence of the scene's length,
 * 2 the voice line when there is one. The clip's own sound (when heard) at
 * its speed and level, ducked low under a voice; the voice on top. Pure.
 */
/** A brick-wall limiter at -1 dBFS: loud mixes are rounded off, never clipped. */
export const LIMITER = "alimiter=limit=0.89:attack=5:release=60:level=disabled";

export function sceneAudioFilter(input: {
  seconds: number;
  ownSound: boolean;
  hasVoice: boolean;
  /** Level of the clip's own sound: 1 is as recorded. */
  ownLevel?: number;
  voiceLevel?: number;
  speed?: number;
  edges?: Edges;
}): string {
  const { seconds } = input;
  const tempo = input.speed && Math.abs(input.speed - 1) > 0.001 ? `,${atempoChain(input.speed)}` : "";
  const own = (input.ownLevel ?? 1) * (input.hasVoice ? 0.22 : 0.9);
  const bed = input.ownSound ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo${tempo},volume=${own.toFixed(3)},apad[bed]` : `[1:a]anull[bed]`;
  const edges = input.edges ?? {};
  const fades: string[] = [];
  if (edges.fadeIn) fades.push(`afade=t=in:d=${Math.min(0.8, seconds / 3).toFixed(2)}`);
  const out = edges.fadeOut ? Math.min(1, seconds / 3) : edges.dip ? 0.3 : 0.03;
  fades.push(`afade=t=out:st=${Math.max(0, seconds - out).toFixed(2)}:d=${out.toFixed(2)}`);
  /* Never past full scale. A voice line is already mastered loud; it was
     boosted 1.5x and mixed over the clip's own sound, and every loud
     syllable was clipped flat — heard as crackling. Now the voice goes in as
     it is and a limiter rounds any peak off before it can clip. */
  const tail = `atrim=0:${seconds},${fades.join(",")},${LIMITER}`;
  return input.hasVoice
    ? `${bed};[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${(1.0 * (input.voiceLevel ?? 1)).toFixed(3)},adelay=150|150,apad[vo];[bed][vo]amix=inputs=2:duration=first:normalize=0[mix];[mix]${tail}[a]`
    : `${bed};[bed]${tail}[a]`;
}

/** One scene, encoded: picture and sound, exactly `seconds` long. Pure. */
export function sceneEncodeArgs(input: {
  clipPath: string;
  /** Before -i: a trim (-ss/-t) for footage, nothing for a picture. */
  inputOptions?: string[];
  voicePath: string | null;
  seconds: number;
  videoFilter: string;
  audioFilter: string;
  encoder: { preset: string; crf: number };
  out: string;
}): string[] {
  const args = ["-hide_banner", "-y", ...(input.inputOptions ?? []), "-i", input.clipPath, "-f", "lavfi", "-t", String(input.seconds), "-i", "anullsrc=r=48000:cl=stereo"];
  if (input.voicePath) args.push("-i", input.voicePath);
  args.push(
    "-filter_complex", `[0:v]${input.videoFilter}[v];${input.audioFilter}`,
    "-map", "[v]", "-map", "[a]",
    "-t", String(input.seconds),
    "-c:v", "libx264", "-preset", input.encoder.preset, "-crf", String(input.encoder.crf), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    input.out,
  );
  return args;
}

/** xfade's name for each transition; null joins straight. Pure. */
export function xfadeName(transition: Transition): string | null {
  if (transition === "cut" || transition === "dip") return null;
  return transition === "crossfade" ? "fade" : transition;
}

/**
 * The scenes joined. A straight join copies them (the concat demuxer, via a
 * list file); a transition overlaps each pair by `duration` seconds with
 * xfade (picture) and acrossfade (sound), so the cut is that much shorter
 * per join. The overlap never exceeds 45% of the shorter scene. Pure.
 */
export function joinArgs(input: {
  segments: { path: string; seconds: number }[];
  transition: Transition;
  duration: number;
  listPath: string;
  out: string;
  encoder: { preset: string; crf: number };
}): { args: string[]; list: string | null; seconds: number } {
  const total = input.segments.reduce((sum, s) => sum + s.seconds, 0);
  const name = xfadeName(input.transition);
  if (!name || input.segments.length < 2) {
    return {
      list: input.segments.map((s) => `file '${s.path}'`).join("\n"),
      /* The picture is copied; the sound is decoded and encoded once more as
         one stream. Copying AAC segments end to end leaves each one's
         encoder padding at the joins — a click at every cut. */
      args: ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", input.listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-af", "aresample=async=1:first_pts=0", "-movflags", "+faststart", input.out],
      seconds: total,
    };
  }
  const shortest = Math.min(...input.segments.map((s) => s.seconds));
  const d = Math.max(0.1, Math.min(input.duration, shortest * 0.45));
  const graph: string[] = [];
  let offset = 0;
  let v = "0:v";
  let a = "0:a";
  input.segments.forEach((segment, i) => {
    if (i === 0) {
      offset = segment.seconds - d;
      return;
    }
    const vOut = i === input.segments.length - 1 ? "v" : `v${i}`;
    const aOut = i === input.segments.length - 1 ? "a" : `a${i}`;
    graph.push(`[${v}][${i}:v]xfade=transition=${name}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`);
    graph.push(`[${a}][${i}:a]acrossfade=d=${d.toFixed(3)}[${aOut}]`);
    v = vOut;
    a = aOut;
    offset += segment.seconds - d;
  });
  return {
    list: null,
    args: [
      "-hide_banner", "-y",
      ...input.segments.flatMap((s) => ["-i", s.path]),
      "-filter_complex", graph.join(";"),
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", input.encoder.preset, "-crf", String(input.encoder.crf), "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      input.out,
    ],
    seconds: total - d * (input.segments.length - 1),
  };
}

/**
 * The score under the joined cut: input 0 is the cut (voice and scene sound
 * already in it), input 1 the music. The music sits low and — when ducking is
 * on — dips under the voice (sidechain compression); it fades in and out with
 * the picture. With no voice in the cut it is the soundtrack and plays
 * fuller. The picture is copied. Levelling is a second pass (the usual
 * loudnorm): loudnorm inside this graph never finishes flushing, and neither
 * does the graph when the music is trimmed with atrim rather than at the
 * input — so it is cut at the input, and the output held to the same length.
 * Pure.
 */
export function musicMixArgs(input: {
  joined: string;
  music: string;
  out: string;
  seconds: number;
  spoken: boolean;
  /** The music's level, 0 to 2: 1 is the default mix. */
  level?: number;
  /** Dip under the voice. Default on. */
  duck?: boolean;
  /** Start this many seconds into the music file. */
  start?: number;
  /** Play the music round again when it ends (a part of a long film). */
  loop?: boolean;
  /** Fade the music in at the start / out at the end. Both default on; a film's middle parts have neither. */
  fadeIn?: boolean;
  fadeOut?: boolean;
}): string[] {
  const seconds = Math.max(1, input.seconds).toFixed(2);
  const fades = [
    input.fadeIn !== false ? "afade=t=in:d=0.5" : "",
    input.fadeOut !== false ? `afade=t=out:st=${Math.max(0, Number(seconds) - 1.5).toFixed(2)}:d=1.5` : "",
  ].filter(Boolean);
  const fade = fades.length ? fades.join(",") : "anull";
  const level = (input.spoken ? 0.25 : 0.7) * (input.level ?? 1);
  const duck = input.duck !== false;
  const filter = duck
    ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vo1][vo2];` +
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${level.toFixed(3)},${fade}[m];` +
      `[m][vo1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[duck];` +
      `[vo2][duck]amix=inputs=2:duration=first:normalize=0,${LIMITER}[a]`
    : `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[vo];` +
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${level.toFixed(3)},${fade}[m];` +
      `[vo][m]amix=inputs=2:duration=first:normalize=0,${LIMITER}[a]`;
  const start = input.start && input.start > 0 ? ["-ss", input.start.toFixed(2)] : [];
  return [
    "-nostdin", "-hide_banner", "-y", "-i", input.joined, ...(input.loop ? ["-stream_loop", "-1"] : []), ...start, "-t", seconds, "-i", input.music,
    "-filter_complex", filter,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
    "-t", seconds, "-movflags", "+faststart", input.out,
  ];
}

/** The last pass: one loudness (-14 LUFS) for everything, or a straight copy. Pure. */
export function finishArgs(input: { source: string; out: string; loudness: boolean; silent: boolean }): string[] {
  if (input.silent || !input.loudness) return ["-hide_banner", "-y", "-i", input.source, "-c", "copy", "-movflags", "+faststart", input.out];
  return ["-hide_banner", "-y", "-i", input.source, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", input.out];
}
