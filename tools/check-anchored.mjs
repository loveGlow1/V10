/* An anchored panel is always on the screen.
 *
 *   npm run check:anchored
 *
 * Two bugs are the reason this exists, and both shipped because a menu was
 * placed by CSS that never asks whether there is room:
 *
 *   The model list opens upward out of the composer and is taller than the
 *   space above it, so its first rows were drawn behind the header and nothing
 *   could scroll them back.
 *
 *   The row menu opens downward. On the last row of a page there is nothing
 *   below it, so Delete was placed past the end of the document — on screen as
 *   far as the layout was concerned, unreachable by a person.
 *
 * Neither was a wrong direction; both were a direction chosen once for a
 * control that moves. So what is checked below is not "does it open upward"
 * but the invariant that actually matters: whatever the window, whatever the
 * anchor, the panel is inside the viewport and no shorter than the room it was
 * given. A placement that satisfies that cannot produce either bug.
 *
 * Runs the shipped function. No DOM, no browser — placeAnchored is arithmetic
 * over a box and a viewport, which is exactly why it was split out.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-anchored");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/app/dashboard/components/anchoredPlacement.ts", "--outDir", out, "--rootDir", "src",
   "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { placeAnchored, GAP, MARGIN } = await import(
  join(out, "app/dashboard/components/anchoredPlacement.js")
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* A control of the given size at the given position, in a window of the given
   size. `y` is the top of the control. */
const at = (y, { height = 32, width = 32, x = 100 } = {}) => ({
  top: y, bottom: y + height, left: x, right: x + width,
});

/* The invariant, stated once and asserted everywhere: the panel is on the
   screen, top to bottom and side to side, with its margins kept. */
function fits(place, viewport, width) {
  const height = Math.min(place.maxHeight, place.natural ?? place.maxHeight);
  return (
    place.top >= MARGIN - 0.5 &&
    place.top + height <= viewport.height - MARGIN + 0.5 &&
    place.left >= MARGIN - 0.5 &&
    place.left + width <= viewport.width - MARGIN + 0.5
  );
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// ── The row menu: Delete on the last row of the page ──────────────────────

console.log("A menu on a control near the bottom of the window:");
{
  /* The exact shape of the bug: a 240x210 menu opening downward from a button
     34px off the bottom of the window. */
  const viewport = DESKTOP;
  const anchor = at(viewport.height - 34);
  const got = placeAnchored({ anchor, viewport, natural: 210, width: 240, side: "bottom" });

  has(got.side === "top", "flips above the button", `stayed ${got.side}`);
  has(
    got.maxHeight >= 210,
    "and has room for the whole menu there, Delete included",
    `only ${Math.round(got.maxHeight)}px`,
  );
  has(
    fits({ ...got, natural: 210 }, viewport, 240),
    "so every item is on the screen",
    `top ${Math.round(got.top)}, height 210, window ${viewport.height}`,
  );
  has(
    got.top + 210 <= anchor.top - GAP + 0.5,
    "and it does not cover the button that opened it",
    `panel ends ${Math.round(got.top + 210)}, button starts ${anchor.top}`,
  );
}

// ── The model list: taller than the room above the composer ───────────────

console.log("\nA list taller than the space it opens into:");
{
  /* A short laptop window with the composer low in it. 520px of models, about
     300px of room above. */
  const viewport = { width: 1440, height: 700 };
  const anchor = at(430, { height: 34, width: 96 });
  const got = placeAnchored({ anchor, viewport, natural: 520, width: 340, side: "top" });

  has(got.side === "top", "stays above, which is where the room is", `went ${got.side}`);
  has(
    got.top >= MARGIN - 0.5,
    "and its first row is on the screen rather than behind the header",
    `top ${Math.round(got.top)}`,
  );
  has(
    got.maxHeight < 520,
    "capped to the room there is",
    `maxHeight ${Math.round(got.maxHeight)} for 520px of content`,
  );
  has(
    Math.abs(got.maxHeight - (anchor.top - GAP - MARGIN)) < 0.5,
    "and capped to exactly that room, not an arbitrary fraction of the window",
    `${Math.round(got.maxHeight)} vs ${anchor.top - GAP - MARGIN}`,
  );
}

// ── It does not flip for the sake of it ───────────────────────────────────

console.log("\nIt keeps the side it was asked for when that side fits:");
for (const [name, side, y] of [
  ["a menu below a control at the top", "bottom", 80],
  ["a list above a control at the bottom", "top", 700],
]) {
  const got = placeAnchored({
    anchor: at(y), viewport: DESKTOP, natural: 240, width: 240, side,
  });
  has(got.side === side, name, `flipped to ${got.side} with room to spare`);
}

// ── Neither side has room ─────────────────────────────────────────────────

console.log("\nA window too short for the panel either way:");
{
  const viewport = { width: 1440, height: 360 };
  const got = placeAnchored({
    anchor: at(170), viewport, natural: 600, width: 240, side: "bottom",
  });
  has(got.maxHeight > 0, "still gets a height to scroll inside", `maxHeight ${got.maxHeight}`);
  has(got.top >= MARGIN - 0.5, "and starts on the screen", `top ${got.top}`);
  has(
    got.top + got.maxHeight <= viewport.height - MARGIN + 0.5,
    "and ends on it",
    `ends ${Math.round(got.top + got.maxHeight)} in ${viewport.height}`,
  );
}

// ── The horizontal edges ──────────────────────────────────────────────────

console.log("\nA right-aligned panel wider than the room beside its control:");
{
  /* The row menu on a phone: a 240px panel right-aligned to a button near the
     right edge of a 390px screen. */
  const anchor = at(300, { x: PHONE.width - 44 });
  const got = placeAnchored({ anchor, viewport: PHONE, natural: 200, width: 240 });
  has(
    got.left >= MARGIN - 0.5,
    "slides in rather than hanging off the left",
    `left ${Math.round(got.left)}`,
  );
  has(
    got.left + 240 <= PHONE.width - MARGIN + 0.5,
    "and does not hang off the right either",
    `ends ${Math.round(got.left + 240)} in ${PHONE.width}`,
  );
}

console.log("\nA left-aligned panel against the left edge:");
{
  const got = placeAnchored({
    anchor: at(300, { x: 2 }), viewport: PHONE, natural: 200, width: 340, align: "left",
  });
  has(got.left >= MARGIN - 0.5, "kept off the left edge", `left ${Math.round(got.left)}`);
}

// ── Every position, both sides, both screens ──────────────────────────────

console.log("\nAnd the invariant holds wherever the control is:");
{
  let broke = null;
  outer: for (const viewport of [DESKTOP, PHONE, { width: 1024, height: 500 }]) {
    for (const side of ["top", "bottom"]) {
      for (const align of ["left", "right"]) {
        for (const natural of [120, 260, 520, 900]) {
          for (let y = 0; y <= viewport.height - 32; y += 8) {
            for (const x of [0, 40, Math.round(viewport.width / 2), viewport.width - 60]) {
              const width = Math.min(340, viewport.width - 2 * MARGIN);
              const got = placeAnchored({
                anchor: at(y, { x }), viewport, natural, width, side, align,
              });
              const height = Math.min(natural, got.maxHeight);
              if (!fits({ ...got, natural: height }, viewport, width)) {
                broke = { viewport, side, align, natural, y, x, got };
                break outer;
              }
            }
          }
        }
      }
    }
  }
  has(broke === null, "the panel is on the screen in every case", broke && JSON.stringify(broke));
}

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
