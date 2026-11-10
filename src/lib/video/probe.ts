/* How long a piece of media runs, read from the file's own header — no
 * ffmpeg, so it works in every route the production line runs in (only the
 * compose route carries the ffmpeg binary):
 *
 *   MP4 / MOV   the movie header box (mvhd): duration ÷ timescale
 *   MP3         a Xing/Info frame count when there is one (VBR), else the
 *               first frame's bitrate over the audio bytes (CBR)
 *   WAV         the data chunk's size ÷ the byte rate
 *
 * The parsers are pure (tools/check-video.mjs). mediaSeconds fetches a URL
 * and reads it. Null whenever it cannot tell.
 *
 * Server-only. */

const MP3_BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

const ascii = (buf: Uint8Array, at: number, length: number) => String.fromCharCode(...buf.subarray(at, at + length));
const positive = (value: number) => (Number.isFinite(value) && value > 0 ? value : null);

function indexOf(buf: Uint8Array, text: string, from = 0): number {
  const codes = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = from; i <= buf.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (buf[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

/** Seconds of an MP4/MOV, from its mvhd box. Pure. */
export function mp4Seconds(buf: Uint8Array): number | null {
  const at = indexOf(buf, "mvhd");
  if (at < 0 || at + 32 > buf.length) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = buf[at + 4];
  if (version === 1) {
    const timescale = view.getUint32(at + 24);
    const duration = Number(view.getBigUint64(at + 28));
    return timescale ? positive(duration / timescale) : null;
  }
  const timescale = view.getUint32(at + 16);
  const duration = view.getUint32(at + 20);
  return timescale ? positive(duration / timescale) : null;
}

/** Seconds of an MP3. Pure. */
export function mp3Seconds(buf: Uint8Array): number | null {
  let start = 0;
  if (ascii(buf, 0, 3) === "ID3" && buf.length > 10) {
    start = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f);
  }
  /* The first frame: an 11-bit sync, Layer III, a real bitrate and rate. */
  let frame = -1;
  for (let i = start; i < Math.min(buf.length - 4, start + 64 * 1024); i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buf[i + 1] >> 3) & 0x03;
    const layer = (buf[i + 1] >> 1) & 0x03;
    const bitrateIndex = buf[i + 2] >> 4;
    const rateIndex = (buf[i + 2] >> 2) & 0x03;
    if (versionBits === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    frame = i;
    break;
  }
  if (frame < 0) return null;
  const versionBits = (buf[frame + 1] >> 3) & 0x03;
  const mpeg1 = versionBits === 3;
  const bitrate = (mpeg1 ? MP3_BITRATES.v1 : MP3_BITRATES.v2)[buf[frame + 2] >> 4] * 1000;
  const sampleRate = MP3_RATES[versionBits][(buf[frame + 2] >> 2) & 0x03];
  const mono = buf[frame + 3] >> 6 === 3;
  const samplesPerFrame = mpeg1 ? 1152 : 576;

  /* A Xing/Info frame knows how many frames follow: exact, VBR or not. */
  const xing = frame + 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
  const tag = ascii(buf, xing, 4);
  if ((tag === "Xing" || tag === "Info") && xing + 12 <= buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint32(xing + 4) & 1) {
      const frames = view.getUint32(xing + 8);
      if (frames) return positive((frames * samplesPerFrame) / sampleRate);
    }
  }
  return positive(((buf.length - frame) * 8) / bitrate);
}

/** Seconds of a WAV. Pure. */
export function wavSeconds(buf: Uint8Array): number | null {
  if (ascii(buf, 0, 4) !== "RIFF" || ascii(buf, 8, 4) !== "WAVE" || buf.length < 44) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let byteRate = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = ascii(buf, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= buf.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") return byteRate ? positive(Math.min(size, buf.length - at - 8) / byteRate) : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Seconds of whichever of the three it is. Pure. */
export function seconds(buf: Uint8Array): number | null {
  if (ascii(buf, 4, 4) === "ftyp" || indexOf(buf.subarray(0, 64), "moov") >= 0) return mp4Seconds(buf);
  if (ascii(buf, 0, 4) === "RIFF") return wavSeconds(buf);
  return mp3Seconds(buf);
}

/** How long the media at a URL runs. Null when it cannot be fetched or read. */
export async function mediaSeconds(url: string, timeoutMs = 20_000): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return null;
    return seconds(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  }
}
