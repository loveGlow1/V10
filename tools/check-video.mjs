#!/usr/bin/env node
/* The Video Studio's orchestrator: ten pipelines, one shared core.
 *
 *   npm run check:video
 *
 * lib/video/pipelines.ts (the pipelines as data), plan.ts (reading a plan,
 * routing scenes, QA and repair) and engines.ts (what rendering needs).
 * Offline. No model, no network, no key. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-video");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"], baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
  files: ["pipelines.ts", "plan.ts", "engines.ts", "render.ts"].map((f) => join(process.cwd(), "src/lib/video", f)),
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const dir = join(out, "lib/video");
/* tsc keeps import specifiers as written; node's ESM loader wants files. */
for (const entry of readdirSync(out, { recursive: true })) {
  if (!String(entry).endsWith(".js")) continue;
  const path = join(out, String(entry));
  const depth = String(entry).split("/").length - 1;
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/(from\s+["'])@\/([^"']+?)(["'])/g, (_, a, rest, c) => `${a}${"../".repeat(depth)}${rest}.js${c}`)
    .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (w, a, spec, c) => (spec.endsWith(".js") ? w : `${a}${spec}.js${c}`)));
}
const P = await import(join(dir, "pipelines.js"));
const L = await import(join(dir, "plan.js"));
const E = await import(join(dir, "engines.js"));
const R = await import(join(dir, "render.js"));

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

console.log("pipelines");
has(P.PIPELINE_IDS.length === 10, "ten pipelines");
has(P.GRID.length === 9 && !P.GRID.includes("photo_to_video"), "nine on the grid, Photo → Video on its own row");
for (const id of P.PIPELINE_IDS) {
  const p = P.PIPELINES[id];
  has(p.id === id && p.stages.length >= 4 && p.questions.length >= 2 && p.director.length >= 1 && p.engines.includes(p.defaultEngine), `${id}: stages, questions, director rules, engines`);
  has(p.questions.every((q) => !q.initial || q.options.includes(q.initial)), `${id}: every default is one of its options`);
}
for (const id of P.PIPELINE_IDS) {
  const p = P.PIPELINES[id];
  const seconds = L.secondsFrom(P.answersFor(p, {}).length);
  has(/\[[A-Z]/.test(p.template) && p.template.includes(`${seconds}-second`), `${id}: a template with [PLACEHOLDERS], timed to its default ${seconds}s`);
}
has(P.PIPELINES.clone.needsConsent === true && P.PIPELINE_IDS.filter((id) => P.PIPELINES[id].needsConsent).length === 1, "only the clone asks for likeness consent");
has(P.PIPELINES.product_showcase.director.some((r) => /LOCKED/.test(r)), "product showcase locks the product");
has(P.PIPELINES.ugc_influencer.director.some((r) => /never imitate a real influencer/i.test(r)), "UGC creator is fictional");
const a = P.answersFor(P.PIPELINES.commercial_ad, { length: "15s", aspect: "nonsense" });
has(a.length === "15s" && a.aspect === "Vertical 9:16" && a.voice === "Female", "answers: kept when valid, defaulted otherwise");

console.log("\nreading a plan");
has(L.secondsFrom("30s") === 30 && L.secondsFrom("2 min") === 120 && L.aspectFrom("Landscape 16:9") === "16:9", "lengths and ratios from answers");
const plan = L.normalizePlan({
  title: "Glow", aspect: "9:16", locks: { product: "matte black 50ml bottle with gold cap" }, cta: "Shop now",
  scenes: [
    { duration: 10, shot: "close-up", visual: "the bottle on marble", motionPrompt: "macro shot of bottle", engine: "video" },
    { duration: 10, shot: "medium", visual: "creator talks to camera", voiceover: "I love it", engine: "nonsense" },
    { duration: 10, shot: "wide", visual: "presenter speaks", voiceover: "", engine: "avatar" },
  ],
}, "commercial_ad", { length: "15s" });
has(plan.scenes.length === 3 && plan.target === 15, "scenes and target read");
has(plan.scenes[1].engine === "avatar", "router: a person speaking to camera goes to the avatar engine");
has(L.normalizePlan(null, "trailer", {}).scenes.length === 0, "nothing in, an empty plan out — never a throw");

console.log("\nQA and repair");
const { plan: fixed, issues } = L.qaAndRepair(plan);
has(L.totalSeconds(fixed) >= 14 && L.totalSeconds(fixed) <= 16, "30s of scenes against a 15s target is rescaled", String(L.totalSeconds(fixed)));
has(fixed.scenes[2].engine === "video", "an avatar scene with nothing to say is re-routed");
has(fixed.scenes.every((s) => s.motionPrompt.includes("matte black 50ml bottle")), "the product lock reaches every scene prompt");
has(fixed.scenes[1].motionPrompt.length > 0 && fixed.scenes[2].motionPrompt.length > 0, "missing prompts are built from shot and visual");
has(/Shop now/.test(fixed.scenes[2].onScreenText), "the CTA is on the last scene");
has(issues.every((i) => typeof i.issue === "string") && issues.some((i) => i.repaired), "issues reported, repairs marked");
has(plan.scenes[0].duration === 10, "the input plan is not mutated");
const ugc = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 15, visual: "creator holds the serum", voiceover: "ok", motionPrompt: "x" }] }, "ugc_influencer", { length: "15s" }));
has(/AI-generated · Ad/.test(ugc.plan.scenes[0].onScreenText), "UGC carries an AI-generated · Ad disclosure");
const noLock = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 5, visual: "a product", motionPrompt: "x" }] }, "product_showcase", { length: "5s" }));
has(noLock.issues.some((i) => !i.repaired && /product lock/i.test(i.issue)), "a product video without a product lock is flagged, not hidden");
has(/SCENE 1/.test(L.scriptText(fixed)) && /CTA: Shop now/.test(L.scriptText(fixed)), "script export");

