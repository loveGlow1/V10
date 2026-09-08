/* Where the subject sits inside the picture.
 *
 * A generated page puts a photograph in a box and stops thinking about it. The
 * box gets `object-fit: cover` and `object-position: center`, which is the
 * right answer for a texture and the wrong one for anything with a subject in
 * it: an ice cream in a 16/9 hero is a cone cut off at the bottom and a scoop
 * hidden behind the header, and no amount of "make it look nicer" fixes that,
 * because nothing in the request is about the layout — it is about which part
 * of the picture the layout is showing.
 *
 * That is what this file is. A picture in a page has three knobs and only
 * three, and every framing complaint anybody has ever typed is one of them:
 *
 *   fit    whether the subject may be cropped at all — cover crops, contain
 *          shows the whole frame and lets the box have space in it.
 *   focal  which point of the PICTURE is pinned to that point of the BOX. This
 *          is object-position, and it is what "bring the cake down" means.
 *   zoom   how close in. Above 1 crops harder; below 1 pulls back.
 *
 * ── The one inversion, written down once so nobody has to rediscover it ───
 *
 * object-position moves the PICTURE behind a window, not the subject in front
 * of one. `object-position: 50% 0%` pins the top of the picture to the top of
 * the box, so what you see is the top of the picture — and everything in it
 * has moved DOWN relative to the frame.
 *
 * So "move the cake down" is `y` going DOWN, and every model asked to do this
 * in prose gets it right about half the time. It is one subtraction here, in
 * one place, with a test on it — which is the entire argument for this file
 * existing rather than another paragraph in a prompt.
 *
 * ── Why this is deterministic and not a model call ────────────────────────
 *
 * Because it costs a credit and a minute and comes back wrong. "Bring the cake
 * down a bit" is a request with exactly one correct implementation, it is two
 * attributes on one tag, and a person should not be spending a build on it —
 * still less the five they currently spend before giving up. See reframe(),
 * which does the whole thing without a model, and returns null rather than
 * guessing whenever it is not certain what was meant.
 */

/** Whether the subject may be cropped by the box it is in. */
export type Fit = "cover" | "contain";

export type Framing = {
  fit: Fit;
  /* Which point of the SOURCE is pinned to the same point of the box, in per
     cent — object-position, and read in that direction. See the header: this
     is the number that runs backwards from what people say. */
  x: number;
  y: number;
  /** 1 is the picture as the box crops it. Above 1 is closer in. */
  zoom: number;
};

/** No framing decision taken: what a browser does when nobody says anything. */
export const NEUTRAL: Framing = { fit: "cover", x: 50, y: 50, zoom: 1 };

/* How far one nudge moves things.
 *
 * Fifteen per cent of the crop, not of the picture: object-position is
 * interpolated across whatever the box is cutting off, so this is a visible
 * move on a hard crop and a small one on a gentle crop, which is exactly the
 * behaviour somebody typing "down a bit" expects. Smaller steps read as
 * nothing happening, and "nothing happened" is what makes a person ask five
 * more times. */
export const STEP = 15;
export const ZOOM_STEP = 0.15;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** A framing with every value inside the range a browser can act on. */
export function normalise(framing: Framing): Framing {
  return {
    fit: framing.fit === "contain" ? "contain" : "cover",
    /* One decimal place, not none. Half a step is 7.5% and rounding it away
       would make "a bit" and "a bit more" land in the same place — which is
       precisely the experience this file exists to end. */
    x: round(clamp(framing.x, 0, 100), 1),
    y: round(clamp(framing.y, 0, 100), 1),
    zoom: round(clamp(framing.zoom, ZOOM_MIN, ZOOM_MAX), 2),
  };
}

