#!/usr/bin/env node
/* A photograph is chosen because it belongs here, not because it was first.
 *
 *   npm run check:stock-query
 *
 * The planner already settles one visual direction for a project and gives
 * every slot a spec that inherits it. The stock provider then threw all of it
 * away: it took the subject, cut it at the first comma, asked for ONE result,
 * and used whatever came back. Three consequences, all of them visible on real
 * pages, and this file is about all three.
 *
 *   THE WEBSITE'S OWN WORDS WERE SEARCHED FOR. "Build me a landing page for an
 *   AI legal assistant" searched for a phrase containing "landing page", and
 *   "landing" returns aeroplanes.
 *
 *   THERE WAS NOTHING TO CHOOSE BETWEEN. per_page=1 is not a shortlist.
 *
 *   A STOREFRONT SHOWED ONE PHOTOGRAPH EIGHT TIMES. Eight product slots share a
 *   subject, so they made the same query and the same top result won all eight.
 *
 * Two halves below, and as everywhere in this codebase the second is the one
 * that decides whether the change is an improvement:
 *
 *   WHAT MUST NOW HAPPEN — the direction reaches the search, results are
 *   ranked, and the same picture is never used twice.
 *
 *   WHAT MUST NEVER HAPPEN — a scorer that starves the page. Stock captions are
 *   written by photographers, not by this system, and a perfectly good picture
 *   of a laboratory may say nothing but "glassware". Anything here that returns
 *   nothing rather than something imperfect has made pages worse, not better.
 *
 * No keys, no network: the pure half only.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-stock-query");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true,
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/assets/stock-query.ts")],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

const rewrite = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { rewrite(path); continue; }
    if (!path.endsWith(".js")) continue;
    const depth = path.slice(out.length + 1).split("/").length - 1;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    writeFileSync(path, readFileSync(path, "utf8").replace(
      /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
        const asFile = join(out, `${rest}.js`);
        const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
        return `${q}${prefix}${target}${q}`;
      }));
  }
};
rewrite(out);

const { contaminationFor, pickBest, scoreCandidate, searchTerms, subjectTerms } =
  await import(join(out, "lib/builder/assets/stock-query.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const want = (over = {}) => ({
  subject: "AI legal assistant",
  type: "hero",
  kind: "landing",
  register: "luxury editorial",
  orientation: "landscape",
  minWidth: 1600,
  ...over,
});

const photo = (id, description, over = {}) => ({
  id, description, width: 4000, height: 2250, ...over,
});

// ── The subject is what it is OF ──────────────────────────────────────────
/* The words that describe the WEBSITE are not the words that describe the
   PHOTOGRAPH, and searching for them is how a legal-tech page ends up with an
   aeroplane on it. */
has(
  !subjectTerms("landing page for an AI legal assistant").includes("landing"),
  "the word \"landing\" never reaches the search",
  subjectTerms("landing page for an AI legal assistant"),
);
has(
  subjectTerms("landing page for an AI legal assistant").includes("legal"),
  "but what it is actually about survives",
  subjectTerms("landing page for an AI legal assistant"),
);
for (const noise of ["website", "web app", "online store", "premium modern site"]) {
  const got = subjectTerms(`${noise} for handmade ceramics`);
  has(got.includes("ceramics") && !/website|store|site|premium/.test(got), `"${noise}" is stripped`, got);
}
/* A long brief is cut to something a stock search can answer, not sent whole. */
has(
  subjectTerms("bespoke luxury skincare for sensitive skin made in small batches in Devon").split(" ").length <= 5,
  "a long subject is cut to a searchable phrase",
  subjectTerms("bespoke luxury skincare for sensitive skin made in small batches in Devon"),
);

