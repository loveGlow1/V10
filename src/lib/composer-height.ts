/* The composer grows with what is typed into it, the way a chat app's does:
 * a long brief is read and edited in a tall box rather than through a
 * two-line slot — up to COMPOSER_MAX, and never past about two fifths of what
 * is on screen, so on a phone the send button stays above the keyboard. Past
 * that, the box scrolls. Shared by Home's composer and the workspace's.
 *
 * Client-only. */

export const COMPOSER_MAX = 300;

export function fitComposer(box: HTMLTextAreaElement | null, hasText: boolean): void {
  if (!box) return;
  box.style.height = "";
  if (!hasText || box.scrollHeight <= box.clientHeight) return;
  const visible = window.visualViewport?.height ?? window.innerHeight;
  const cap = Math.max(box.clientHeight, Math.min(COMPOSER_MAX, Math.round(visible * 0.42)));
  box.style.height = `${Math.min(box.scrollHeight, cap)}px`;
}
