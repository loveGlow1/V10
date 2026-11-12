/* A file written into storage while it is being made — for a film too big
 * for this server's disk (chapters.ts). Supabase Storage's resumable upload
 * (TUS): the upload is opened, then sent in 6 MB pieces as they arrive.
 *
 * The length is not known until the end, so the upload is opened with its
 * length deferred. Where that is refused, the file is made twice: once to
 * count its bytes, once to send them.
 *
 * Server-only. Never throws. */

import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

/** Supabase's resumable uploads take pieces of exactly this size (the last may be shorter). */
export const PIECE = 6 * 1024 * 1024;

type Result = { ok: true; bytes: number } | { ok: false; reason: string };

/** Cuts a stream of buffers into pieces of exactly `size` bytes; the last may be shorter. Pure. */
export async function* pieces(source: AsyncIterable<Buffer>, size = PIECE): AsyncGenerator<Buffer> {
  let held: Buffer[] = [];
  let heldBytes = 0;
  for await (const chunk of source) {
    let rest = chunk;
    while (rest.length) {
      const room = size - heldBytes;
      const take = rest.subarray(0, room);
      held.push(take);
      heldBytes += take.length;
      rest = rest.subarray(take.length);
      if (heldBytes === size) {
        yield Buffer.concat(held, size);
        held = [];
        heldBytes = 0;
      }
    }
  }
  if (heldBytes) yield Buffer.concat(held, heldBytes);
}

/** ffmpeg's output, as it is written. Rejects when ffmpeg fails. */
export async function* ffmpegOutput(args: string[], timeoutMs: number): AsyncGenerator<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server.");
  const child = spawn(ffmpegPath as string, args, { stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stderr.on("data", (data: Buffer) => {
    said = (said + data.toString()).slice(-2000);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const finished = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  try {
    for await (const chunk of child.stdout) yield chunk as Buffer;
    const code = await finished;
    if (code !== 0) throw new Error(`ffmpeg stopped (${code ?? "killed"}): ${said.trim().split("\n").pop() ?? ""}`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

const b64 = (value: string) => Buffer.from(value).toString("base64");

function storageBase(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

async function open(base: { url: string; key: string }, input: { bucket: string; path: string; contentType: string; length: number | null }): Promise<string | { refused: string }> {
  const response = await fetch(`${base.url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${base.key}`,
      apikey: base.key,
      "Tus-Resumable": "1.0.0",
      ...(input.length === null ? { "Upload-Defer-Length": "1" } : { "Upload-Length": String(input.length) }),
      "Upload-Metadata": [`bucketName ${b64(input.bucket)}`, `objectName ${b64(input.path)}`, `contentType ${b64(input.contentType)}`, `cacheControl ${b64("3600")}`].join(","),
      "x-upsert": "true",
    },
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => ({ ok: false, status: 0, text: async () => String(error), headers: new Headers() }) as unknown as Response);
  const location = response.headers.get("location");
  if (response.status !== 201 || !location) return { refused: `${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}` };
  return new URL(location, `${base.url}/storage/v1/upload/resumable/`).toString();
}

async function send(base: { url: string; key: string }, at: string, piece: Buffer, offset: number, finalLength: number | null): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(at, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${base.key}`,
        apikey: base.key,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        ...(finalLength !== null ? { "Upload-Length": String(finalLength) } : {}),
      },
      body: new Uint8Array(piece),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (response && (response.status === 204 || response.status === 200)) return null;
    if (response && response.status < 500 && response.status !== 409) return `${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`;
  }
  return "the storage service stopped answering";
}

/**
 * Stores what `make()` produces at `bucket/path`, as it is produced.
 * `make` may be called twice (see the header), so it must make the same bytes each time.
 */
export async function streamToStorage(input: {
  bucket: string;
  path: string;
  contentType: string;
  make: () => AsyncIterable<Buffer>;
}): Promise<Result> {
  const base = storageBase();
  if (!base) return { ok: false, reason: "storage is not configured on this server" };
  try {
    let at = await open(base, { ...input, length: null });
    let knownLength: number | null = null;
    if (typeof at !== "string") {
      /* The length could not be deferred: count it first. */
      let counted = 0;
      for await (const chunk of input.make()) counted += chunk.length;
      if (!counted) return { ok: false, reason: "nothing was made" };
      knownLength = counted;
      at = await open(base, { ...input, length: counted });
      if (typeof at !== "string") return { ok: false, reason: `storage refused the upload (${at.refused})` };
    }
    let offset = 0;
    let previous: Buffer | null = null;
    /* Each piece is sent once the next exists, so the last one is known to be last. */
    for await (const piece of pieces(input.make())) {
      if (previous) {
        const failed = await send(base, at, previous, offset, null);
        if (failed) return { ok: false, reason: `storage refused a piece (${failed})` };
        offset += previous.length;
      }
      previous = piece;
    }
    if (!previous) return { ok: false, reason: "nothing was made" };
    const total = offset + previous.length;
    if (knownLength !== null && knownLength !== total) return { ok: false, reason: "the file came out differently the second time" };
    const failed = await send(base, at, previous, offset, knownLength === null ? total : null);
    if (failed) return { ok: false, reason: `storage refused the last piece (${failed})` };
    return { ok: true, bytes: total };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "the upload failed" };
  }
}
