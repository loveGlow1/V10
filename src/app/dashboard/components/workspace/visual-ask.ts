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
