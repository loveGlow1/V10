/* Whether an edited page is fit to store.
 *
 * Everything upstream of this decides WHAT to change: the model proposes,
 * search-and-replace or a line range places it, and both refuse rather than
 * guess. None of that asks the one question this file exists for — is the
 * document that came out still a page?
 *
 * A patch can apply perfectly and still wreck the layout. "Delete this part"
 * that takes an opening <div> and leaves its </div> behind is a clean,
 * successful, unambiguous edit that closes a section early and folds the rest
 * of the page into it. A line range off by one does the same. Every one of
 * those was stored on top of the working version, and the person found out by
 * looking at their own site.
 *
 * So the edit is checked before it is committed, and a page that fails is not
 * stored at all — the previous version stays exactly as it was. That is the
 * whole promise: a bad answer from a model must never be able to damage
 * something that was working.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not judge whether the edit was
 * any good, or whether the page is well-formed HTML in the abstract. Pages here
 * are written by models and hand-edited by people, and plenty of perfectly good
 * ones would fail a strict parse. Refusing those would be the same disease this
 * codebase has already had twice: a rule that is right in principle and wrong
 * about the documents it actually meets.
 *
 * Every check below is therefore a COMPARISON against the page as it stood.
 * Nothing is rejected for being imperfect — only for being newly broken, in a
 * way this edit caused. A page that was already missing a closing tag stays
 * editable forever. */

export type Verdict = { ok: true } | { ok: false; problem: string };

/* The elements whose balance decides whether a layout holds together. Deliberately
   the structural ones only: a stray <span> or <br> costs nothing, and counting
   every tag in the document would fail on the void elements and the sloppiness
   that real pages are full of. */
const STRUCTURAL = [
  "html", "head", "body", "main", "header", "footer", "nav", "section",
  "article", "aside", "div", "form", "ul", "ol", "table", "style", "script",
] as const;

/* Text that only LOOKS like markup, removed before anything is counted.
 *
 * A <div> written inside a script's template literal, or inside a comment, is
 * not an element. Counting it would make the balance drift for reasons no edit
 * caused — and drift is indistinguishable from damage, so an ordinary change to
 * a page with a script in it would be refused for a tag that was never there.
 *
 * The script and style TAGS survive; only their contents go, so those two are
 * still counted as the elements they are. */
function markupOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
}

/** How many `<tag>` are left unclosed — negative if `</tag>` outnumbers them. */
function balance(html: string, tag: string): number {
  const opened = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) ?? [];
  /* <div /> opens and closes at once. Counted as an opening tag it would look
     like a section left hanging on a page that is perfectly sound. */
  const selfClosed = opened.filter((written) => written.endsWith("/>")).length;
  const closed = html.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  return opened.length - selfClosed - closed;
}

/* An embedded picture, which is bytes rather than page.
 *
 * Every measurement of "how much of the page is left" has to run on this
 * version, and a real page says why. One stored here is 1,705,298 characters,
 * of which 46,112 are the markup and 1,659,186 are a single logo somebody
 * uploaded — the picture is 97% of the document by weight and none of it by
 * structure.
 *
 * Measured whole, that page cannot be reasoned about. Losing the logo reads as
 * losing 97% of the page and is refused as catastrophic; deleting HALF THE
 * ACTUAL MARKUP reads as losing 1.4% and sails through. The floor below was
 * inverted on exactly the pages it most needed to protect. */
const EMBEDDED_IMAGE = /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/gi;

function markupOf(html: string): string {
  return html.replace(EMBEDDED_IMAGE, "");
}

/** How many `<img` tags and how many embedded pictures a document carries. */
function pictures(html: string): { tags: number; embedded: number } {
  return {
    tags: (html.match(/<img\b/gi) ?? []).length,
    embedded: (html.match(EMBEDDED_IMAGE) ?? []).length,
  };
}

/* Below this share of the page, an edit has removed more than any ordinary one
 * does and is more likely to be a mistake than a request.
 *
 * Set low on purpose. "Delete the pricing section" legitimately removes a real
 * fraction of a page, and refusing a change somebody asked for is the failure
 * this whole area has been suffering from — so this is not a tidiness rule, it
 * is a floor under catastrophe. Losing four fifths of a document is not an edit
 * anybody typed. */
const FLOOR = 0.2;

