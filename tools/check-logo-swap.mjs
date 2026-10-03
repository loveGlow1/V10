#!/usr/bin/env node

/* The logo swap: "use this as the logo" done without a model.
 *
 * What it has to get right is mostly what it must NOT touch — the partner
 * logos in a "trusted by" strip are named logo too, and swapping the
 * customer's own mark into every one of them is the worst outcome there is.
 * See src/lib/builder/logo-swap.ts. */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-logo-swap");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/builder/logo-swap.ts")],
    },
    null,
    2,
  ),
);
execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });

const require = createRequire(import.meta.url);
const { asksForLogoSwap, swapLogo, swapLogoInTree, asksForLogoResize, resizeLogo, resizeLogoInTree, resizeScope, describeResize } = require(join(out, "lib/builder/logo-swap.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));
const count = (text, needle) => text.split(needle).length - 1;

/* ── Reading the request ─────────────────────────────────────────────────── */
for (const message of [
  "Update the logo with a different logo image",
  "use this as my logo",
  "replace the logo",
  "change logo",
  "Change these exact elements (picked in the visual editor):\n1. <svg> in components/Logo.tsx line 3: update logo",
  "put our new logo in the header",
  "replace the logo with this, the old one is too big",
  "logo",
  "new logo",
  "logo update",
  "change the logo",
  "here's the logo",
  "fix the logo",
  "logo pls",
  "can you change our logo",
  "lgo",
  "loog change",
]) {
  has(asksForLogoSwap(message, 1), `a swap: "${message.split("\n").pop()}"`);
}
for (const message of ["make the logo bigger", "move the logo to the left", "change the logo colour to green", "remove the logo", "make my logo smaller", "add a shadow to the logo", "center the logo", "add a log in button"]) {
  has(!asksForLogoSwap(message, 1), `not a swap, the model's job: "${message}"`);
}
has(!asksForLogoSwap("update the logo", 0), "no picture attached, no swap");
has(!asksForLogoSwap("use this picture in the hero", 1), "a picture that is not a logo is not a swap");
has(asksForLogoSwap("update this", 1, ["IMG_logo_final.png"]), "a file named as a logo makes \"update this\" a swap");
has(!asksForLogoSwap("update this", 1, ["IMG_8017.png"]), "an unnamed picture with \"update this\" is the model's to read");

/* ── A page ──────────────────────────────────────────────────────────────── */
const page = `<!doctype html><html><head><title>Neuralis Systems — AI</title><link rel="icon" href="/old.ico"></head><body>
<header class="site-header">
  <a href="#" class="brand"><span class="dot"></span>NEURALIS <span class="muted">SYSTEMS</span></a>
  <nav><a href="#services">Services</a><a href="#contact">Contact</a></nav>
</header>
<div id="mobile-menu" class="hidden"><a href="/" class="logo"><svg class="logo-mark" width="24" height="24"><rect/></svg></a></div>
<main>
  <section class="trusted"><h2>Trusted by</h2>
    <div class="logo-grid"><img class="logo" src="acme.png" alt="Acme"><img class="logo" src="globex.png" alt="Globex"></div>
  </section>
  <section class="clients"><img class="client-logo" src="initech.png" alt="Initech"></section>
</main>
<footer><div class="footer-logo">NEURALIS</div><p>© 2026</p></footer>
</body></html>`;

const swap = swapLogo(page, "attachment:1");
has(swap !== null, "a page with a named logo is swapped");
if (swap) {
  has(swap.swapped === 3, `the header, the mobile menu and the footer — three places (got ${swap.swapped})`);
  has(swap.where.includes("header") && swap.where.includes("footer") && swap.where.includes("mobile menu"), `and it says where: ${swap.where.join(", ")}`);
  has(swap.source.includes('<a href="#" class="brand"><img src="attachment:1"'), "the header link keeps its tag and its href, the picture goes inside");
  has(!swap.source.includes("NEURALIS <span"), "and the old wordmark is gone");
  has(swap.source.includes('src="acme.png"') && swap.source.includes('src="globex.png"'), "THE PARTNER LOGOS ARE UNTOUCHED");
  has(swap.source.includes('src="initech.png"'), "and so is a client logo");
  has(swap.source.includes('alt="NEURALIS SYSTEMS logo"'), "alt text comes from what the logo said");
  has(swap.source.includes('<link rel="icon" href="attachment:1">') && !swap.source.includes("old.ico"), "the browser tab icon is the logo too");
  has(swap.where.includes("browser tab"), "and that is reported");
  has(count(swap.source, "<main>") === 1 && swap.source.includes("<h2>Trusted by</h2>"), "everything else is byte-for-byte where it was");
}

const capped = swapLogo(page, "attachment:1", { maxCopies: 1, favicon: false });
has(capped && capped.swapped === 1 && capped.where[0] === "header", "a large picture is written once, in the header first");

const bare = `<html><head></head><body><header><a href="/"><b>Acme</b> Co</a><nav><a href="/about">About</a></nav></header><main><p>hi</p></main></body></html>`;
const fallback = swapLogo(bare, "attachment:1");
has(fallback && fallback.swapped === 1 && fallback.source.includes('<a href="/"><img src="attachment:1"'), "nothing named logo: the link home in the header is the logo");

const imgLogo = `<html><head></head><body><header><img class="logo h-8" src="old.png" srcset="old@2x.png 2x" alt="Acme"></header></body></html>`;
const imgSwap = swapLogo(imgLogo, "attachment:1");
has(imgSwap && imgSwap.source.includes('class="logo h-8"') && imgSwap.source.includes('src="attachment:1"') && !imgSwap.source.includes("srcset"), "an <img> logo keeps its classes, gets the new picture, loses the old srcset");

const none = `<html><body><main><h1>No header here</h1><div class="logos"><img class="logo" src="a.png"></div></main></body></html>`;
has(swapLogo(none, "attachment:1") === null, "no logo of its own anywhere: null, so the model is asked rather than this guessing");

/* ── A project ───────────────────────────────────────────────────────────── */
const tree = [
  { path: "components/Logo.tsx", content: `export default function Logo({ className }: { className?: string }) {\n  return <svg className={className} viewBox="0 0 10 10"><rect/></svg>;\n}\n` },
  { path: "components/Header.tsx", content: `import Logo from "./Logo";\nexport function Header() {\n  return <header><Link href="/"><Logo className="h-8" /></Link></header>;\n}\n` },
  { path: "app/page.tsx", content: `export default function Page() { return <main><div className="logos"><img className="logo" src="/a.png" /></div></main>; }` },
];
const treeSwap = swapLogoInTree(tree, "data:image/png;base64,AAAA", "Aurelia Estates");
has(treeSwap !== null, "a project with a Logo component is swapped");
if (treeSwap) {
  has(treeSwap.paths.length === 1 && treeSwap.paths[0] === "components/Logo.tsx", `only the Logo component changes (${treeSwap.paths.join(", ")})`);
  const logo = treeSwap.files[0].content;
  has(/export default Logo;/.test(logo) && /function Logo\(/.test(logo), "it is still the default export called Logo, so every import resolves");
  has(logo.includes("data:image/png;base64,AAAA") && logo.includes('alt="Aurelia Estates logo"'), "and it draws the uploaded picture");
  has(logo.includes("className={className}"), "and still takes the className its callers size it with");
}

const named = swapLogoInTree([{ path: "components/brand/SiteLogo.tsx", content: `"use client";\nexport function SiteLogo() { return <span>Acme</span>; }\n` }], "data:x", null);
has(named && /^"use client";/.test(named.files[0].content) && /export function SiteLogo\(/.test(named.files[0].content) && !/export default/.test(named.files[0].content), "a named export stays a named export, and \"use client\" is kept");

const inline = swapLogoInTree([{ path: "components/Navbar.tsx", content: `export function Navbar() {\n  return <nav><a href="/" className="logo font-bold">Acme</a><a href="/about">About</a></nav>;\n}\n` }], "data:x", "Acme");
has(inline && inline.files[0].content.includes('<a href="/" className="logo font-bold"><img src="data:x" alt="Acme logo"') && inline.files[0].content.includes("style={{ height: 44"), "no Logo component: the inline mark in the navbar is swapped, written as JSX");

has(swapLogoInTree([{ path: "app/page.tsx", content: "<main/>" }], "data:x") === null, "a project with no logo anywhere: null");

/* ── Resizing ─────────────────────────────────────────────────────────────
 *
 * "Make the logo bigger" kept coming back at the same size: the swap sets the
 * height inline and the model's classes could never beat it. */
const reads = [
  ["make the logo bigger", "scale", 1.4],
  ["logo a lot bigger", "scale", 1.75],
  ["make the logo much larger", "scale", 1.75],
  ["logo slightly bigger", "scale", 1.2],
  ["increase the logo size", "scale", 1.4],
  ["the logo is too small", "scale", 1.5],
  ["logo looks tiny", "scale", 1.5],
  ["make the logo smaller", "scale", 0.72],
  ["logo a bit smaller", "scale", 0.85],
  ["logo is too big", "scale", 0.7],
  ["double the logo", "scale", 2],
  ["logo 1.5x", "scale", 1.5],
  ["make the logo 50% bigger", "scale", 1.5],
  ["logo 30% smaller", "scale", 0.7],
  ["make the logo 64px", "absolute", 64],
  ["logo height 80", "absolute", 80],
  ["make the logo large", "absolute", 64],
  ["set the logo size to extra large", "absolute", 88],
  ["logo size medium", "absolute", 48],
];
for (const [message, kind, value] of reads) {
  const got = asksForLogoResize(message);
  const actual = got ? (got.kind === "absolute" ? got.px : Math.round(got.factor * 100) / 100) : null;
  has(got && got.kind === kind && actual === value, `"${message}" → ${kind} ${value}`, `got ${JSON.stringify(got)}`);
}
has(asksForLogoResize("make the heading bigger") === null, "bigger, without the logo named, is not about the logo");
has(asksForLogoResize("update the logo") === null, "a logo message with no size in it is not a resize");
has(resizeScope("make the footer logo bigger") === "footer" && resizeScope("bigger logo in the header") === "header" && resizeScope("logo bigger") === null, "footer only, header only, or both");

if (swap) {
  const placed = swap.source.split("attachment:1").join("data:image/png;base64,AAAA");
  const bigger = resizeLogo(placed, asksForLogoResize("make the logo bigger"));
  has(bigger !== null, "a swapped logo can be resized");
  if (bigger) {
    const header = bigger.sizes.find((size) => size.where === "header");
    has(header && header.from === 44 && header.to === 62, `header 44px → 62px (${describeResize(bigger.sizes)})`);
    has(bigger.source.includes("height:62px") && !bigger.source.includes("height:44px"), "the inline height — the one that wins — is what changes");
    has(bigger.source.includes("max-width:372px"), "and the width cap grows with it, so a wide logo is not squeezed");
    const again = resizeLogo(bigger.source, asksForLogoResize("logo a lot bigger"));
    const header2 = again && again.sizes.find((size) => size.where === "header");
    has(header2 && header2.from === 62 && header2.to === 109, `asked again, it grows again: ${header2 && header2.from}px → ${header2 && header2.to}px`);
    const exact = resizeLogo(placed, asksForLogoResize("make the logo 72px"));
    has(exact && exact.sizes.every((size) => size.to === 72), "an exact size is exact, everywhere");
    const footerOnly = resizeLogo(placed, asksForLogoResize("make the footer logo smaller"), { only: "footer" });
    has(footerOnly && footerOnly.sizes.length === 1 && footerOnly.sizes[0].where === "footer" && footerOnly.sizes[0].to === 26, "the footer alone, when the footer is named");
    has(placed.includes('src="acme.png"') && bigger.source.includes('src="acme.png"'), "partner logos are never resized");
  }
}

const classed = resizeLogo(`<html><body><header><a href="/" class="logo"><img class="h-8 w-auto" src="l.png" alt="L"></a></header></body></html>`, asksForLogoResize("logo bigger"));
has(classed && classed.sizes[0].from === 32 && classed.sizes[0].to === 45 && classed.source.includes("height:45px"), "a Tailwind h-8 logo is read as 32px and set inline, where it wins");
const wordmark = resizeLogo(`<html><body><header><a href="/" class="brand text-xl font-bold">ACME</a></header></body></html>`, asksForLogoResize("make the logo bigger"));
has(wordmark && wordmark.source.includes("font-size:28px"), "a logo that is only words gets bigger words");

const comp = swapLogoInTree(tree, "data:image/png;base64,AAAA", "Aurelia Estates");
const compTree = tree.map((file) => comp.files.find((f) => f.path === file.path) ?? file);
const treeBigger = resizeLogoInTree(compTree, asksForLogoResize("make the logo much bigger"));
has(treeBigger && treeBigger.paths[0] === "components/Logo.tsx" && /height = 77,/.test(treeBigger.files[0].content), "on a project, the Logo component's own height goes 44 → 77");
const svgTree = resizeLogoInTree(tree, asksForLogoResize("logo 2x"));
has(svgTree && svgTree.files[0].content.includes("style={{ height: 88"), "an SVG Logo component never swapped is resized too");

console.log(`\n${failed === 0 ? "All logo swap checks passed." : `${failed} failed.`}`);
process.exit(failed === 0 ? 0 : 1);
