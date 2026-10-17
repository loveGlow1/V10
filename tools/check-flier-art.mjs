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
  files: [join(root, "src/lib/flyers/art.ts")],
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

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : "\nAll flier art checks passed.");
process.exit(failed ? 1 : 0);
