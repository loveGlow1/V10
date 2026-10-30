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
  files: ["pipelines.ts", "plan.ts", "engines.ts", "render.ts", "fal.ts", "clip-engines.ts", "credit.ts", "versions.ts"].map((f) => join(process.cwd(), "src/lib/video", f)),
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
const F = await import(join(dir, "fal.js"));
const C = await import(join(dir, "clip-engines.js"));
const K = await import(join(dir, "credit.js"));

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
has(/AI-generated · Ad/.test(ugc.plan.scenes.at(-1).onScreenText), "UGC carries an AI-generated · Ad disclosure");
has(ugc.plan.scenes.length === 3 && ugc.plan.scenes.every((s) => s.duration <= L.MAX_CLIP_SECONDS) && L.totalSeconds(ugc.plan) === 15, "a 15s scene becomes three clips that fit, same total");

console.log("\nclips that fit");
const beat = { n: 1, duration: 10, shot: "selfie", visual: "creator holds the serum", onScreenText: "Day 1", voiceover: "My skin looked dull. Then I found this serum.", motionPrompt: "creator holds serum", sound: "", engine: "video" };
const halves = L.splitScene(beat);
has(halves.length === 2 && halves[0].duration + halves[1].duration === 10, "a 10s beat is two clips");
has(halves[0].voiceover === "My skin looked dull." && halves[1].voiceover === "Then I found this serum.", "its line is shared at the sentence end", JSON.stringify(halves.map((h) => h.voiceover)));
has(halves[0].onScreenText === "Day 1" && halves[1].onScreenText === "", "a title card shows once");
has(/Continuation of the previous shot/.test(halves[1].motionPrompt), "the second clip carries on from the first");
has(L.splitScene({ ...beat, duration: 13, voiceover: "one long line with no stops at all in it" }).every((s) => s.duration <= 6 && s.duration >= 4), "13s → three clips of 4–5s");
has(L.splitScene({ ...beat, duration: 6 }).length === 1, "a clip that fits is left alone");
const timeline = L.qaAndRepair(L.normalizePlan({ scenes: [2, 8, 10, 6, 4].map((d, i) => ({ duration: d, visual: "creator talks to camera", voiceover: `Line ${i + 1}. Part two.`, motionPrompt: "x" })) }, "ugc_influencer", { length: "30s" }));
has(timeline.plan.scenes.every((s, i) => s.duration <= 6 && s.n === i + 1) && L.totalSeconds(timeline.plan) === 30, "the UGC template's timeline renders as clips that fit, numbered in order", timeline.plan.scenes.map((s) => s.duration).join(","));
const cloneLong = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 12, visual: "presenter talks to camera", voiceover: "hi there. bye now.", motionPrompt: "x", engine: "avatar" }] }, "clone", { length: "12s" }));
has(cloneLong.plan.scenes.length === 1, "a clone's presenter scene stays whole — it is made from their photo, not a clip");
const narratedJobs = R.jobsFor(L.normalizePlan({ scenes: [{ duration: 5, visual: "a", voiceover: "Hi there.", motionPrompt: "creator smiles" }, { duration: 5, visual: "b", motionPrompt: "logo spins" }] }, "ugc_influencer", {}), {});
const clips = narratedJobs.filter((j) => j.kind === "clip");
has(clips.every((j) => j.prompt.includes(R.NO_LETTERING)), "every clip is asked for no lettering of its own — the captions are added at the cut");
has(clips[0].prompt.includes(R.NO_SPEECH) && !clips[1].prompt.includes(R.NO_SPEECH), "a clip under a voice line is asked for no speech; one without keeps its sound");
has(R.clipPrompt("x".repeat(3000), true).length <= 2000, "the picture-only prompt still fits MiniMax's 2000 characters");
const composeSrc = readFileSync(join(process.cwd(), "src/lib/video/compose-local.ts"), "utf8");
has(/clip\.audio && !hasVoice \?/.test(composeSrc), "under a voice line, the clip's own sound is left out — the script is the only voice");
has(clips[1].prompt.includes(R.clearSpeech("English")) && R.clipPrompt("x", false, "French").includes("clear, natural French"), "a clip that keeps its sound is asked for clear words in the video's language — no mumbling");
const branded = L.qaAndRepair(L.normalizePlan({ cta: "Try QuickStark", scenes: [{ duration: 5, visual: "a", voiceover: "Then I found QuickStark.", onScreenText: "QuickStark.Ai did this", motionPrompt: "x" }, { duration: 5, visual: "b", voiceover: "Go to quickstark.tech", motionPrompt: "y" }] }, "ugc_influencer", { length: "10s" }));
has(branded.plan.scenes[0].voiceover === "Then I found QuickStark.ai." && branded.plan.scenes[0].onScreenText === "QuickStark.ai did this", "the name is said and shown as QuickStark.ai", JSON.stringify(branded.plan.scenes[0]));
has(branded.plan.cta === "Try QuickStark.ai" && branded.plan.scenes[1].voiceover === "Go to quickstark.tech", "the CTA too — a web address is left alone");
has(L.unfilledPlaceholders("Recommend [PRODUCT] to [TARGET AUDIENCE] [Push in] [PRODUCT]").join() === "[PRODUCT],[TARGET AUDIENCE]", "unfilled template blanks are found; camera commands are not");
const noLock = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 5, visual: "a product", motionPrompt: "x" }] }, "product_showcase", { length: "5s" }));
has(noLock.issues.some((i) => !i.repaired && /product lock/i.test(i.issue)), "a product video without a product lock is flagged, not hidden");
has(/SCENE 1/.test(L.scriptText(fixed)) && /CTA: Shop now/.test(L.scriptText(fixed)), "script export");

