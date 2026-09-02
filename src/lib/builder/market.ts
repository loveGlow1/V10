/* Which market a build is for.
 *
 * The locale default used to be one country, because the app served one. It
 * serves two now — the United States and Nigeria — and "default to the US" is
 * the wrong shape for that: a Lagos bakery asking for a landing page should not
 * have to say "in Nigeria" to be quoted in naira, and a US fleet operator
 * should not be quoted in naira because a default flipped.
 *
 * So the brief is read for it, the same way its kind is read (kinds.ts), and
 * for the same reasons: regexes are free, instant and right almost always, and
 * what they answer is checkable offline against a corpus.
 *
 * Detection here picks which DEFAULT the prompt carries. It is not a lock: the
 * locale section always opens by telling the model that a brief naming a
 * country, city or currency wins outright — so a Leeds bakery is British even
 * though neither market matched, and nothing here has to enumerate the world.
 *
 * Pure on purpose: no SDK import, so the browser can read the labels and
 * tools/check-blueprint.mjs can compile it on its own. */

export const MARKETS = ["us", "ng"] as const;

export type Market = (typeof MARKETS)[number];

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

export const MARKET_LABEL: Record<Market, string> = {
  us: "United States",
  ng: "Nigeria",
};

/* Where a brief that names nowhere is set.
 *
 * One constant, deliberately, so that changing which market is assumed is one
 * line and one decision rather than an archaeology exercise. It matters less
 * than it looks: most briefs that are for Nigeria say so within a few words,
 * because the business is in a named city or takes payment through a named
 * Nigerian processor. */
export const DEFAULT_MARKET: Market = "us";

export type MarketResult = {
  market: Market;
  /** "named" when the brief said so; "default" when nothing in it did. */
  source: "override" | "named" | "default";
  /** One clause for the step list, and for anyone arguing with the answer. */
  reason: string;
};

/* ── Signals ──────────────────────────────────────────────────────────────
 *
 * Places, money, and the services a business in each market actually uses.
 * That last group is what makes this work on briefs that never name a country:
 * nobody writes "in Nigeria" when they write "storefront with Paystack
 * checkout", and nobody has to. */

const NIGERIA =
  /\b(nigeria|nigerian|naija|lagos|abuja|port ?harcourt|ibadan|kano|enugu|kaduna|abeokuta|benin city|calabar|uyo|ilorin|jos|owerri|warri|onitsha|aba|maiduguri|zaria)\b|\b(lekki|ikeja|ikoyi|yaba|surulere|ajah|victoria island|wuse|garki|maitama|gwarinpa|apapa|festac)\b|₦|\b(naira|kobo|ngn)\b|\b(paystack|flutterwave|interswitch|opay|moniepoint|palmpay|remita|monnify|kuda)\b|\b(gtbank|gtco|zenith bank|access bank|first bank|uba|fidelity bank|wema|sterling bank)\b|\b(jumia|konga|nollywood|afrobeats|jollof|danfo|keke|okada|agbero)\b|\bankara (fabric|print|style|material|dress)\b|\b(cac|rc ?number|bvn|nin|jamb|waec|nysc)\b|\b(dispatch rider|gig logistics|kwik|gokada)\b|\b(9mobile|glo|airtel|mtn) (nigeria|line|number)\b|\+234|\bwat\b/i;

const UNITED_STATES =
  /\b(usa|u\.s\.a?\.|united states|stateside|american|americans)\b|\bzip ?code\b|\b(new york|brooklyn|los angeles|san francisco|chicago|houston|dallas|austin|denver|seattle|boston|atlanta|miami|phoenix|philadelphia|portland|nashville|charlotte|detroit|minneapolis|las vegas|san diego|kansas city|st\.? louis|grand rapids|fort worth)\b|\b(california|texas|florida|new jersey|illinois|georgia|arizona|colorado|michigan|ohio|virginia|washington state|north carolina|massachusetts)\b|\b(dollars?|usd)\b|\$\d|\b(stripe|shopify payments|venmo|zelle|cash ?app|quickbooks|netsuite)\b|\b(irs|ein|llc|s-?corp|401\(?k\)?|medicaid|medicare)\b|\b(sales tax|nasdaq|dmv)\b/i;

function hits(text: string, pattern: RegExp): number {
  const all = text.match(new RegExp(pattern.source, "gi")) ?? [];
  return new Set(all.map((hit) => hit.toLowerCase())).size;
}

/**
 * The market a brief is for.
 *
 * Never throws and never returns null: a build has to be set somewhere, and a
 * brief that names nowhere gets {@link DEFAULT_MARKET} with `source: "default"`
 * so that the caller can tell an answer from an assumption.
 */
export function detectMarket(brief: string, override?: Market | null): MarketResult {
  if (override) {
    return { market: override, source: "override", reason: "you chose it" };
  }

  const m = brief.trim();
  const ng = hits(m, NIGERIA);
  const us = hits(m, UNITED_STATES);

  /* Both, which is a real brief rather than a broken one: "a store shipping
     from Lagos to customers in the US" names two markets and is written from
     one of them. The heavier side wins, and a genuine tie falls to the default
     rather than to whichever regex is declared first. */
  if (ng > 0 && ng > us) {
    return { market: "ng", source: "named", reason: "your brief is set in Nigeria" };
  }
  if (us > 0 && us > ng) {
    return { market: "us", source: "named", reason: "your brief is set in the United States" };
  }

  return {
    market: DEFAULT_MARKET,
    source: "default",
    reason:
      DEFAULT_MARKET === "us"
        ? "no country named, so US by default — say the city and it follows the brief"
        : "no country named, so Nigeria by default — say the city and it follows the brief",
  };
}
