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
export type VisualAsk = { projectId: string; texts: string[] };

export function askChat(ask: VisualAsk) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<VisualAsk>(VISUAL_ASK_EVENT, { detail: ask }));
}
