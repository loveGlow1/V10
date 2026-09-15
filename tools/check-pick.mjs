#!/usr/bin/env node
/* Which file an instruction is about.
 *
 *   npm run check:pick
 *
 * On a single page this question did not exist. On a file tree it is the first
 * thing that happens and the most expensive thing to get wrong: an edit sent to
 * the wrong file produces search blocks that match nothing, and the pipeline
 * reports that as "I couldn't place that change in the page" — a sentence about
 * the person's words describing a fault in our routing. They rephrase. It fails
 * again. Nothing anywhere says which file was being looked at.
 *
 * So the local rules are held here exhaustively. Everything they settle is a
 * model call not made, and — more to the point — a decision that is inspectable
 * rather than a coin toss inside a prompt.
 *
 * The `why` on every pick is checked as well as the path. A right answer for
 * the wrong reason is a rule that is not doing its job and will stop being
 * right the moment a project is shaped slightly differently.
 *
 * No keys, no network — pickFileLocally and readPick never call a model. The
 * model path is in edit.ts and is exercised by check:builder.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-pick");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/pick-file.ts", "src/lib/builder/tree.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { pickFileLocally, readPick, homePageOf, neighbourBrief } =
  await import(join(out, "lib/builder/pick-file.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* A project in the shape scaffold.ts actually produces. */
const TREE = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/globals.css",
  "app/pricing/page.tsx",
  "app/contact/page.tsx",
  "app/blog/page.tsx",
  "app/blog/[slug]/page.tsx",
  "components/Nav.tsx",
  "components/Footer.tsx",
  "components/PricingTable.tsx",
  "lib/supabase.ts",
  "package.json",
  "tailwind.config.ts",
].map((path) => ({ path, content: "// x" }));

const pick = (message) => pickFileLocally(message, TREE);
const picks = (message, path, why) => {
  const got = pick(message);
  has(
    got?.path === path && (why === undefined || got.why === why),
    `"${message}" -> ${path}${why ? ` (${why})` : ""}`,
    got ? `got ${got.path} (${got.why})` : "got nothing",
  );
};
const defers = (message) => {
  const got = pick(message);
  has(got === null, `"${message}" is left to the model`, got ? `decided ${got.path} (${got.why})` : "");
};

// ── A file named outright ─────────────────────────────────────────────────

picks("change app/pricing/page.tsx to use three columns", "app/pricing/page.tsx", "named");
picks("in components/Nav.tsx, make the links bigger", "components/Nav.tsx", "named");

/* THE SPECIFICITY ONE. Both paths appear in the message; the longer is the
   more specific statement and must win. */
picks("copy the layout from app/page.tsx into app/blog/[slug]/page.tsx", "app/blog/[slug]/page.tsx", "named");

/* A bare filename, which is how people talk once they have seen the list. */
picks("Nav.tsx needs a mobile menu", "components/Nav.tsx", "named");
picks("update tailwind.config.ts", "tailwind.config.ts", "named");

/* And the one it must NOT resolve: `page.tsx` names five files here, so it
   names none of them, and guessing would be the whole failure this exists to
   prevent. */
defers("page.tsx has a typo in it");

/* ── A path that is nearly the path ────────────────────────────────────────
 *
 * The one that was silently broken, and the reason it was worth finding: every
 * message here names its file outright, and every one of them used to resolve
 * to NOTHING — through the bare-filename pass, where `page.tsx` matches five
 * routes, and on to a model told "if nothing fits, answer with the home page's
 * path". Somebody asking for a change to the dashboard by name got the home
 * page edited, or a second dashboard written over the first. */

/* The root left off, which is how people read a file listing back. */
picks("edit contact/page.tsx to add a phone number", "app/contact/page.tsx", "named");
picks("blog/[slug]/page.tsx renders the date wrong", "app/blog/[slug]/page.tsx", "named");

/* THE ONE THAT WAS REPORTED, in the shape it was reported in: a project with a
   dashboard, and a message naming it under the word the interface shows. */