// ── The ladder ────────────────────────────────────────────────────────────
const ladder = searchTerms(want({ type: "product", subject: "handmade ceramic mug" }));
has(ladder.length >= 2 && ladder.length <= 4, `between two and four searches — ${ladder.length}`, ladder.join(" | "));
has(
  ladder[0].includes("ceramic") && ladder[0].includes("product photography"),
  "the first is the most specific: subject and slot together",
  ladder[0],
);
has(
  ladder[0].includes("editorial") || ladder[0].includes("luxury"),
  "and the project's register reaches the search at last",
  ladder[0],
);
has(
  ladder[ladder.length - 1].length > 0 && !ladder[ladder.length - 1].includes("ceramic"),
  "the last rung drops the subject, so an unsearchable one still finds something",
  ladder[ladder.length - 1],
);
has(new Set(ladder).size === ladder.length, "no rung is searched twice", ladder.join(" | "));

/* A slot with no type term and no register collapses to one query rather than
   three identical round trips. */
const plain = searchTerms(want({ type: "gallery", subject: "coffee", register: "clear commercial" }));
has(plain.length <= 2, "a slot with nothing to add does not repeat itself", plain.join(" | "));

// ── Ranking ───────────────────────────────────────────────────────────────
const legal = want();
const onSubject = photo("a", "a lawyer reading a legal document in an office");
const offSubject = photo("b", "a bowl of fruit on a table");
has(
  scoreCandidate(onSubject, legal) > scoreCandidate(offSubject, legal),
  "a photograph of the subject outranks one that is not",
  `${scoreCandidate(onSubject, legal).toFixed(2)} vs ${scoreCandidate(offSubject, legal).toFixed(2)}`,
);

/* Shape is about the page rather than the picture: a hero cropped out of a
   portrait is a hero with its subject cut off. */
const wide = photo("c", "a lawyer at a desk", { width: 4000, height: 2250 });
const tall = photo("d", "a lawyer at a desk", { width: 2250, height: 4000 });
has(
  scoreCandidate(wide, legal) > scoreCandidate(tall, legal),
  "for a wide slot, a wide photograph outranks a tall one of the same thing",
);

/* And the reverse, so this is a match rather than a preference for landscape. */
const portraitWant = want({ type: "portrait", orientation: "portrait" });
has(
  scoreCandidate(tall, portraitWant) > scoreCandidate(wide, portraitWant),
  "and for a portrait slot the tall one wins",
);

/* Resolution counts, and only up to what was asked for: a 6000px photograph is
   not a better answer than a 2000px one, it is a slower one. */
const small = photo("e", "a lawyer at a desk", { width: 400, height: 225 });
const enough = photo("f", "a lawyer at a desk", { width: 1600, height: 900 });
const huge = photo("g", "a lawyer at a desk", { width: 6000, height: 3375 });
has(scoreCandidate(enough, legal) > scoreCandidate(small, legal), "too small a photograph ranks lower");
has(
  Math.abs(scoreCandidate(huge, legal) - scoreCandidate(enough, legal)) < 0.001,
  "and past the size asked for, bigger earns nothing",
);

/* Tags count as much as the caption: many photographs describe themselves only
   in their tags. */
has(
  scoreCandidate(photo("h", "", { tags: ["legal", "assistant", "office"] }), legal) > 0.2,
  "a photograph that describes itself only in tags is still scored",
);

// ── Keeping the wrong category out ────────────────────────────────────────
const market = photo("i", "a busy grocery supermarket aisle with shopping trolleys");
const picked = pickBest([market, onSubject], legal, new Set());
has(picked?.candidate.id === "a", "a supermarket is not chosen for legal software", picked?.candidate.id);

/* THE ONE THAT MATTERS MOST HERE. A rule that filters "grocery" out of every
   landing page makes grocery businesses unable to get any photographs at all —
   the rule would be most wrong for exactly the projects that most need it. */
const grocer = want({ subject: "grocery delivery service" });
has(
  !contaminationFor("landing", "grocery delivery service").includes("grocery"),
  "a grocery business can still get grocery photographs",
  contaminationFor("landing", "grocery delivery service").join(", "),
);
const forGrocer = pickBest([market, offSubject], grocer, new Set());
has(forGrocer?.candidate.id === "i", "and the supermarket wins for the grocer", forGrocer?.candidate.id);