/* An edit must leave the page exactly as well balanced as it found it.
 *
 * There was a slack of one here, on the reasoning that the counting is a
 * heuristic rather than a parser. It let through precisely the failure this
 * check exists for: a deletion that takes an opening <div> and leaves its
 * </div> is a delta of exactly one. A threshold that tolerates the main target
 * is not a safety margin, it is a hole.
 *
 * So the noise is removed instead of tolerated — see markupOnly, which drops
 * the comments and script bodies that were the real source of it — and the
 * remaining difference is required to be zero. An edit adds and removes tags in
 * pairs, or it has broken something. */
const SLACK = 0;

/**
 * Whether `after` may be stored in place of `before`.
 *
 * Called with the finished document — pictures restored, attachment tokens
 * resolved — because that is what would be written, and a check on some earlier
 * form of it is a check on something nobody will ever see.
 */
export function validatePage(before: string, after: string): Verdict {
  const trimmed = after.trim();

  /* An edit that emptied the page. Nothing else here matters if this is true,
     and it is the one outcome that is never what was asked for. */
  if (trimmed.length === 0) {
    return { ok: false, problem: "the change emptied the page" };
  }

  /* Measured on the markup, with the embedded pictures set aside. See
     markupOf: on a page that is mostly one base64 logo, the two numbers do not
     merely differ, they point opposite ways. */
  const wasText = markupOf(before);
  const nowText = markupOf(trimmed);

  if (wasText.length > 0 && nowText.length < wasText.length * FLOOR) {
    const lost = Math.round((1 - nowText.length / wasText.length) * 100);
    return {
      ok: false,
      problem: `the change removed ${lost}% of the page, which is more than that asked for`,
    };
  }

  /* A picture that fell out of a tag that is still there.
   *
   * Removing an <img> is a change somebody can ask for, and it takes its
   * picture with it — that is correct and is not this. This is the other one:
   * the same number of <img> tags come out, and one of them has lost its
   * source. It happens when the model rewrites a tag to change something else
   * about it — "the logo is too small, increase it" — and does not carry the
   * src through, because a src reading `stashed-image-0` does not look to a
   * model like something worth preserving. The tag survives, the photograph
   * does not, and what gets stored is a page with a hole where a logo was.
   *
   * Caught here as well as discouraged in the prompt, because a rule a model is
   * asked to follow is not a rule until something checks. */
  const had = pictures(before);
  const has = pictures(trimmed);

  if (has.tags >= had.tags && has.embedded < had.embedded) {
    const lost = had.embedded - has.embedded;
    return {
      ok: false,
      problem:
        lost === 1
          ? "the change would have dropped one of the page's pictures while keeping the tag it sat in"
          : `the change would have dropped ${lost} of the page's pictures while keeping the tags they sat in`,
    };
  }

  /* The scaffolding that was there must still be there. A </body> that goes
     missing means an edit ate the end of the document — everything after the
     region it was meant to touch. */
  for (const closing of ["</body>", "</html>"]) {
    if (before.includes(closing) && !trimmed.includes(closing)) {
      return { ok: false, problem: `the change removed the page's ${closing} tag` };
    }
  }

  /* THE ONE THIS IS REALLY FOR. Tags left open by a deletion that took an
     opening tag and not its closer — the layout collapses, the sections after
     it fold inward, and every part of the pipeline before this reports success.
     Judged as a DELTA so a page that was already imbalanced stays editable. */
  const wasMarkup = markupOnly(before);
  const nowMarkup = markupOnly(trimmed);

  for (const tag of STRUCTURAL) {
    const was = balance(wasMarkup, tag);
    const now = balance(nowMarkup, tag);
    if (Math.abs(now - was) > SLACK) {
      const direction = now > was ? "left open" : "over-closed";
      return {
        ok: false,
        problem: `the change ${direction} a <${tag}> — the layout below it would break`,
      };
    }
  }

  /* A token that never became a picture. Both kinds are supposed to be resolved
     by the time this runs — attachment:N by placeAttachments, stashed-image-N by
     restoreImages — so one surviving to here is a bug upstream, and storing it
     bakes a broken image into the page permanently. Refused rather than shipped. */
  if (/\battachment:\d+/.test(trimmed)) {
    return { ok: false, problem: "an attached picture did not resolve, so the page would have a broken image in it" };
  }
  if (/stashed-image-\d+/.test(trimmed)) {
    return { ok: false, problem: "a picture already in the page did not come back, so it would have been lost" };
  }

  return { ok: true };
}
