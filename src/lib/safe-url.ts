/* Links that came from somewhere else.
 *
 * Preview and repository addresses are written by the build orchestrator, not
 * by this app, and they end up in `href` and in an iframe `src`. An `href` runs
 * whatever scheme it is given — `javascript:alert(document.cookie)` in an
 * anchor executes in *this* origin, where the Supabase session cookie lives.
 * `data:` and `blob:` are the same problem wearing a different hat.
 *
 * So nothing reaches an href or a src without passing through here first: an
 * absolute http(s) URL comes back, and everything else comes back null and is
 * not rendered as a link at all. */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The value if it is an absolute http(s) URL, otherwise null.
 *
 * Relative URLs are rejected too: these addresses always point somewhere else,
 * so a relative one means the orchestrator sent something unexpected.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    /* No base is passed on purpose — with one, "javascript:…" would be parsed
       as a relative path and quietly resolve to a same-origin URL. */
    return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}
