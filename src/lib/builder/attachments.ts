import type Anthropic from "@anthropic-ai/sdk";

import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Files someone attached, turned into something a model can look at.
 *
 * A sentence is a thin brief. "Match this screenshot", "use our logo", "lay out
 * this copy" are all ordinary requests that a prompt alone cannot carry, and
 * every one of them is answered by handing the model the file.
 *
 * The bytes are read here, on the server, under the service key — never sent
 * up from the browser. The browser uploaded them and holds only an id; what
 * reaches the model is fetched from Storage against the attachment's owner. */

export const ATTACHMENTS_BUCKET = "attachments";

/* What can usefully be shown to a model, and what each becomes. Anything not
   listed is refused at upload rather than silently ignored later — a file that
   was accepted and then not used is worse than one that was declined. */
export const ACCEPTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

/* Anthropic's own ceiling for an image is 5MB after base64; PDFs are allowed
   more. Held below both, because the whole request has to fit as well. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/* A page of text is worth reading; a database dump is not, and would crowd out
   the page being edited. */
const MAX_TEXT_CHARS = 20_000;

export type AttachmentRow = {
  id: string;
  path: string;
  name: string;
  mime: string;
};

function isImage(mime: string): mime is "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/webp";
}

/* ── What the bytes actually are ───────────────────────────────────────────
 *
 * The mime type on the row is whatever the browser said at upload, and a
 * browser says whatever the file's extension implies. A photograph off an
 * iPhone is the ordinary way for those two to disagree: iOS stores HEIC, some
 * paths hand it over still HEIC with a .jpeg name and image/jpeg on the
 * request, and the file is then declared to be a JPEG all the way to the model
 * — which reads the first bytes, finds no JPEG, and rejects the whole request
 * with a 400. One unreadable photograph killed an edit that had nothing to do
 * with it.
 *
 * So the bytes are asked rather than the label. Every image format the API
 * takes announces itself in its first few bytes, and this reads them.
 */
type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function sniffImage(buffer: Buffer): ImageMime | "heic" | null {
  const at = (index: number) => buffer[index];

  /* JPEG: FF D8 FF. */
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";

  /* PNG: the eight-byte signature, whose first four are \x89PNG. */
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";

  /* GIF87a / GIF89a. */
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";

  /* WEBP rides inside a RIFF container: "RIFF" then four bytes of length then
     "WEBP". Both ends are checked, because "RIFF" alone is also a WAV. */
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  /* HEIC and its relatives: an ISO base media file whose brand says so. Named
     rather than lumped in with "unreadable", because it is the one somebody can
     act on — it is what an iPhone gives you, and re-saving as JPEG fixes it. */
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("msf")) return "heic";
  }

  return null;
}

/** A file that could not be sent, and the sentence to say about it. */
export type SkippedAttachment = { name: string; reason: string };

function isText(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json";
}

/**
 * The rows for these attachment ids, restricted to one project and one owner.
 *
 * Both are matched even though the ids came from the caller's own session: this
 * reads under the service key, so an id from another project must not resolve
 * simply because it exists.
 */
export async function loadAttachments(
  ids: string[],
  projectId: string,
  userId: string,
): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];

  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("project_attachments")
    .select("id, path, name, mime")
    .in("id", ids.slice(0, 8))
    .eq("project_id", projectId)
    .eq("user_id", userId);

  return (data ?? []) as AttachmentRow[];
}

/**
 * The attachments as content blocks, ready to sit beside the text of a message.
 *
 * An unreadable file is skipped rather than fatal: a build should not fail
 * because one of four references could not be fetched, and the ones that did
 * arrive are still worth having.
 */
export async function attachmentBlocks(
  rows: AttachmentRow[],
): Promise<{ blocks: Anthropic.ContentBlockParam[]; skipped: SkippedAttachment[] }> {
  const supabase = createSupabaseServiceClient();
  if (!supabase || rows.length === 0) return { blocks: [], skipped: [] };

  const blocks: Anthropic.ContentBlockParam[] = [];
  const skipped: SkippedAttachment[] = [];
  /* Counted separately from the loop index: the tokens number the IMAGES, and
     imagePlacements numbers them the same way. A PDF between two photographs
     must not shift what attachment:2 means. */
  let images = 0;

  for (const row of rows) {
    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(row.path);
    if (error || !data) continue;

    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      skipped.push({ name: row.name, reason: "it is larger than I can send to the model" });
      continue;
    }

    if (isImage(row.mime)) {
      /* The bytes, not the label. A file the model cannot decode fails the
         whole request rather than being ignored, so it is left out here — with
         a reason somebody can act on. */
      const actual = sniffImage(buffer);

      if (actual === "heic") {
        skipped.push({
          name: row.name,
          reason: "it is a HEIC photograph rather than the JPEG its name claims — re-save or re-export it as JPEG and it will go through",
        });
        continue;
      }

      if (!actual) {
        skipped.push({ name: row.name, reason: "the file does not look like an image I can read" });
        continue;
      }

      /* Named first, so the model can tell "logo.svg" from "screenshot.png"
         when the request mentions one of them by name — and given its token, so
         that a request to PUT this picture in the page has an address to write.
         The token is resolved to the real bytes after the edit applies; see
         imagePlacements. */
      blocks.push({
        type: "text",
        text: `Attached image — ${row.name}. To place this picture in the page, use src="${attachmentToken(images)}".`,
      });
      images += 1;
      blocks.push({
        type: "image",
        /* What it IS, which is not always what it was called. A PNG uploaded
           with a .jpg name is perfectly readable — it just has to be declared
           correctly. */
        source: { type: "base64", media_type: actual, data: buffer.toString("base64") },
      });
      continue;
    }

    if (row.mime === "application/pdf") {
      blocks.push({ type: "text", text: `Attached document — ${row.name}:` });
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
      });
      continue;
    }

    if (isText(row.mime)) {
      const text = buffer.toString("utf8").slice(0, MAX_TEXT_CHARS);
      blocks.push({ type: "text", text: `Attached file — ${row.name}:\n\n${text}` });
    }
  }

  return { blocks, skipped };
}

