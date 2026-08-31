"use client";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

/* Putting a file where a build can see it.
 *
 * The browser uploads straight to Storage under the person's own session — RLS
 * on the bucket is what keeps one account's files out of another's — and then
 * writes a row saying what it was. The message that follows carries only ids;
 * the bytes are read back on the server when the model is called.
 *
 * The file never travels through the app's own API, which is the point: a
 * screenshot is a megabyte, and a serverless function is a poor place to hold
 * one on its way somewhere else. */

/* Kept in step with ACCEPTED_MIME in src/lib/builder/attachments.ts. A file
   accepted here and refused there would be one someone watched upload and then
   never saw used. */
export const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json";

const ACCEPTED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/* More than a handful stops being context and starts being a corpus — and
   every one of them is read into the request beside the page. */
export const MAX_ATTACHMENTS = 4;

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
};

export type UploadResult = { attachment?: Attachment; error?: string };

/* A name that is safe as a Storage path and still recognisable in the chat.
   Storage keys reject a lot of what a filename may contain, and a rejected
   upload reads as a broken paperclip rather than as a punctuation problem. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-80);
  return cleaned || "file";
}

/** Uploads one file and records it against a project. */
export async function uploadAttachment(
  file: File,
  projectId: string,
  userId: string,
): Promise<UploadResult> {
  if (!isSupabaseConfigured) return { error: "Attachments are unavailable." };

  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED_MIME.has(mime)) {
    return { error: `${file.name} is not a kind of file a build can read.` };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: `${file.name} is larger than 4MB.` };
  }

  const supabase = createSupabaseBrowserClient();
  /* The owner first, because the bucket's policies compare exactly that
     segment. Then the project, so a file belongs to one app rather than to an
     account at large, and a random suffix so two screenshots called
     "Screenshot.png" do not overwrite one another. */
  const path = `${userId}/${projectId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: mime, upsert: false });

  if (uploadError) {
    return { error: `${file.name} could not be uploaded.` };
  }

  const { data, error: rowError } = await supabase
    .from("project_attachments")
    .insert({
      project_id: projectId,
      user_id: userId,
      path,
      name: file.name.slice(0, 200),
      mime,
      bytes: file.size,
    })
    .select("id")
    .single();

  if (rowError || !data) {
    /* The object is up but nothing points at it, which would leave a file
       nobody can reach and nothing can clean up. Undone rather than left. */
    await supabase.storage.from("attachments").remove([path]);
    return { error: `${file.name} could not be attached.` };
  }

  return {
    attachment: { id: (data as { id: string }).id, name: file.name, mime, bytes: file.size },
  };
}
