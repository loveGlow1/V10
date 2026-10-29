/* One logo per flier, the same on every image.
 *
 * Image models were told about a logo and drew one — a different one every
 * time, and with MiniMax, which takes no image at all, one it made up. So no
 * model draws a logo any more (prompt.ts says none, and leaves a corner clear),
 * and the real file is stamped on afterwards, here: same mark, same corner,
 * same size relative to the image, on every version, every "4 more" and every
 * change, whichever model made the picture.
 *
 * Where the logo comes from: an image attached to a message in the flier's
 * workspace, when the message mentions a logo or the file is named like one.
 * It is copied into the flyers bucket under the owner's folder and its path
 * kept on the request (brand.logoPath), which every revision carries forward
 * (brief.ts spreads the previous brand). It changes only when another logo is
 * attached, and goes when the person asks for no logo.
 *
 * Server-only. */

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ATTACHMENTS_BUCKET, type AttachmentRow } from "@/lib/builder/attachments";

const IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;

/** Whether this message asks for the logo to go. Pure. */
export const wantsNoLogo = (message: string) =>
  /\b(no|remove|without|drop|delete|take (?:off|out|away)|get rid of)\b[^.!?]{0,24}\blogo\b/i.test(message);

/** Which attachment is the logo, if any. Pure. */
export function logoAttachment(message: string, attachments: Pick<AttachmentRow, "name" | "mime">[]): number {
  const images = attachments.map((row, index) => ({ row, index })).filter(({ row }) => IMAGE.test(row.mime));
  const named = images.find(({ row }) => /logo|brand|mark/i.test(row.name));
  if (named) return named.index;
  if (/\blogo\b/i.test(message) && images.length > 0) return images[0].index;
  return -1;
}

/** Copies an attached logo into the flier's own storage, as a PNG. Its path, or null. */
export async function keepLogo(service: SupabaseClient, userId: string, attachment: AttachmentRow): Promise<string | null> {
  const { data } = await service.storage.from(ATTACHMENTS_BUCKET).download(attachment.path);
  if (!data) return null;
  try {
    const png = await sharp(Buffer.from(await data.arrayBuffer()))
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const path = `${userId}/brand/logo-${attachment.id}.png`;
    const { error } = await service.storage.from("flyers").upload(path, png, { contentType: "image/png", upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

export async function loadLogo(service: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data } = await service.storage.from("flyers").download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

/* The mark's box: a sixth of the image wide at most, a ninth of it tall, set
   in from the top-left corner by a twenty-fifth of the width — the corner the
   prompt keeps clear. */
const WIDTH = 1 / 6;
const HEIGHT = 1 / 9;
const MARGIN = 1 / 25;

/** The image with the logo placed in its top-left corner, as a PNG. */
export async function stampLogo(image: Buffer, logo: Buffer): Promise<Buffer> {
  const base = sharp(image);
  const { width = 0, height = 0 } = await base.metadata();
  if (!width || !height) return image;
  let mark = sharp(logo);
  /* A logo saved with a wide white or transparent border would sit small in
     its box; trimmed, every logo fills the same box the same way. */
  try {
    mark = sharp(await mark.trim().toBuffer());
  } catch {
    mark = sharp(logo);
  }
  const fitted = await mark
    .resize({ width: Math.round(width * WIDTH), height: Math.round(height * HEIGHT), fit: "inside" })
    .png()
    .toBuffer();
  const inset = Math.round(width * MARGIN);
  return base.composite([{ input: fitted, left: inset, top: inset }]).png().toBuffer();
}
