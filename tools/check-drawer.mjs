/* The phone drawer opens instantly, and stays that way.
 *
 * It used to freeze for up to 2.5s on a phone-speed CPU when opened: it was
 * built from scratch on every open, started a WebGL renderer for the 3D mark,
 * blurred the whole page behind it and pinned the body with position: fixed.
 * Each of those is pinned out here. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync("src/app/dashboard/components/Sidebar.tsx", "utf8");
let failed = 0;
const has = (ok, label) => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}`);
  if (!ok) failed += 1;
};

has(!/\{open && \(/.test(src), "the drawer is always mounted, not built on open");
has(/translate-x-0/.test(src) && /-translate-x-full/.test(src), "opening is a CSS transform");
has(!/<Q3DCanvas(?![^>]*paused=\{!settled\})/.test(src) && /setSettled\(true\)/.test(src), "the 3D mark is held still while the drawer slides");
has(!/fixed inset-0[^"`]*backdrop-blur/.test(src), "no full-screen blur behind the drawer");
has(!/body\.style\.position\s*=\s*"fixed"/.test(src), "the scroll lock does not relayout the page");
has(/inert=\{!open\}/.test(src), "a closed drawer takes no taps or focus");
has(!/bg-panel\/\[0\.\d+\] p-4/.test(src), "the panel is opaque, so the page never shows through");

const css = readFileSync("src/app/globals.css", "utf8");
has(/@media \(max-width: 767px\) \{\s*\.fixed\.inset-0\[class\*="backdrop-blur"\] \{\s*-webkit-backdrop-filter: none !important;\s*backdrop-filter: none !important;/.test(css), "no full-screen blur behind any dialog on a phone");

/* The page behind a dialog never moves. Every full-screen dimmed overlay is
   a marked dialog (the global rule in globals.css then freezes the page) or
   pins the page itself; the drawer has its own lock, above. */
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tsx")) files.push(path);
  }
};
walk("src");
const unlocked = files.filter((file) => {
  if (file.endsWith("Sidebar.tsx")) return false;
  const text = readFileSync(file, "utf8");
  return /fixed inset-0[^"`]*bg-black\//.test(text) && !/aria-modal="true"/.test(text) && !/useBodyScrollLock\(/.test(text);
});
has(unlocked.length === 0, `every dimmed full-screen overlay holds the page still${unlocked.length ? `: ${unlocked.join(", ")}` : ""}`);
has(/html:has\(\[aria-modal="true"\]\),\s*html:has\(\[aria-modal="true"\]\) body \{\s*overflow: hidden;/.test(css), "an open dialog freezes the page under it");
has(/useBodyScrollLock\(shown\)/.test(readFileSync("src/app/dashboard/components/billing/CardWelcome.tsx", "utf8")), "the Add-a-card sheet pins the dashboard behind it");

/* Scrolling the dashboard: nothing heavy runs while it moves. */
const thumb = readFileSync("src/app/dashboard/components/PageThumbnail.tsx", "utf8");
has(/srcDoc=\{stilledHtml/.test(thumb) && /animation-play-state:paused/.test(thumb) && /clearInterval\(i\)/.test(thumb), "a project thumbnail is stilled once drawn, not left running");
has(/rootMargin: "800px"/.test(thumb), "thumbnails are drawn well before they scroll into view");
const inset = readFileSync("src/hooks/use-keyboard-inset.ts", "utf8");
has(/if \(overlap === last\) return;/.test(inset) && /requestAnimationFrame\(write\)/.test(inset), "the keyboard inset restyles the page only when it changes");
has(/requestAnimationFrame\(\(\) => \{\s*frame = 0;\s*read\(\);/.test(readFileSync("src/app/dashboard/components/ScrollToEnds.tsx", "utf8")), "the scroll arrows measure at most once a frame");
has(/<ScrollCalm \/>/.test(readFileSync("src/app/dashboard/layout.tsx", "utf8")) && /html\.qs-scrolling \.qs-edge-glow/.test(css), "decoration pauses while the dashboard scrolls");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
