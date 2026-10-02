/* The link that starts Connect GitHub and comes back to `next` (a same-origin
 * path; defaults to wherever the person is now). Client-safe: no secrets, no
 * node imports. */
export function connectGitHubHref(next?: string): string {
  const back = next ?? currentPlace();
  return `/api/integrations/github/authorize?next=${encodeURIComponent(back)}`;
}

/** What ?github= says about the sign-in that just came back, for a toast or a line of text. */
export const GITHUB_RETURNED: Record<string, string> = {
  connected: "GitHub is connected. Open an app's Integrations to push its code.",
  cancelled: "GitHub sign-in was cancelled. Nothing was changed.",
  expired: "That GitHub sign-in took too long or came from somewhere else. Try again.",
  failed: "GitHub didn't complete the sign-in. Try again in a moment.",
  unavailable: "Connect GitHub isn't set up on this deployment yet.",
};

/* Where the person is now — except inside an app, where the way back is that
   app's Integrations drawer, because that is where the push happens and where
   ?github= is read. */
function currentPlace(): string {
  if (typeof window === "undefined") return "/dashboard";
  const { pathname, search } = window.location;
  if (/^\/dashboard\/project\/[^/]+$/.test(pathname)) return `${pathname}?view=integrations`;
  return `${pathname}${search}`;
}
