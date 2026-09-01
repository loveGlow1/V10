/* Turning the first thing someone types into a name for their app.
 *
 * This used to be a truncation: forty characters of the prompt, cut at a word.
 * What that produced, in the live table, was nineteen projects called things
 * like "CREATE A LANDING PAGE FOR ST MONICA'S" and "I want to build a DIASPORA
 * ASSIST app A" — nine of them shouting in capitals, every one of them
 * truncated in the drawer, and none of them a name.
 *
 * A prompt is a sentence addressed to someone. A name is a noun phrase. Getting
 * from one to the other is mostly subtraction: drop the greeting, drop the
 * politeness, drop the "I want you to build me a", and what is left is usually
 * the thing itself. Then fix the shouting and cut it to a length that fits a
 * tab.
 *
 * Deliberately a pile of small steps rather than one regex. Each one is a
 * separate claim about how people write these, they are checked individually by
 * tools/check-project-name.mjs against the prompts this account actually sent,
 * and a bad step can be removed without unpicking the others. */

/** Words that mean nothing at the end of a name once the tail is cut off. */
const TRAILING_FILLER =
  /[\s,;:—–-]*\b(?:named?|called|titled|for|with|that|which|and|or|to|of|a|an|the|in|on|at|is|it|app|please)\b[\s,;:—–-]*$/i;

/* Openers, stripped in order. Each is anchored, so a prompt that does not start
   with one is untouched. */
const OPENERS: RegExp[] = [
  /^(?:hi|hey|hello|yo)\b[\s,!.]*/i,
  /^please\b[\s,]*/i,
  /^(?:can|could|would|will)\s+you\b[\s,]*/i,
  /^please\b[\s,]*/i,
  /^i(?:'d| would)\s+like\s+(?:you\s+)?to\b\s*/i,
  /^i\s+(?:want|need)\s+(?:you\s+)?to\b\s*/i,
  /^i\s+(?:want|need)\b\s*/i,
  /^help\s+me\b\s*(?:to\s+)?/i,
  /^(?:let'?s|lets)\b\s*/i,
  /^please\b[\s,]*/i,
  /* The build verb and its article — the last thing before the noun. */
  /^(?:build|create|make|design|generate|develop|scaffold|set\s+up|put\s+together|do)\b\s*/i,
  /^me\b\s*/i,
  /^(?:a|an|the|some)\b\s*/i,
];

/* Kept as typed when a name is title-cased: initialisms are not words, and
   "Ai Landing Page" is wrong in a way "AI Landing Page" is not. */
const KEEP_UPPER = /^(?:AI|UI|UX|API|CRM|ERP|SEO|CMS|SaaS|B2B|B2C|PDF|HR|IT|ID|FAQ|CTA)$/;

/* Joining words stay lowercase inside a title — "Landing Page for St Monica's",
   not "For". The first word is always capitalised whatever it is. */
const SMALL_WORDS =
  /^(?:a|an|the|and|or|but|for|nor|of|on|in|at|to|by|with|from|as|per|via|vs)$/i;

/** Title case, for a prompt that arrived in capitals. */
function titleCase(text: string): string {
  let first = true;
  return text.replace(/[^\s]+/g, (word) => {
    const wasFirst = first;
    if (/[A-Za-z]/.test(word)) first = false;
    if (KEEP_UPPER.test(word)) return word;
    const lower = word.toLowerCase();
    if (!wasFirst && SMALL_WORDS.test(word)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

const MAX_NAME = 32;

/** A name from the first thing someone typed. */
export function nameFromPrompt(prompt: string): string {
  let text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return "Untitled app";

  /* "…a Law Firm website named Adjei & Co" — the words after "named" are not a
     description of the app, they are its name, and someone who bothered to give
     one has said what they want it called. Taken before anything else, since
     everything below is about salvaging a name from a description. */
  const named = text.match(/\b(?:named|called|titled)\s+["'\u201c\u2018]?([^.!?\n]{2,40}?)["'\u201d\u2019]?\s*(?:[.!?]|$)/i);
  if (named) {
    const proper = named[1].trim().replace(/[\s,;:&-]+$/, "");
    if (proper.length >= 2) text = proper;
  }

  for (const opener of OPENERS) text = text.replace(opener, "");

  /* Stop at the end of the first thought. A prompt often carries its whole
     brief — "… — SERIES SERVICE COMPANY, with a hero, pricing and a contact
     form" — and the first clause is the part that names it. Commas are not
     boundaries: "premium, modern, mobile-first" is one description, and cutting
     at the first comma would name the app "Premium". */
  const stop = text.search(/[.!?]|\s[—–]\s|\s-\s/);
  if (stop > 8) text = text.slice(0, stop);

  if (text.length > MAX_NAME) {
    const cut = text.slice(0, MAX_NAME);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > 10 ? cut.slice(0, lastSpace) : cut;
  }

  /* Twice: cutting a tail can expose another filler word behind it. Then the
     punctuation that word was holding up — "Law Firm website named Adjei &"
     ends on an ampersand once "Co" is cut. */
  text = text
    .replace(TRAILING_FILLER, "")
    .replace(TRAILING_FILLER, "")
    .replace(/[\s,;:&/+\-—–]+$/, "")
    .trim();

  if (!text) return "Untitled app";

  /* Shouting is fixed; anything else keeps the capitals its author chose, since
     "DIASPORA ASSIST" inside an otherwise ordinary sentence is a name. */
  if (text === text.toUpperCase() && /[A-Z]/.test(text)) text = titleCase(text);

  return text.charAt(0).toUpperCase() + text.slice(1);
}
