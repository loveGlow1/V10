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

/* Pictures, and nothing else.
 *
 * An attachment here has one job: showing the builder something about the page
 * that a sentence cannot carry. That is a screenshot — this part, this spacing,
 * this is what it looks like on my phone — and occasionally a logo or a photo
 * to put in. Documents were accepted too, and a PDF is a poor way to say any of
 * those things: it arrives as pages of prose that crowd out the page being
 * edited and answer a question nobody asked.
 *
 * `image/*` rather than a list, deliberately. A phone's picker offers what a
 * phone stores, and on iOS that is HEIC — which is a real picture that this app
 * can read perfectly well once it has been converted. Naming four formats here
 * would grey out the camera roll on the device most people are holding. */
export const ACCEPT = "image/*";

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

  if (!file.type.startsWith("image/")) {
    return {
      error: `${file.name} isn't an image. Attach a screenshot of the part you mean — that is what a build can read.`,
    };
  }

  /* Converted here, in the browser, before anything is stored.
   *
   * Two problems, one answer. A photograph off an iPhone is HEIC, and some
   * upload paths hand it over with a .jpeg name and image/jpeg on the request —
   * so it was declared a JPEG all the way to the model, which read the bytes,
   * found no JPEG, and refused the whole request with a 400. And a full-size
   * screenshot is several megabytes of pixels the model does not use, because
   * it scales anything larger than about 1,568px down before it looks at it.
   *
   * The browser already knows how to decode whatever it just let somebody pick.
   * Drawing it to a canvas and reading it back as PNG settles the format, and
   * doing it at a bounded size settles the weight — so what reaches Storage is
   * always a picture this app can read, and always one worth sending. */
  const png = await asPng(file);
  if ("error" in png) return { error: `${file.name} ${png.error}` };

  const upload = png.file;
  const mime = "image/png";

  if (upload.size > MAX_ATTACHMENT_BYTES) {
    return { error: `${file.name} is too large to attach, even after resizing.` };
  }

  const supabase = createSupabaseBrowserClient();
  /* The owner first, because the bucket's policies compare exactly that
     segment. Then the project, so a file belongs to one app rather than to an
     account at large, and a random suffix so two screenshots called
     "Screenshot.png" do not overwrite one another. */
  const path = `${userId}/${projectId}/${crypto.randomUUID()}-${safeName(pngName(file.name))}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, upload, { contentType: mime, upsert: false });

  if (uploadError) {
    return { error: `${file.name} could not be uploaded.` };
  }

  const { data, error: rowError } = await supabase
    .from("project_attachments")
    .insert({
      project_id: projectId,
      user_id: userId,
      path,
      /* Their name for it, with the extension corrected: the row says what is
         actually stored, and "IMG_7663.jpeg" holding a PNG is how the last
         confusion started. */
      name: pngName(file.name).slice(0, 200),
      mime,
      bytes: upload.size,
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
    attachment: { id: (data as { id: string }).id, name: pngName(file.name), mime, bytes: upload.size },
  };
}

/* ── Becoming a PNG ────────────────────────────────────────────────────────
 *
 * Every attachment is re-encoded in the browser before it is stored, and this
 * is where. Two things go wrong without it, and both were being paid for.
 *
 * THE FORMAT. A photograph taken on an iPhone is HEIC. Some pickers hand it
 * over with a .jpeg name and image/jpeg on the request, so it was declared a
 * JPEG the whole way to the model — which reads the bytes rather than the
 * label, finds no JPEG, and rejects the ENTIRE request with a 400. One
 * unreadable photograph killed edits that had nothing to do with it. Whatever
 * the browser was willing to display, it is willing to draw; what comes back
 * off the canvas is a PNG because we asked for one, and nothing downstream has
 * to take anybody's word for it.
 *
 * THE WEIGHT. A screenshot off a modern phone is several megabytes of pixels
 * the model never looks at: anything longer than about 1,568px on its long edge
 * is scaled down before it is read. Sending the full-size original spends
 * upload time, storage and a slice of the request budget to say exactly the
 * same thing.
 *
 * Re-encoding is lossless the way it matters here — PNG keeps every pixel it is
 * given — so what is lost is only the resolution nobody was going to use. */

/** The long edge the model reads at. Above this it downscales anyway. */
const MAX_EDGE = 1568;

/* PNG is bigger than JPEG for a photograph, and a busy 1568px picture can come
   back over the ceiling. Rather than refuse it, draw it smaller and try again:
   a slightly softer screenshot is a screenshot, and a rejected upload is
   nothing. The last step is small enough that no real photograph survives it. */
const EDGE_STEPS = [MAX_EDGE, 1200, 900, 700];

/* Held under what an edit can actually carry — see MAX_EMBED_BYTES in
   lib/builder/attachments.ts, which is the budget for base64 in one request. */
const TARGET_BYTES = 1_800_000;

/** The same filename, saying what the file now is. */
export function pngName(name: string): string {
  const base = name.replace(/\.[^./\\]{1,12}$/, "");
  return `${base || "image"}.png`;
}

/** Whatever the browser can display, decoded to something canvas can draw. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  /* The fast path, and the one that handles formats an <img> would need a
     document reflow for. Not everywhere yet, hence the fallback. */
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* Falls through — an <img> can still be worth a try for the same file. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("undecodable"));
      image.src = url;
    });
  } finally {
    /* Revoked either way: an object URL held past its use is a leak that lives
       as long as the tab does. */
    URL.revokeObjectURL(url);
  }
}

/** The file as a PNG, small enough to send, or a sentence saying why not. */
export async function asPng(file: File): Promise<{ file: File } | { error: string }> {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await decode(file);
  } catch {
    return { error: "could not be read as an image. Try a screenshot or a PNG." };
  }

  const { width, height } = source;
  if (!width || !height) return { error: "could not be read as an image." };

  /* Never upscaled — a small logo redrawn at 1568px is the same picture in four
     times the bytes — and a step that would draw at a size already tried is
     dropped, so a picture smaller than the ceiling is encoded once. */
  const scales = [...new Set(EDGE_STEPS.map((edge) => Math.min(1, edge / Math.max(width, height))))];

  try {
    for (const [step, scale] of scales.entries()) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext("2d");
      if (!context) return { error: "could not be converted in this browser." };
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return { error: "could not be converted in this browser." };

      /* Under the budget, or as small as this will be drawn — either way this
         is the one that goes. The last step is taken whatever it weighs, and
         the caller's own size check is the backstop under that. */
      if (blob.size <= TARGET_BYTES || step === scales.length - 1) {
        return { file: new File([blob], pngName(file.name), { type: "image/png" }) };
      }
    }

    return { error: "is too detailed to attach. Try cropping to the part you mean." };
  } finally {
    /* A bitmap holds its pixels until it is told not to. */
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
  }
}
