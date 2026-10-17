#!/usr/bin/env node
/* Flier art: the key visual behind a flier's type, generated for it.
 *
 *   npm run check:flier-art
 *
 * Offline. The routing in lib/flyers/art.ts is pure and run directly; the
 * provider is run with fake makers; the save route, the flier rules and the
 * standalone flyer API are read as source and held to their guardrails.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-flier-art");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler",
    skipLibCheck: true, strict: true, types: ["node"], typeRoots: [join(root, "node_modules", "@types")],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  files: [join(root, "src/lib/flyers/art.ts"), join(root, "src/lib/flyers/fit.ts"), join(root, "src/lib/flyers/router.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
(function fix(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { fix(path); continue; }
    if (!entry.endsWith(".js")) continue;
    writeFileSync(path, readFileSync(path, "utf8")
      .replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_, a, spec, b) => {
        let rel = relative(dirname(path), join(out, spec)).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return `${a}${rel}${b}`;
      })
      .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, a, spec, b) => (spec.endsWith(".js") ? whole : `${a}${spec}.js${b}`)));
  }
})(join(out, "lib"));
const A = await import(join(out, "lib/flyers/art.js"));
const Fit = await import(join(out, "lib/flyers/fit.js"));
const Router = await import(join(out, "lib/flyers/router.js"));

let failed = 0;
const has = (cond, t, d) => {
  if (cond) console.log(`ok    ${t}`);
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${JSON.stringify(d)}` : ""}`); }
};

const keys = { IDEOGRAM_API_KEY: "i", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" };
has(A.artStyle("bold geometric shapes, risograph texture, neon gradient") === "graphic", "poster art, patterns and textures read as graphic");
has(A.artStyle("a chef plating jollof rice, warm restaurant light") === "photo", "a scene with people and food reads as photo");
has(A.artChain("graphic", keys).join() === "ideogram,openai,gemini", "graphic: Ideogram 3 first");
has(A.artChain("photo", keys).join() === "openai,gemini,ideogram", "photo: gpt-image-2 first");
has(A.artChain("photo", { IDEOGRAM_API_KEY: "i" }).join() === "ideogram", "only connected makers are tried");
has(A.artChain("photo", { ...keys, FLIER_ART: "stock" }).length === 0, "FLIER_ART=stock keeps fliers on Unsplash");
has(A.formatFor("1080/1920") === "story" && A.formatFor("794/1123") === "portrait" && A.formatFor("1/1") === "square" && A.formatFor("16/9") === "landscape", "the picture is made at the canvas's own shape");
const prompt = A.artPrompt({ shot: "sunset over Accra skyline, warm orange palette, calm sky top third", alt: "" }, "photo");
has(/Accra skyline/.test(prompt) && /no text, letters, numbers, words, logos/i.test(prompt), "the art is the builder's direction, and never carries lettering");
has(A.isFlier('<div data-qs-flier class="canvas">') && !A.isFlier("<main>"), "a flier is recognised by its canvas marker");

/* The provider: generated first, the library after, at most MAX_ART pictures. */
const library = { name: "lib", shotFor: async () => ({ id: "unsplash:1", bytes: Buffer.from("x"), contentType: "image/jpeg" }) };
const none = A.flierArtProvider(library, {});
const shot = await none.shotFor({ tag: "", shot: "a beach", alt: "", ratio: "4/5", weight: "hero", focal: "", fit: "cover" }, 1200);
has(shot?.id === "unsplash:1" && none.made() === 0, "with no image model connected, Unsplash fills the slot and nothing is charged");
has(A.MAX_ART >= 1 && A.ART_COST > 0, "art is capped per flier and priced per picture");