export function sameFraming(a: Framing, b: Framing): boolean {
  return a.fit === b.fit && a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/* ── Reading a framing off a tag ───────────────────────────────────────────
 *
 * Two sources, in this order: the attributes a generator declared, then the CSS
 * somebody wrote by hand. The attributes win because they are the intent —
 * `data-focal="50% 30%"` says a decision was taken — where the inline
 * declarations may be the compiled form of that same decision or may be
 * whatever a person last typed. Reading both means an edit can act on a page
 * whichever way its pictures were framed, including pages built before any of
 * this existed.
 */

const attributeOf = (tag: string, name: string): string =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim() ?? "";

/* The keywords a browser accepts wherever a percentage is allowed. Left in
   because people write them and a parser that only understood percentages
   would read `object-position: top` as "no framing" and then overwrite it. */
const KEYWORDS: Record<string, number> = {
  left: 0,
  top: 0,
  start: 0,
  center: 50,
  centre: 50,
  middle: 50,
  right: 100,
  bottom: 100,
  end: 100,
};

function coordinate(text: string, fallback: number): number {
  const word = text.trim().toLowerCase();
  if (word in KEYWORDS) return KEYWORDS[word];
  const percent = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(word);
  if (percent) return Number(percent[1]);
  const bare = /^(-?\d+(?:\.\d+)?)$/.exec(word);
  if (bare) return Number(bare[1]);
  return fallback;
}

/** "50% 30%", "centre top", "40%" — the pair, with anything missing centred. */
export function readPosition(text: string): { x: number; y: number } | null {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { x: coordinate(parts[0], 50), y: 50 };
  return { x: coordinate(parts[0], 50), y: coordinate(parts[1], 50) };
}

/** The declarations of an inline style attribute, lower-cased by property. */
function inlineStyle(tag: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of attributeOf(tag, "style").split(";")) {
    const at = part.indexOf(":");
    if (at === -1) continue;
    const property = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (property) declarations.set(property, value);
  }
  return declarations;
}

/**
 * The framing this tag currently has.
 *
 * Never throws and never guesses: a tag saying nothing about how it is framed
 * comes back NEUTRAL, which is what the browser is doing to it anyway.
 */
export function readFraming(tag: string): Framing {
  const style = inlineStyle(tag);

  const declaredFit = (attributeOf(tag, "data-fit") || style.get("object-fit") || "").toLowerCase();
  const fit: Fit = declaredFit === "contain" ? "contain" : "cover";

  const position =
    readPosition(attributeOf(tag, "data-focal")) ??
    readPosition(style.get("object-position") ?? "") ??
    { x: NEUTRAL.x, y: NEUTRAL.y };

  const declaredZoom =
    attributeOf(tag, "data-zoom") ||
    /scale\(\s*([\d.]+)\s*\)/i.exec(style.get("transform") ?? "")?.[1] ||
    "";
  const zoom = Number(declaredZoom);

  return normalise({
    fit,
    x: position.x,
    y: position.y,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : NEUTRAL.zoom,
  });
}

/* ── Writing one back ──────────────────────────────────────────────────────
 *
 * Both forms, every time: the attributes so the decision is still legible — and
 * still readable by the next edit — and the declarations so a browser acts on
 * it. Inline rather than in a stylesheet because an inline declaration cannot
 * be lost to a selector somebody else wrote, and because a page here is one
 * file that people download and open in readers with opinions of their own.
 */

/** The tag with these declarations merged into its style attribute. */
function setStyle(tag: string, changes: Record<string, string | null>): string {
  const style = inlineStyle(tag);
  for (const [property, value] of Object.entries(changes)) {
    if (value === null) style.delete(property);
    else style.set(property, value);
  }

  const text = [...style].map(([property, value]) => `${property}:${value}`).join(";");
  return setAttribute(tag, "style", text);
}

