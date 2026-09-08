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
      join(process.cwd(), "src/lib/builder/assets/providers/registry.ts"),
      join(process.cwd(), "src/lib/builder/assets/asset-intake.ts"),
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
      writeFileSync(path, readFileSync(path, "utf8")
        .replace(
          /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
            /* A bare directory import — "@/lib/builder/blueprints" — is the
               package's index, and node will not find it by appending .js. */
            const asFile = join(out, `${rest}.js`);
            const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
            return `${q}${prefix}${target}${q}`;
          })
        /* And the relative ones, which tsc also leaves as written. Missing
           here while every other checker in this directory had it, so this
           check stopped running the moment any module it loads grew a
           relative import — which design.ts did, when its dark-colour test
           was moved into qa/contrast. A checker that cannot start is a
           checker that is not checking anything. */
        .replace(
          /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
          (whole, before, specifier, after) =>
            specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
        ));
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

  // ── Providers: the resilience requirement ───────────────────────────────
  const registry = await import(join(out, "lib/builder/assets/providers/registry.js"));

  /* The state that matters most: nothing configured at all. Every external key
     absent, the curated library unpopulated. This must be silent and it must
     still build. */
  for (const key of ["UNSPLASH_ACCESS_KEY", "PEXELS_API_KEY", "CURATED_ASSETS_BASE_URL", "AI_IMAGE_ENDPOINT", "AI_IMAGE_API_KEY", "AI_IMAGE_ENABLED", "ASSET_PROVIDER_ORDER"]) {
    delete process.env[key];
  }

  const bare = await registry.providerStatus({ assets: [] });
  is(bare.length, 5, "every provider reports a status, configured or not");
  is(bare.find((p) => p.id === "project").health, "available", "project assets are always available");
  is(bare.find((p) => p.id === "curated").health, "misconfigured", "an unpopulated library says so rather than serving 404s");
  is(bare.find((p) => p.id === "unsplash").health, "misconfigured", "a missing key is misconfigured, not an error");
  is(bare.find((p) => p.id === "ai").health, "disabled", "generation is off until somebody turns it on");

  const bareChain = await registry.usableProviders({ assets: [] });
  is(bareChain.length, 1, "with nothing configured the chain is project assets alone");
  is(bareChain[0].id, "project", "and that is the source that needs no configuration");

  /* The curated library, populated, must carry a project by itself. */
  process.env.CURATED_ASSETS_BASE_URL = "https://assets.example.test/curated";
  const curatedChain = await registry.usableProviders({ assets: [] });
  is(curatedChain.map((p) => p.id).join(","), "project,curated",
     "a populated library joins the chain with no API key anywhere");

  const restaurant = planner.planAssets({ kind: "landing", brief: "a luxury restaurant in Denver" });
  const fromLibrary = await resolver.resolveAssets({
    projectId: "p", plan: restaurant, library: { assets: [] }, providers: curatedChain,
  });
  is(fromLibrary.unresolved < restaurant.requests.length, true,
     "and it actually fills slots — the library alone produces a visual page");
  is(fromLibrary.bySource.curated > 0, true, "with photographs that came from us");
  is(Object.values(fromLibrary.manifest.assets).some((url) => url.startsWith("https://assets.example.test/")), true,
     "served from the configured base rather than an invented address");

  /* Two products must not be the same photograph. */
  const shop = planner.planAssets({ kind: "ecommerce", brief: "a luxury skincare store" });
  const shopFilled = await resolver.resolveAssets({
    projectId: "p", plan: shop, library: { assets: [] },
    providers: await registry.usableProviders({ assets: [] }),
  });
  const productUrls = Object.entries(shopFilled.manifest.assets)
    .filter(([slot, url]) => slot.startsWith("product-") && url)
    .map(([, url]) => url);
  is(new Set(productUrls).size, productUrls.length,
     "a catalogue never shows the same curated photograph twice");

  // ── Order and cost are configuration ────────────────────────────────────
  process.env.ASSET_PROVIDER_ORDER = "curated,project";
  is((await registry.usableProviders({ assets: [] })).map((p) => p.id).join(","), "curated,project",
     "the chain order is configuration, not code");
  delete process.env.ASSET_PROVIDER_ORDER;

  process.env.AI_IMAGE_ENABLED = "true";
  process.env.AI_IMAGE_ENDPOINT = "https://ai.example.test/v1";
  process.env.AI_IMAGE_API_KEY = "test";
  const withAi = await registry.usableProviders({ assets: [] });
  is(withAi.some((p) => p.id === "ai"), true, "an enabled generative provider joins the chain");
  const cheapOnly = await registry.usableProviders({ assets: [] }, { maxCost: "free" });
  is(cheapOnly.some((p) => p.id === "ai"), false, "and a cost ceiling keeps it out of a build that cannot afford it");
  is(cheapOnly.every((p) => p.cost === "free"), true, "leaving only the free sources");
  delete process.env.AI_IMAGE_ENABLED;

  /* Disabling by name, without unsetting the key. */
  process.env.CURATED_LIBRARY_ENABLED = "false";
  is((await registry.providerStatus({ assets: [] })).find((p) => p.id === "curated").health, "disabled",
     "a provider can be switched off without removing its configuration");
  delete process.env.CURATED_LIBRARY_ENABLED;

  // ── No key ever reaches the generated project ───────────────────────────
  process.env.UNSPLASH_ACCESS_KEY = "secret-key-value";
  const leaky = await resolver.resolveAssets({
    projectId: "p", plan: restaurant, library: { assets: [] },
    providers: await registry.usableProviders({ assets: [] }),
  });
  const rendered = resolver.manifestForPrompt(leaky.manifest);
  is(rendered.includes("secret-key-value"), false, "no provider key appears in what the code generator is given");
  is(JSON.stringify(leaky.manifest).includes("secret-key-value"), false, "nor anywhere in the manifest");
  delete process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.CURATED_ASSETS_BASE_URL;

  // ── The priority ladder, now walked through providers ───────────────────
  const plan = planner.planAssets({ kind: "landing", brief: "a landing page for a gym" });
  const ready = (over) => ({
    id: "x", projectId: "p", status: "ready", quality: "premium",
    createdAt: new Date().toISOString(), ...over,
  });

  const chainFor = async (assets) => registry.usableProviders({ assets });

  const theirLibrary = { assets: [ready({ type: "hero", source: "user", url: "https://theirs/hero.jpg" })] };
  const withUpload = await resolver.resolveAssets({
    projectId: "p", plan, library: theirLibrary, providers: await chainFor(theirLibrary.assets),
  });
  is(withUpload.manifest.assets.hero, "https://theirs/hero.jpg", "an uploaded asset wins the slot");
  is(withUpload.bySource.project, 1, "and is counted to the project, not to a paid source");
  is(withUpload.created.some((a) => a.url === "https://theirs/hero.jpg"), false,
     "their own asset is not recorded again as something we acquired");

  /* Several uploads must land in several slots, not one upload in all of them.
     This is the failure the anti-demo bar forbids, arriving through the one
     provider that is supposed to be about the customer's own work. */
  const shopPlan = planner.planAssets({ kind: "ecommerce", brief: "a store selling ceramics" });
  const theirPhotos = {
    assets: [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      ready({ id: `u${n}`, type: "product", source: "user", url: `https://theirs/product-${n}.jpg` }),
    ),
  };
  const placed = await resolver.resolveAssets({
    projectId: "p", plan: shopPlan, library: theirPhotos,
    providers: await chainFor(theirPhotos.assets),
  });
  const productPhotos = Object.entries(placed.manifest.assets)
    .filter(([slot, url]) => slot.startsWith("product-") && url)
    .map(([, url]) => url);
  is(productPhotos.length, 8, "eight uploads fill eight product slots");
  is(new Set(productPhotos).size, 8, "and each slot gets a different one of them");

  /* A tag naming the slot beats a guess from the type. */
  const tagged = {
    assets: [
      ready({ id: "generic", type: "hero", source: "user", url: "https://theirs/any.jpg" }),
      ready({ id: "exact", type: "hero", source: "user", url: "https://theirs/for-hero.jpg", tags: ["hero"] }),
    ],
  };
  const byTag = await resolver.resolveAssets({
    projectId: "p", plan, library: tagged, providers: await chainFor(tagged.assets),
  });
  is(byTag.manifest.assets.hero, "https://theirs/for-hero.jpg",
     "an upload tagged for a slot wins over one that merely shares its type");

  const mine = library.fingerprint(plan.requests.find((r) => r.slot === "hero").spec);
  const mineLibrary = {
    assets: [ready({ type: "hero", source: "generated", url: "https://ours/hero.jpg", prompt: mine })],
  };
  const reusedRun = await resolver.resolveAssets({
    projectId: "p", plan, library: mineLibrary, providers: await chainFor(mineLibrary.assets),
  });
  is(reusedRun.manifest.assets.hero, "https://ours/hero.jpg", "an asset this project already made is reused");
  is(reusedRun.bySource.project, 1, "and is not paid for again");

  /* A source that throws must be skipped, not fatal. */
  const angry = {
    id: "pexels", label: "Angry", cost: "low",
    capabilities: { bespoke: false, edit: false, upscale: false },
    health: () => "available",
    async supply() { throw new Error("429"); },
  };
  const stub = {
    id: "curated", label: "Stub", cost: "free",
    capabilities: { bespoke: false, edit: false, upscale: false },
    health: () => "available",
    async supply() {
      return { url: "https://stub/img.jpg", provider: "curated", retrievedAt: new Date().toISOString() };
    },
  };

  const survived = await resolver.resolveAssets({
    projectId: "p", plan, library: { assets: [] }, providers: [angry],
  });
  is(survived.unresolved, plan.requests.filter((r) => r.spec).length,
     "a source that throws leaves only its PHOTOGRAPHS unresolved");
  is(survived.manifest.drawn.length, plan.requests.filter((r) => !r.spec).length,
     "and the drawn slots are handed back to the code generator rather than blanked");
  is(survived.created.every((a) => a.status === "failed"), true, "recorded as failed, not as ready");

  const fellThrough = await resolver.resolveAssets({
    projectId: "p", plan, library: { assets: [] }, providers: [angry, stub],
  });
  is(fellThrough.bySource.curated > 0, true, "and the next source in the chain answers instead");

  const nothing = await resolver.resolveAssets({
    projectId: "p", plan, library: { assets: [] }, providers: [],
  });
  is(Object.keys(nothing.manifest.assets).length, plan.requests.length,
     "an empty chain still returns every slot");
  is(nothing.manifest.direction.register.length > 0, true,
     "and the visual direction still reaches the code generator");

  const made = fellThrough;

  // ── Taking in what somebody attached ────────────────────────────────────
  const intake = await import(join(out, "lib/builder/assets/asset-intake.js"));

  /* No service key here, so nothing can be copied into the bucket. Everything
     must come back as reference rather than vanishing — an upload that
     disappears with no explanation is the worst of the three outcomes. */
  const upload = (id, name, mime = "image/jpeg") => ({ id, name, mime, path: `p/${id}` });
  const noKey = await intake.intakeAttachments({
    projectId: "p", kind: "ecommerce", existing: [],
    rows: [upload("a", "bowl-01.jpg"), upload("b", "bowl-02.jpg")],
  });
  is(noKey.assets.length, 0, "with no storage configured nothing is taken in");
  is(noKey.reference.length, 2, "and every upload still reaches the model to look at");

  /* Classification is what decides whether a picture is used or copied, so it
     is the part worth pinning down. It runs before any storage call. */
  const classified = async (name, kind) => {
    const out = await intake.intakeAttachments({
      projectId: "p", kind, existing: [], rows: [upload("x", name)],
    });
    return out.reference.length === 1 ? "reference-or-unstored" : "asset";
  };
  is(await classified("homepage-screenshot.png", "ecommerce"), "reference-or-unstored",
     "a screenshot is a picture of what they want, not content for the page");
  is(await classified("figma-mockup.png", "landing"), "reference-or-unstored",
     "so is a mockup");

  /* A non-image is never taken in, whatever it is called. */
  const withPdf = await intake.intakeAttachments({
    projectId: "p", kind: "ecommerce", existing: [],
    rows: [upload("d", "catalogue.pdf", "application/pdf")],
  });
  is(withPdf.assets.length + withPdf.reference.length, 0, "a PDF is not an image and is left alone");

  /* An upload already taken in must not be copied again on the next build. */
  const again = await intake.intakeAttachments({
    projectId: "p", kind: "ecommerce",
    existing: [ready({ type: "product", source: "user", url: "https://theirs/1.jpg", tags: ["product-1", "product", "upload:a"] })],
    rows: [upload("a", "bowl-01.jpg")],
  });
  is(again.assets.length, 0, "an upload already taken in is not taken in twice");
  is(again.reference.length, 0, "and is not sent to the model as a reference either");

  // ── What the code generator is told ─────────────────────────────────────
  const text = resolver.manifestForPrompt(made.manifest);
  is(text.includes("use these exact URLs and no others"), true, "the manifest forbids inventing an address");
  is(text.includes("VISUAL DIRECTION"), true, "and carries the direction so the design matches the pictures");
  const emptyText = resolver.manifestForPrompt(nothing.manifest);
  is(emptyText.includes("never an SVG drawing of what the photograph would have shown"), true,
     "an unresolved photograph is told to be a panel, not a drawing of the subject");
  is(emptyText.includes("DRAW THIS YOURSELF"), true,
     "and a drawn slot is told to be drawn");

  // ── Delivery ────────────────────────────────────────────────────────────
  const delivery = optimizer.deliveryFor("https://cdn/a.webp", { maxDisplayWidth: 640, quality: "premium", aboveTheFold: true });
  is(delivery.loading, "eager", "the hero is not lazy-loaded");
  is(delivery.srcset.split(",").length > 1, true, "an image is offered at several widths");
  is(optimizer.deliveryFor("https://cdn/a.webp", { maxDisplayWidth: 320, quality: "premium" }).loading, "lazy",
     "and everything below the fold waits its turn");
  is(optimizer.transformed("data:image/png;base64,AAAA", 320, "premium"), "data:image/png;base64,AAAA",
     "an inline image is left alone rather than given a transform it cannot take");

  /* ── The registry: whose pictures these are (§1) ────────────────────────
   *
   * The failure this exists to stop is invisible from inside one build. Two
   * customers ask for a bakery; the planner writes the same direction for
   * both, the same direction makes the same query, and the same query ranks
   * the same photographs in the same order. Nothing anywhere is an error and
   * both websites show the same loaf.
   *
   * So the property under test is a property BETWEEN projects, and it has to be
   * checked with two of them.
   */
  const assetRegistry = await import(join(out, "lib/builder/assets/asset-registry.js"));
  const curated = await import(join(out, "lib/builder/assets/providers/curated.js"));

  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  is(assetRegistry.rotationFor(A) === assetRegistry.rotationFor(A), true,
     "a project's rotation is the same on every rebuild");
  is(assetRegistry.rotationFor(A) !== assetRegistry.rotationFor(B), true,
     "and two projects do not share one");

  /* The rotation may only reorder candidates that are equally good. A weak
     match promoted over a strong one for the sake of variety is a worse
     picture, which is not the trade being made here. */
  const ranked = [
    { item: "best", score: 1 },
    { item: "tied", score: 0.98 },
    { item: "weak", score: 0.2 },
  ];
  const rotated = assetRegistry.rotate(ranked, 1, 0.08);
  is(rotated[rotated.length - 1], "weak", "a weak match is never rotated ahead of a strong one");
  is(rotated.length, 3, "and nothing is lost in the rotation");

  /* One project's stored asset is never served inside another's site. */
  is(assetRegistry.belongsToAnotherProject(`https://x.co/storage/v1/object/public/project-assets/${B}/pic.png`, A),
     true, "another project's stored picture is recognised as theirs");
  is(assetRegistry.belongsToAnotherProject(`https://x.co/storage/v1/object/public/project-assets/${A}/pic.png`, A),
     false, "and the project's own is not");

  /* The promise itself, through the curated library: the same request, the
     same register, two projects — and not the same photograph.

     Product photography is what this is asked of, because it is where the
     catalogue actually holds alternatives: four seamless studio shots in one
     register, equally right for the same request, which is precisely the
     situation where the top result used to win for everybody.

     Where the catalogue holds ONE candidate for a register — as it does for
     several of the heroes — no amount of rotation can produce a second, and
     two projects will share it. That is a fact about the size of the library
     rather than about this code, and the honest answer to it is more
     photographs, not a worse match. */
  const productRequest = {
    slot: "product-1",
    type: "product",
    purpose: "the catalogue",
    aspectRatio: "4/5",
    quality: "premium",
    alt: "A product on a seamless background",
    spec: { type: "product", subject: "product on seamless", environment: "studio",
            composition: "centred", lighting: "soft", style: "catalogue", mood: "neutral",
            aspectRatio: "4/5", text: false, watermark: false },
  };

  const forA = curated.search(productRequest, "catalogue-consistent product photography", new Set(), A);
  const forB = curated.search(productRequest, "catalogue-consistent product photography", new Set(), B);

  is(forA.length >= 2, true, "the catalogue holds alternatives for this request");
  is(forA[0].path !== forB[0].path, true,
     "two projects asking for the same picture are not handed the same one");

  /* And the same project asked twice gets the same one, because a rebuild must
     not reshuffle a page's photography. */
  is(curated.search(productRequest, "catalogue-consistent product photography", new Set(), A)[0]?.path,
     forA[0]?.path,
     "the same project gets the same photograph on every build");

  console.log(`\n${failed === 0 ? "All checks passed." : `${failed} failed.`}`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
