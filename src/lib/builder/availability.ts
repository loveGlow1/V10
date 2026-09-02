/* Whether the builder is taking work right now.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * On 2026-09-02 the Anthropic account behind generation ran out of credit. What
 * a person saw was this: they wrote a brief, pressed send, watched "Building
 * your page — this one takes minutes, not seconds…" for as long as they were
 * willing to, and eventually got a failure. The project row said Failed. They
 * had no way to tell whether they had asked for something impossible, whether
 * their account was broken, or whether it would work if they tried again.
 *
 * Every second of that spinner was a lie. The build could not have succeeded;
 * the key was refused in 385 milliseconds. The app knew nothing, so it showed
 * progress, and showing progress toward something that cannot happen is worse
 * than saying nothing — it spends the person's time and their trust to hide an
 * operational problem they would have forgiven if simply told.
 *
 * So there is a switch. When it is on, a build is refused before anything is
 * classified, charged, or written to a row, and the composer says so up front
 * rather than accepting a brief into a box that goes nowhere.
 *
 * ── Why an environment variable ───────────────────────────────────────────
 *
 * Not a database row, which would be a query on the path of every build to
 * answer a question that is false almost always. Not a build-time constant
 * either — NEXT_PUBLIC_ would bake the answer into the browser bundle, so
 * turning it off would need a rebuild rather than a restart, and the whole
 * point is to flip it quickly when something breaks at three in the morning.
 *
 * It is read on the server, per request, and handed to the browser by
 * /api/builder/status.
 */

/** What the app says when it is not building. Deliberately short and specific
 *  about the one thing a person needs: it is us, not them, and it is temporary. */
export const DEFAULT_PAUSE_MESSAGE =
  "Building is paused while we sort out a problem on our side. Nothing you did caused this and nothing has been charged — we will be back shortly.";

export type Availability = {
  /** True when builds are refused. */
  paused: boolean;
  /** What to show. Always present, so no caller has to invent wording. */
  message: string;
};

/**
 * Whether builds are being accepted, and what to say if not.
 *
 * `BUILDER_PAUSED` turns it on: "true", "1" or "yes", case-insensitively.
 * Anything else — including unset, which is the normal state — is running.
 *
 * `BUILDER_PAUSED_MESSAGE` overrides the wording for the specific outage. Keep
 * it to a sentence or two, keep it honest about whose fault it is, and say
 * whether anything was charged, because that is the first thing anyone wonders.
 */
export function builderAvailability(): Availability {
  const flag = (process.env.BUILDER_PAUSED ?? "").trim().toLowerCase();
  const paused = flag === "true" || flag === "1" || flag === "yes";
  const custom = (process.env.BUILDER_PAUSED_MESSAGE ?? "").trim();
  return { paused, message: custom || DEFAULT_PAUSE_MESSAGE };
}
