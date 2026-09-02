#!/usr/bin/env node
/* Judges a generated page against the blueprint it was built from.
 *
 *   node tools/audit-page.mjs <file.html> <kind>
 *
 * check:blueprint asks whether the PROMPT still says the right things. This
 * asks the question after it: whether what came back actually obeyed them. The
 * two fail in different places and neither substitutes for the other — a
 * blueprint can read beautifully and still produce a page with eleven dead
 * links in it.
 *
 * Only the mechanically checkable half is here, and that is the point: these
 * are the rules a person stops checking after the third build. Whether the copy
 * is any good is still a judgement someone has to make by looking.
 *
 * It runs offline against a file. Nothing here calls a model.
 */

import { readFileSync } from "node:fs";

const [, , file, kind] = process.argv;
if (!file || !kind) {
  console.error("usage: node tools/audit-page.mjs <file.html> <kind>");
  process.exit(2);
}

const html = readFileSync(file, "utf8");
const lower = html.toLowerCase();

/* What a reader actually sees, for the checks that are about copy rather than
   markup. Scripts, styles and attribute values are stripped: placeholder="M17
   1LT" on a postcode field is a real placeholder attribute doing its job, and
   reading the whole file as prose flags it as placeholder copy. */
const prose = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .toLowerCase();

let failed = 0;
let warned = 0;

function check(ok, text, detail) {
  if (ok) return console.log(`ok    ${text}`);
  failed++;
  console.log(`FAIL  ${text}${detail ? `\n        ${detail}` : ""}`);
}
function soft(ok, text, detail) {
  if (ok) return console.log(`ok    ${text}`);
  warned++;
  console.log(`warn  ${text}${detail ? `\n        ${detail}` : ""}`);
}

const count = (pattern) => (html.match(pattern) ?? []).length;

/* ── What every build has to be, whatever kind it is ───────────────────── */
console.log(`\n── ${file} · ${kind} ──\n`);

check(/^\s*<!doctype html/i.test(html), "starts as an HTML document");
check(/<\/html\s*>\s*$/i.test(html), "the document is finished", "a page cut off at the token ceiling still starts with <!doctype html>");
check(Buffer.byteLength(html, "utf8") < 400_000, `under the 400KB store limit (${(Buffer.byteLength(html, "utf8") / 1024).toFixed(0)}KB)`);

/* Placeholder copy: the single loudest tell of a demo. */
const PLACEHOLDERS = [
  "lorem ipsum", "your headline here", "feature one", "feature two",
  "product 1", "item a", "company name", "$0.00", "example@example.com",
  "john doe", "jane doe", "your company", "insert ", "placeholder",
];
const seen = PLACEHOLDERS.filter((word) => prose.includes(word));
check(seen.length === 0, "no placeholder copy", seen.join(", "));

