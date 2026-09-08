/* Whether the numbers on the page are anybody's.
 *
 * A generated business site invents figures the way it invents copy, and the
 * two are not the same act. "Hand-finished in small batches" is writing. "2,400
 * happy customers" is a claim about a real company that no one has made and no
 * one can stand behind — and it goes out under their name, on their domain, to
 * their customers, next to their prices. A revenue chart drawn from numbers a
 * model chose is the same thing with a shape around it.
 *
 * So this gate asks one question of every figure that reads as a business
 * metric: did the person who asked for this page supply it? A number they gave
 * is theirs to publish. A number nothing supplied is fabricated, and it is a
 * defect however plausible it looks — the plausible ones are worse, because
 * nobody catches them.
 *
 * ── What is deliberately NOT flagged ──────────────────────────────────────
 *
 * Prices, weights, sizes, opening hours, addresses, dates, years, quantities in
 * product copy, "24/7", a menu's £8.50. Those are content, they are what the
 * page is for, and a gate that argues about them is one nobody keeps. The
 * evidence rule is about claims of PERFORMANCE — money taken, people served,
 * growth achieved, ratings received — and only those.
 *
 * The distinction is carried by proximity: a number is only a metric if a word
 * that makes it one is standing next to it. "£8.50" beside "sourdough" is a
 * price. "£8.50m" beside "revenue" is a claim.
 */

import { type GateResult, type Issue, emptyGate } from "./types";

/* ── What the customer actually gave us ───────────────────────────────────*/

export type Evidence = {
  /** Every figure that appeared in something the user wrote or attached. */
  figures: Set<string>;
  /** The supplied text itself, lowercased, for phrase checks. */
  text: string;
  /** Whether anything was supplied at all. */
  any: boolean;
};

/** A figure reduced to what makes two of them the same figure. */
function normaliseFigure(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[£$€₦¥,\s]/g, "")
    /* 2.4m, 2.4 m and 2,400,000 are not reconciled here on purpose. Somebody
       who wrote "2.4m" and got "2,400,000" on the page has been paraphrased,
       which is fine; somebody who wrote nothing and got either has not. */
    .replace(/\+$/, "");
}

const FIGURE = /\b\d[\d,.]*\s?(?:%|k|m|bn|b|x|\+)?\b/gi;

/**
 * The figures the user supplied, from their own words and their own files.
 *
 * Everything is evidence: the brief, an attached spreadsheet's text, a pasted
 * table. The bar is deliberately low — this decides what may be PUBLISHED, and
 * being strict here would flag a page for repeating a number its owner typed.
 */
export function evidenceFrom(...parts: (string | null | undefined)[]): Evidence {
  const text = parts.filter(Boolean).join("\n").toLowerCase();
  const figures = new Set<string>();

  for (const match of text.matchAll(FIGURE)) {
    const figure = normaliseFigure(match[0]);
    if (figure) figures.add(figure);
  }

  return { figures, text, any: text.trim().length > 0 };
}

/** Whether this exact figure came from the customer. */
export function supplied(evidence: Evidence, raw: string): boolean {
  const figure = normaliseFigure(raw);
  if (!figure) return true;
  if (evidence.figures.has(figure)) return true;

  /* A figure with its unit stripped, in case they wrote "40 percent" and the
     page wrote "40%". The reverse of the same courtesy. */
  const bare = figure.replace(/[%kmbnx+]/g, "");
  return bare.length > 0 && evidence.figures.has(bare);
}

/* ── What makes a number a claim ──────────────────────────────────────────
 *
 * Two lists, and both are narrow. The first is performance: things a business
 * reports about itself that can only be true or false. The second is scale:
 * how many of something there are. A number beside either is a claim; a number
 * beside neither is content. */