/* The same for a recipe site, where "recipe" and "cuisine" are the subject. */
has(
  !contaminationFor("landing", "recipe sharing community").includes("recipe"),
  "a recipe site can still get food photographs",
);

/* A wedding planner is a landing page whose subject is weddings. */
has(
  !contaminationFor("landing", "wedding planning studio").includes("wedding"),
  "a wedding planner can still get wedding photographs",
);

/* The overlap that makes grouping worth the trouble: software ABOUT restaurants
   is a landing page that needs restaurant photography and must still be spared
   the market stalls it has nothing to do with. */
const bookings = contaminationFor("landing", "booking software for restaurants");
has(bookings.length === 0 || !bookings.includes("restaurant"), "restaurant software can still get restaurant photographs", bookings.join(", "));

/* And a project with nothing to do with either category keeps the whole list —
   otherwise the grouping has quietly disabled the rule for everybody. */
const accounting = contaminationFor("landing", "accounting practice management");
has(
  accounting.includes("supermarket") && accounting.includes("wedding"),
  "a project in neither category keeps every negative",
  accounting.join(", "),
);

/* Contamination runs the other way too: a storefront should not be handed a
   photograph of source code. */
const shop = want({ kind: "ecommerce", type: "product", subject: "leather boots" });
const code = photo("j", "source code on a screen, programming");
const boots = photo("k", "brown leather boots on a studio background");
has(pickBest([code, boots], shop, new Set())?.candidate.id === "k", "a storefront is not handed a screenshot of code");

// ── The same picture is never used twice ──────────────────────────────────
/* This is the storefront bug. Eight product slots, one subject, one query, one
   ranking — and without an exclusion the top result wins every slot. */
const shelf = [photo("p1", "brown leather boots studio"), photo("p2", "brown leather boots studio")];
const taken = new Set();
const first = pickBest(shelf, shop, taken);
taken.add(first.candidate.id);
const second = pickBest(shelf, shop, taken);
has(
  first.candidate.id !== second?.candidate.id,
  "the second slot gets a different photograph from the first",
  `${first.candidate.id} then ${second?.candidate.id}`,
);

/* And when the shortlist is exhausted it says so, rather than repeating one —
   the resolver then walks on to the next source, which is the right answer. */
taken.add(second.candidate.id);
has(pickBest(shelf, shop, taken) === null, "when everything is used up it returns nothing rather than a repeat");

// ── What must never happen: starving the page ─────────────────────────────
/* Stock captions are written by photographers. A perfectly good picture may say
   almost nothing about itself, and a scorer that refuses it leaves a grey panel
   where a photograph belongs — which is a worse page, not a safer one. */
const terse = photo("q", "glassware");
has(pickBest([terse], want({ subject: "clinical diagnostics laboratory" }), new Set()) !== null,
  "a photograph with a thin caption is still chosen rather than refused");

const nothingSaid = { id: "r" };
has(pickBest([nothingSaid], legal, new Set()) !== null,
  "a result with no caption, no tags and no dimensions is still usable");

has(pickBest([], legal, new Set()) === null, "an empty result set is nothing, not a crash");

/* Every score stays inside its range, whatever it is handed. A weight that can
   exceed one silently outranks everything else. */
const extremes = [
  photo("s", "legal assistant AI luxury editorial legal legal", { tags: ["legal", "assistant", "ai"] }),
  photo("t", "", { width: 99999, height: 1 }),
  { id: "u", description: null, tags: [] },
];
for (const candidate of extremes) {
  const score = scoreCandidate(candidate, legal);
  has(score >= 0 && score <= 1, `a score stays between 0 and 1 — ${candidate.id}`, score.toFixed(3));
}

/* Every kind has both a fallback query and a contamination list; a kind added
   later without them would silently lose its ranking. */
for (const kind of ["landing", "ecommerce", "blog", "news", "webapp"]) {
  const terms = searchTerms(want({ kind, subject: "" }));
  has(terms.length > 0, `${kind}: a project whose subject is unusable still has something to search`, terms.join(" | "));
  has(Array.isArray(contaminationFor(kind, "")), `${kind}: has a contamination list`);
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
