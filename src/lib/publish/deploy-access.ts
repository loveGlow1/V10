/* Who may have a project built and hosted.
 *
 * Deploying is the newest path in the system: it uploads a customer's source to
 * a third party, spends build minutes on an account this platform pays for, and
 * creates a public website. A capability like that belongs to a named list
 * rather than to everybody, and the list started at one.
 *
 * It is no longer unexercised, and that sentence used to say it was. On
 * 2026-09-12 it ran against the real API repeatedly: uploads accepted, installs
 * run, twenty-seven files compiled, and a failure that was a genuine error in
 * the generated code rather than anything about the pipeline. The plumbing
 * works. What is still true is that a public website is a real thing to create
 * on somebody's behalf, which is why this is a list and not a default.
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

/* Everybody, as of 2026-09-12.
 *
 * This was a list of one address while the path was unproven, and the note
 * above says what changed: it has now run against the real API repeatedly and
 * the plumbing works. What settled it was watching the rollout end from the
 * other side — the owner of the platform opened their own project, was told it
 * was not hosted, and had no control anywhere on the page to do anything about
 * it, because the button is drawn only for accounts on this list. A capability
 * nobody can reach is not being rolled out carefully, it is just missing, and
 * every account that generates a project has the same reason to want it.
 *
 * WHAT THIS DOES NOT OPEN. Deploying still requires being signed in and still
 * requires owning the project: the route settles that with ownedProject()
 * before this is consulted at all, and POST re-checks everything the button
 * only asks about. This decides which signed-in owners see the control, not
 * whether a stranger can deploy somebody else's work.
 *
 * Narrowing it again needs no code change — DEPLOY_ALLOWLIST replaces this
 * entirely, so a comma-separated list of addresses takes it back to a rollout
 * whenever that is wanted. */
const DEFAULT_ALLOWLIST = ["*"];

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