const PERFORMANCE =
  /\b(revenue|turnover|profit|sales|earnings|income|gmv|arr|mrr|roi|roas|growth|grew|increase[sd]?|uptime|conversion|retention|churn|satisfaction|nps|accuracy|success rate|on[- ]time|delivered on time|savings?|reduced?|faster|efficiency)\b/i;

const SCALE =
  /\b(customers?|clients?|users?|members?|subscribers?|patients?|students?|downloads?|installs?|orders?|transactions?|bookings?|sessions?|visits?|reviews?|ratings?|projects? (?:completed|delivered)|countries|cities served|teams?|companies|businesses|partners|installations|units sold|copies sold|followers)\b/i;

const RATING = /\b(rating|rated|stars?|out of 5|\/\s?5\b|★)\b/i;

/* Numbers that read as metrics. A bare four-figure number, anything with a
   thousands separator, a percentage, a k/m/bn suffix, or a "500+". */
const CLAIMABLE = /(?<![\w.])(?:[£$€₦¥]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|m\b|bn\b|\+)|(?<![\w.,])\d{1,3}(?:,\d{3})+(?![\d.])|(?<![\w.,])\d{4,}(?![\d.])/gi;

/* Words that make a number innocent even when a metric word is nearby: a price
   list next to the word "orders", a phone number, a postcode, a year. */
const INNOCENT =
  /\b(price|prices|priced|cost|costs|from|per|each|kg|g\b|ml|litres?|liters?|cm|mm|inch|inches|ft|sq|square|bedroom|seats?|minutes?|hours?|days?|weeks?|months?|am|pm|open|closes?|tel|phone|call|whatsapp|est\.?|since|founded|©|copyright)\b/i;

const YEAR = /^(?:19|20)\d{2}$/;

/** The words around a match, for deciding what kind of number it is. */
function context(text: string, index: number, length: number, span = 60): string {
  return text.slice(Math.max(0, index - span), Math.min(text.length, index + length + span));
}

/* ── The document, as a visitor reads it ──────────────────────────────────*/

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

/* ── The gate ─────────────────────────────────────────────────────────────*/

export type ContentInput = {
  html: string;
  evidence: Evidence;
  /** Whether the brief asked for a dashboard or analytics at all. */
  analyticsAsked?: boolean;
};

/**
 * Numbers, charts and testimonials, against what the customer supplied.
 *
 * Errors, not warnings, for the fabrications: this is the one gate whose
 * findings are about a claim being published under somebody else's name, and a
 * warning is a thing a pipeline ships anyway.
 */