console.log("\nrendering");
has(E.enginesNeeded(fixed).some((e) => e.engine === "video" && e.required), "a fictional on-camera scene starts as a clip");
has(E.enginesNeeded(fixed).some((e) => e.engine === "avatar" && !e.required), "lip sync on it is an upgrade, not a requirement");
has(E.enginesNeeded(fixed).some((e) => e.engine === "voice" && e.required), "a spoken line needs the voice engine");
const env = { N8N_WEBHOOK_URL: "https://x.app.n8n.cloud/webhook/api/v1/build", N8N_WEBHOOK_TOKEN: "secret" };
has(E.readiness(fixed, {}).ready === false && E.readiness(fixed, env).ready === true, "ready only when n8n is configured");
const clone = L.normalizePlan({ scenes: [{ duration: 5, visual: "presenter talks to camera", voiceover: "hi", motionPrompt: "x", engine: "avatar" }] }, "clone", { length: "5s" });
has(E.readiness(clone, env).ready === false, "a clone waits for a real avatar engine — never faked");
has(E.readiness(L.normalizePlan({ music: "upbeat synth", scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }] }, "trailer", {}), env).ready === true, "music is optional");
has(E.readiness(fixed, env).notes.some((n) => /lip sync/i.test(n)), "says lip sync is not available when it would be wanted");