/* Inert controls. The interaction rule, as far as a regex can read it. */
const deadHrefs = count(/href\s*=\s*["']#["']/gi);
check(deadHrefs === 0, `no href="#" (${deadHrefs})`, "every link goes somewhere real on the page");

/* Anchors that point at ids the document does not contain. */
const targets = [...html.matchAll(/href\s*=\s*["']#([\w-]+)["']/gi)].map((m) => m[1]);
const ids = new Set([...html.matchAll(/\sid\s*=\s*["']([\w-]+)["']/gi)].map((m) => m[1]));
const broken = [...new Set(targets.filter((t) => !ids.has(t)))];
check(broken.length === 0, "every anchor resolves to an id on the page", broken.map((b) => `#${b}`).join(" "));

/* Content in the HTML, not built by script at load. */
const built = count(/\.innerHTML\s*=\s*[^;]*\.map\s*\(/g) + count(/insertAdjacentHTML\([^)]*map\(/g);
check(built === 0, "content is not constructed from a JS array at load", `${built} innerHTML = …map(…)`);

/* The storage APIs that throw in the sandboxed preview frame. */
const storage = [...html.matchAll(/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/g)].map((m) => m[1]);
check(storage.length === 0, "no storage APIs", [...new Set(storage)].join(", "));

/* External fetches: only the Tailwind CDN is allowed. */
const external = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)]
  .map((m) => m[1])
  .filter((url) => !url.startsWith("https://cdn.tailwindcss.com"));
check(external.length === 0, "no external images or scripts", external.slice(0, 4).join(" "));
check(count(/<img\b/gi) === 0 || external.length === 0, "no <img> pointing at an invented URL");

const sections = count(/<section\b/gi);
const headings = count(/<h2\b/gi);

/* ── Per kind ──────────────────────────────────────────────────────────── */
if (kind === "landing") {
  check(sections >= 9, `at least 9 sections (${sections})`);
  check(count(/<details\b/gi) >= 5, `at least 5 FAQ entries (${count(/<details\b/gi)})`);
  check(!/\b(add to (cart|basket|bag))\b/i.test(html), "no add-to-cart");
  check(!/<[^>]*\bid=["'](cart|checkout)["']/i.test(html), "no cart or checkout section");
  soft(count(/<form\b/gi) >= 1, "there is a form to convert on");
}

if (kind === "ecommerce") {
  const products = count(/data-product\b/gi) || count(/\bclass="[^"]*product-card/gi);
  soft(products >= 8, `at least 8 products marked up (${products})`, "counted by data-product / .product-card");
  check(/\bcart\b/i.test(html), "there is a cart");
  check(/\bcheckout\b/i.test(html), "there is a checkout");
  check(/\bsubtotal\b/i.test(html), "the cart shows a subtotal");
  check(/\b(total)\b/i.test(html), "the cart shows a total");
  soft(/quantity|qty/i.test(html), "quantities can be changed");
}

if (kind === "blog") {
  const articles = count(/<article\b/gi);
  check(articles >= 7, `at least 7 articles (${articles})`);
  /* The full article: the one thing a publication is judged on. Counted from
     the longest <article> in the document, tags stripped. */
  const bodies = [...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(
    (m) => m[0].replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
  );
  const longest = bodies.length ? Math.max(...bodies) : 0;
  check(longest >= 800, `one full article of 800+ words (longest is ${longest})`);
  check(!/\b(add to (cart|basket)|checkout)\b/i.test(html), "no shop mechanics");
}

if (kind === "webapp") {
  /* Counted from data-view="…" specifically. data-view-btn is the control that
     reaches a view, not a view, and counting both made a four-view app look
     like nineteen. */
  const views = count(/data-view\s*=\s*["'][^"']+["']/gi) || sections;
  soft(views >= 4, `at least 4 views or workflows (${views})`);
  check(!/\b(add to (cart|basket)|checkout)\b/i.test(html), "no storefront mechanics");
  const marketing = /\b(testimonial|pricing tier|trusted by|start your free trial)\b/i.test(html);
  check(!marketing, "no marketing hero furniture inside the app");
  /* The conditional rules, reported rather than judged: which architecture the
     build decided it needed is the thing being tested, not a pass mark. */
  const notes = [
    /sign[- ]?in|log[- ]?in/i.test(html) ? "sign-in" : null,
    /\bapi\s*[.=]|const api\b/i.test(html) ? "api layer" : null,
    /create table|-- schema|CREATE TABLE/i.test(html) ? "SQL schema" : null,
    /\brole\b(?!\s*=)/i.test(html.replace(/role\s*=\s*["'][^"']*["']/gi, " ")) ? "roles" : null,
  ].filter(Boolean);
  console.log(`      architecture present: ${notes.length ? notes.join(", ") : "none — a plain tool"}`);
}

/* States, everywhere they apply. */
if (kind === "webapp" || kind === "ecommerce") {
  soft(/\bempty\b/i.test(html), "an empty state exists");
  soft(/\berror\b/i.test(html), "an error state exists");
}

console.log(`\n${failed} failed · ${warned} warnings`);
process.exit(failed > 0 ? 1 : 0);
