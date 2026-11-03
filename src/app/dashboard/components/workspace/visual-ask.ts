/* The visual editor's way into the chat.
 *
 * Changes that cannot be written straight into the code — "make this a
 * carousel", words that come from data — go to the ordinary edit path, as one
 * message naming each element's file and line. The chat owns sending (credits,
 * steps, the thread), so the editor asks it to rather than calling the build
 * route itself: the same pattern as the database-connect button. */

export const VISUAL_ASK_EVENT = "quickstark:visual-ask";

/* One message per file: an edit changes one file, so elements in two files
   are two requests, sent one after the other. */
export type VisualAsk = {
  projectId: string;
  texts: string[];
  /* Sent as an undo rather than read: the Undo button and the version list. */
  intent?: "revert";
};

export function askChat(ask: VisualAsk) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<VisualAsk>(VISUAL_ASK_EVENT, { detail: ask }));
}

/* The same request from another tab — the code editor's terminal, whose
   "Ask AI to fix" belongs in this project's chat, which is open elsewhere.
   ChatPanel relays what arrives here into askChat. */
export const ASK_CHANNEL = "quickstark-ask";

export function askChatFromAnotherTab(ask: VisualAsk) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return false;
  const channel = new BroadcastChannel(ASK_CHANNEL);
  channel.postMessage(ask);
  channel.close();
  return true;
}

/* ── Words typed into the page, and the agent: one at a time ────────────
 *
 * A word typed into the preview is saved straight into the source; a message
 * to the agent changes the source too. If the agent started from the page as
 * it was a moment before the typing was saved, its version would come back
 * without the typing. So a save in flight is tracked here, and the chat waits
 * for it before it sends anything — the agent always starts from the page
 * with the typing in it. (The other way round — typing while the agent is
 * working — is held by the save itself until the agent has finished; see
 * preview-bridge.ts.) */
let pendingSaves: Promise<unknown>[] = [];

export function trackTypedSave<T>(save: Promise<T>): Promise<T> {
  pendingSaves.push(save);
  void save.finally(() => {
    pendingSaves = pendingSaves.filter((one) => one !== save);
  });
  return save;
}

/** Resolves once every typed edit sent so far has been saved (or given up on). */
export async function settleTypedEdits(): Promise<void> {
  while (pendingSaves.length) await Promise.allSettled([...pendingSaves]);
}

/* ── The composer's pictures, shared with the visual editor ─────────────
 *
 * A picture attached in the composer and a picture picked in the preview
 * are the two halves of "use this image here", and they live in two panels
 * that know nothing of each other. So the composer publishes what it is
 * holding — each upload's id, its name, and a small thumbnail — and the
 * visual editor offers those pictures on any image that is picked: one tap
 * and the upload replaces it, by hand (preview-bridge swapImage), no AI.
 *
 * The thumbnail is a data URL, not a blob URL: the preview is a sandboxed
 * frame with an origin of its own, and a blob URL from this page is not
 * something it can load. It shows the new picture in place at once, while
 * the real one is stored. */
export type ComposerImage = { id: string; name: string; thumb: string | null };

export const COMPOSER_IMAGES_EVENT = "quickstark:composer-images";
const composerImages = new Map<string, ComposerImage[]>();

export function shareComposerImages(projectId: string, images: ComposerImage[]) {
  if (typeof window === "undefined") return;
  composerImages.set(projectId, images);
  window.dispatchEvent(new CustomEvent(COMPOSER_IMAGES_EVENT, { detail: { projectId } }));
}

export function composerImagesFor(projectId: string | null | undefined): ComposerImage[] {
  return projectId ? (composerImages.get(projectId) ?? []) : [];
}

/** A small JPEG of a picked file, as a data URL — null for anything this browser cannot draw. */
export async function thumbnailOf(file: File, longest = 640): Promise<string | null> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

/* A composer picture the visual editor has just put into the page: the
   composer lets go of it, so it is not sent again with the next message. */
export const COMPOSER_IMAGE_USED_EVENT = "quickstark:composer-image-used";
export function composerImageUsed(projectId: string, id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPOSER_IMAGE_USED_EVENT, { detail: { projectId, id } }));
}
