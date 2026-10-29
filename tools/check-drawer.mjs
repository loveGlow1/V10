/* The phone drawer opens instantly, and stays that way.
 *
 * It used to freeze for up to 2.5s on a phone-speed CPU when opened: it was
 * built from scratch on every open, started a WebGL renderer for the 3D mark,
 * blurred the whole page behind it and pinned the body with position: fixed.
 * Each of those is pinned out here. */

import { readFileSync } from "node:fs";

const src = readFileSync("src/app/dashboard/components/Sidebar.tsx", "utf8");
let failed = 0;
const has = (ok, label) => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}`);
  if (!ok) failed += 1;
};

has(!/\{open && \(/.test(src), "the drawer is always mounted, not built on open");
has(/translate-x-0/.test(src) && /-translate-x-full/.test(src), "opening is a CSS transform");
has(!/Q3DCanvas/.test(src), "no 3D (WebGL) mark inside the drawer");
has(!/fixed inset-0[^"`]*backdrop-blur/.test(src), "no full-screen blur behind the drawer");
has(!/body\.style\.position\s*=\s*"fixed"/.test(src), "the scroll lock does not relayout the page");
has(/inert=\{!open\}/.test(src), "a closed drawer takes no taps or focus");
has(!/bg-panel\/\[0\.\d+\] p-4/.test(src), "the panel is opaque, so the page never shows through");

const css = readFileSync("src/app/globals.css", "utf8");
has(/@media \(max-width: 767px\) \{\s*\.fixed\.inset-0\[class\*="backdrop-blur"\] \{\s*-webkit-backdrop-filter: none !important;\s*backdrop-filter: none !important;/.test(css), "no full-screen blur behind any dialog on a phone");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