const save = readFileSync(join(root, "src/app/api/builder/webapp/save/route.ts"), "utf8");
has(/isFlier\(html\) \? flierArtProvider\(providerFromEnv\(\)\)/.test(save), "the save step uses flier art only on a flier canvas, with Unsplash behind it");
has(/cost: artMade \* ART_COST/.test(save) && /dedupeKey: `flier-art:/.test(save), "charged per picture made, once per build");
const rules = readFileSync(join(root, "src/lib/builder/targets.ts"), "utf8");
has(/data-qs-flier/.test(rules) && /data-weight=\\"hero\\"/.test(rules) && /every word on the flier is HTML text/.test(rules), "the flier rules declare the art slot and keep every word in HTML");
const api = readFileSync(join(root, "src/app/api/flyers/route.ts"), "utf8");
const run = readFileSync(join(root, "src/lib/flyers/run.ts"), "utf8");
has(/currentBalance/.test(api) && /status: 402/.test(api), "the flyer API checks the balance before it makes anything");
has(/dedupeKey: `flyer:\$\{jobId\}`/.test(run) && /flyerJobCost\(stage, outputs\.length\)/.test(run), "and charges once, for the images that arrived");

/* Fit: a flier shrinks as a picture on a small screen. */
const older = '<div id="flier"></div><button>Download PNG</button><span>1200 × 628 px</span></body></html>';
has(Fit.looksLikeFlier(older) && Fit.looksLikeFlier('<div data-qs-flier>') && !Fit.looksLikeFlier("<main><h1>Bakery</h1></main>"), "fliers are recognised, including ones made before the marker");
const fitted = Fit.withFlierFit(older);
has(fitted.includes(Fit.FIT_MARK) && fitted.indexOf(Fit.FIT_MARK) < fitted.indexOf("</body>"), "the fit script goes in before </body>");
has(Fit.withFlierFit(fitted) === fitted && Fit.withFlierFit("<main>site</main>") === "<main>site</main>", "once, and never on a page that is not a flier");
has(/scaler\.appendChild\(canvas\)/.test(fitted) && !/canvas\.style\.transform/.test(fitted), "the wrapper is scaled, never the canvas, so Download PNG still exports full size");
const preview = readFileSync(join(root, "src/app/preview/[projectId]/route.ts"), "utf8");
const serve = readFileSync(join(root, "src/lib/publish/serve.ts"), "utf8");
has(/withFlierFit\(withSinglePageEdit\(/.test(preview) && /withFlierFit\(publication\.html/.test(serve) && /html = withFlierFit\(html\)/.test(save), "applied in the preview, the published site and the stored page");
has(/data-width and data-height/.test(rules), "the flier rules build the canvas at its exact size");

/* The download: the platform's, clean, high resolution, to Photos on a phone. */
has(/addEventListener\('click', onClick, true\)/.test(fitted) && /stopImmediatePropagation\(\)/.test(fitted), "Download PNG is taken over before the page's own handler");
has(/pixelRatio: ratio/.test(fitted) && /Math\.min\(2, 4096/.test(fitted), "exported at twice the design size, capped at 4096px");
has(/borderRadius: '0', boxShadow: 'none'/.test(fitted), "a clean image: square corners, no shadow, the canvas only");
has(/navigator\.share\(\{ files: \[file\]/.test(fitted) && /a\.download = fileName\(\)/.test(fitted), "the share sheet on a phone (Save Image → Photos), a file download on a computer");
has(/Save image/.test(fitted), "if the tap expires while the image is made, one more tap saves it");
has(fitted.includes(Fit.HTML_TO_IMAGE) && /@\d+\.\d+\.\d+\//.test(Fit.HTML_TO_IMAGE), "the renderer is a pinned version");
const panel = readFileSync(join(root, "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
has(/sandbox allow-scripts allow-forms allow-popups allow-downloads/.test(preview) && /allow-downloads/.test(serve), "downloads are allowed by the preview's and the published site's sandbox");
has((panel.match(/allow-downloads/g) ?? []).length >= 3 && /allow="web-share"/.test(panel), "and by the workspace frame, with the share sheet allowed");

/* The Fliers tab is image generation, not the website builder. */
const home = readFileSync(join(root, "src/app/dashboard/page.tsx"), "utf8");
const start = readFileSync(join(root, "src/app/dashboard/components/StartBuildButton.tsx"), "utf8");
const flyersApi = readFileSync(join(root, "src/app/api/flyers/route.ts"), "utf8");
const briefSrc = readFileSync(join(root, "src/lib/flyers/brief.ts"), "utf8");
has(/flier=\{activeCategory === "fliers"/.test(home) && /if \(flier\) \{[\s\S]{0,200}fetch\("\/api\/flyers"/.test(start) && /router\.push\(`\/dashboard\/fliers\//.test(start), "the Fliers tab opens the Flier Studio, never a website workspace");
has(/requestFromBrief\(/.test(flyersApi) && /stage === 'final' && typeof raw\.parentJobId === 'string'/.test(flyersApi), "the flier API takes a plain brief, and makes a final from a chosen draft");
has(/currentBalance/.test(flyersApi) && !/FLYERS_API_ENABLED === '1'/.test(flyersApi), "on by default now a screen uses it, with the balance checked first");
has(/Never invent facts/.test(briefSrc) && /heuristicRequest/.test(briefSrc), "the brief is read without inventing facts, with a fallback when the model is unavailable");
const chain = Router.providerChain({ brand: { name: "x", colors: { primary: "#000000" } }, spec: { headline: "h", format: "square", textMode: "ai" }, stage: "preview" }, { OPENAI_API_KEY: "o" });
has(chain.join() === "gpt-image-2", "only connected image models are tried", chain);
const review = readFileSync(join(root, "src/lib/builder/review-round.ts"), "utf8");
const buildRoute = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
has(/html\.ilike\.\*data-qs-flier\*/.test(review), "a flier is never given the website review round");
has(/if \(service && !freeReview\) \{\s*await recordMessage\(service, \{\s*projectId: project\.id,\s*userId: user\.id,\s*role: "you"/.test(buildRoute), "the review round's own instruction is never shown as the person's message");

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : "\nAll flier art checks passed.");
process.exit(failed ? 1 : 0);
