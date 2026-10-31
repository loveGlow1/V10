/* Fliers: one logo, the same everywhere, and no lettering nobody asked for.
 *
 * Runs the real stamping code (lib/flyers/logo.ts) on real images with sharp,
 * and pins the rules around it: which attachment is the logo, when it goes,
 * that no model is ever given or asked to draw a logo, and that an image is
 * charged only after its text has been checked. */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const sharp = require("sharp");
const read = (file) => readFileSync(join(root, file), "utf8");

let failed = 0;
const has = (ok, label, detail = "") => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed += 1;
};

/* logo.ts, compiled, with its one app import stood in for. */
const dir = mkdtempSync(join(tmpdir(), "flier-logo-"));
writeFileSync(join(dir, "attachments.mjs"), 'export const ATTACHMENTS_BUCKET = "attachments";');
const js = ts
  .transpileModule(read("src/lib/flyers/logo.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace('"@/lib/builder/attachments"', JSON.stringify(join(dir, "attachments.mjs")))
  .replace('from "sharp"', `from ${JSON.stringify(require.resolve("sharp"))}`);
writeFileSync(join(dir, "logo.mjs"), js);
const { stampLogo, logoAttachment, wantsNoLogo } = await import(join(dir, "logo.mjs"));

/* Which attachment is the logo. */
const png = (name) => ({ name, mime: "image/png" });
has(logoAttachment("make it for my bakery", [png("photo.jpg"), png("acme-logo.png")]) === 1, "a file named like a logo is the logo");
has(logoAttachment("here is our logo", [png("IMG_2231.png")]) === 0, "the image sent with \"here is our logo\" is the logo");
has(logoAttachment("use this photo of our cakes", [png("IMG_2231.png")]) === -1, "a product photo is not taken for a logo");
has(logoAttachment("here is our logo", [{ name: "brief.pdf", mime: "application/pdf" }]) === -1, "only an image can be a logo");
has(wantsNoLogo("remove the logo please") && wantsNoLogo("no logo on this one") && !wantsNoLogo("make the logo bigger"), "\"remove the logo\" removes it; other mentions keep it");

/* Stamping: the same mark, the same corner, scaled to the image. */
const flier = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#123456" } }).png().toBuffer();
const square = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#123456" } }).png().toBuffer();
/* A red mark with a wide white border, as logos are often saved. */
const logo = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#ffffff" } })
  .composite([{ input: await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ff0000" } }).png().toBuffer(), left: 150, top: 100 }])
  .png()
  .toBuffer();
const pixel = async (buffer, x, y) => {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const stamped = await stampLogo(flier, logo);
const meta = await sharp(stamped).metadata();
has(meta.width === 1200 && meta.height === 1800, "the image keeps its size");
const inset = Math.round(1200 / 25);
const [r, g, b] = await pixel(stamped, inset + 20, inset + 20);
has(r > 200 && g < 60 && b < 60, "the logo sits in the top-left corner, its border trimmed", `${r},${g},${b}`);
const [r2, , b2] = await pixel(stamped, 1100, 1700);
has(r2 < 40 && b2 > 60, "the rest of the image is untouched");
const big = await stampLogo(square, logo);
const [r3] = await pixel(big, Math.round(2048 / 25) + 20, Math.round(2048 / 25) + 20);
has(r3 > 200, "the same corner on every shape");

/* No model draws or is handed the logo; text is checked before charging. */
const prompt = read("src/lib/flyers/prompt.ts");
const router = read("src/lib/flyers/router.ts");
const run = read("src/lib/flyers/run.ts");
has(!/Use the provided logo/.test(prompt) && /No logo, emblem, monogram/.test(prompt), "the model is told to draw no logo, ever");
has(/Keep the top-left corner/.test(prompt), "a corner is kept clear for the real logo");
has(/no Chinese, Japanese or Korean characters/.test(prompt), "the model is told: only the requested text, in its own alphabet");
has(/const all = shots;/.test(router), "no model is given the logo image to redraw");
has(/keepReadable\(made\.images, req\)/.test(run) && run.indexOf("keepReadable(made.images") < run.indexOf("chargeCredits("), "every image's text is checked before anything is charged");
has(/if \(!kept\.length\) continue;/.test(run), "a set with the wrong words falls through to the next model");
has(/cost: flyerJobCost\(stage, outputs\.length\)/.test(run), "only the images kept are charged");
has(/attachmentIds: Array\.isArray\(body\.attachmentIds\)/.test(read("src/app/api/build/route.ts")), "a logo attached in the workspace reaches the flier");

/* Every word set in real type: the model makes the picture only. */
{
  const typesetSrc = read("src/lib/flyers/typeset.tsx");
  const promptSrc = read("src/lib/flyers/prompt.ts");
  const briefSrc = read("src/lib/flyers/brief.ts");
  has(!/textMode: "ai"/.test(briefSrc) && (briefSrc.match(/textMode: "overlay"/g) ?? []).length >= 4, "every new and revised flier sets its words in real type — none is left to the image model");
  has(/Do NOT render any text, letters, numbers, signs, labels or logos/.test(promptSrc) && /calm, darker and uncluttered for the words/.test(promptSrc), "the model is asked for the picture alone, with calm space where the words go");
  has(/req\.spec\.textMode === 'overlay' \? await Promise\.all\(kept\.map\(\(image\) => typeset\(image/.test(run) && run.indexOf("typeset(image") < run.indexOf("stampLogo(image, logo)"), "the words are set after the picture passes its no-text check, then the logo goes on");
  has(/spec\.headline\.trim\(\)/.test(typesetSrc) && /spec\.subhead/.test(typesetSrc) && /spec\.details/.test(typesetSrc) && /spec\.cta/.test(typesetSrc) && /brand\.name\.trim\(\)/.test(typesetSrc), "headline, subhead, details, button and brand are all set from the brief, word for word");
  has(/!input\.logo && brand\.name\.trim\(\)/.test(typesetSrc), "the brand name is set only when there is no logo stamped");
}
console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