const DASHED = [
  "app/layout.tsx", "app/page.tsx", "app/globals.css",
  "app/dashboard/page.tsx", "app/dashboard/settings/page.tsx",
  "components/Nav.tsx",
].map((path) => ({ path, content: "// x" }));
has(
  pickFileLocally("update scaffold/dashboard/page.tsx to add a revenue chart", DASHED)?.path
    === "app/dashboard/page.tsx",
  '"scaffold/dashboard/page.tsx" is the dashboard, not the home page',
  JSON.stringify(pickFileLocally("update scaffold/dashboard/page.tsx to add a revenue chart", DASHED)),
);
has(
  pickFileLocally("dashboard/settings/page.tsx needs a save button", DASHED)?.path
    === "app/dashboard/settings/page.tsx",
  "and the deeper route wins over the one above it",
  JSON.stringify(pickFileLocally("dashboard/settings/page.tsx needs a save button", DASHED)),
);

/* A root this tree does not have. `src/` because most projects have one;
   `scaffold/` because that is the word the interface puts above the listing. */
picks("change src/app/pricing/page.tsx to three columns", "app/pricing/page.tsx", "named");
picks("update scaffold/app/contact/page.tsx", "app/contact/page.tsx", "named");
picks("in scaffold/components/Nav.tsx make the links bigger", "components/Nav.tsx", "named");

/* Leading ./ and / are noise around a path, not part of one. */
picks("./app/blog/page.tsx needs pagination", "app/blog/page.tsx", "named");
picks("fix /components/Footer.tsx", "components/Footer.tsx", "named");

/* AND WHERE IT MUST STOP. A suffix that names more than one file is a real
   ambiguity — trimming further only matches more, so the model decides rather
   than this picking whichever came first. */
const AMBIGUOUS = [
  { path: "app/dashboard/page.tsx", content: "// x" },
  { path: "admin/dashboard/page.tsx", content: "// x" },
  { path: "app/page.tsx", content: "// x" },
];
has(
  pickFileLocally("update dashboard/page.tsx", AMBIGUOUS) === null,
  '"dashboard/page.tsx" naming two files is left to the model',
  JSON.stringify(pickFileLocally("update dashboard/page.tsx", AMBIGUOUS)),
);

/* A path-shaped thing that is not a path in this project stays not a path. */
defers("the design is at https://dribbble.com/shots/9421-inspiration.png");
defers("this broke on 12/05/2025");

// ── What people actually say ──────────────────────────────────────────────
/* Each of these is a thing said constantly, going to a place the thing
   reliably is. The component beats the layout when the project has one — that
   is the more specific home for it. */

picks("make the nav darker", "components/Nav.tsx", "convention");
picks("the navbar links are too small", "components/Nav.tsx", "convention");
picks("add a link to the header", "components/Nav.tsx", "convention");
picks("the footer needs the year updating", "components/Footer.tsx", "convention");
picks("the logo is too small, increase it", "components/Nav.tsx", "convention");

/* Design tokens are in the stylesheet, not in whichever markup uses them —
   the single most common way to edit the wrong file. */
picks("make the colours darker", "app/globals.css", "convention");
picks("change the accent colour to cyan", "app/globals.css", "convention");
picks("the spacing feels cramped", "app/globals.css", "convention");
picks("use a different font", "app/globals.css", "convention");

picks("make the hero more cinematic", "app/page.tsx", "convention");
picks("the landing page needs a stronger headline", "app/page.tsx", "convention");
picks("add a plan to the pricing", "app/pricing/page.tsx", "convention");
picks("change the page title and favicon", "app/layout.tsx", "convention");

// ── When there is nothing to decide ───────────────────────────────────────

const single = [{ path: "index.html", content: "<html></html>" }];
has(pickFileLocally("anything at all", single)?.why === "only-one", "a single-page project needs no choosing");
has(pickFileLocally("x", [])?.path === undefined, "an empty project picks nothing");

