#!/usr/bin/env node
/* Checks the framing model: where the subject of a picture sits, and what a
 * request to move it actually does.
 *
 *   npm run check:framing
 *
 * This exists because of one inversion. `object-position` moves the PICTURE
 * behind a window rather than the subject in front of one, so "bring the cake
 * down" is the second value going DOWN — and a rule that runs backwards from
 * how it is spoken is a rule that gets written the wrong way round about half
 * the time it is written. It is written once here, and this is what holds it.
 *
 * The rest is the same argument as every other checker in this directory: the
 * deterministic reframe path spends no credit and asks nobody's permission, so
 * a false positive is an edit nobody requested. Every case below is exercised
 * twice — once where it must act and once where it must decline.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-framing");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      strict: true,
      types: ["node"],
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/framing.ts"),
      join(process.cwd(), "src/lib/builder/reference.ts"),
    ],
  }),
);

let failed = 0;
const ok = (text, detail) => console.log(`ok    ${text}${detail ? ` — ${detail}` : ""}`);
function fail(text, detail) {
  failed += 1;
  console.log(`FAIL  ${text}${detail ? `\n        ${detail}` : ""}`);
}
const is = (got, want, text) =>
  got === want ? ok(text, String(got)) : fail(text, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

const framing = await import(join(out, "lib/builder/framing.js"));
const reference = await import(join(out, "lib/builder/reference.js"));

const {
  NEUTRAL,
  STEP,
  ZOOM_STEP,
  applyMoves,
  describeChange,
  ensureFramingStyles,
  framingRequest,
  heroPicture,
  pictures,
  readFraming,
  reframe,
  sameFraming,
  writeFraming,
} = framing;

/* A page with a lead photograph and a second one, plus a piece of text that is
   NOT a picture — the control for "move the pricing table down", which must
   never be answered by reframing a photograph. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Cones</title></head>
<body>
<header class="site"><nav><a href="#menu">Menu</a></nav></header>
<section class="hero">
  <img data-shot="single scoop cone held against a pale wall, soft daylight" data-ratio="16/9" data-weight="hero" alt="A single scoop cone" style="width:100%;aspect-ratio:16/9;object-fit:cover;object-position:50% 50%">
  <h1>Made this morning</h1>
</section>
<section id="menu">
  <h2>The pricing table</h2>
  <table><tr><td>Single scoop</td><td>£3.20</td></tr></table>
  <img data-shot="tray of waffle cones cooling on a rack" data-ratio="4/3" data-weight="thumb" alt="Waffle cones cooling">
</section>
</body></html>`;

console.log("\n── Reading a framing off a tag ──────────────────────────────────\n");

{
  const [hero] = pictures(PAGE);
  const read = readFraming(hero.tag);
  is(read.fit, "cover", "object-fit is read out of the inline style");
  is(read.y, 50, "object-position's second value is read out of the inline style");

  const declared = readFraming('<img data-fit="contain" data-focal="30% 20%" data-zoom="1.2">');
  is(declared.fit, "contain", "data-fit is read when there is no CSS yet");
  is(declared.x, 30, "data-focal's first value is read");
  is(declared.y, 20, "data-focal's second value is read");
  is(declared.zoom, 1.2, "data-zoom is read");

  const keywords = readFraming('<img style="object-position: center top">');
  is(keywords.y, 0, "the keyword form of object-position is understood");

  const bare = readFraming('<img alt="nothing said about framing">');
  is(sameFraming(bare, NEUTRAL), true, "a tag that says nothing is read as no decision, not as a wrong one");
}

console.log("\n── The inversion, which is the whole point ──────────────────────\n");

{
  const from = { fit: "cover", x: 50, y: 50, zoom: 1 };

  const down = applyMoves(from, [{ move: "down", amount: 1 }]);
  is(down.y, 50 - STEP, "moving the subject DOWN lowers object-position's second value");
  is(down.y < from.y, true, "…which is the direction that shows more of the top of the picture");

  const up = applyMoves(from, [{ move: "up", amount: 1 }]);
  is(up.y, 50 + STEP, "moving the subject UP raises it");

  const left = applyMoves(from, [{ move: "left", amount: 1 }]);
  is(left.x, 50 + STEP, "moving the subject LEFT raises the first value");

  const right = applyMoves(from, [{ move: "right", amount: 1 }]);
  is(right.x, 50 - STEP, "moving the subject RIGHT lowers it");

  const abit = applyMoves(from, [{ move: "down", amount: 0.5 }]);
  is(abit.y, 50 - STEP / 2, "\"a bit\" is half a step");

  const alot = applyMoves(from, [{ move: "down", amount: 2 }]);
  is(alot.y, 50 - STEP * 2, "\"a lot\" is two");

  const floored = applyMoves(from, [{ move: "down", amount: 2 }, { move: "down", amount: 2 }, { move: "down", amount: 2 }]);
  is(floored.y, 0, "it stops at the edge of the picture rather than going past it");
}

console.log("\n── Fit and zoom ────────────────────────────────────────────────\n");

{
  const cover = { fit: "cover", x: 50, y: 40, zoom: 1 };

  const whole = applyMoves(cover, [{ move: "whole" }]);
  is(whole.fit, "contain", "\"show the whole thing\" stops the box cropping it");
  is(whole.zoom, 1, "…and drops a zoom that was only there to fight the crop");

  const out1 = applyMoves(cover, [{ move: "out", amount: 1 }]);
  is(out1.fit, "contain", "pulling back from a crop that is already at its limit means not cropping");

  const zoomed = applyMoves({ fit: "cover", x: 50, y: 50, zoom: 1.5 }, [{ move: "out", amount: 1 }]);
  is(zoomed.zoom, Number((1.5 - ZOOM_STEP).toFixed(2)), "pulling back from a zoom reduces the zoom");
  is(zoomed.fit, "cover", "…and leaves the fit alone while there is zoom left to give");

  const closer = applyMoves({ fit: "contain", x: 50, y: 50, zoom: 1 }, [{ move: "in", amount: 1 }]);
  is(closer.fit, "cover", "going closer in from contain fills the frame first");
}

console.log("\n── Reading what somebody typed ─────────────────────────────────\n");

const REQUESTS = [
  { text: "bring the cake down", moves: ["down"], subject: "cake" },
  { text: "move the cake down a bit and show the entire cone", moves: ["down", "whole"], subject: "cake" },
  { text: "the cone is cut off at the bottom", moves: ["whole"], subject: null },
  { text: "make the image smaller", moves: ["out"], subject: null },
  { text: "zoom in on the hero image", moves: ["in"], subject: null },
  { text: "the scoop is hidden behind the header", moves: ["down"], subject: null },
  { text: "nudge the photo up slightly", moves: ["up"], subject: null },
  { text: "shift it left", moves: ["left"], subject: null },
];

for (const request of REQUESTS) {
  const read = framingRequest(request.text);
  if (!read) {
    fail(`"${request.text}" is read as a framing request`, "it was declined");
    continue;
  }
  const moves = read.moves.map((move) => move.move);
  if (JSON.stringify(moves) !== JSON.stringify(request.moves)) {
    fail(`"${request.text}"`, `expected ${request.moves.join("+")}, got ${moves.join("+")}`);
  } else {
    ok(`"${request.text}"`, moves.join(" + "));
  }
  if (request.subject && read.subject !== request.subject) {
    fail(`"${request.text}" names its subject`, `expected ${request.subject}, got ${read.subject}`);
  }
}

/* And the half that matters more: everything this must NOT claim. Each of
   these would be a wrong edit made without asking and without charging, which
   is the worst possible combination — nobody would even see it on a bill. */
