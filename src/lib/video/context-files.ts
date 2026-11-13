/* What the director and the AI editor are shown from a video's uploads,
 * beside the ATTACHMENTS list (assets.ts):
 *
 *   pictures    up to twenty — the person's pictures as they are, and a frame
 *               from each clip; the ones marked as the look first
 *   documents   a script, a brand guide, a brief: a PDF is handed over whole
 *               (every model in the picker reads PDFs), a text or Markdown
 *               file as its text — up to ten, read in full
 *
 * Server-only. Never throws: a file that cannot be read is left out. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LlmPart } from "@/lib/ai/llm";

import { handles } from "./assets";

/** The most pictures a model is shown with a request. */
export const MAX_CONTEXT_PICTURES = 20;
/** The most documents read with a request. */
export const MAX_CONTEXT_DOCUMENTS = 10;
/** The longest a text document is read (characters); PDFs are capped by size at upload (10 MB). */
export const MAX_DOCUMENT_CHARS = 200_000;

type Upload = { id: string; kind: string; name?: string | null; status?: string | null; storage_path: string; poster_path?: string | null; mime?: string | null };

/** Which uploads are shown as pictures, in order: the look first, then the rest as uploaded. Pure. */
export function picturePaths(uploads: Upload[], look: string[] = []): string[] {
  const ordered = [...uploads].sort((a, b) => Number(look.includes(b.id)) - Number(look.includes(a.id)));
  const paths: string[] = [];
  for (const asset of ordered) {
    if (paths.length >= MAX_CONTEXT_PICTURES || asset.status === "failed") continue;
    if (asset.kind === "audio" || asset.kind === "document" || asset.kind === "render") continue;
    const path = asset.kind === "video" ? asset.poster_path : asset.storage_path;
    if (path) paths.push(path);
  }
  return paths;
}

/** The documents to read, newest last, at most MAX_CONTEXT_DOCUMENTS. Pure. */
export function documentsOf(uploads: Upload[]): Upload[] {
  return uploads.filter((asset) => asset.kind === "document" && asset.status !== "failed").slice(-MAX_CONTEXT_DOCUMENTS);
}

/** Signed links to the pictures, and the documents as parts a model reads. */
export async function contextFiles(
  storage: SupabaseClient,
  uploads: Upload[],
  look: string[] = [],
): Promise<{ images: string[]; documents: LlmPart[] }> {
  const images: string[] = [];
  for (const path of picturePaths(uploads, look)) {
    const { data } = await storage.storage.from("video-assets").createSignedUrl(path, 600);
    if (data?.signedUrl) images.push(data.signedUrl);
  }
  const named = handles(uploads.map((u) => ({ id: u.id, name: u.name ?? "" })));
  const documents: LlmPart[] = [];
  for (const doc of documentsOf(uploads)) {
    try {
      const { data } = await storage.storage.from("video-assets").download(doc.storage_path);
      if (!data) continue;
      const label = `DOCUMENT ${named.get(doc.id) ?? ""} "${(doc.name ?? "document").slice(0, 80)}"`;
      if ((doc.mime ?? "").includes("pdf") || /\.pdf$/i.test(doc.storage_path)) {
        documents.push({ type: "text", text: `${label} — the PDF that follows:` });
        documents.push({ type: "file", mediaType: "application/pdf", base64: Buffer.from(await data.arrayBuffer()).toString("base64") });
      } else {
        const text = (await data.text()).slice(0, MAX_DOCUMENT_CHARS);
        documents.push({ type: "text", text: `${label}:\n${text}` });
      }
    } catch {
      /* Left out. */
    }
  }
  return { images, documents };
}

/** What the model is told the documents are for. */
export const DOCUMENTS_NOTE =
  "DOCUMENTS (the person's own files, read in full): follow them — a script's scenes, lines and names; a brand guide's spelling, colours and tone; a brief's facts. Where a document and the idea disagree, the idea wins.";