// ── What must be left to the model ────────────────────────────────────────
/* The rules are meant to skip the obvious, not to have an opinion about
   everything. A rule that fires on a request it does not understand is worse
   than no rule: it sends the edit somewhere confidently wrong. */

defers("add a testimonials section");
defers("this doesn't work on mobile");
defers("make it feel more premium");
defers("remove the thing at the bottom with the cards");

// ── Reading the model's answer ────────────────────────────────────────────
/* A model asked for a path will occasionally invent a plausible one, and an
   edit against a file that does not exist fails in a way that reads as the
   person's fault. */

has(readPick("app/page.tsx", TREE) === "app/page.tsx", "a clean answer is taken");
has(readPick("  app/page.tsx  \n", TREE) === "app/page.tsx", "whitespace is trimmed");
has(readPick('"app/page.tsx"', TREE) === "app/page.tsx", "and quotes");
has(readPick("./app/page.tsx", TREE) === "app/page.tsx", "and a leading ./");
has(readPick("app/page.tsx/", TREE) === "app/page.tsx", "and a trailing slash");
has(readPick("APP/PAGE.TSX", TREE) === "app/page.tsx", "a case difference is recovered");
has(readPick("Nav.tsx", TREE) === "components/Nav.tsx", "a bare filename is recovered when it is unambiguous");
has(
  readPick("app/page.tsx\nBecause the hero lives there.", TREE) === "app/page.tsx",
  "a model that explained itself anyway is still understood",
);

/* THE ONE THAT MATTERS. An invented path must come back null so the caller
   falls back, rather than an edit proceeding against nothing. */
has(readPick("app/components/Hero.tsx", TREE) === null, "an invented path is refused");
has(readPick("", TREE) === null, "and an empty answer");
has(readPick("I'm not sure which file you mean.", TREE) === null, "and prose that names no file");
has(readPick("page.tsx", TREE) === null, "and a filename that names five files");

// ── The fallback ──────────────────────────────────────────────────────────

has(homePageOf(TREE) === "app/page.tsx", "the fallback is the home page");
has(homePageOf(single) === "index.html", "a single-page project falls back to its page");
has(
  homePageOf([{ path: "components/Nav.tsx", content: "" }]) === "components/Nav.tsx",
  "a project with no home page falls back to something rather than nothing",
);
has(homePageOf([]) === null, "and an empty project falls back to nothing");

/* ── What else reaches a file ──────────────────────────────────────────────
 *
 * The other half of picking one. A model editing a component in isolation
 * cannot see who imports it, and the commonest way to break a project from
 * inside one file is to rename or remove an export another file is still
 * asking for — which fails the BUILD rather than making the page look wrong,
 * so nobody finds out until the deployment does not happen.
 *
 * Names and paths only. The point of a tree is that changing one component
 * does not mean reading forty others. */
const NEIGHBOURS = [
  { path: "app/page.tsx", content: "import Hero from '@/components/Hero';\nexport default () => <Hero />;" },
  { path: "app/about/page.tsx", content: "import Hero from '@/components/Hero';\nexport default () => <Hero />;" },
  { path: "components/Hero.tsx", content: "export default function Hero(){return <h1>Welcome</h1>;}" },
  { path: "app/globals.css", content: "@import './tokens.css';" },
];

const heroBrief = neighbourBrief(NEIGHBOURS, "components/Hero.tsx");
has(
  heroBrief.includes("app/page.tsx") && heroBrief.includes("app/about/page.tsx"),
  "a component is told every file that imports it",
  `got: ${heroBrief.slice(0, 120) || "(nothing)"}`,
);
has(
  !heroBrief.includes("components/Hero.tsx"),
  "and not told about itself",
);
has(
  /breaks every one of them/.test(heroBrief),
  "with the consequence stated, not just the list",
);
has(
  neighbourBrief(NEIGHBOURS, "app/globals.css") === "",
  "a file nothing imports gets an empty brief rather than an empty heading",
);

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
