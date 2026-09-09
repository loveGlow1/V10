#!/usr/bin/env node
/* Attached pictures reach the page they were attached to.
 *
 *   npm run check:attachments
 *
 * The failure this exists for, from a real conversation: somebody attached a
 * photograph, wrote "use this image", and got back a page with an invented file
 * path in the src and a reply explaining they would need to host the file
 * themselves. The model could see the picture and had no address to write down.
 *
 * The fix gives each image a token — attachment:1 — which the model writes as
 * the src and which is swapped for the real bytes after the edit applies. Two
 * things about that can be wrong without anything throwing, and both are here:
 *
 *   the NUMBERING — what the model was told is attachment:2 has to be what
 *   attachment:2 resolves to. The tokens count the images actually sent, and a
 *   row can be left out of that between two photographs; if one side counts
 *   rows and the other counts what it sent, the page gets the wrong picture.
 *   Nothing errors. The person sees their logo where their product shot should
 *   be.
 *
 *   the LEFTOVERS — a token that survives into the stored page is a src of
 *   "attachment:2", which renders as a broken image.
 *
 * No keys, no network: the pure halves only.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-attachments");
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
      join(process.cwd(), "src/lib/builder/attachments.ts"),
      join(process.cwd(), "src/lib/page-html.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

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

const { attachmentToken, placeAttachments, sniffImage } = await import(join(out, "lib/builder/attachments.js"));
const { stashImages, restoreImages } = await import(join(out, "lib/page-html.js"));

// ── The tokens are one-based and stable ───────────────────────────────────
has(attachmentToken(0) === "attachment:1", "the first image is attachment:1", attachmentToken(0));
has(attachmentToken(1) === "attachment:2", "the second is attachment:2", attachmentToken(1));

/* The numbering rule the two sides share, asserted as arithmetic rather than
   read out of either: tokens count the images that are actually SENT, in order,
   so a row that is skipped changes nothing about the ones after it.
   attachmentBlocks increments its counter only when it pushes a picture, and
   imagePlacements increments on exactly the same condition — this is the
   property both of those are implementing. Get it wrong on one side and
   somebody's logo lands where their product shot should be, with nothing
   anywhere reporting an error.

   Nothing but a picture can be attached any more, so the row in the middle here
   is what a skip now looks like: an old document, or a file whose bytes are not
   the picture its name claims. */
const mixed = ["image/png", "application/pdf", "image/jpeg"];
const tokensForSent = mixed
  .filter((mime) => mime.startsWith("image/"))
  .map((_, sentIndex) => attachmentToken(sentIndex));
has(
  tokensForSent.join(",") === "attachment:1,attachment:2",
  "a skipped row between two images does not shift the numbering",
  tokensForSent.join(","),
);

// ── Placement ─────────────────────────────────────────────────────────────
const shot = { token: "attachment:1", dataUri: "data:image/png;base64,AAAA", name: "shot.png" };
const logo = { token: "attachment:2", dataUri: "data:image/jpeg;base64,BBBB", name: "logo.jpg" };

const placed = placeAttachments(
  `<img src="attachment:1" alt="a"><img src="attachment:2" alt="b">`,
  [shot, logo],
);
has(
  placed === `<img src="data:image/png;base64,AAAA" alt="a"><img src="data:image/jpeg;base64,BBBB" alt="b">`,
  "each token becomes its own picture",
  placed,
);

/* The same picture used twice is an ordinary thing to ask for — a logo in the
   header and again in the footer — and a replace that stops at the first is a
   second broken image. */
const twice = placeAttachments(`<img src="attachment:1"><img src="attachment:1">`, [shot]);
has(
  !twice.includes("attachment:1") && twice.split("data:image/png").length === 3,
  "one picture placed twice is placed both times",
  twice,
);

/* A token for a picture that could not be embedded — too large, or unreadable
   — must not survive into the page. An empty src leaves a styled slot; a src of
   "attachment:2" is a broken image icon in the middle of somebody's page. */
const orphan = placeAttachments(`<img src="attachment:1"><img src="attachment:2">`, [shot]);
has(
  !orphan.includes("attachment:2"),
  "a token with no picture behind it is removed, not left in the markup",
  orphan,
);

/* And the ordinary case: an edit that never mentioned an attachment is
   returned exactly as it came, byte for byte. */
const untouched = `<main><h1>Nothing attached here</h1></main>`;
has(placeAttachments(untouched, [shot]) === untouched, "a page with no tokens is unchanged");
has(placeAttachments(untouched, []) === untouched, "no attachments at all changes nothing");

