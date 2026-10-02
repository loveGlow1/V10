#!/usr/bin/env node
/* The five tabs and their sub-types.
 *
 *   npm run check:targets
 *
 * lib/builder/targets.ts turns a tab (Web App, Website, Fliers, Video, Mobile
 * App) and a sentence into a sub-type, the build kind it runs on, and the
 * rules the build prompt carries. Landing page, store, blog and news are
 * Website's sub-types and must still reach their own blueprints.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-targets");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: [],
    },
    files: ["targets.ts", "kinds.ts"].map((f) => join(process.cwd(), "src/lib/builder", f)),
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const dir = join(out, "lib/builder");
for (const entry of readdirSync(dir)) {
  if (!entry.endsWith(".js")) continue;
  const path = join(dir, entry);
  writeFileSync(path, readFileSync(path, "utf8").replace(/(from\s+["'])(\.\/[^"']+?)(["'])/g, (whole, a, spec, c) => (spec.endsWith(".js") ? whole : `${a}${spec}.js${c}`)));
}

const T = await import(join(dir, "targets.js"));

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};
const resolve = (target, brief) => T.resolveTarget(T.parseTarget(target), brief);

console.log("tabs");
has(T.CATEGORIES.join() === "web_app,website,fliers,video,mobile_app", "five tabs, in the spec's order");
for (const category of T.CATEGORIES) has(T.SUBTYPES[category].length >= 2, `${category} has sub-types`);

console.log("\nparsing what arrives in a URL");
has(T.parseTarget("fliers")?.category === "fliers" && T.parseTarget("fliers").subtype === null, "a bare category");
has(T.parseTarget("website:blog")?.subtype === "blog", "category and sub-type");
has(T.parseTarget("website:social_post")?.subtype === null, "a sub-type from another tab is dropped, the tab kept");
has(T.parseTarget("mobile") === null && T.parseTarget(42) === null && T.parseTarget(null) === null, "anything else is nothing");
has(T.formatTarget({ category: "video", subtype: "social_reel" }) === "video:social_reel", "formats back");

console.log("\nWebsite keeps the four kinds underneath");
has(resolve("website", "a landing page for my gym").kind === "landing", "landing page → landing");
has(resolve("website", "an online store for my candles with a cart").kind === "ecommerce", "store → ecommerce");
has(resolve("website", "a blog about travel with articles and authors").kind === "blog", "blog → blog");
has(resolve("website", "a news site covering local politics with headlines").kind === "news", "news → news");
has(resolve("website", "something for my bakery").subtype.id === "landing_page", "nothing clear → landing page");
has(resolve("website:news_magazine", "a site for my bakery").kind === "news", "a picked chip beats the sentence");
has(resolve("website:news_magazine", "x").picked === true && resolve("website", "x").picked === false, "and says it was picked");

console.log("\nthe other tabs");
has(resolve("web_app", "a CRM for my sales team").subtype.id === "saas_dashboard", "CRM → dashboard");
has(resolve("web_app", "a marketplace with inventory and checkout").kind === "ecommerce", "store logic → ecommerce kind");
has(resolve("web_app", "a currency converter tool").subtype.id === "custom_tool", "converter → custom tool");
has(resolve("fliers", "an instagram story for our sale").subtype.id === "social_post", "instagram story → social post");
has(resolve("fliers", "a 40% off weekend sale banner").subtype.id === "marketing_banner", "sale banner → promo banner");
has(resolve("fliers", "a poster for our jazz night").subtype.id === "event_flyer", "jazz night → event flyer");
has(resolve("video", "a tiktok for my coffee brand").subtype.id === "social_reel", "tiktok → reel");
has(resolve("video", "a tutorial on setting up the app").subtype.id === "explainer_video", "tutorial → explainer");
has(resolve("video", "announce our new headphones").subtype.id === "product_launch", "announcement → launch");
has(resolve("mobile_app", "a habit tracker").subtype.id === "pwa", "default mobile → PWA");
has(resolve("mobile_app", "an android app for my gym").subtype.id === "native_mobile", "android → native-style");
for (const category of ["fliers", "video"]) has(T.SUBTYPES[category].every((entry) => entry.kind === "landing"), `${category} builds as a single page`);
for (const id of ["pwa", "native_mobile"]) has(T.SUBTYPES.mobile_app.find((e) => e.id === id).kind === "webapp", `${id} builds as a web app`);

console.log("\nthe tab follows the sentence");
has(T.categoryFor("design a flyer for my church concert") === "fliers", "flyer → Fliers");
has(T.categoryFor("make a reel for our launch") === "video", "reel → Video");
has(T.categoryFor("build a mobile app for tracking runs") === "mobile_app", "mobile app → Mobile App");
has(T.categoryFor("hello") === null, "nothing confident → stays put");

console.log("\nwhat the build prompt carries");
const flier = T.targetBrief(resolve("fliers", "a poster for our jazz night"));
has(/NOT A WEBSITE/.test(flier) && /aspect ratio/i.test(flier) && /A4/.test(flier) && /Download PNG/.test(flier), "fliers: canvas, ratio, A4, download");
const video = T.targetBrief(resolve("video", "a tiktok for my brand"));
has(/scene/i.test(video) && /voiceover/i.test(video) && /shot/i.test(video) && /9:16/.test(video), "video: scenes, shots, voiceover, 9:16");
const mobile = T.targetBrief(resolve("mobile_app", "a habit tracker"));
has(/44/.test(mobile) && /bottom tab/i.test(mobile) && /safe-area/.test(mobile), "mobile: 44px, bottom tabs, safe areas");
const site = T.targetBrief(resolve("website", "a blog about tea"));
has(/SEO/.test(site) && /<article>/.test(site) && /reading time/.test(site), "website: SEO, semantic HTML, the blog's own rules");
const app = T.targetBrief(resolve("web_app", "a CRM"));
has(/authentication/i.test(app) && /row-level security/.test(app), "web app: auth and RLS");
has(/these win/.test(app), "and says it overrules the blueprint");

const blueprints = readFileSync(join(process.cwd(), "src/lib/builder/blueprints/index.ts"), "utf8");
has(/context\.target/.test(blueprints), "composeBuildPrompt places the block");
const route = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
has(/parseTarget\(body\.target\)/.test(route) && /targetBrief\(resolvedTarget\)/.test(route), "the build route reads the tab and passes its rules");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
