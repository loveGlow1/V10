#!/usr/bin/env node
/* Checks that a downloaded page works with the network unplugged.
 *
 *   npm run check:standalone
 *
 * The failure this guards against does not look like a failure. A page whose
 * styling lives behind cdn.tailwindcss.com renders fine at its URL and renders
 * as raw HTML from a file — same document, no error, no console message,
 * nothing to tell whoever opened it that anything is missing. So the check is
 * blunt: after the transform there must be no remote reference of any kind
 * left, and the utilities the page uses must be present as real CSS.
 *
 * Offline and free. No model call, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-standalone");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  [
    "tsc", "src/lib/standalone-page.ts",
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { toStandalone } = createRequire(import.meta.url)(
  join(out, "standalone-page.js"),
);

/* The shape every generated page has: the CDN script, a config beside it with
   a custom palette, the page's own <style>, then markup using both. */
const PAGE = `<!doctype html>
<html lang="en" class="scroll-smooth">
<head>
<meta charset="utf-8">
<title>The Meridian</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ink: '#12100e', crimson: '#b3232b' },
      fontFamily: { head: ['Georgia','serif'] }
    }
  }
}
</script>
<style>
  .rule{ border-top:1px solid rgba(18,16,14,.14); }
</style>
</head>
<body class="bg-paper font-sans">
  <header class="flex items-center justify-between px-6 py-4">
    <a href="#" class="text-2xl font-head font-bold text-crimson">The Meridian</a>
    <svg class="h-5 w-5 text-ink" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/></svg>
  </header>
  <main class="mx-auto max-w-3xl px-6"><p class="text-sm leading-relaxed">Story.</p></main>
</body>
</html>`;

const checks = [];
const check = (why, ok, detail) => checks.push({ why, ok, detail });

const result = await toStandalone(PAGE);
const html = result.html;

/* The whole point: nothing left that needs fetching. */
check("no Tailwind CDN script remains", !/cdn\.tailwindcss\.com/i.test(html));
check(
  "no remote script, stylesheet or font remains",
  !/(src|href)\s*=\s*["']https?:\/\//i.test(html),
  (html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/i) ?? [])[0],
);
check("the orphaned tailwind.config script is gone", !/tailwind\.config/.test(html));

/* And the styling it replaced is really there. */
check("a stylesheet was compiled in", result.cssBytes > 3000, `${result.cssBytes} bytes`);
check("the custom theme was understood", result.themeApplied === true);
check("a custom colour compiled", /--tw-text-opacity|#b3232b/.test(html) || /\.text-crimson\b/.test(html));
check("the size utility the SVG needs compiled", /\.h-5\b/.test(html) && /\.w-5\b/.test(html));
check("layout utilities compiled", /\.flex\b/.test(html) && /\.max-w-3xl\b/.test(html));
check("preflight compiled, so the SVG is not full-bleed", /svg[^{]*\{[^}]*display:\s*block/i.test(html));
check("the page's own <style> block survives", /border-top:1px solid rgba\(18,16,14,\.14\)/.test(html));
check("the document is still a document", /^<!doctype html>/i.test(html) && /<\/html>\s*$/i.test(html));

/* A page that never used the CDN is left alone rather than padded out. */
const plain = "<!doctype html><html><head><style>body{color:red}</style></head><body>hi</body></html>";
const untouched = await toStandalone(plain);
check("a page without the CDN is returned unchanged", untouched.html === plain && untouched.cssBytes === 0);

/* A config the parser cannot read must cost the palette, never the export. */
const withFn = PAGE.replace("colors: { ink: '#12100e', crimson: '#b3232b' },", "colors: (() => ({}))(),");
const degraded = await toStandalone(withFn);
check(
  "an unreadable config still exports, against the default theme",
  degraded.cssBytes > 3000 && degraded.themeApplied === false && !/cdn\.tailwindcss\.com/i.test(degraded.html),
);


/* Webfonts, which need the network to inline and so are checked only when there
   is one. Skipped rather than failed offline: this suite's promise is that it
   runs anywhere, and a skip that says so is honest where a pass would not be. */
const FONT_PAGE = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
</head><body class="font-bold">Set</body></html>`;

let online = true;
try {
  const ping = await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  online = ping.ok;
} catch {
  online = false;
}

if (online) {
  const fonts = await toStandalone(FONT_PAGE);
  check("the webfont stylesheet is inlined", !/fonts\.googleapis\.com/.test(fonts.html));
  check("the font files come with it", (fonts.html.match(/data:font\/woff2;base64,/g) ?? []).length > 0);
  check("nothing points at the font hosts any more", !/fonts\.gstatic\.com/.test(fonts.html));
  check("the preconnect hints are gone too", !/preconnect/.test(fonts.html));
} else {
  console.log("  skip webfont inlining — no network from here");
}

let failed = 0;
for (const { why, ok, detail } of checks) {
  if (ok) {
    console.log(`  ok   ${why}${detail ? ` (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL ${why}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("");
console.log(`Compiled ${result.cssBytes} bytes of CSS for a page that shipped none.`);
if (failed > 0) {
  console.log(`${failed} of ${checks.length} failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} passed.`);
