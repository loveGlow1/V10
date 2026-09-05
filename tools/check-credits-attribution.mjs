#!/usr/bin/env node
/* Photographs are credited on the page that publishes them.
 *
 *   npm run check:attribution
 *
 * This is a licence obligation, not a nicety. Unsplash's API guidelines make
 * attribution the condition on which the pictures are free, and it is the first
 * thing looked at when an application asks to leave the 50-requests-an-hour
 * demo tier. The credits were being collected by fillImages and dropped by its
 * caller, so every page built with photographs was in breach — silently, and
 * for exactly as long as nobody looked.
 *
 * The cases below are the ones that would put it back in breach without
 * anybody noticing: a name that closes the attribute it sits in, a page filled
 * twice growing two blocks, six pictures by one person credited six times.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-attribution");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/photo-credits.ts"),
      /* searchContext lives here. Compiled alongside rather than moved out of
         it: the function belongs with the fill it serves, and a helper relocated
         to make a test simpler is a test shaping the code it checks. */
      join(process.cwd(), "src/lib/builder/images.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

try {
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
          return `${q}${prefix}${existsSync(asFile) ? rest : `${rest}/index`}.js${q}`;
        }));
    }
  };
  rewrite(out);

  const { addPhotoCredits } = await import(join(out, "lib/builder/photo-credits.js"));
  const { searchContext } = await import(join(out, "lib/builder/images.js"));

  const PAGE = "<html><body><h1>Hi</h1></body></html>";
  const ana = { author: "Ana Silva", source: "Unsplash", url: "https://unsplash.com/@ana" };
  const bo = { author: "Bo Chen", source: "Unsplash", url: "https://unsplash.com/@bo" };

  // ── Nothing to credit ───────────────────────────────────────────────────
  has(addPhotoCredits(PAGE, []) === PAGE, "a page with no photographs is untouched");

  // ── The obligation itself ───────────────────────────────────────────────
  const one = addPhotoCredits(PAGE, [ana]);
  has(one.includes("Ana Silva"), "the photographer is named");
  has(one.includes("unsplash.com/@ana"), "and linked to");
  has(/Unsplash<\/a>|>Unsplash</.test(one), "the library is credited as well as the person");
  has(one.includes("utm_source=quickstark"), "links carry the referral parameters the guidelines ask for");
  has(one.indexOf("data-quickstark-credits") < one.indexOf("</body>"), "the block sits inside the body");

  // ── One line per photographer ───────────────────────────────────────────
  /* Six pictures by one person is one credit. A page naming them six times
     reads as a fault rather than as thoroughness. */
  const repeated = addPhotoCredits(PAGE, [ana, ana, ana, bo, ana]);
  has(repeated.match(/Ana Silva/g).length === 1, "a photographer used six times is credited once");
  has(repeated.includes("Bo Chen"), "and everyone else is still there");

  // ── Filled twice ────────────────────────────────────────────────────────
  /* A rebuild, or a save replayed. Two credit blocks on one page is the kind
     of thing nobody notices until a customer does. */
  has(
    addPhotoCredits(addPhotoCredits(PAGE, [ana]), [bo]).match(/data-quickstark-credits/g).length === 1,
    "a page credited twice grows one block, not two",
  );

  // ── A name that could break out ─────────────────────────────────────────
  /* The reason escaping is not optional: this is a photographer's real name as
     far as the API is concerned, and it is being written into an href. */
  const hostile = addPhotoCredits(PAGE, [
    { author: '"><script>alert(1)</script>', source: "Unsplash", url: 'https://x.com/"><script>' },
  ]);
  has(!hostile.includes("<script>"), "a name cannot close the tag it is written into");
  has(hostile.includes("&lt;script&gt;"), "it is escaped rather than dropped");

  // ── A fragment with no body ─────────────────────────────────────────────
  has(
    addPhotoCredits("<h1>Hi</h1>", [ana]).includes("Ana Silva"),
    "a fragment with no </body> is still credited",
  );

  // ── The photographs belong to THIS page ─────────────────────────────────
  /* Two shops selling cloth write the same "folded fabric" slot and want
     entirely different pictures. Nothing inside one <img> tag can tell them
     apart; the brief that produced the page can. This is what is carried
     across, and it is only ever appended to a slot too generic to search for
     on its own — so it has to be the distinguishing fact and nothing else.
     A brief of pure instructions must yield NOTHING rather than a few
     grammatical words, which would search worse than the slot alone. */
  const CONTEXT = [
    ["Build me an online shop for Adire wax print fabric in Lagos", "Adire wax print fabric"],
    ["a landing page for my gym", "gym"],
    ["news site for local politics", "local politics"],
    ["a blog about Japanese woodworking", "Japanese woodworking"],
    ["create a beautiful website for my coffee roastery in Portland", "coffee roastery Portland"],
    /* Nothing but instructions and a category. Empty is the right answer. */
    ["Build me an ecomerce page", ""],
    ["make me a website", ""],
  ];

  for (const [brief, want] of CONTEXT) {
    const got = searchContext(brief);
    has(got === want, `"${brief.slice(0, 44)}"`, got === want ? "" : `expected "${want}", got "${got}"`);
  }

  console.log(failed === 0 ? "\nphotographs are credited." : `\n${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
