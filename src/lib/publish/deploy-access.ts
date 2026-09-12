/* Who may have a project built and hosted.
 *
 * Deploying is the newest and least exercised path in the system: it uploads a
 * customer's source to a third party, spends build minutes on an account this
 * platform pays for, and creates a public website. It has also never once run
 * against the real API — see the note at the end of vercel-deploy.ts. A
 * capability in that state belongs to a named list rather than to everybody,
 * and the list starts at one.
 *
 * ── Server-side, and only server-side ─────────────────────────────────────
 *
 * The workspace asks whether the button should be drawn, and this answers. But
 * the button is a courtesy and the check on the POST is the gate: hiding a
 * control is a statement about what is worth showing, never about what is
 * permitted, and a browser can ask for anything the network will carry.
 *
 * ── Widening it ───────────────────────────────────────────────────────────
 *
 * DEPLOY_ALLOWLIST is a comma-separated list of addresses and replaces the
 * default entirely. Setting it to `*` opens the capability to every signed-in
 * account, which is the right move once a real deployment has been watched end
 * to end and not before.
 */

const DEFAULT_ALLOWLIST = ["micheledallida@gmail.com"];

function allowlist(): string[] {
  const configured = process.env.DEPLOY_ALLOWLIST;
  if (!configured) return DEFAULT_ALLOWLIST;

  return configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether every signed-in account may deploy. */
export function deploysAreOpen(): boolean {
  return allowlist().includes("*");
}

/**
 * Whether this address may have a project built and hosted.
 *
 * Compared lowercased, because an address somebody typed with a capital is the
 * same person. Absent or empty is false rather than an error: no address is
 * not on any list.
 */
export function canDeploy(email: string | null | undefined): boolean {
  if (!email) return false;
  if (deploysAreOpen()) return true;
  return allowlist().includes(email.trim().toLowerCase());
}

/** Why not, for the person being refused. */
export const NOT_ALLOWED =
  "Hosting projects is still being rolled out and is not enabled for this account yet. " +
  "Your files are complete and downloadable in the meantime.";
