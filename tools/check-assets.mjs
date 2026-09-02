#!/usr/bin/env node
/* Checks the asset pipeline without a provider, a key or a network.
 *
 *   npm run check:assets
 *
 * Everything this covers fails silently. A planner that stops inheriting the
 * visual direction gives you eight images that each look fine; a priority
 * ladder that stops preferring an upload replaces somebody's logo with a stock
 * photograph; a fingerprint that stops being stable pays twice for the same
 * picture every build. None of those throw, and none of them are visible in a
 * single page — which is exactly why they are worth a test.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-assets");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/assets/asset-planner.ts"),
      join(process.cwd(), "src/lib/builder/blueprints/index.ts"),
      join(process.cwd(), "src/lib/builder/assets/asset-resolver.ts"),
      join(process.cwd(), "src/lib/builder/assets/asset-optimizer.ts"),
      join(process.cwd(), "src/lib/builder/assets/asset-library.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  /* tsc leaves "@/" specifiers alone, so they are rewritten to relative paths
     before node is asked to load any of it. */
  const rewrite = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { rewrite(path); continue; }
      if (!path.endsWith(".js")) continue;
      const depth = path.slice(out.length + 1).split("/").length - 1;
      const prefix = depth === 0 ? "./" : "../".repeat(depth);
      writeFileSync(path, readFileSync(path, "utf8").replace(
        /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          /* A bare directory import — "@/lib/builder/blueprints" — is the
             package's index, and node will not find it by appending .js. */
          const asFile = join(out, `${rest}.js`);
          const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
          return `${q}${prefix}${target}${q}`;
        }));
    }
  };
  rewrite(out);

  const planner = await import(join(out, "lib/builder/assets/asset-planner.js"));
  const resolver = await import(join(out, "lib/builder/assets/asset-resolver.js"));
  const optimizer = await import(join(out, "lib/builder/assets/asset-optimizer.js"));
  const library = await import(join(out, "lib/builder/assets/asset-library.js"));

  // ── The visual direction ────────────────────────────────────────────────
  const luxury = planner.planDirection("ecommerce", "a luxury skincare store");
  const craft = planner.planDirection("ecommerce", "a small-batch handmade soap store");
  is(luxury.register, "luxury editorial", "a brief that says luxury gets the luxury register");
  is(craft.register, "warm documentary", "and one that says handmade gets a different one");
  is(luxury.register !== planner.planDirection("ecommerce", "a store").register, true,
     "a brief that says neither gets the kind's own default, not the luxury one");
  is(luxury.avoid.length >= 5, true, "every direction forbids the tells of a generated image");

  // ── The plan ────────────────────────────────────────────────────────────
  const store = planner.planAssets({ kind: "ecommerce", brief: "a luxury skincare store" });
  const app = planner.planAssets({ kind: "webapp", brief: "a CRM for a sales team" });
  const blog = planner.planAssets({ kind: "blog", brief: "a blog about woodworking" });

  is(store.requests.filter((r) => r.type === "product").length >= 8, true,
     "a storefront plans at least as many product photographs as its blueprint requires");
  is(app.requests.every((r) => !r.spec), true,
     "a web app plans no photographs at all — every slot it has is drawn");
  is(blog.requests.filter((r) => r.type === "article-cover").length >= 7, true,
     "a blog plans a cover for the lead story and every article");

  const specs = store.requests.filter((r) => r.spec).map((r) => r.spec);
  is(new Set(specs.map((s) => s.lighting)).size, 1, "every picture in a project inherits one lighting");
  is(new Set(specs.map((s) => s.style)).size, 1, "and one style, which is what makes them look like one shoot");
  is(specs.every((s) => s.text === false && s.watermark === false), true,
     "no spec ever asks for text or a watermark inside an image");
  is(specs[0].subject.includes("luxury skincare"), true, "the subject comes from the brief");

  // ── Reuse ───────────────────────────────────────────────────────────────
  const a = library.fingerprint(specs[0]);
  const b = library.fingerprint({ ...specs[0] });
  const c = library.fingerprint({ ...specs[0], subject: "something else" });
  is(a === b, true, "the same request fingerprints the same way twice");
  is(a !== c, true, "and a different one does not");

  // ── The priority ladder ─────────────────────────────────────────────────
  const plan = planner.planAssets({ kind: "landing", brief: "a landing page for a gym" });
  const ready = (over) => ({
    id: "x", projectId: "p", status: "ready", quality: "premium",
    createdAt: new Date().toISOString(), ...over,
  });

  const withUpload = await resolver.resolveAssets({
    projectId: "p", plan, providers: [],
    library: { assets: [ready({ type: "hero", source: "user", url: "https://theirs/hero.jpg" })] },
  });
  is(withUpload.manifest.assets.hero, "https://theirs/hero.jpg", "an uploaded asset wins the slot");
  is(withUpload.used.user, 1, "and is counted as theirs, not as something we made");

  const existing = await resolver.resolveAssets({
    projectId: "p", plan, providers: [],
    library: { assets: [ready({
      type: "hero", source: "generated", url: "https://ours/hero.jpg",
      prompt: library.fingerprint(plan.requests.find((r) => r.slot === "hero").spec),
    })] },
  });
  is(existing.manifest.assets.hero, "https://ours/hero.jpg", "an asset this project already made is reused");
  is(existing.used.reused, 1, "and is not paid for again");

  const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64");
  const stub = {
    name: "stub", kind: "generative",
    async generate() {
      return { id: "j", status: "ready", image: { bytes: PIXEL, contentType: "image/png", width: 1600, height: 900, provider: "stub" } };
    },
  };
  const made = await resolver.resolveAssets({ projectId: "p", plan, providers: [stub], library: { assets: [] } });
  is(made.used.made > 0, true, "with nothing to reuse, assets are made");
  is(made.manifest.assets.hero.startsWith("data:image/png;base64,"), true, "and land in the manifest");
  is(made.created.every((asset) => asset.status === "ready"), true, "each one recorded as ready");

  // ── Failure ─────────────────────────────────────────────────────────────
  const angry = { name: "angry", kind: "generative", async generate() { throw new Error("429"); } };
  const broke = await resolver.resolveAssets({ projectId: "p", plan, providers: [angry], library: { assets: [] } });
  is(broke.manifest.unresolved.length > 0, true, "a provider that throws leaves slots unresolved");
  is(broke.created.every((asset) => asset.status === "failed"), true, "recorded as failed, not as ready");
  is(Object.keys(broke.manifest.assets).length, plan.requests.length, "and every slot still appears in the manifest");

  const fallback = await resolver.resolveAssets({
    projectId: "p", plan, providers: [angry, stub], library: { assets: [] },
  });
  is(fallback.used.made > 0, true, "a second provider is tried when the first fails");

  const none = await resolver.resolveAssets({ projectId: "p", plan, providers: [], library: { assets: [] } });
  is(none.manifest.unresolved.length, plan.requests.length, "with no provider at all, everything is unresolved");
  is(none.manifest.direction.register.length > 0, true, "and the direction still reaches the code generator");

  // ── What the code generator is told ─────────────────────────────────────
  const text = resolver.manifestForPrompt(made.manifest);
  is(text.includes("use these exact URLs and no others"), true, "the manifest forbids inventing an address");
  is(text.includes("VISUAL DIRECTION"), true, "and carries the direction so the design matches the pictures");
  const emptyText = resolver.manifestForPrompt(none.manifest);
  is(emptyText.includes("never an SVG drawing of what the photograph would have shown"), true,
     "an unresolved slot is told to be a panel, not a drawing of the subject");

  // ── Delivery ────────────────────────────────────────────────────────────
  const delivery = optimizer.deliveryFor("https://cdn/a.webp", { maxDisplayWidth: 640, quality: "premium", aboveTheFold: true });
  is(delivery.loading, "eager", "the hero is not lazy-loaded");
  is(delivery.srcset.split(",").length > 1, true, "an image is offered at several widths");
  is(optimizer.deliveryFor("https://cdn/a.webp", { maxDisplayWidth: 320, quality: "premium" }).loading, "lazy",
     "and everything below the fold waits its turn");
  is(optimizer.transformed("data:image/png;base64,AAAA", 320, "premium"), "data:image/png;base64,AAAA",
     "an inline image is left alone rather than given a transform it cannot take");

  console.log(`\n${failed === 0 ? "All checks passed." : `${failed} failed.`}`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
