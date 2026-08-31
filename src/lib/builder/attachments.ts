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
): Promise<Anthropic.ContentBlockParam[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase || rows.length === 0) return [];

  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const row of rows) {
    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(row.path);
    if (error || !data) continue;

    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) continue;

    if (isImage(row.mime)) {
      /* Named first, so the model can tell "logo.svg" from "screenshot.png"
         when the request mentions one of them by name. */
      blocks.push({ type: "text", text: `Attached image — ${row.name}:` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: row.mime, data: buffer.toString("base64") },
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

  return blocks;
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