/* ── The bytes, not the label ──────────────────────────────────────────────
 *
 * This is the check for the HTTP 400. A photograph off an iPhone can arrive
 * named .jpeg, declared image/jpeg, and actually be HEIC — and the API reads
 * the bytes, finds no JPEG, and refuses the ENTIRE request. One picture killed
 * an edit that had nothing to do with it, and the person was shown a status
 * code.
 *
 * Real headers, written out byte for byte, because a signature test that is
 * itself written from the same wrong assumption proves nothing.
 */
const header = (...bytes) => Buffer.from(bytes);
const ascii = (text) => Buffer.from(text, "ascii");

const SIGNATURES = [
  ["a JPEG", Buffer.concat([header(0xff, 0xd8, 0xff, 0xe0), ascii("\u0000\u0010JFIF")]), "image/jpeg"],
  ["a PNG", Buffer.concat([header(0x89), ascii("PNG"), header(0x0d, 0x0a, 0x1a, 0x0a)]), "image/png"],
  ["a GIF", ascii("GIF89a-and-then-some"), "image/gif"],
  ["a WEBP", Buffer.concat([ascii("RIFF"), header(0, 0, 0, 0), ascii("WEBPVP8 ")]), "image/webp"],
  /* The one that was failing: an ISO container whose brand says HEIC. */
  ["an iPhone HEIC", Buffer.concat([header(0, 0, 0, 0x18), ascii("ftypheic"), ascii("mif1")]), "heic"],
  ["a HEIF sequence", Buffer.concat([header(0, 0, 0, 0x18), ascii("ftypmif1"), ascii("heic")]), "heic"],
  /* RIFF alone is a WAV, not a picture. */
  ["a WAV pretending to be RIFF", Buffer.concat([ascii("RIFF"), header(0, 0, 0, 0), ascii("WAVEfmt ")]), null],
  ["a text file", ascii("just some words in a file"), null],
  ["nothing at all", Buffer.alloc(0), null],
];

for (const [name, bytes, expected] of SIGNATURES) {
  const got = sniffImage(bytes);
  has(got === expected, `${name} reads as ${expected ?? "not an image"}`, `got ${got}`);
}

/* ── A page with photographs in it can still be edited ────────────────────
 *
 * The second failure, and the one that made a page permanently uneditable: a
 * stored page carries its pictures as base64, and on a real one that was
 * 416,149 of its 463,340 characters. Base64 is close to a token a character, so
 * three photographs were about 370,000 tokens — against a 200,000 ceiling — and
 * every edit was refused before it started. Not slow: impossible.
 *
 * The numbers below are that page's, so the arithmetic is checked against the
 * thing that failed rather than against a convenient invention.
 */
/* Distinguishable on purpose: two runs of the same character would make the
   shorter picture a substring of the longer one, and "is it still there?" would
   answer yes for the wrong reason. */
const photograph = (n, fill) => `data:image/jpeg;base64,${fill.repeat(n)}`;
const page = `<main><img src="${photograph(200_000, "Q")}" alt="hero"><h1>Storecraft</h1><img src="${photograph(150_000, "Z")}" alt="team"></main>`;

const { lean, images } = stashImages(page);
has(images.length === 2, "every embedded picture is lifted out", `${images.length}`);
has(!lean.includes("base64"), "the page shown to the model carries no base64", lean.slice(0, 60));
has(
  lean.length < page.length / 100,
  `the page shrinks from ${page.length} characters to ${lean.length}`,
);
has(lean.includes('alt="hero"') && lean.includes("<h1>Storecraft</h1>"), "the markup itself is untouched");

/* And it comes back whole: byte for byte, or somebody's photographs have been
   destroyed by a step that was only supposed to hide them. */
has(restoreImages(lean, images) === page, "the page comes back byte for byte");

/* An edit that deletes the section takes its picture with it, which is the
   right answer — asking for a photograph to go should make it go. */
const deleted = lean.replace(/<img src="stashed-image-1"[^>]*>/, "");
const afterDelete = restoreImages(deleted, images);
has(!afterDelete.includes(images[1]), "a picture the edit removed stays removed");
has(afterDelete.includes(images[0]), "the pictures it kept are still there");

/* The same photograph used twice is stored once and pointed at twice. */
const twicePage = `<img src="${photograph(100, "Q")}"><img src="${photograph(100, "Q")}">`;
const twiceStash = stashImages(twicePage);
has(twiceStash.images.length === 1, "one picture used twice is stashed once", `${twiceStash.images.length}`);
has(restoreImages(twiceStash.lean, twiceStash.images) === twicePage, "and both copies come back");

/* A token the model invented, pointing at nothing, must not be left to render
   as a broken image. */
has(
  !restoreImages(`<img src="stashed-image-9">`, images).includes("stashed-image"),
  "an invented token is emptied rather than left in the page",
);

/* A page with no pictures at all is returned exactly as it came. */
const plain = "<main><h1>Nothing embedded</h1></main>";
has(stashImages(plain).lean === plain, "a page with no pictures is unchanged");

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
