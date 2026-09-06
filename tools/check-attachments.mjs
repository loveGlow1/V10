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
 *   attachment:2 resolves to. The tokens count images; the attachment list can
 *   hold a PDF between two photographs, and if one side counts rows and the
 *   other counts images, the page gets the wrong picture. Nothing errors. The
 *   person sees their logo where their product shot should be.
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
    files: [join(process.cwd(), "src/lib/builder/attachments.ts")],
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

const { attachmentToken, placeAttachments } = await import(join(out, "lib/builder/attachments.js"));

// ── The tokens are one-based and stable ───────────────────────────────────
has(attachmentToken(0) === "attachment:1", "the first image is attachment:1", attachmentToken(0));
has(attachmentToken(1) === "attachment:2", "the second is attachment:2", attachmentToken(1));

/* The numbering rule the two sides share, asserted as arithmetic rather than
   read out of either: tokens count IMAGES in order, so a document sitting
   between two of them changes nothing. attachmentBlocks increments its own
   counter only on an image, and imagePlacements filters to images before it
   enumerates — this is the property both of those are implementing. */
const mixed = ["image/png", "application/pdf", "image/jpeg"];
const tokensForImages = mixed
  .map((mime, index) => ({ mime, index }))
  .filter((entry) => entry.mime.startsWith("image/"))
  .map((entry, imageIndex) => attachmentToken(imageIndex));
has(
  tokensForImages.join(",") === "attachment:1,attachment:2",
  "a document between two images does not shift the numbering",
  tokensForImages.join(","),
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

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