/* ── Putting an attached picture INTO the page ─────────────────────────────
 *
 * Showing the model an image and asking it to place one are different things,
 * and the second was missing. Somebody attached a photograph, wrote "use this
 * image", and got back a page with an invented file path in the src and a reply
 * explaining that they would need to host the file themselves — because the
 * model could see the picture perfectly well and had no address to write down.
 *
 * So it is given one. Each attached image gets a short token, the model is told
 * to use that token as the src, and the token is swapped for the real bytes
 * after the edit has applied.
 *
 * The swap happens afterwards for one reason that matters: a data URI for a
 * photograph is hundreds of thousands of characters, and a model asked to write
 * one would spend its entire output budget transcribing base64 and never reach
 * the end of the page. The token is nine characters. It writes the token.
 */

/** What the model writes as the src, one per attached image, in order. */
export function attachmentToken(index: number): string {
  return `attachment:${index + 1}`;
}

/* A ceiling on what may be embedded in one edit. The page is a file people
   download, and every embedded photograph is carried inside it — see
   MAX_HTML_BYTES in lib/page-html.ts, which is the backstop under this. */
const MAX_EMBED_BYTES = 2_600_000;

export type Placement = { token: string; dataUri: string; name: string };

/**
 * The attached images as `token → data URI`, in the order the tokens are given.
 *
 * Numbered off the same list the blocks are built from, so what the model was
 * shown as `attachment:2` is what `attachment:2` resolves to. Anything too
 * large to embed is left out of BOTH, rather than being described to the model
 * and then quietly unavailable.
 */
export async function imagePlacements(rows: AttachmentRow[]): Promise<Placement[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const placements: Placement[] = [];
  let spent = 0;

  for (const [index, row] of rows.filter((entry) => isImage(entry.mime)).entries()) {
    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(row.path);
    if (error || !data) continue;

    const buffer = Buffer.from(await data.arrayBuffer());
    const encoded = buffer.toString("base64");
    if (spent + encoded.length > MAX_EMBED_BYTES) continue;
    spent += encoded.length;

    placements.push({
      token: attachmentToken(index),
      dataUri: `data:${row.mime};base64,${encoded}`,
      name: row.name,
    });
  }

  return placements;
}

/**
 * The page with every attachment token replaced by the picture it stands for.
 *
 * Run after an edit applies. A token the model did not use costs nothing, and a
 * token it used for an image that could not be embedded is removed rather than
 * left in the markup — a src of "attachment:2" renders as a broken image, which
 * is worse than a slot with no src at all.
 */
export function placeAttachments(html: string, placements: Placement[]): string {
  let placed = html;

  for (const placement of placements) {
    placed = placed.split(placement.token).join(placement.dataUri);
  }

  /* Anything still bearing a token refers to a picture that did not make it.
     Emptied, so the layout keeps its slot and nothing renders as broken. */
  return placed.replace(/attachment:\d+/g, "");
}

/**
 * Addresses the orchestrator can fetch, for the build that happens outside this
 * app. Images only: n8n hands the URL straight to the model, and a URL source
 * is the one form that does not mean pushing megabytes of base64 through a
 * webhook.
 *
 * Signed for an hour — comfortably longer than a build, and not a standing
 * public link to someone's unreleased design.
 */
export async function signedImageUrls(rows: AttachmentRow[]): Promise<string[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const images = rows.filter((row) => isImage(row.mime));
  const urls: string[] = [];

  for (const row of images) {
    const { data } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(row.path, 60 * 60);
    if (data?.signedUrl) urls.push(data.signedUrl);
  }

  return urls;
}

/** The text of any non-image attachments, for a prompt that can only take text. */
export async function attachmentText(rows: AttachmentRow[]): Promise<string> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return "";

  const parts: string[] = [];

  for (const row of rows) {
    if (isImage(row.mime) || row.mime === "application/pdf") continue;
    if (!isText(row.mime)) continue;

    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(row.path);
    if (error || !data) continue;

    const text = Buffer.from(await data.arrayBuffer()).toString("utf8").slice(0, MAX_TEXT_CHARS);
    parts.push(`Attached file — ${row.name}:\n\n${text}`);
  }

  return parts.join("\n\n");
}
