#!/usr/bin/env node
/* Checks the photograph pipeline without calling a provider.
 *
 *   npm run check:images
 *
 * A generated page declares picture slots rather than drawing photographs, and
 * src/lib/builder/images.ts fills them with real pixels after generation. That
 * is a lot of moving parts for something whose failure is silent: a page with
 * unfilled slots looks deliberate, so a broken fill step would ship for weeks
 * before anybody noticed the pictures were always placeholders.
 *
 * So the whole path is exercised against a stub provider that answers with a
 * real one-pixel PNG. No key, no network, no cost — and it still proves the
 * parts that actually break: that slots are read, that bytes land in the right
 * tag, that the budget is respected, that a provider returning nothing leaves a
 * usable page, and that two identical tags do not end up sharing a photograph.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-images");
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
      types: ["node"],
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/images.ts")],
  }),
);

let failed = 0;
const ok = (text, detail) => console.log(`ok    ${text}${detail ? ` — ${detail}` : ""}`);
function fail(text, detail) {
  failed++;
  console.log(`FAIL  ${text}${detail ? `\n        ${detail}` : ""}`);
}
const is = (got, want, text) =>
  got === want ? ok(text, String(got)) : fail(text, `expected ${want}, got ${got}`);

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });
  const { readSlots, fillImages, placeholderFor, WIDTH } = await import(join(out, "lib/builder/images.js"));

  /* A real 1×1 PNG. Small enough to make the budget arithmetic legible, and an
     actual image rather than random bytes, because the point of this pipeline
     is that what lands in the page is a decodable picture. */
  const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const page = `<!doctype html><html><body>
<img data-shot="wide shot of a depot at dusk, vans charging, long exposure" data-ratio="16/9" data-weight="hero" alt="Depot at dusk">
<img data-shot="folded ochre wax print fabric, raking light, neutral seamless" data-ratio="4/5" data-weight="thumb" alt="Ochre wax print">
<img data-shot="folded ochre wax print fabric, raking light, neutral seamless" data-ratio="4/5" data-weight="thumb" alt="Ochre wax print">
<svg aria-label="Chart of overnight load"><rect/></svg>
</body></html>`;

  // ── Reading the slots ────────────────────────────────────────────────────
  const slots = readSlots(page);
  is(slots.length, 3, "every slot is read, and the SVG is not one");
  is(slots[0].weight, "hero", "weight is read off the tag");
  is(slots[1].ratio, "4/5", "ratio is read off the tag");
  is(WIDTH[slots[0].weight] > WIDTH[slots[1].weight], true, "a hero is asked for at a larger width than a thumb");

  // ── Filling them ─────────────────────────────────────────────────────────
  const asked = [];
  const stub = {
    name: "stub",
    async shotFor(slot, width) {
      asked.push({ shot: slot.shot.slice(0, 24), width });
      return { bytes: PIXEL, contentType: "image/png", credit: { author: "A Photographer", source: "Stub", url: "https://example.test" } };
    },
  };

  const filled = await fillImages(page, stub);
  is(filled.filled, 3, "every slot is filled when the provider answers");
  is((filled.html.match(/src="data:image\/png;base64,/g) ?? []).length, 3, "each tag carries real image bytes");
  is(filled.credits.length, 3, "attribution comes back with the pictures");
  is(asked[0].width, WIDTH.hero, "the hero is requested first, at hero width");

  /* Two identical tags must not collapse into one replacement — a global
     replace would give both products the same photograph, which is the bug
     this ordering exists to avoid. */
  const distinct = filled.html.split('<img').filter((part) => part.includes("data:image"));
  is(distinct.length, 3, "identical tags are each rewritten, not collapsed");

  // ── The budget ───────────────────────────────────────────────────────────
  const tight = await fillImages(page, stub, { budget: PIXEL.toString("base64").length * 2 });
  is(tight.filled, 2, "spending stops at the budget");
  is(tight.skipped, 1, "what does not fit is reported as skipped");
  is(
    (tight.html.match(/src="data:image\/svg\+xml;base64,/g) ?? []).length,
    1,
    "a slot that misses out keeps a placeholder rather than an empty src",
  );

  // ── Nothing configured, and nothing found ────────────────────────────────
  const none = await fillImages(page, null);
  is(none.filled, 0, "no provider fills nothing");
  is(
    (none.html.match(/src="data:image\/svg\+xml;base64,/g) ?? []).length,
    3,
    "and every slot still ends up with a usable placeholder",
  );

  const empty = await fillImages(page, { name: "empty", async shotFor() { return null; } });
  is(empty.filled, 0, "a provider that finds nothing fills nothing");
  is(empty.html.includes("<img"), true, "and the page survives it");

  const angry = await fillImages(page, { name: "angry", async shotFor() { throw new Error("429"); } });
  is(angry.filled, 0, "a provider that throws is caught");
  is(angry.html.includes('alt="Depot at dusk"'), true, "and the page keeps its alt text");

  // ── The placeholder itself ───────────────────────────────────────────────
  const a = placeholderFor(slots[0]);
  const b = placeholderFor(slots[1]);
  is(a.startsWith("data:image/svg+xml;base64,"), true, "a placeholder is a self-contained data URI");
  is(a !== b, true, "different pictures get different placeholder tones");
  is(placeholderFor(slots[0]) === a, true, "and the same picture gets the same one every time");

  console.log(`\n${failed === 0 ? "All checks passed." : `${failed} failed.`}`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
