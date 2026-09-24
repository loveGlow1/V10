/* The page as a list of places, for a model holding a picture of it.
 *
 * "Use this screenshot and fix the cake positioning" is the request this
 * builder is worst at, and the reason is not the model. It is given a
 * photograph of a RENDERED page and, separately, the page's SOURCE, and asked
 * to do the visual-to-source mapping with nothing in between. No element
 * boundaries, no ordering it can trust, no names.
 *
 * Worse, the two do not even match. stashImages replaces every photograph with
 * `stashed-image-N` so the document fits in a context window — so the single
 * most distinctive thing in the screenshot is precisely what has been removed
 * from the text the model is matching it against.
 *
 * This is the cheap half of the fix. It reads the document statically and
 * produces the map a person would use to describe where something is: the
 * sections in order, what each one is called, the first words visible in it,
 * and which pictures are in which. A screenshot plus this is a lookup rather
 * than a guess — "the third section, the one headed Our Cakes, containing the
 * 4/5 photograph of a cake" is something a model can find in the markup.
 *
 * ── What this deliberately is not ─────────────────────────────────────────
 *
 * It is not a rendering. There are no coordinates, no bounding boxes and no
 * measurements, because those need a browser and there is none in a serverless
 * function — qa/render.ts can produce all of it and runs only under the CLI.
 * When a worker with a browser exists, the measured version belongs beside
 * this rather than instead of it: order and naming come from the document, and
 * geometry comes from the render.
 *
 * Pure and dependency-free, like the other readers here. Regexes over markup
 * rather than a parser, for the same reason page-html.ts uses them: this runs
 * on documents that are already stored, some of them megabytes, and it must
 * never be the thing that fails an edit.
 */

/** One place on the page, in the order it appears. */
export type Landmark = {
  /** 1-based, matching how anybody counts sections when describing one. */
  order: number;
  /** The tag that opened it — section, header, footer, main, article. */
  tag: string;
  /** Its id, where it has one. This is what an anchor and a script address. */
  id: string | null;
  /** The first heading inside it, which is what the section is called. */
  heading: string | null;
  /** The first words of its text, for a section with no heading. */
  opening: string | null;
  /** The pictures in it, as the slot declares them. */
  pictures: { shot: string | null; alt: string | null; ratio: string | null }[];
};

/* What counts as a place.
 *
 * `nav` and `aside` are deliberately absent. Both are almost always INSIDE one
 * of these rather than beside it — a nav lives in the header — so counting
 * them produced a list where the header ended where its own nav began, and
 * every number after it was off by one against what somebody sees. The list
 * has to match how a person counts blocks down a page, or the numbers are
 * worse than no numbers. */
const BLOCK = /<(section|header|footer|main|article)\b([^>]*)>/gi;
const ID = /\bid\s*=\s*["']([^"']+)["']/i;
const HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
const IMG = /<img\b[^>]*>/gi;
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");

function text(html: string, limit = 90): string | null {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) return null;
  return stripped.length > limit ? `${stripped.slice(0, limit).trimEnd()}…` : stripped;
}

/** One block of the page with the markup that makes it, for comparing two versions. */
export type Region = {
  order: number;
  tag: string;
  id: string | null;
  heading: string | null;
  /** The markup between this block's opening tag and the next block's. */
  source: string;
};

/* The blocks, walked once.
 *
 * Both readers below want the same walk and differ only in what they keep, so
 * the walk lives here rather than twice: `pageLandmarks` keeps a description
 * for a model to read, `pageRegions` keeps the markup itself for a verifier to
 * diff. Two copies of this loop would drift, and the numbering is the one
 * thing that has to agree between them — a landmark the model was told is
 * "3." and a region the verifier checked as "3." must be the same block.
 */
