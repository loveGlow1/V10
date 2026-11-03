#!/usr/bin/env node
/* Sharing a published site: the address follows the name, and the share card
 * follows the page.
 *
 *   npm run check:share
 *
 * lib/publish/share-meta.ts (the card), and the wiring of rename, redirects
 * and Share around it. Offline. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-share");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"] },
  files: [join(root, "src/lib/publish/share-meta.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const S = await import(join(out, "lib/publish/share-meta.js"));
const read = (p) => readFileSync(join(root, p), "utf8");

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

const page = `<!doctype html><html><head><title>JBL</title><meta property="og:title" content="Jimmy Bankz"><meta property="og:url" content="https://old-name.quickstark.tech"></head><body>
<img src="https://images.example/logo.png" alt="">
<img data-hero-photo src="https://images.example/rider.jpg?w=1800&amp;q=80" alt="rider"></body></html>`;
const served = S.withShareMeta(page, { url: "https://jimmy-bankz-logistics.quickstark.tech" });
has(/og:image" content="https:\/\/images\.example\/rider\.jpg\?w=1800&amp;q=80"/.test(served), "the share picture is the page's hero photo, not the first image", served.slice(0, 400));
has(/twitter:card" content="summary_large_image"/.test(served) && /twitter:image/.test(served), "X shows it large");
has((served.match(/og:url/g) ?? []).length === 1 && /og:url" content="https:\/\/jimmy-bankz-logistics/.test(served), "og:url is the address it is served on — the old one is gone");
const own = `<html><head><meta property="og:image" content="https://mine.example/card.png"></head><body><img data-hero-photo src="https://x/y.jpg"></body></html>`;
const ownServed = S.withShareMeta(own, { url: "https://a.quickstark.tech" });
has(/x\/y\.jpg/.test(ownServed) && !/mine\.example/.test(ownServed), "a stale share picture written at build time gives way to the live hero");
const noHero = S.withShareMeta(`<html><head><meta property="og:image" content="https://mine.example/card.png"></head><body><p>hi</p></body></html>`, { url: "https://a" });
has(/mine\.example\/card\.png/.test(noHero) && /summary_large_image/.test(noHero), "a page with no hero keeps its own share picture");
has(S.heroImageOf(`<img fetchpriority="high" src="https://a/b.jpg"><img src="https://c/d.jpg">`) === "https://a/b.jpg", "without a marked hero, the high-priority image is the hero");
has(S.withShareMeta("<p>no head</p>", { url: "https://a" }) === "<p>no head</p>", "a document with no head is left alone");

const serve = read("src/lib/publish/serve.ts");
has(/withShareMeta\(withFlierFit\(publication\.html/.test(serve), "every published page is served with its card, from the live snapshot");
has(/contains\("previous_slugs", \[asked\.slug\]\)[\s\S]{0,300}Response\.redirect\(publishedUrl\(moved\.slug/.test(serve), "an old address redirects to the renamed site");
has(/contains\("previous_slugs", \[wanted\]\)/.test(read("src/app/[slug]/preview/route.ts")), "an old preview link redirects too");
const rename = read("src/app/api/projects/[id]/rename/route.ts");
has(/addressFor\(name, project\.id\)/.test(rename) && /previous_slugs: previous/.test(rename) && /attachPageDomain\(slug\)/.test(rename), "renaming moves the address, keeps the old one, and attaches the new one");
has(/\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/rename/.test(read("src/app/dashboard/ProjectsContext.tsx")), "the app's rename goes through it");
const panel = read("src/app/dashboard/components/workspace/PreviewPanel.tsx");
has(/const shareLink = publicLink \?\?/.test(panel) && /deployed \?\? \(project\.slug \? publishedUrl\(project\.slug\)/.test(panel), "Share hands out a published page's live address, not the private preview");
has(/add column if not exists previous_slugs/.test(read("supabase/schema.sql")), "previous_slugs is in the schema");

console.log(`\n${failed ? `${failed} checks failed.` : "All share checks passed."} (${passed} passed)`);
process.exit(failed ? 1 : 0);