console.log("\nproduction (fal)");
const fal = { ...env, FAL_KEY: "k" };
has(E.engineHealth("avatar", env) === "not-configured" && E.engineHealth("avatar", fal) === "available", "lip sync, avatar, music and compose turn on with FAL_KEY");
has(E.readiness(clone, fal).ready === true, "a clone renders once the avatar engine is there");
has(E.readiness(fixed, env).notes.some((n) => /FAL_KEY/.test(n)) && !E.readiness(fixed, fal).notes.some((n) => /lip sync needs/i.test(n)), "the studio says what FAL_KEY would add, and stops saying it once set");
const spokenAvatar = L.normalizePlan({ music: "upbeat", scenes: [{ duration: 5, visual: "creator talks to camera", voiceover: "hi", motionPrompt: "x", engine: "avatar" }, { duration: 5, visual: "b-roll", motionPrompt: "y" }] }, "ugc_influencer", {});
has(E.renderCost(spokenAvatar, env) === E.CLIP_COST * 2 + E.VOICE_COST, "without fal: clips and voice only");
has(E.renderCost(spokenAvatar, fal) === E.CLIP_COST * 2 + E.VOICE_COST + E.LIPSYNC_COST + E.MUSIC_COST + E.COMPOSE_COST, "with fal: + lip sync, music and the final MP4");
const cloneSpoken = L.normalizePlan({ scenes: [{ duration: 5, visual: "presenter talks to camera", voiceover: "hello", motionPrompt: "x", engine: "avatar" }] }, "clone", {});
const cloneJobs = R.jobsFor(cloneSpoken, {});
has(cloneJobs.length === 1 && cloneJobs[0].kind === "voice", "a clone's presenter scene orders its voice, not a stranger's clip");
has(E.renderCost(cloneSpoken, fal) === E.VOICE_COST + E.AVATAR_COST + E.COMPOSE_COST, "and is priced as voice + avatar");
const photoJobs = R.jobsFor(L.normalizePlan({ scenes: [{ duration: 5, visual: "mountains", motionPrompt: "x" }] }, "photo_to_video", {}), {}, { firstFrameUrl: "https://x/photo.jpg" });
has(photoJobs[0].imageUrl === "https://x/photo.jpg", "Photo → Video clips start from the photo");
has(F.parseJobKey("avatar:3")?.scene === 3 && F.parseJobKey("compose")?.scene === null && F.parseJobKey("rm -rf") === null, "fal job keys parse, junk does not");
const tok = F.falToken("vid", 1, "avatar:2", env);
has(F.verifyFalToken("vid", 1, "avatar:2", tok, env) && !F.verifyFalToken("vid", 1, "avatar:3", tok, env) && !F.verifyFalToken("vid", 2, "avatar:2", tok, env), "a fal callback token is good for its own job only");
has(F.outputUrl({ video: { url: "https://v3.fal.media/a.mp4" } }) && F.outputUrl({ audio: { url: "https://v3.fal.media/a.mp3" } }) && F.outputUrl({ video_url: "https://v3.fal.media/b.mp4" }) && !F.outputUrl({ video: { url: "http://evil/a.mp4" } }), "media read out of every model's answer, https only");
const hook = F.falWebhookUrl("https://www.quickstark.tech", "vid", 4, { engine: "compose", scene: null });
has(/\/api\/video\/vid\/render\/fal\?v=4&job=compose&t=[0-9a-f]{64}$/.test(hook), "webhook address names the video, version and job");

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
/* The render route is a thin door; the work is in lib/video/start-render.ts. */
const render = readFileSync(join(root, "src/app/api/video/[id]/render/route.ts"), "utf8") + readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8");
has(/if \(!ready\.ready\)/.test(render), "render refuses rather than queue for engines that are not connected");
has(/currentBalance/.test(render) && /retryFailed/.test(render), "render checks credits first and can retry only what failed");
const callback = readFileSync(join(root, "src/app/api/video/[id]/render/callback/route.ts"), "utf8");
has(/hasWebhookToken\(request\.headers\)/.test(callback) && /verifyRender\(/.test(callback), "the callback checks the token AND the signature");
const results = readFileSync(join(root, "src/lib/video/results.ts"), "utf8");
has(/landResult\(/.test(callback), "the n8n callback lands its result like every other engine");
has(/dedupeKey: `video-job:/.test(results) && /if \(delivered && output\) \{\s*await chargeCredits/.test(results), "charged once per delivered job, never for a failure");
has(/clipCost\(landing\.engine/.test(results), "at the price of the engine that made it");
has(/video-assets/.test(results), "media is copied into private storage (provider URLs expire)");

console.log("\nthe clip router");
const nothing = {};
const mm = { MINIMAX_API_KEY: "k" };
const hf = { HF_API_KEY_ID: "i", HF_API_KEY_SECRET: "s" };
const every = { ...mm, ...hf, FAL_KEY: "f", N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/x", N8N_WEBHOOK_TOKEN: "t" };
const ugcScene = { pipeline: "ugc_influencer", aspect: "9:16", fromFrame: false };
has(C.routeClip(ugcScene, every)[0] === "n8n", "by default the MiniMax usage credit on n8n goes first — vertical included");
has(C.routeClip(ugcScene, every)[1] === "seedance", "and behind it, the best paid engine for the scene");
has(C.routeClip({ ...ugcScene, tier: "best" }, every)[0] === "seedance", "UGC, best: Seedance 2.0 first");
has(C.routeClip({ ...ugcScene, tier: "credit" }, hf)[0] === "seedance", "with no n8n connected, the credit tier goes straight to the best engine");
has(C.routeClip({ ...ugcScene, tier: "economy" }, every)[0] === "seedance", "economy never sends a vertical text-to-video scene to a landscape-only engine");
has(C.routeClip({ ...ugcScene, fromFrame: true, tier: "economy" }, every)[0] === "minimax", "economy, from a frame: the free MiniMax credit first");
has(C.routeClip(ugcScene, mm).length === 0, "MiniMax alone cannot make a vertical scene from text — no crop, it is left out");
has(C.routeClip({ ...ugcScene, fromFrame: true }, mm)[0] === "minimax", "but can from a frame, where the frame decides the shape");
has(C.routeClip({ pipeline: "photo_to_video", aspect: "9:16", fromFrame: true, tier: "best" }, every)[0] === "minimax", "photo to video: MiniMax Hailuo image-to-video first");
has(C.routeClip({ pipeline: "explainer", aspect: "16:9", fromFrame: false }, mm)[0] === "minimax", "a landscape explainer runs on the free credit alone");
has(!C.routeClip({ pipeline: "trailer", aspect: "16:9", fromFrame: true }, { FAL_KEY: "f" }).includes("seedance-fal"), "fal's Seedance is never asked to start from a frame");
has(C.routeClip(ugcScene, nothing).length === 0, "nothing connected, nothing routed");
has(C.routeClip({ ...ugcScene, prefer: "seedance-fal" }, every)[0] === "seedance-fal", "an engine can be preferred, and only when it can make the scene");
has(C.durationFor("minimax", 4) === 6 && C.durationFor("minimax", 8) === 10 && C.durationFor("minimax", 30) === 10, "MiniMax clips are 6s or 10s");
has(C.durationFor("seedance", 7) === 7 && C.durationFor("seedance", 40) === 15 && C.durationFor("kling", 6) === 10, "Seedance 4–15s, Kling 5 or 10s");
has(C.tierFrom({ VIDEO_QUALITY: "economy" }) === "economy" && C.tierFrom({}) === "credit" && C.tierFrom({}, "Best") === "best" && C.tierFrom({ VIDEO_QUALITY: "best" }, "MiniMax credit") === "credit", "quality comes from the video's answer, then VIDEO_QUALITY, else the MiniMax credit");
const n8nOnly = { N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/x", N8N_WEBHOOK_TOKEN: "t" };
has(C.voiceDirect({ ...n8nOnly, ...mm }) === false && C.voiceDirect({ ...n8nOnly, ...mm }, "best") === true && C.voiceDirect(mm) === true, "voices go through n8n on the credit tier, direct otherwise");
for (const engine of ["seedance", "kling", "minimax", "seedance-fal"]) {
  const parsed = C.parseProvider(C.providerOf(engine, "abc-123"));
  has(parsed?.engine === engine && parsed.id === "abc-123", `${engine}: its request is found again from the row`);
}
has(C.parseProvider("fal:xyz") === null && C.parseProvider("minimax:speech") === null && C.parseProvider("n8n:minimax") === null, "lip sync, music, compose and voice rows are never read as clips");
has(E.engineHealth("video", mm) === "available" && E.engineHealth("voice", mm) === "available", "a MiniMax key alone renders clips and voices — no n8n needed");
const vertical = { pipeline: "ugc_influencer", aspect: "9:16", music: "none", scenes: [{ n: 1, duration: 5, voiceover: "", engine: "video", visual: "", shot: "", onScreenText: "", motionPrompt: "x", sound: "" }] };
has(E.renderCost(vertical, hf) === C.ENGINES.seedance.cost, "the price shown is the price of the engine that will make it");

const clipRoute = readFileSync(join(root, "src/app/api/video/[id]/render/clip/route.ts"), "utf8");
has(/verifyFalToken\(id, version, `clip:\$\{scene\}`/.test(clipRoute), "a clip webhook carries our token for this video, version and scene");
has(/return NextResponse\.json\(\{ challenge: body\.challenge \}\)/.test(clipRoute), "MiniMax's address check is answered");
has(/state = await clipStatus\(engine, current\.id\)/.test(clipRoute), "the result is asked of the engine itself, not read off the body");
has(/verifyFalSignature/.test(clipRoute), "fal's deliveries are checked against fal's own signature");
has(/current\.engine !== engine\) return NextResponse\.json\(\{ ok: true, ignored: true \}\)/.test(clipRoute), "a delivery the scene is no longer waiting on is ignored");
has(/retryClip\(/.test(clipRoute), "a failed clip is handed to the next engine before it is called failed");
has(/chain\.slice\(chain\.indexOf\(input\.failed\) \+ 1\)/.test(results), "the fallback chain only moves forward");
has(/submitClip\(/.test(render) && /ensureKeyframe\(/.test(render) && /speak\(/.test(render), "render routes each clip, makes the UGC keyframe first, and voices lines direct");
const providers = readFileSync(join(root, "src/lib/video/providers.ts"), "utf8");
has(/generate_audio: false/.test(providers), "generated clips bring no audio of their own to fight the voice and music");
has(!/console\.log/.test(providers) && /process\.env\.HF_API_KEY_SECRET/.test(providers) && !/HF_API_KEY_SECRET/.test(readFileSync(join(root, "src/lib/video/clip-engines.ts"), "utf8").replace(/env\.HF_API_KEY_SECRET/g, "")), "keys are read on the server and never logged");

has(/retryClip\(service, \{ videoId: id, version, n, failed: "n8n"/.test(callback), "a clip n8n could not make goes on to the next engine instead of failing");
has(/kind === "voice" && process\.env\.MINIMAX_API_KEY/.test(callback) && /speak\(/.test(callback), "a voice line n8n could not make is voiced by MiniMax directly");
const studio = readFileSync(join(root, "src/app/api/video/[id]/route.ts"), "utf8") + readFileSync(join(root, "src/lib/video/state.ts"), "utf8");
has(/row\.provider === "n8n:minimax"[\s\S]{0,200}retryClip\(/.test(studio), "an n8n clip that never came back is handed on, not failed");
has(/for \(const engine of chain\)[\s\S]{0,120}engine === "n8n"/.test(render), "render walks each chain in order, n8n included");

console.log("\nthe MiniMax usage credit on n8n");
for (const said of ["MiniMax: insufficient balance (1008)", "Your credits have been exhausted", "quota exceeded for this account", "402 Payment Required", "Out of credits — top up to continue", "usage limit reached"]) {
  has(K.isCreditExhausted(said), `"${said}" reads as the credit running out`);
}
for (const said of ["rate limit exceeded, try again later", "429 Too Many Requests", "1002", "MiniMax refused the prompt as sensitive", "nothing returned", ""]) {
  has(!K.isCreditExhausted(said), `"${said || "(empty)"}" does not`);
}
has(K.pauseHours({}) === 24 && K.pauseHours({ N8N_CREDIT_PAUSE_HOURS: "6" }) === 6 && K.pauseHours({ N8N_CREDIT_PAUSE_HOURS: "nope" }) === 24, "n8n is paused for 24h by default, then tried again");
const wideScene = { pipeline: "explainer", aspect: "16:9", fromFrame: false, tier: "credit" };
has(C.routeClip(wideScene, every).slice(0, 2).join() === "n8n,minimax", "credit tier: n8n first, then the main MiniMax API");
has(C.routeClip({ ...wideScene, skip: ["n8n"] }, every)[0] === "minimax", "with n8n paused, the main API is first — immediately");
has(C.routeClip({ ...ugcScene, tier: "credit", skip: ["n8n"] }, every)[0] === "seedance", "and a vertical scene the main API cannot make from text goes on to Seedance");
has(C.voiceDirect({ ...n8nOnly, ...mm }, "credit", true) === true, "with n8n paused, voices go to MiniMax directly");
has(E.renderCost(vertical, every, "MiniMax credit", ["n8n"]) === C.ENGINES.seedance.cost + E.COMPOSE_COST && E.renderCost(vertical, every, "MiniMax credit") === C.ENGINES.n8n.cost + E.COMPOSE_COST, "the price quoted follows the pause");
has(/isCreditExhausted\(error\)[\s\S]{0,200}pauseN8n\([\s\S]{0,120}failoverN8n\(/.test(callback), "the first 'credit spent' reply pauses n8n and hands the whole render on at once");
has(/row\.provider !== "n8n:minimax"\) return NextResponse\.json\(\{ ok: true, ignored: true \}\)/.test(callback), "a late n8n reply for a job already handed on is ignored");
has(/n8nPausedUntil\(/.test(render) && /skip \}\)/.test(render), "new renders skip a paused n8n");
has(/\.eq\("provider", "n8n:minimax"\)[\s\S]{0,60}\.eq\("status", "running"\)/.test(results), "the hand-off takes only the render's n8n jobs still waiting");

/* The studio is a workspace: the Director's chat edits the video in words. */
const studioPage = readFileSync(join(root, "src/app/dashboard/video/[id]/page.tsx"), "utf8");
has(/<DirectorChat/.test(studioPage) && /onAsk=\{\(text\) => void plan\(\{ note: text \}\)\}/.test(studioPage), "the studio has the Director's chat, and a message there makes a new version");
has(/Change only scene \$\{scene\.n\}, keep every other scene exactly as it is/.test(studioPage), "a scene can be changed on its own");
has(/payment required\|402/.test(studioPage) && /out of credit, so no clips were made and nothing was charged/.test(studioPage), "a render that made nothing says why, in words");

/* Videos open in the workspace, like a website. */
const vws = readFileSync(join(root, "src/lib/video/workspace.ts"), "utf8");
const vboard = readFileSync(join(root, "src/app/api/video/[id]/board/route.ts"), "utf8");
const vbuild = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
const vpreview = readFileSync(join(root, "src/app/preview/[projectId]/route.ts"), "utf8");
const vstart = readFileSync(join(root, "src/app/dashboard/components/StartBuildButton.tsx"), "utf8");
has(/projectId: workspace\.id/.test(vstart) && /router\.push\(`\/dashboard\/project\/\$\{workspace\.id\}/.test(vstart), "the Video tab opens the workspace on a project linked to the video");
has(/project\.intent === VIDEO_INTENT/.test(vbuild) && /startVideoTurn\(/.test(vbuild), "a video project's messages plan and render it, not build a page");
has(/planVideo\(writer, userId, video\.id, first \? \{ fill \} : \{ note: prompt \}\)/.test(vws) && /startRender\(writer, userId, video\.id/.test(vws), "the first message plans it; every one after revises it; both render");
const vplan = readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8");
has(vplan.indexOf("unfilledPlaceholders(brief)") > 0 && vplan.indexOf("unfilledPlaceholders(brief)") < vplan.indexOf("currentBalance("), "a first plan with [BLANKS] left is stopped before any credit");
has(/FILLED\}\\n\$\{fill\}/.test(vplan) && /first && prompt\.trim\(\) && prompt\.trim\(\) !== \(video\.brief/.test(vws), "a reply before the first plan fills the blanks, and is kept with the brief");
has(/owner\?\.intent === VIDEO_INTENT/.test(vpreview) && /videoBoardHtml\(/.test(vpreview), "the preview iframe shows the video board");
has(/verifyBoardToken\(id/.test(vboard) && /Access-Control-Allow-Origin/.test(vboard) && /\{ video: video \? \{ id: video\.id, status: video\.status, title: video\.title \} : null, latest, renders, final \}/.test(vboard), "the board reads its video's state with a token for that video only");
has(/setTimeout\(load,busy\?6000:30000\)/.test(vws), "the board updates itself as clips land");
has(/rendered\.status === 402[\s\S]{0,300}you have \$\{await balanceOf/.test(vws) && /say "render it"/.test(vws), "short of credits, the chat says how many it needs and how many you have");
has(/const renderOnly = !first && RENDER_ONLY\.test/.test(vws), "\"render it\" renders the current plan without planning it again");
has(/grid-template-columns:minmax\(0,1fr\)/.test(vws) && /overflow-x:hidden/.test(vws), "the video board fits a phone: nothing wider than the screen");
/* n8n's queue: five at a time, the rest wait — not failures. */
const renderLib = readFileSync(join(root, "src/lib/video/render.ts"), "utf8");
const cb = readFileSync(join(root, "src/app/api/video/[id]/render/callback/route.ts"), "utf8");
has(/STALE_AFTER_MS = 30 \* 60 \* 1000/.test(renderLib), "a queued n8n clip has 30 minutes before it is called lost");
has(/name === "TimeoutError"\) return \{ job, ok: true \}/.test(renderLib), "a slow answer from n8n is its queue, not a refusal");
has(/const late = row\?\.status === "failed" && url !== null;/.test(cb) && /row\.provider !== "n8n:minimax"/.test(cb), "a finished clip that arrives late is still taken — while it is still n8n's");
/* The final cut, made here when there is no fal key. */
const local = readFileSync(join(root, "src/lib/video/compose-local.ts"), "utf8");
const prod = readFileSync(join(root, "src/lib/video/production.ts"), "utf8");
const composeRoute = readFileSync(join(root, "src/app/api/video/[id]/render/compose/route.ts"), "utf8");
const stateSrc = readFileSync(join(root, "src/lib/video/state.ts"), "utf8");
const nextConfig = readFileSync(join(root, "next.config.mjs"), "utf8");
has(/if \(!falConfigured\(\)\) \{\s*await advanceLocal\(/.test(prod), "with no FAL_KEY, a finished render is cut on this server");
has(/provider: "local", status: "running"/.test(prod) && /render\/compose\?v=\$\{version\}&t=\$\{falToken\(videoId, version, "compose-local"\)\}/.test(prod), "the cut is claimed once and run in its own route");
has(/verifyFalToken\(id, version, "compose-local"/.test(composeRoute) && /maxDuration = 300/.test(composeRoute), "the compose route takes only its own token, with a full time budget");
has(/tpad=stop_mode=clone/.test(local) && /drawtext=fontfile=/.test(local) && /amix=inputs=2/.test(local) && /"concat"/.test(local), "each scene fitted, held, titled and voiced, then all joined in order");
has(/storage\.from\("video-assets"\)\.upload\(path/.test(local) && /status: "done", output_path: `storage:\$\{path\}`/.test(local), "the MP4 is stored and becomes the version's final cut");
has(/await advance\(service, id, video\.current_version/.test(stateSrc), "a finished render that missed its cut gets one when it is next looked at");
has(/serverExternalPackages: \["ffmpeg-static"\]/.test(nextConfig) && /node_modules\/ffmpeg-static\/ffmpeg/.test(nextConfig), "the ffmpeg binary is shipped with the compose route");
/* Narrated throughout, unless narration is turned off. */
const directorSrc = readFileSync(join(root, "src/lib/video/director.ts"), "utf8");
const pipelinesSrc = readFileSync(join(root, "src/lib/video/pipelines.ts"), "utf8");
has(/- \$\{narrationRule\(answers\.voice\)\}/.test(directorSrc) && /write a voiceover line for EVERY scene/.test(directorSrc), "a narrated video gets a voice line in every scene, not just the last");
has(/no voiceover\|music only\|none/.test(directorSrc), "No voiceover / Music only still means none");
has(!/initial: "Music only"/.test(pipelinesSrc) && /id: "voice", label: "Voiceover", options: \["Male", "Female", "No voiceover"\], initial: "Male"/.test(pipelinesSrc), "trailers ask for a voice, and every type defaults to narrated");
/* The finished video in the chat, with Download. */
const announce = readFileSync(join(root, "src/lib/video/announce.ts"), "utf8");
const fileRoute = readFileSync(join(root, "src/app/api/video/[id]/file/route.ts"), "utf8");
const msgRow = readFileSync(join(root, "src/app/dashboard/components/workspace/MessageRow.tsx"), "utf8");
const falRoute = readFileSync(join(root, "src/app/api/video/[id]/render/fal/route.ts"), "utf8");
const localCut = readFileSync(join(root, "src/lib/video/compose-local.ts"), "utf8");
has(/label: "video:1", href: finalVideoUrl\(/.test(announce) && /dedupe_key: `video-final:/.test(announce), "a finished video is posted to the chat once, with the video in it");
has(/await announceFinal\(service, \{ videoId, version, origin/.test(localCut) && /if \(media\) await announceFinal\(/.test(falRoute), "whichever way the cut was made — here or on fal");
has(/<ReplyVideos videos=\{videos\} \/>/.test(msgRow) && /<video[\s\S]{0,80}controls[\s\S]{0,40}playsInline/.test(msgRow), "the chat plays it");
has(/download \? \{ download: fileName\(/.test(fileRoute) && /createSupabaseServerClient/.test(fileRoute) && /\.eq\("engine", "compose"\)/.test(fileRoute), "Download saves the MP4 itself — the owner's, under their session");
/* Undo, Redo and Versions on a video: a move between cuts already made —
   never a brief for the director, which would plan and render it all again. */
{
  const VV = await import(join(dir, "versions.js"));
  const go = (prompt, current, versions = [1, 2, 3, 4]) => {
    const move = VV.resolveVideoMove(prompt, current, versions);
    return move.kind === "go" ? `${move.how}:${move.to}` : move.kind;
  };
  has(go("Undo the last change", 4) === "undo:3" && go("undo", 3) === "undo:2", "Undo plays the cut before the one playing");
  has(go("Undo the last change", 1) === "refuse", "and stops at the first cut, no loop");
  has(go("Redo", 2) === "redo:3" && go("Redo", 4) === "refuse", "Redo plays the next cut, and stops at the newest");
  has(go("Go back to version 2", 4) === "pick:2" && go("Go back to version 9", 4) === "refuse", "a named version is that exact cut — one that does not exist is said so");
  has(go("Go back to version 4", 4) === "refuse", "the cut already playing is not switched to again");
  has(go("show me my versions", 4) === "list", "asking for the versions lists them");
  has(VV.isVideoVersionAsk("undo", false) && VV.isVideoVersionAsk("redo", false) && VV.isVideoVersionAsk("go back to version 2", false), "typed undo / redo / version are moves");
  has(!VV.isVideoVersionAsk("make the intro shorter", false) && !VV.isVideoVersionAsk("put the old voice back", false), "a change is still a brief for the director");
  has(VV.isVideoVersionAsk("Undo the last change", true), "the Undo button is always a move");
  has(VV.statusOf([{ engine: "compose", status: "done" }]) === "ready" && VV.statusOf([{ engine: "video", status: "running" }]) === "rendering" && VV.statusOf([]) === "planned", "a cut switched to says what it is: made, rendering, or only planned");
  const build = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
  const planner = readFileSync(join(process.cwd(), "src/lib/video/plan-video.ts"), "utf8");
  const state = readFileSync(join(process.cwd(), "src/lib/video/state.ts"), "utf8");
  has(build.indexOf("await moveVideoVersion(") > 0 && build.indexOf("await moveVideoVersion(") < build.indexOf("const turn = await startVideoTurn("), "the build route moves between cuts before anything reaches the director");
  has(/Math\.max\(video\.current_version \?\? 0, \(newestRow\?\.version/.test(planner), "a change after Undo is saved as the newest number — never over a cut that exists");
  has(/versions\?\.find\(\(row\) => row\.version === video\.current_version\)/.test(state), "the preview plays the cut that is current, not just the newest");
  has(/project\.intent === FLIER_INTENT && service\) \{\s*const moved = await moveFlierVersion\(/.test(build), "Undo on a flier moves between its sets — it designs nothing and charges nothing");
}

/* The video in the chat, every time. */
{
  const announce = readFileSync(join(process.cwd(), "src/lib/video/announce.ts"), "utf8");
  const stateSrc = readFileSync(join(process.cwd(), "src/lib/video/state.ts"), "utf8");
  const moves = readFileSync(join(process.cwd(), "src/lib/video/versions.ts"), "utf8");
  const chat = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
  const row = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/MessageRow.tsx"), "utf8");
  has(/if \(error\) return;\s*await service\.from\("projects"\)\.update\(\{ last_build_at/.test(announce), "a cut is announced once; a repeat inserts nothing and reloads nothing");
  has(/video-final:\$\{id\}:\$\{video\.current_version\}/.test(stateSrc) && /if \(!told\) await announceFinal\(/.test(stateSrc), "a cut made but never put in the chat is put there when the video is next looked at");
  has(/label: "video:1", href: finalVideoUrl\(input\.origin, found\.videoId, move\.to\)/.test(moves), "switching to a made cut puts its MP4 in the chat, with Download");
  has(/projectIntent !== "video" && projectIntent !== "flier"/.test(chat) && /message\.at > followedTo\.current/.test(chat), "the open chat follows a video's or flier's thread, so late messages appear without a reload");
  has(/if \(message\.links\?\.length && !next\[at\]\.links\?\.length\) next\[at\] = \{ \.\.\.next\[at\], links: message\.links \}/.test(chat), "a message already showing is not added twice — it is given its media");
  has(/was deleted\. It stays in Recently deleted/.test(row) && /couldn&apos;t be loaded just now/.test(row), "media that cannot load says why instead of vanishing");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