export function contentGate(input: ContentInput): GateResult {
  const { html, evidence } = input;
  const issues: Issue[] = [];
  const text = visibleText(html);

  /* ── Invented metrics ──────────────────────────────────────────────── */

  const invented: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(CLAIMABLE)) {
    const raw = match[0].trim();
    const index = match.index ?? 0;
    const near = context(text, index, raw.length);

    const bare = raw.replace(/[^\d]/g, "");
    if (YEAR.test(bare) && !/%/.test(raw)) continue;

    const isClaim = PERFORMANCE.test(near) || SCALE.test(near);
    if (!isClaim) continue;

    /* A price list is allowed to sit near the word "orders". Only skip when
       nothing performance-shaped is in the same breath — "$40 per order" is a
       price, "$40k in orders" is a claim. */
    if (INNOCENT.test(near) && !PERFORMANCE.test(near)) continue;

    if (supplied(evidence, raw)) continue;

    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    /* The words AFTER the figure, which are what make it a claim and what a
       person needs in order to find it on the page. The words before it are
       usually the tail of the previous sentence. */
    const after = text.slice(index, Math.min(text.length, index + 52)).trim();
    invented.push(`“${after}…”`);
    if (invented.length >= 6) break;
  }

  if (invented.length > 0) {
    issues.push({
      gate: "content",
      severity: "error",
      rule: "content/invented-metric",
      message: `${invented.length} business figure${invented.length === 1 ? "" : "s"} nobody supplied: ${invented
        .slice(0, 3)
        .join("; ")}. These go out as claims about a real company. Remove them, or replace the section with something true — what the business does, how it works, what it sells.`,
    });
  }

  /* ── Charts drawn from numbers that do not exist ───────────────────── */

  const chartish =
    /<canvas\b|chart\.js|chartjs|highcharts|apexcharts|\bnew Chart\b|class\s*=\s*["'][^"']*\b(chart|graph|sparkline|trend-?line|analytics)\b/i.test(
      html,
    );
  const chartSubject =
    /\b(revenue|sales|growth|analytics|performance|traffic|conversion|monthly recurring|profit|turnover)\b/i.test(
      text,
    );

  /* Whether the customer gave us numbers, rather than whether they gave us
     words. The first version of this asked `!evidence.any`, which meant a
     one-line brief — every brief — silenced the rule completely: "a bakery in
     Peckham" is evidence of a bakery, and of no revenue whatsoever. A chart
     needs a series, so three figures is the floor at which it is worth
     believing one was supplied. */
  const suppliedFigures = evidence.figures.size >= 3;

  if (chartish && chartSubject && !suppliedFigures) {
    issues.push({
      gate: "content",
      severity: "error",
      rule: "content/fabricated-chart",
      message:
        "There is a chart of business performance built from numbers nobody provided. Replace it with an empty state — “Analytics will appear once data is connected” — or with something real: what is sold, how it works, where it happens.",
    });
  }

  /* ── Reviews nobody wrote ──────────────────────────────────────────── */

  const stars = (text.match(/★/g) ?? []).length;
  const ratingClaim = RATING.test(text) && /\b[1-5](?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)\b/i.test(text);
  const testimonialish =
    /\b(testimonial|what our (?:customers|clients) say|review[s]?|trusted by|loved by)\b/i.test(text);

  /* Marked as an example is a different thing from passed off as real, and the
     spec asks for exactly that distinction. */
  const marked = /\b(sample|example|placeholder|illustrative|for illustration|not real)\b/i.test(text);

  /* Same correction, and the same trap: a brief mentioning a bakery is not a
     customer supplying testimonials. What counts as supplied here is the
     customer having said something about reviews, ratings or feedback at all —
     or having pasted one, which is what a quotation mark in their own words
     means. */
  const suppliedReviews =
    /\b(review|reviews|testimonial|testimonials|rating|rated|stars|feedback|quote from|says?:)\b/i.test(
      evidence.text,
    ) || /[“"'][^“"']{25,}[”"']/.test(evidence.text);

  if ((testimonialish || stars >= 3 || ratingClaim) && !suppliedReviews && !marked) {
    issues.push({
      gate: "content",
      severity: "error",
      rule: "content/invented-reviews",
      message:
        "There are reviews, ratings or testimonials on the page that nobody wrote. Published under a real business's name these are fabricated endorsements. Remove them, or label the block plainly as an example until real ones exist.",
    });
  }

  /* ── The same photograph, over and over ────────────────────────────── */

  const sources = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const counts = new Map<string, number>();
  for (const source of sources) {
    if (!source || source.startsWith("data:")) continue;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  const gallery = /\b(gallery|carousel|slideshow|lightbox)\b/i.test(html);
  const repeated = [...counts.entries()].filter(([, count]) => count >= 3);

  if (repeated.length > 0 && !gallery) {
    const worst = repeated.sort((a, b) => b[1] - a[1])[0];
    issues.push({
      gate: "content",
      severity: "warning",
      rule: "content/repeated-image",
      message: `The same photograph is used ${worst[1]} times on this page. One picture standing in for a whole catalogue is the clearest tell that nothing here is real.`,
      where: worst[0].slice(0, 80),
    });
  }

  return {
    ran: true,
    passed: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

/** A gate that cannot be judged — no document to read. */
export const noContentGate = (): GateResult => emptyGate(false);