console.log("\nrendering");
has(!E.enginesNeeded(fixed).some((e) => e.engine === "avatar"), "a fictional on-camera scene renders as video + voice, not avatar");
has(E.enginesNeeded(fixed).some((e) => e.engine === "voice" && e.required), "a spoken line needs the voice engine");
const env = { N8N_WEBHOOK_URL: "https://x.app.n8n.cloud/webhook/api/v1/build", N8N_WEBHOOK_TOKEN: "secret" };
has(E.readiness(fixed, {}).ready === false && E.readiness(fixed, env).ready === true, "ready only when n8n is configured");
const clone = L.normalizePlan({ scenes: [{ duration: 5, visual: "presenter talks to camera", voiceover: "hi", motionPrompt: "x", engine: "avatar" }] }, "clone", { length: "5s" });
has(E.readiness(clone, env).ready === false, "a clone waits for a real avatar engine — never faked");
has(E.readiness(L.normalizePlan({ music: "upbeat synth", scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }] }, "trailer", {}), env).ready === true, "music is optional");
has(E.readiness(fixed, env).notes.some((n) => /lip sync/i.test(n)), "says lip sync is not available when it would be wanted");

console.log("\njobs and signing");
has(R.videoWebhookUrl(env) === "https://x.app.n8n.cloud/webhook/api/v1/video-render", "webhook derived from the build webhook's origin");
has(R.videoWebhookUrl({ ...env, N8N_VIDEO_WEBHOOK_URL: "https://y/hook" }) === "https://y/hook", "and overridable");
const jobs = R.jobsFor(fixed, { voice: "Male" });
has(jobs.filter((j) => j.kind === "clip").length === fixed.scenes.length, "one clip per scene");
has(jobs.filter((j) => j.kind === "voice").length === fixed.scenes.filter((s) => s.voiceover).length, "one voice line per spoken scene");
has(jobs.every((j) => j.kind !== "clip" || (j.duration >= 4 && j.duration <= R.MAX_CLIP_SECONDS)), "clips are 4–6s (the 180s run limit)");
has(jobs.find((j) => j.kind === "voice")?.voiceId === "English_Trustworth_Man", "male voice when asked");
has(R.jobsFor(L.normalizePlan({ scenes: [{ duration: 5, visual: "a", voiceover: "MAYA: We go now.", motionPrompt: "x" }] }, "cinematic_short", {}), {}).find((j) => j.kind === "voice")?.text === "We go now.", "dialogue speaker names are not spoken");
has(R.jobCost(jobs) === E.renderCost(fixed), "the price shown is the price charged");
const sig = R.signRender("vid", 2, "user", env);
has(R.verifyRender("vid", 2, "user", sig, env), "a signature verifies for its own render");
has(!R.verifyRender("vid", 3, "user", sig, env) && !R.verifyRender("other", 2, "user", sig, env) && !R.verifyRender("vid", 2, "someone", sig, env), "and for nothing else");
has(!R.verifyRender("vid", 2, "user", sig, { N8N_WEBHOOK_TOKEN: "other" }), "a different secret fails");
has(!R.verifyRender("vid", 2, "user", "1.abc", env), "an expired or forged signature fails");
const h = new Headers({ "X-QuickStark-Token": "secret" });
has(R.hasWebhookToken(h, env) && !R.hasWebhookToken(new Headers({ "X-QuickStark-Token": "nope" }), env) && !R.hasWebhookToken(new Headers(), env), "the callback token check");

const root = process.cwd();
const create = readFileSync(join(root, "src/app/api/video/route.ts"), "utf8");
has(/needsConsent && body\.consent !== true/.test(create), "creating a clone requires consent");
const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
has(/video_projects_clone_consent/.test(schema) && /create table if not exists public\.video_versions/.test(schema), "schema: consent constraint and versioning");
const render = readFileSync(join(root, "src/app/api/video/[id]/render/route.ts"), "utf8");
has(/if \(!ready\.ready\)/.test(render), "render refuses rather than queue for engines that are not connected");
has(/currentBalance/.test(render) && /retryFailed/.test(render), "render checks credits first and can retry only what failed");
const callback = readFileSync(join(root, "src/app/api/video/[id]/render/callback/route.ts"), "utf8");
has(/hasWebhookToken\(request\.headers\)/.test(callback) && /verifyRender\(/.test(callback), "the callback checks the token AND the signature");
has(/dedupeKey: `video-job:/.test(callback) && /if \(url\) \{\s*await chargeCredits/.test(callback), "charged once per delivered job, never for a failure");
has(/video-assets/.test(callback), "media is copied into private storage (provider URLs expire)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