function setAttribute(tag: string, name: string, value: string | null): string {
  const pattern = new RegExp(`\\s*\\b${name}\\s*=\\s*"[^"]*"`, "i");

  if (value === null) return tag.replace(pattern, "");

  const escaped = value.replace(/"/g, "&quot;");
  if (pattern.test(tag)) {
    return tag.replace(pattern, ` ${name}="${escaped}"`);
  }
  /* Written just after the tag name so the framing sits with the other
     data- attributes rather than after four hundred characters of Tailwind. */
  return tag.replace(/^<img\b/i, `<img ${name}="${escaped}"`);
}

/**
 * The tag, framed.
 *
 * Idempotent: writing the same framing twice produces the same string, which is
 * what lets the compile step in autofix run on every build without the document
 * drifting a character each time.
 */
export function writeFraming(tag: string, raw: Framing): string {
  const framing = normalise(raw);
  const position = `${framing.x}% ${framing.y}%`;

  let out = tag;
  out = setAttribute(out, "data-fit", framing.fit);
  out = setAttribute(out, "data-focal", position);
  out = setAttribute(out, "data-zoom", framing.zoom === 1 ? null : String(framing.zoom));

  out = setStyle(out, {
    "object-fit": framing.fit,
    "object-position": position,
    /* Removed rather than set to scale(1): a transform establishes a containing
       block and its own stacking context, and leaving one on every picture in
       the document to say "unchanged" is a side effect for nothing. */
    transform: framing.zoom === 1 ? null : `scale(${framing.zoom})`,
    "transform-origin": framing.zoom === 1 ? null : position,
  });

  return out;
}

/* The one rule that cannot live on the tag.
 *
 * A zoomed picture is bigger than the box it is in, and what stops it spilling
 * over the section below is `overflow: hidden` on its PARENT — which an
 * attribute on the image cannot reach. `:has()` can, it is in every browser
 * this ships to, and scoping it to `[data-zoom]` means a document with no
 * zoomed picture in it is not styled at all.
 *
 * Appended only when there is a zoom to contain. A stylesheet that arrives on
 * every page to do nothing is a stylesheet somebody eventually deletes. */
export const FRAMING_CSS = `
/* Added automatically: a picture framed closer in than its box is clipped by
   the box rather than spilling over the section under it. */
:has(> img[data-zoom]) { overflow: hidden; }
img[data-zoom] { display: block; }
`;

const FRAMING_MARK = "a picture framed closer in than its box";

/** The document with that rule in it, once, when something needs it. */
export function ensureFramingStyles(html: string): string {
  if (!/<img\b[^>]*\bdata-zoom\s*=/i.test(html)) return html;
  if (html.includes(FRAMING_MARK)) return html;

  const block = `<style>${FRAMING_CSS}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}\n</body>`);
  return html;
}

/* ── What somebody asked for ───────────────────────────────────────────────
 *
 * "Bring the cake down and show the entire cone" is two moves and a subject,
 * and reading it is a handful of patterns rather than a model call — the
 * vocabulary people use for this is small, and the failure mode of a regex here
 * is that it declines, which costs nothing because the model path is still
 * behind it.
 */

export type Move =
  /** Move the SUBJECT this way inside the frame. */
  | { move: "down" | "up" | "left" | "right"; amount: number }
  /** Closer in, or further back. */
  | { move: "in" | "out"; amount: number }
  /** Show all of it, whatever the box wanted. */
  | { move: "whole" }
  /** Fill the frame again, cropping if it has to. */
  | { move: "fill" };

export type FramingRequest = {
  moves: Move[];
  /* What they called the thing — "the cake", "the hero image", "it". Null when
     the message named nothing, which is the ordinary case for "move it down a
     bit" and is resolved against the page instead. */
  subject: string | null;
};

/* How big a nudge. "A bit" is half a step and "way down" is two, because a
   person who says "a bit" and gets a shove asks again, and so does a person who
   says "much lower" and gets a nudge. */
function amountIn(text: string): number {
  if (/\b(a bit|a little|slightly|a touch|a fraction|a hair|marginally)\b/i.test(text)) return 0.5;
  if (/\b(a lot|much|way|far|right|considerably|significantly|properly)\b/i.test(text)) return 2;
  return 1;
}

/* Verbs that are about position at all. "Move", "bring", "shift", "push",
   "drop", "raise" — and NOT "make", which is about size and is read below. */
const DIRECTIONS: { move: "down" | "up" | "left" | "right"; match: RegExp }[] = [
  { move: "down", match: /\b(down|downward|downwards|lower|further down|drop it|drop the)\b/i },
  { move: "up", match: /\b(up|upward|upwards|higher|raise|lift)\b/i },
  { move: "left", match: /\b(left|leftward|leftwards)\b/i },
  { move: "right", match: /\b(right(?:ward|wards)?)\b(?!\s*(?:down|up|now))/i },
];

/* Said about a picture and about nothing else. A message with none of these and
   none of the phrases below is not a framing request however many directions it
   contains — "move the button down" is a layout change and belongs to the model
   path, not to this file. */