const NOT_FRAMING = [
  "make the header dark blue",
  "add a contact form under the menu",
  "the prices are down to £3 on Tuesdays",
  "change the headline to something shorter",
  "add product reviews",
  "delete the pricing table",
  "what does this page do?",
];

for (const text of NOT_FRAMING) {
  const read = framingRequest(text);
  if (read) fail(`"${text}" is NOT read as a framing request`, `it produced ${read.moves.map((m) => m.move).join("+")}`);
  else ok(`"${text}" is left to the model`);
}

console.log("\n── Which picture ───────────────────────────────────────────────\n");

{
  const all = pictures(PAGE);
  is(all.length, 2, "every picture in the page is found");
  is(heroPicture(PAGE).alt, "A single scoop cone", "the hero is the slot that says it is one");

  const noWeight = `<body><div class="hero-banner"><img alt="Leading picture"></div><img alt="Later picture"></body>`;
  is(heroPicture(noWeight).alt, "Leading picture", "…and where nothing says so, the one inside the hero");
}

console.log("\n── The whole edit, end to end ──────────────────────────────────\n");

{
  const result = reframe(PAGE, "bring the cake down a bit");
  if (!result) {
    fail("\"bring the cake down\" reframes the hero", "it was declined");
  } else {
    is(result.after.y, 50 - STEP / 2, "the hero's focal point comes down half a step");
    is(result.before.y, 50, "…from where it was");
    is(/object-position:\s*50% 42\.5%/.test(result.html), true, "the declaration is rewritten in the page");
    is(/data-focal="50% 42\.5%"/.test(result.html), true, "…and the attribute records the decision");
    is(result.html.includes("Waffle cones cooling"), true, "the other picture is untouched");
    is(result.html.includes("<h1>Made this morning</h1>"), true, "the page around it is untouched");
    is(result.html.includes("£3.20"), true, "and so is everything else on it");
    is(result.said.toLowerCase().includes("down"), true, "the reply says what it did");
  }
}

