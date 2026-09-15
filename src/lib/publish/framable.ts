/* Whether the live site can actually be shown inside the workspace.
 *
 * The workspace frames a deployed project's real address, which is the right
 * thing to show: it is the compiled site, exactly as a visitor gets it. But
 * "the site is up" and "the site can be put in an iframe" are different
 * questions, and the pane was only ever asking the first one.
 *
 * The reported symptom is the signature of the gap: the address opens cleanly
 * in a tab, and breaks in the preview pane. A page that is perfectly reachable
 * refuses to be framed when it carries `X-Frame-Options`, or a
 * `Content-Security-Policy` whose `frame-ancestors` does not name us — and the
 * browser's only feedback is a blank rectangle, with the console message going
 * to a frame nobody is looking at. Nothing on the server knows it happened.
 *
 * Vercel's Deployment Protection is the common way to land here. A protected
 * deployment answers 401 to anybody not signed in to the team, and the sign-in
 * it redirects to refuses framing outright. In a tab, with the team's cookie,
 * it opens; in a cross-site frame, where that cookie is not sent, it is a white
 * box. Same URL, two answers, and the one the customer sees is the broken one.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * So that the pane can STOP framing what it cannot show, and fall back to the
 * in-builder renderer, which needs nothing from Vercel and always works. The
 * customer sees their project either way; the difference is whether they also
 * get told that the live site is not viewable from here and why.
 *
 * ── Deliberately generous ─────────────────────────────────────────────────
 *
 * The default answer is YES. This refuses only on the small set of responses
 * that certainly cannot be framed, because the cost of being wrong in the two
 * directions is not symmetric: wrongly refusing to frame a working site costs
 * a live view that the in-builder render substitutes for almost exactly, and
 * wrongly framing a blocked one costs the customer a blank rectangle with no
 * explanation. A timeout, a network error or anything unrecognised is treated
 * as framable and left to the browser.
 */

/* Short on purpose. This runs while somebody is waiting for their workspace to
   open, and an answer that takes fifteen seconds to arrive is worse than the
   default it would have replaced. A site too slow to answer in four seconds is
   framed optimistically. */
const TIMEOUT_MS = 4_000;

export type Framable = { ok: true } | { ok: false; reason: string };

/* `frame-ancestors` beats X-Frame-Options where both are present, which is what
   the spec says and what browsers do. Parsed loosely: this is looking for the
   directive at all and then for whether it forbids everybody. */
function frameAncestors(csp: string): string | null {
  for (const directive of csp.split(";")) {
    const trimmed = directive.trim();
    if (/^frame-ancestors\b/i.test(trimmed)) {
      return trimmed.replace(/^frame-ancestors\b/i, "").trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Whether `address` can be displayed in an iframe on this platform.
 *
 * `origin` is the address the workspace is served from, so that a
 * `frame-ancestors` naming it explicitly is read as permission rather than as a
 * refusal.
 *
 * Goes out BARE, with no Vercel token — the same reasoning as the reachability
 * check in vercel-deploy.ts. A request carrying a token proves only that we can
 * reach the site, and the whole question is what a stranger's browser gets.
 */
export async function canBeFramed(address: string, origin?: string): Promise<Framable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    /* GET rather than HEAD. Vercel's protection challenge answers HEAD
       inconsistently, and the body is discarded anyway. */
    const response = await fetch(address, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "QuickStark-Preview" },
      cache: "no-store",
    });

    /* Signed-out and refused. This is Deployment Protection almost every time,
       and it is the case that produces the blank pane. */
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        reason:
          "The site built and is running, but Vercel is asking visitors to sign in before they can see it — " +
          "Deployment Protection is on for this project.",
      };
    }

    const xfo = response.headers.get("x-frame-options");
    if (xfo && /\b(deny|sameorigin)\b/i.test(xfo)) {
      return {
        ok: false,
        reason: `The site sends X-Frame-Options: ${xfo.trim()}, which tells browsers not to display it inside another page.`,
      };
    }

    const csp = response.headers.get("content-security-policy");
    const ancestors = csp ? frameAncestors(csp) : null;
    if (ancestors !== null) {
      const allowsAnyone = /\*/.test(ancestors) && !/'none'/.test(ancestors);
      const namesUs = origin ? ancestors.includes(origin.toLowerCase().replace(/^https?:\/\//, "")) : false;
      if (!allowsAnyone && !namesUs) {
        return {
          ok: false,
          reason:
            "The site's Content-Security-Policy only allows it to be displayed inside pages it names, and this one is not among them.",
        };
      }
    }

    return { ok: true };
  } catch {
    /* Timed out, or could not be reached from here. Neither is proof that a
       browser cannot frame it — see the header: the default is yes. */
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