const POSITIONAL =
  /\b(move|moves?|moving|bring|shift|nudge|push|pull|drop|raise|lift|reposition|position|place|slide)\b/i;

const SHOW_WHOLE =
  /\b(show (?:the )?(?:whole|entire|full|complete|all(?: of)?)|see (?:the )?(?:whole|entire|full)|(?:whole|entire|full|complete) (?:\w+ ){0,2}(?:visible|in(?: the)? (?:frame|shot|picture))|don'?t crop|do not crop|stop cropping|uncrop|not cut off|isn'?t cut off|fits? (?:in|inside) the (?:frame|box)|in full)\b/i;

const CROPPED =
  /\b(cut off|cutoff|chopped|cropped|clipped|getting cut|is cut|half (?:the|a)|missing the (?:top|bottom|base)|can'?t see the (?:whole|rest|bottom|top))\b/i;

const SMALLER =
  /\b(smaller|shrink|reduce|zoom(?:ed)? out|scale (?:it )?down|less zoom(?:ed)?|too (?:big|large|zoomed|close)|pull back|further back|wider shot)\b/i;

const BIGGER =
  /\b(bigger|larger|zoom(?:ed)? in|scale (?:it )?up|more zoom(?:ed)?|too (?:small|far)|closer(?: in)?|fill the (?:frame|box|space))\b/i;

/* Hidden behind the header, and only that.
 *
 * The first version of this matched a preposition and a noun — "under the
 * menu" — and read "add a contact form under the menu" as a complaint that
 * something was obscured. A position is not a complaint, so the complaint has
 * to be in the sentence: something is hidden, covered, buried or lost, and
 * THEN behind the bar. */
const BEHIND_HEADER =
  /\b(?:hidden|obscured|covered|buried|lost|stuck|cut off|disappear\w*|vanish\w*|sits?|sitting|goes?|going|ends? up)\s+(?:\w+\s+){0,2}(?:behind|under(?:neath)?|beneath)\s+(?:the\s+)?(?:header|nav(?:bar|igation)?|top ?bar|toolbar|menu ?bar|sticky bar)\b/i;

/* Which picture, in their words. Everything between the verb and the direction:
   "bring THE CAKE down", "show the whole CONE", "move THE HERO IMAGE up". */
const SUBJECT_AFTER_VERB =
  /\b(?:move|bring|shift|nudge|push|pull|drop|raise|lift|reposition|position|slide|show|see|make)\s+(?:me\s+)?(?:the\s+|that\s+|this\s+|a\s+|whole\s+|entire\s+|full\s+|complete\s+|all\s+of\s+the\s+|all\s+of\s+)*([a-z][a-z' -]{1,28}?)\s*(?=\b(?:down|up|left|right|lower|higher|bigger|smaller|visible|in the|a bit|a little|slightly|and|so|then|,|\.|$))/i;

/** Words that are about the frame rather than about a thing in it. */
const NOT_A_SUBJECT =
  /^(it|them|this|that|these|those|everything|thing|things|stuff|page|whole|entire|full|complete|down|up|left|right|image|images|picture|pictures|photo|photos|photograph|photographs|hero|hero image|hero photo|banner|shot|graphic|visual)$/i;

/**
 * What this message asks of a picture's framing, or null when it asks nothing.
 *
 * Declines readily and on purpose. Everything this returns is applied without a
 * model looking at the page, so a false positive is an edit nobody asked for —
 * and the cost of declining is one ordinary model edit, which is what would
 * have happened anyway.
 */
export function framingRequest(message: string): FramingRequest | null {
  const text = (message ?? "").trim();
  if (!text || text.length > 400) return null;

  const moves: Move[] = [];
  const amount = amountIn(text);

  /* Position, and only when a verb says this is about moving something. A
     message that merely contains the word "down" — "the price is down to £4" —
     is not a request to reframe anything. */
  if (POSITIONAL.test(text) || BEHIND_HEADER.test(text)) {
    for (const direction of DIRECTIONS) {
      if (direction.match.test(text)) moves.push({ move: direction.move, amount });
    }
  }

  /* A subject hidden behind the header comes down out of it. Stated in the spec
     as a rule the builder must never break, and it is a move rather than a
     complaint: what somebody wants when they say it is the picture's content
     lower in its frame. */
  if (BEHIND_HEADER.test(text) && !moves.some((move) => move.move === "down")) {
    moves.push({ move: "down", amount });
  }

  if (SHOW_WHOLE.test(text) || CROPPED.test(text)) moves.push({ move: "whole" });

  /* Size. Read after "show the whole", because "make it smaller so the whole
     cone fits" is one request and the fit is the part that answers it. */
  if (SMALLER.test(text)) moves.push({ move: "out", amount });
  else if (BIGGER.test(text)) moves.push({ move: "in", amount });

  if (moves.length === 0) return null;

  const named = SUBJECT_AFTER_VERB.exec(text)?.[1]?.trim().toLowerCase() ?? "";
  const subject = named && !NOT_A_SUBJECT.test(named) ? named : null;

  return { moves, subject };
}

/**
 * The framing after those moves.
 *
 * Pure arithmetic, and the one line worth reading twice is the first: moving
 * the subject DOWN means object-position going UP the picture. See the header.
 */
export function applyMoves(from: Framing, moves: Move[]): Framing {
  const framing = { ...from };

  for (const move of moves) {
    switch (move.move) {
      /* The inversion. Showing more of the top of the picture is what puts the
         subject lower in the box. */
      case "down":
        framing.y -= STEP * move.amount;
        break;
      case "up":
        framing.y += STEP * move.amount;
        break;
      case "left":
        framing.x += STEP * move.amount;
        break;
      case "right":
        framing.x -= STEP * move.amount;
        break;

      case "out":
        /* Below 1 there is nothing left to pull back from while the box is
           cropping: the picture is already only as big as the box. So the first
           step out of a cover crop is the fit, and the zoom only moves once
           there is room for it to. */
        if (framing.zoom > 1) framing.zoom -= ZOOM_STEP * move.amount;
        else framing.fit = "contain";
        break;
      case "in":
        if (framing.fit === "contain") framing.fit = "cover";
        else framing.zoom += ZOOM_STEP * move.amount;
        break;

      case "whole":
        framing.fit = "contain";
        /* Nothing is cropped any more, so a zoom that was compensating for the
           crop is now cutting into a picture that fits. */
        framing.zoom = 1;
        break;
      case "fill":
        framing.fit = "cover";
        break;
    }
  }

  return normalise(framing);
}

/* ── Which picture ─────────────────────────────────────────────────────────*/

export type Picture = {
  /** The whole <img …> tag, so it can be rewritten in place. */
  tag: string;
  /** Where it starts in the document. */
  at: number;
  alt: string;
  shot: string;
  weight: string;
  /** Everything about it worth matching a subject against. */
  words: string;
};

/** Every <img> in the document, in order. */
export function pictures(html: string): Picture[] {
  const found: Picture[] = [];

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const alt = attributeOf(tag, "alt");
    const shot = attributeOf(tag, "data-shot");
    found.push({
      tag,
      at: match.index ?? 0,
      alt,
      shot,
      weight: attributeOf(tag, "data-weight").toLowerCase(),
      words: `${alt} ${shot} ${attributeOf(tag, "class")} ${attributeOf(tag, "id")}`.toLowerCase(),
    });
  }

  return found;
}

/**
 * The picture a page is ABOUT, when a request does not say which.
 *
 * In order of how much the page itself says: a slot declared as the hero, then
 * a picture inside something called a hero, then the first one in the document.
 * The last is a guess and a good one — a page's first picture is its lead far
 * more often than not — but it is only ever reached when the request named no
 * subject at all.
 */
export function heroPicture(html: string, all = pictures(html)): Picture | null {
  if (all.length === 0) return null;

  const declared = all.find((picture) => picture.weight === "hero");
  if (declared) return declared;

  /* Inside something calling itself a hero or a banner. Read out of the markup
     immediately before the tag rather than by parsing the document: the opening
     tag of the section a picture leads is within a few hundred characters of
     it, and a parser here would be a parser for one question. */
  for (const picture of all) {
    const before = html.slice(Math.max(0, picture.at - 800), picture.at);
    if (/\b(?:class|id)\s*=\s*"[^"]*\b(?:hero|banner|masthead|splash|cover)\b/i.test(before)) {
      return picture;
    }
  }

  return all[0];
}

/** How well a picture answers to a name somebody used for it. */
function scoreFor(picture: Picture, subject: string): number {
  const words = subject.split(/\s+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  return words.filter((word) => picture.words.includes(word)).length;
}

/* ── The whole edit, without a model ───────────────────────────────────────*/

export type Reframed = {
  html: string;
  before: Framing;
  after: Framing;
  /** The picture, in words somebody would recognise. */
  what: string;
  /** What changed, as a sentence for the reply. */
  said: string;
};

/**
 * A framing request, applied to the picture it is about.
 *
 * Returns null — deliberately, and often — whenever it is not certain. In
 * particular it refuses when the thing being moved is not a picture: "move the
 * pricing table down" names something the page has, and quietly reframing a
 * photograph instead would be a wrong edit that nobody could account for. The
 * caller falls back to the ordinary model edit, which is what used to happen
 * every time.
 */
export function reframe(html: string, message: string): Reframed | null {
  const request = framingRequest(message);
  if (!request) return null;

  const all = pictures(html);
  if (all.length === 0) return null;

  let picture: Picture | null = null;

  if (request.subject) {
    const scored = all
      .map((candidate) => ({ candidate, score: scoreFor(candidate, request.subject!) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      picture = scored[0].candidate;
    } else if (mentionedOutsideImages(html, request.subject)) {
      /* The page has something by that name and it is not a picture. This is
         not ours: reframing the hero because somebody asked for the price list
         to move down is exactly the wrong edit, and it is invisible until they
         look. */
      return null;
    } else {
      /* Nothing anywhere answers to it. A framing verb was used and the only
         thing on the page that can be framed is the lead picture, so that is
         what was meant. */
      picture = heroPicture(html, all);
    }
  } else {
    picture = heroPicture(html, all);
  }

  if (!picture) return null;

  const before = readFraming(picture.tag);
  const after = applyMoves(before, request.moves);
  /* Already framed that way. Returning null rather than storing a version
     identical to the last one — and the caller then says so, which is more use
     than "done" over a page that did not change. */
  if (sameFraming(before, after)) return null;

  const rewritten = writeFraming(picture.tag, after);
  const out =
    html.slice(0, picture.at) + rewritten + html.slice(picture.at + picture.tag.length);

  const what = picture.alt || picture.shot || request.subject || "the picture";

  return {
    html: ensureFramingStyles(out),
    before,
    after,
    what,
    said: describeChange(before, after, what),
  };
}

/* Whether the page names this thing somewhere that is not an <img> tag.
 *
 * Cheap and deliberately blunt: the document with every image tag removed, and
 * a search for the words. What it is protecting against is acting on a request
 * about something else entirely, and for that a false "yes" is free — it hands
 * the edit back to the model — where a false "no" is a wrong edit. */
function mentionedOutsideImages(html: string, subject: string): boolean {
  const withoutImages = html.replace(/<img\b[^>]*>/gi, " ").toLowerCase();
  const words = subject.split(/\s+/).filter((word) => word.length > 3);
  if (words.length === 0) return false;
  return words.every((word) => withoutImages.includes(word));
}

/** What changed, said the way the person asked for it rather than in per cent. */
export function describeChange(before: Framing, after: Framing, what: string): string {
  const parts: string[] = [];

  if (after.y < before.y) parts.push("moved it down in the frame");
  if (after.y > before.y) parts.push("moved it up in the frame");
  if (after.x > before.x) parts.push("moved it left");
  if (after.x < before.x) parts.push("moved it right");

  if (after.fit !== before.fit) {
    parts.push(
      after.fit === "contain"
        ? "and it is all in the frame now, nothing cropped"
        : "and it fills the frame again",
    );
  }

  if (after.zoom < before.zoom) parts.push("pulled back a little");
  if (after.zoom > before.zoom) parts.push("brought it closer in");

  const subject = what.length > 60 ? `${what.slice(0, 57)}…` : what;
  if (parts.length === 0) return `Reframed ${subject}.`;
  return `${parts.join(", ").replace(/^./, (first) => first.toUpperCase())} — ${subject}.`;
}