{
  /* The refusal that matters most: something on the page is called that, and it
     is not a picture. */
  const declined = reframe(PAGE, "move the pricing table down");
  is(declined, null, "a request about something that is not a picture is handed back to the model");
}

{
  const none = reframe(`<!doctype html><html><body><h1>No pictures here</h1></body></html>`, "move the photo down");
  is(none, null, "a page with no pictures is handed back too");
}

{
  /* Already there. Storing a version identical to the last one and saying
     "done" is worse than saying nothing. */
  const already = reframe(PAGE, "show the whole thing");
  const twice = already ? reframe(already.html, "show the whole thing") : null;
  is(twice, null, "asking for the framing it already has changes nothing");
}

{
  const whole = reframe(PAGE, "the cone is cut off, show all of it");
  if (!whole) fail("\"show all of it\" stops the crop", "it was declined");
  else is(/object-fit:\s*contain/.test(whole.html), true, "\"show all of it\" becomes object-fit: contain");
}

console.log("\n── Writing a framing back ──────────────────────────────────────\n");

{
  const tag = '<img alt="A cone" style="width:100%">';
  const once = writeFraming(tag, { fit: "cover", x: 50, y: 30, zoom: 1 });
  const twice = writeFraming(once, readFraming(once));
  is(once, twice, "writing the same framing twice produces the same string");
  is(once.includes("width:100%"), true, "the declarations already on the tag survive");

  const zoomed = writeFraming(tag, { fit: "cover", x: 50, y: 30, zoom: 1.2 });
  is(/transform:scale\(1\.2\)/.test(zoomed), true, "a zoom becomes a transform");
  is(/transform-origin:50% 30%/.test(zoomed), true, "…anchored at the focal point rather than the middle");

  const unzoomed = writeFraming(zoomed, { fit: "cover", x: 50, y: 30, zoom: 1 });
  is(/transform:/.test(unzoomed), false, "and a zoom of 1 leaves no transform behind at all");

  const styled = ensureFramingStyles(`<html><head></head><body>${zoomed}</body></html>`);
  is(styled.includes(":has(> img[data-zoom])"), true, "a zoomed picture gets the rule that clips it");
  is(ensureFramingStyles(styled), styled, "…once, however many times it runs");
  is(ensureFramingStyles(`<html><head></head><body>${once}</body></html>`).includes(":has("), false,
    "a document with nothing zoomed is not styled at all");
}

console.log("\n── The reference brief ─────────────────────────────────────────\n");

{
  is(reference.referenceBrief(0), "", "no attachments means no section about them");

  const brief = reference.referenceBrief(2);
  is(brief.includes("2 images were"), true, "it counts what was actually attached");
  for (const word of ["container", "grid", "focal", "header", "type scale", "DIRECTION", "CONTENT"]) {
    is(brief.toLowerCase().includes(word.toLowerCase()), true, `it names ${word} as something to read off the reference`);
  }
  is(/never place the file/i.test(brief), true, "and forbids dropping a design in as a picture");

  is(reference.referenceEditBrief(0), "", "and it stays out of an edit that carries no pictures");
  is(reference.referenceEditBrief(1).length > 100, true, "an edit that carries one gets the short form");
}

console.log("");
if (failed > 0) {
  console.log(`${failed} failed\n`);
  process.exit(1);
}
console.log("all good\n");