function walk(html: string, limit: number): { order: number; tag: string; attributes: string; inside: string }[] {
  const found: { order: number; tag: string; attributes: string; inside: string }[] = [];
  BLOCK.lastIndex = 0;

  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = BLOCK.exec(html)) !== null && found.length < limit) {
    order += 1;
    const [, tag, attributes] = match;

    /* Everything up to the next block of the same kind, which is not the same
       as the element's real extent and does not need to be: what this is for
       is "what is in this part of the page", and the next section starting is
       a good enough boundary for that. A real parser would be correct and
       would also be a dependency, a failure mode and a megabyte. */
    const from = match.index + match[0].length;
    BLOCK.lastIndex = from;
    const nextStart = BLOCK.exec(html)?.index ?? html.length;
    BLOCK.lastIndex = from;

    found.push({ order, tag: tag.toLowerCase(), attributes, inside: html.slice(from, nextStart) });
  }

  return found;
}

/**
 * The document's places, in order.
 *
 * Bounded rather than complete. A page with two hundred sections is a page
 * where a list of two hundred is no more useful than a list of forty and costs
 * five times as much to send — and the sections somebody points at in a
 * screenshot are overwhelmingly near the top.
 */
export function pageLandmarks(html: string, limit = 40): Landmark[] {
  return walk(html, limit).map(({ order, tag, attributes, inside }) => {
    const pictures: Landmark["pictures"] = [];
    IMG.lastIndex = 0;
    let picture: RegExpExecArray | null;
    while ((picture = IMG.exec(inside)) !== null) {
      const tagText = picture[0];
      pictures.push({
        shot: tagText.match(ATTR("data-shot"))?.[1] ?? null,
        alt: tagText.match(ATTR("alt"))?.[1] ?? null,
        ratio: tagText.match(ATTR("data-ratio"))?.[1] ?? null,
      });
    }

    return {
      order,
      tag,
      id: attributes.match(ID)?.[1] ?? null,
      heading: text(inside.match(HEADING)?.[1] ?? "", 60),
      opening: text(inside.replace(HEADING, " "), 90),
      pictures: pictures.slice(0, 6),
    };
  });
}

/**
 * The same blocks, with the markup kept.
 *
 * For asking whether a particular part of the page actually changed, which is
 * a question about the source and cannot be answered from a description of it.
 * See verify-edit.ts: an edit that claims to have made the logo smaller and
 * left the header's markup byte-identical did not make the logo smaller.
 */
export function pageRegions(html: string, limit = 40): Region[] {
  return walk(html, limit).map(({ order, tag, attributes, inside }) => ({
    order,
    tag,
    id: attributes.match(ID)?.[1] ?? null,
    heading: text(inside.match(HEADING)?.[1] ?? "", 60),
    source: inside,
  }));
}

/**
 * The map, as the model is shown it.
 *
 * Written as a numbered list because that is how somebody describes a place on
 * a page out loud — "the third block down, the one with the cakes" — and the
 * whole point of this is to let a picture be turned into a place and a place
 * into markup.
 *
 * Empty for a page with no sections at all, which is a page this cannot help
 * with; returning an empty heading would be a section of the prompt that says
 * nothing, and those are how a prompt stops being read.
 */
export function landmarkBrief(html: string): string {
  const landmarks = pageLandmarks(html);
  if (landmarks.length === 0) return "";

  const lines = landmarks.map((place) => {
    const name = place.heading ? `“${place.heading}”` : place.opening ? `starts “${place.opening}”` : "(no text)";
    const where = place.id ? ` id="${place.id}"` : "";
    const shots = place.pictures
      .map((picture) => picture.shot ?? picture.alt)
      .filter(Boolean)
      .slice(0, 3);
    const art = shots.length > 0 ? ` — pictures: ${shots.join("; ")}` : "";
    return `${place.order}. <${place.tag}${where}> ${name}${art}`;
  });

  return `THE PAGE, AS PLACES — read this against the picture you were given.

This is the document in order, top to bottom. Use it to turn what you can SEE into what you have to FIND: match the screenshot to a numbered entry by its heading, its opening words or the picture in it, then search the markup for that heading or that id and change what is inside it.

${lines.join("\n")}

Two things worth knowing before you go looking:
- A picture in the page reaches you as src="stashed-image-N", not as an image. The photograph itself was lifted out so the document would fit in front of you. So the thing that is most obvious in the screenshot is the thing that is missing from the source — find its section by the words around it instead, and copy the token through untouched.
- Numbers here are positions, not names. Do not write one into the page; they exist so you can say which place you mean to yourself before you quote it.`;
}
