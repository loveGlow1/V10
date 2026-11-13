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
  files: ["pipelines.ts", "plan.ts", "engines.ts", "render.ts", "fal.ts", "clip-engines.ts", "credit.ts", "versions.ts", "editor.ts", "exports.ts", "sound.ts", "probe.ts", "assets.ts", "cut-settings.ts", "cut-filters.ts", "timeline.ts", "media-files.ts", "editor-timeline.ts", "voices.ts", "cast.ts", "continuity.ts", "pricing.ts", "look.ts", "chapters.ts", "context-files.ts"].map((f) => join(process.cwd(), "src/lib/video", f)),
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
const ED = await import(join(dir, "editor.js"));
const X = await import(join(dir, "exports.js"));
const SD = await import(join(dir, "sound.js"));

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

console.log("pipelines");
has(P.PIPELINE_IDS.length === 12, "twelve pipelines");
has(P.GRID.length === 11 && !P.GRID.includes("photo_to_video") && P.GRID.includes("clip_edit") && P.GRID.includes("full_movie"), "eleven on the grid (Edit my clips and Full Movie among them), Photo → Video on its own row");
for (const id of P.PIPELINE_IDS) {
  const p = P.PIPELINES[id];
  has(p.id === id && p.stages.length >= 4 && p.questions.length >= 2 && p.director.length >= 1 && p.engines.includes(p.defaultEngine), `${id}: stages, questions, director rules, engines`);
  has(p.questions.every((q) => !q.initial || q.options.includes(q.initial)), `${id}: every default is one of its options`);
}
for (const id of P.PIPELINE_IDS) {
  const p = P.PIPELINES[id];
  const seconds = L.secondsFrom(P.answersFor(p, {}).length);
  has(/\[[A-Z]/.test(p.template) && (p.template.includes(`${seconds}-second`) || (seconds >= 300 && p.template.includes(`${seconds / 60}-minute`))), `${id}: a template with [PLACEHOLDERS], timed to its default ${seconds}s`);
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
has(clips.every((j) => j.prompt.includes(R.NO_SPEECH)), "no clip is asked to speak — every spoken word comes from the voice model");
has(R.clipPrompt("x".repeat(3000)).length <= 2000, "the picture-only prompt still fits MiniMax's 2000 characters");
const composeSrc = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(process.cwd(), "src/lib/video", f), "utf8")).join("\n");
has(/audio: cut\.audio \?\? \(narrated \? "voiceover" : "original"\)/.test(composeSrc) && /\(Boolean\(talking\) \|\| keepsOriginal\)/.test(composeSrc), "a narrated video's cut is the script's voice only by default — a lip-synced clip's sound is that voice, and stays");
const branded = L.qaAndRepair(L.normalizePlan({ cta: "Try QuickStark", scenes: [{ duration: 5, visual: "a", voiceover: "Then I found QuickStark.", onScreenText: "QuickStark.Ai did this", motionPrompt: "x" }, { duration: 5, visual: "b", voiceover: "Go to quickstark.tech", motionPrompt: "y" }] }, "ugc_influencer", { length: "10s" }));
has(branded.plan.scenes[0].voiceover === "Then I found QuickStark.Ai." && branded.plan.scenes[0].onScreenText === "QuickStark.Ai did this", "the name is said and shown as QuickStark.Ai", JSON.stringify(branded.plan.scenes[0]));
has(branded.plan.cta === "Try QuickStark.Ai" && branded.plan.scenes[1].voiceover === "Go to quickstark.tech", "the CTA too — a web address is left alone");
const boardSrc = readFileSync(join(process.cwd(), "src/lib/video/workspace.ts"), "utf8");
const boardShow = boardSrc.slice(boardSrc.indexOf("function show(k)"), boardSrc.indexOf("function startedAt"));
has(!/s\.visual/.test(boardShow) && /Filming scene/.test(boardShow), "a scene still filming shows which scene and its line — never the engine prompt");
has(/We couldn\\u2019t film this video just now/.test(boardSrc) && /You haven\\u2019t been charged for the scenes/.test(boardSrc), "a video that could not be made says so plainly, once, and that nothing was charged for it");
has(!/could not be made/.test(boardSrc) && /\$\('cap'\)\.hidden=!\(clip&&s\.voiceover\)/.test(boardSrc), "no red per-scene alarms, and no caption laid over the waiting card");
const studioSrc = readFileSync(join(process.cwd(), "src/app/dashboard/video/[id]/page.tsx"), "utf8");
has(/sceneFailure\(failure\)/.test(studioSrc) && !/title=\{failure\}/.test(studioSrc), "the studio never shows an engine's own error (keys, providers) to the person");
const integrationsSrc = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/Integrations.tsx"), "utf8");
const integrationsList = readFileSync(join(process.cwd(), "src/app/dashboard/integrations.ts"), "utf8");
has(!/building is live/.test(integrationsSrc) && /askChat\(\{ projectId, texts: \[integration\.request/.test(integrationsSrc), "Integrations: Add on Storage / email login really builds it through the chat — no placeholder message");
has(/upload/i.test(integrationsList.slice(integrationsList.indexOf('id: "storage"'))) && !/>Soon</.test(integrationsSrc), "the storage request names uploads (what turns storage on); no row is a dead end");
{
  const rows = integrationsList.split(/\n  \{\n/).slice(1);
  const dead = rows.filter((row) => !/id: "github"/.test(row) && !/request:/.test(row));
  has(dead.length === 0, "every integration connects: GitHub, or a build request — with the person's own keys where the service needs them", String(dead.length));
  has(/name: "STRIPE_SECRET_KEY"/.test(integrationsList) && /name: "OPENAI_API_KEY"/.test(integrationsList) && /name: "ANTHROPIC_API_KEY"/.test(integrationsList) && /name: "GEMINI_API_KEY"/.test(integrationsList) && /name: "RESEND_API_KEY"/.test(integrationsList) && /name: "TWILIO_AUTH_TOKEN"/.test(integrationsList), "each keyed service asks for the key name the builder detects it by");
  has(/\/api\/projects\/\$\{projectId\}\/secrets`, \{\s*method: "POST"/.test(integrationsSrc) && /type="password"/.test(integrationsSrc) && /setValues\(\{\}\)/.test(integrationsSrc) && !/NEXT_PUBLIC_/.test(integrationsList), "keys go to the app's server environment through the Server keys route — masked, cleared once used, never NEXT_PUBLIC_");
}
{
  const c = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(process.cwd(), "src/lib/video", f), "utf8")).join("\n");
  has(/setpts=PTS\*\$\{input\.stretch\.toFixed\(4\)\}/.test(c) && /Math\.min\(1\.4, Math\.max\(1, seconds \/ clip\)\)/.test(c), "a clip shorter than its line is slowed to fit (up to 1.4×) before its last frame is held");
  has(/loudnorm=I=-14:TP=-1\.5:LRA=11/.test(c) && /"-c:v", "copy", "-af", "loudnorm/.test(c), "the whole cut is set to -14 LUFS, the picture copied, not encoded again");
  has(/cut\.captions && \(hasVoice \|\| cut\.audio === "none"\) \? scene\.voiceover/.test(c) && /scene\.n === last && cut\.endCard/.test(c), "captions are the spoken line; the end card sits on the last scene");
  has(/talking \|\| cut\.audio === "original" \|\| cut\.audio === "none" \? null : pick\(scene\.n, "voice"\)/.test(c) && /const keepsOriginal = cut\.audio === "original" \|\| cut\.audio === "mix"/.test(c) && /!cut\.muted\.has\(scene\.n\)/.test(c), "the cut's audio choice is honoured: voice-over only, original sound only, or both — and muted scenes stay silent");
  const P2 = L.normalizeCut({ audio: "original", captions: false, endCard: "QuickStark.Ai", muted: [1, "2", -3, 1], junk: 1 });
  has(P2.audio === "original" && P2.captions === false && P2.endCard === "QuickStark.Ai" && P2.muted.join() === "1,2" && !("junk" in P2) && L.normalizeCut({ audio: "loud" }) === undefined, "cut settings are read strictly — anything unknown is dropped");
  const kept = L.qaAndRepair(L.normalizePlan({ cut: { audio: "mix", endCard: "Try QuickStark" }, scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }] }, "commercial_ad", { length: "5s" }));
  has(kept.plan.cut?.audio === "mix" && kept.plan.cut?.endCard === "Try QuickStark.Ai", "a plan keeps its cut settings through QA, the brand in full on the end card");
}
{
  /* The editor: only what was asked changes; the rest is reused. */
  const made = L.normalizePlan({ title: "Four Fliers", aspect: "9:16", locks: { creator: "brunette woman, cream sweater" }, scenes: [1, 2, 3, 4].map((n) => ({ duration: 5, visual: "v", voiceover: `Line ${n}.`, onScreenText: n === 4 ? "Try it" : "", motionPrompt: `prompt ${n}` })) }, "ugc_influencer", {});
  const audioOnly = ED.applyEdit(made, ED.normalizeEdit({ reply: "Original voices.", cut: { audio: "original", endCard: "QuickStark" } }, made));
  has(audioOnly.refilm.length === 0 && audioOnly.revoice.length === 0 && audioOnly.carry.every((c) => c.clip && c.voice) && audioOnly.plan.cut.audio === "original" && audioOnly.plan.cut.endCard === "QuickStark.Ai", "\"use the original voices\" re-films and re-voices nothing — a new cut only");
  has(R.jobsFor(audioOnly.plan, {}).every((j) => j.kind === "clip"), "a cut of the clips' own sound orders no voice lines");
  const refilm = ED.applyEdit(made, ED.normalizeEdit({ scenes: [{ n: 3, action: "refilm", motionPrompt: "closer shot, brunette woman, cream sweater" }, { n: 2, action: "revoice", voiceover: "A brand new line." }] }, made));
  has(refilm.refilm.join() === "3" && refilm.revoice.join() === "2" && refilm.carry.filter((c) => c.clip).length === 3 && refilm.plan.scenes[2].motionPrompt.startsWith("closer"), "re-filming scene 3 and re-voicing scene 2 reuses every other clip and line");
  const reread = ED.applyEdit(made, ED.normalizeEdit({ scenes: [{ n: 2, action: "revoice" }] }, made));
  has(reread.revoice.join() === "2" && reread.plan.scenes[1].voiceover === made.scenes[1].voiceover && reread.refilm.length === 0, "\"read it again\": a revoice with no new words records the same line afresh");
  const sameLine = ED.applyEdit(made, ED.normalizeEdit({ scenes: [{ n: 1, action: "revoice", voiceover: made.scenes[0].voiceover }] }, made));
  has(sameLine.revoice.join() === "1", "a revoice with the same words is recorded again, not skipped");
  const older = { ...made, scenes: made.scenes.map((sc, i) => (i === 1 ? { ...sc, voiceover: "The old line she said.", onScreenText: "Day 1" } : sc)) };
  const hist = ED.historyBrief(made, [{ version: 3, note: "first cut", plan: older }]);
  has(/VERSION 3 \("first cut"\)/.test(hist) && /scene 2 spoken: The old line she said\./.test(hist) && /scene 2 on screen: Day 1/.test(hist) && ED.historyBrief(made, [{ version: 2, plan: made }]) === "", "the editor sees what earlier versions said, so the previous voice-over comes back word for word");
  has(ED.readEditJson('Sure! ```json\n{"reply":"ok","scenes":[{"n":1,"action":"keep"},],}\n``` hope that helps {x}').reply === "ok" && ED.readEditJson('{"reply":"a } brace in text","scenes":[]} trailing {"other":1}').reply === "a } brace in text" && ED.readEditJson("no json here") === null, "the editor's answer is read even with chatter, fences, trailing commas or braces in its text");
  const editSrc = readFileSync(join(process.cwd(), "src/lib/video/editor.ts"), "utf8");
  has(/for \(let attempt = 0; attempt < 3; attempt \+= 1\)/.test(editSrc) && /YOUR LAST ANSWER WAS CUT OFF/.test(editSrc) && /THE PERSON ASKS:\\n\$\{input\.instruction\}`/.test(editSrc), "the editor tries up to three times, is told what was wrong, and reads the whole request");
  const applyNoop = readFileSync(join(process.cwd(), "src/lib/video/apply-edit.ts"), "utf8");
  has(/YOUR LAST ANSWER CHANGED NOTHING/.test(applyNoop) && /nothing was changed or charged/.test(applyNoop) && /\.limit\(12\)/.test(applyNoop), "an answer that changes nothing is asked again, and never charged as a change");
  const removed = ED.applyEdit(made, ED.normalizeEdit({ scenes: [{ n: 2, action: "remove" }], order: [4, 1, 3] }, made));
  has(removed.plan.scenes.map((s) => s.n).join() === "1,2,3" && removed.carry.map((c) => `${c.from}>${c.to}`).join() === "4>1,1>2,3>3" && removed.refilm.length === 0, "removing and reordering scenes renumbers them and carries each clip with its scene");
  const junk = ED.normalizeEdit({ replan: "yes", scenes: [{ n: 9, action: "remove" }, { n: 1, action: "refilm" }, { n: 2, action: "explode" }], order: [1, 1] }, made);
  has(junk.replan === false && junk.scenes.length === 0 && !junk.order && junk.reply === "Done.", "the editor's answer is read strictly — unknown scenes, actions and orders are dropped");
  const apply = readFileSync(join(process.cwd(), "src/lib/video/apply-edit.ts"), "utf8");
  const ws = readFileSync(join(process.cwd(), "src/lib/video/workspace.ts"), "utf8");
  has(/: await editVideo\(\{ writer, userId, videoId: video\.id, instruction: prompt, origin, model: input\.model \}\)/.test(ws) && /if \(decided\.edit\.replan\) return null;/.test(apply), "a message on a made video is an edit; only a different video is planned again");
  has(/status: "done", output_path: picture\.output_path/.test(apply) && /onlyMissing: true/.test(apply) && /keyframePath\(video\.user_id as string, videoId, nextVersion\)/.test(apply), "carried clips and lines are filed under the new version as they are, the keyframe too; only the missing pieces render");
  has(/await advance\(service, videoId, nextVersion, origin\)/.test(apply), "with nothing to make, the new cut is made at once");
}
{
  has(X.exportsFor("9:16").join() === "feed,whatsapp" && X.exportsFor("16:9").join() === "vertical,feed,whatsapp" && X.exportPath("u/v/v2/final.mp4", "feed") === "u/v/v2/final-feed.mp4", "every cut gets the ready-to-post shapes it is not already, stored beside it");
  const c = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(process.cwd(), "src/lib/video", f), "utf8")).join("\n");
  has(/Math\.floor\(\(15 \* 8 \* 1024\) \/ Math\.max\(1, input\.seconds\)\) - 140/.test(c) && /boxblur=24:2/.test(c), "the WhatsApp file is sized under 16 MB; feed and vertical keep the whole picture over a blurred fill");
  const st = readFileSync(join(process.cwd(), "src/lib/video/state.ts"), "utf8");
  const fr = readFileSync(join(process.cwd(), "src/app/api/video/[id]/file/route.ts"), "utf8");
  const bd = readFileSync(join(process.cwd(), "src/lib/video/workspace.ts"), "utf8");
  has(/exports,\n  \}\);/.test(st) && /isExportKind\(format\)/.test(fr) && /state\.exports\|\|\[\]/.test(bd) && /closest\('a\.dl'\)/.test(bd), "the preview offers each version with its own Download, saved to Photos on a phone");
}
{
  /* No sound at all, and the Sound switch. */
  has(L.normalizeCut({ audio: "none" })?.audio === "none" && L.usesVoice({ audio: "none" }) === false && L.usesVoice(undefined) === true, "a cut can be silent, and a silent cut uses no voice lines");
  const silent = L.normalizePlan({ cut: { audio: "none" }, scenes: [{ duration: 5, visual: "a", voiceover: "Hi.", motionPrompt: "x" }] }, "ugc_influencer", {});
  has(R.jobsFor(silent, {}).every((j) => j.kind === "clip") && E.renderCost(silent, {}) < E.renderCost({ ...silent, cut: undefined }, {}), "a silent video orders and charges no voice lines");
  const c = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(process.cwd(), "src/lib/video", f), "utf8")).join("\n");
  has(/cut\.audio !== "none" && !cut\.muted\.has/.test(c) && /cut\.audio === "original" \|\| cut\.audio === "none" \? null : pick/.test(c) && /hasVoice \|\| cut\.audio === "none"\) \? scene\.voiceover/.test(c), "a silent cut has no voice and no clip sound — and keeps the script as captions");
  has(Object.keys(SD.SOUND_COMMANDS).join() === "voiceover,original,mix,none" && SD.soundCommand(SD.SOUND_COMMANDS.none) === "none" && SD.soundCommand("mute it please") === null, "the Sound switch's four requests are fixed phrases, told apart from an edit");
  const ap = readFileSync(join(process.cwd(), "src/lib/video/apply-edit.ts"), "utf8");
  const ws2 = readFileSync(join(process.cwd(), "src/lib/video/workspace.ts"), "utf8");
  has(/charge: 0 \}\);/.test(ap) && /const audio = soundCommand\(prompt\);/.test(ws2) && /setSound\(/.test(ws2), "switching the sound asks no model and charges nothing");
  has(/entry\.voice && voice &&/.test(ap) && /if \(!scene\.voiceover\.trim\(\) \|\| noVoice\) voice = true;/.test(readFileSync(join(process.cwd(), "src/lib/video/editor.ts"), "utf8")), "muting keeps the voice lines, so turning the sound back on records nothing again");
  const pp = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
  has(/project\.intent !== "video"\) return;/.test(pp) && /isSound\(data\.detail\?\.sound\)\) askChat\(\{ projectId, texts: \[SOUND_COMMANDS\[data\.detail\.sound\]\] \}\)/.test(pp), "the preview's switch reaches the chat only as one of the four fixed choices, and only for a video");
  has(/data-s="none">No sound</.test(ws2) && /parent\.postMessage\(\{source:'quickstark-preview',state:'ask',detail:\{sound:s\}\}/.test(ws2), "the finished video has a Sound switch: Voice-over · Original · Both · No sound");
}
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
has(E.renderCost(spokenAvatar, env) === E.CLIP_COST * 2 + E.VOICE_COST + E.cutCost(spokenAvatar, env), "without fal: clips, voice and the cut made here");
has(E.renderCost(spokenAvatar, fal) === E.CLIP_COST * 2 + E.VOICE_COST + E.LIPSYNC_COST + E.MUSIC_COST + E.COMPOSE_COST, "with fal: + lip sync, music and the final MP4");

console.log("\nproduction (Runware)");
const rw = { ...env, RUNWARE_API_KEY: "k" };
has(E.productionEngine(rw) === "runware" && E.productionEngine({ ...rw, FAL_KEY: "f" }) === "runware" && E.productionEngine(fal) === "fal" && E.productionEngine(env) === null, "Runware runs the production line when its key is set; fal otherwise");
has(E.productionEngine({ ...rw, FAL_KEY: "f", VIDEO_PRODUCTION_ENGINE: "fal" }) === "fal", "VIDEO_PRODUCTION_ENGINE pins fal where both keys are set");
has(E.engineHealth("avatar", rw) === "available" && E.engineHealth("music", rw) === "available" && E.engineHealth("compose", env) === "available", "with RUNWARE_API_KEY: lip sync, avatar and music; the cut is always made here");
has(!E.readiness(fixed, rw).notes.some((n) => /lip sync needs/i.test(n)), "the studio stops saying lip sync is missing once Runware is connected");
has(E.creditsForUsd(0.3) === Math.ceil((0.3 * 2.5) / E.usdPerCredit()) && E.creditsForUsd(0) === 1, "credits(usd) = ceil(usd × 2.5 ÷ the price of a credit), at least one");
has(E.runwareJobCredits("lipsync", 6) === E.creditsForUsd(0.0733 * 6) && E.runwareJobCredits("avatar", 6, "draft") === E.creditsForUsd(0.044 * 6), "lip sync and avatars are quoted by the second at Runware's list price");
has(E.runwareJobCredits("music", 10) === E.creditsForUsd(0.0001 * 30), "music is quoted at ACE-Step's 30-second minimum");
has(E.settleRunwareCredits(4, null) === 4 && E.settleRunwareCredits(4, 0.01) === 1 && E.settleRunwareCredits(4, 100) === Math.ceil(4 * 1.1), "settled at Runware's actual cost, never more than 10% over the quote");
has(E.renderCost(spokenAvatar, rw) === C.ENGINES.runware.cost * 2 + E.VOICE_COST + E.runwareJobCredits("lipsync", 5) + E.runwareJobCredits("music", 10) + E.cutCost(spokenAvatar, rw), "with Runware: + lip sync and music by the second, and the cut by its length");
has(E.productionTier("Economy") === "draft" && E.productionTier("Best") === "final" && E.productionTier(null) === "final", "the economy answer takes the draft lip sync and avatar models");
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
has(R.jobCost(jobs) + E.cutCost(fixed) === E.renderCost(fixed), "the price shown is the price charged");
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
has(E.renderCost(vertical, hf) === C.ENGINES.seedance.cost + E.cutCost(vertical, hf), "the price shown is the price of the engine that will make it");

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
has(/kind === "voice" && \(process\.env\.RUNWARE_API_KEY \|\| process\.env\.MINIMAX_API_KEY\)/.test(callback) && /speak\(/.test(callback), "a voice line n8n could not make is voiced by MiniMax directly (on Runware or MiniMax's own API)");
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
has(/<DirectorChat/.test(studioPage) && /onAsk=\{\(text\) => plan\(\{ note: text \}\)\}/.test(studioPage), "the studio has the Director's chat, and a message there makes a new version");
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
has(/planVideo\(writer, userId, video\.id, first \? \{ fill, model: input\.model \} : \{ note: prompt, model: input\.model \}\)/.test(vws) && /startRender\(writer, userId, video\.id/.test(vws), "the first message plans it; every one after revises it; both render");
const vplan = readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8");
has(vplan.indexOf("unfilledPlaceholders(brief)") > 0 && vplan.indexOf("unfilledPlaceholders(brief)") < vplan.lastIndexOf("currentBalance("), "a first plan with [BLANKS] left is stopped before any credit");
has(/FILLED\}\\n\$\{fill\}/.test(vplan) && /first && prompt\.trim\(\) && prompt\.trim\(\) !== \(video\.brief/.test(vws), "a reply before the first plan fills the blanks, and is kept with the brief");
has(/owner\?\.intent === VIDEO_INTENT/.test(vpreview) && /videoBoardHtml\(/.test(vpreview), "the preview iframe shows the video board");
has(/verifyBoardToken\(id/.test(vboard) && /Access-Control-Allow-Origin/.test(vboard) && /\{ video: video \? \{ id: video\.id, status: video\.status, title: video\.title \} : null, latest, renders, final \}/.test(vboard), "the board reads its video's state with a token for that video only");
has(/setTimeout\(load,busy\?6000:30000\)/.test(vws), "the board updates itself as clips land");
has(/rendered\.status === 402[\s\S]{0,300}you have \$\{await balanceOf/.test(vws) && /say "generate it"/.test(vws), "short of credits, the chat says how many it needs and how many you have");
has(/const renderOnly = !first && RENDER_ONLY\.test/.test(vws), "\"render it\" renders the current plan without planning it again");
has(/grid-template-columns:minmax\(0,1fr\)/.test(vws) && /overflow-x:hidden/.test(vws), "the video board fits a phone: nothing wider than the screen");
/* n8n's queue: five at a time, the rest wait — not failures. */
const renderLib = readFileSync(join(root, "src/lib/video/render.ts"), "utf8");
const cb = readFileSync(join(root, "src/app/api/video/[id]/render/callback/route.ts"), "utf8");
has(/STALE_AFTER_MS = 30 \* 60 \* 1000/.test(renderLib), "a queued n8n clip has 30 minutes before it is called lost");
has(/name === "TimeoutError"\) return \{ job, ok: true \}/.test(renderLib), "a slow answer from n8n is its queue, not a refusal");
has(/const late = row\?\.status === "failed" && url !== null;/.test(cb) && /row\.provider !== "n8n:minimax"/.test(cb), "a finished clip that arrives late is still taken — while it is still n8n's");
/* The final cut, made here when there is no fal key. */
const local = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(root, "src/lib/video", f), "utf8")).join("\n");
const prod = readFileSync(join(root, "src/lib/video/production.ts"), "utf8");
const composeRoute = readFileSync(join(root, "src/app/api/video/[id]/render/compose/route.ts"), "utf8");
const stateSrc = readFileSync(join(root, "src/lib/video/state.ts"), "utf8");
const nextConfig = readFileSync(join(root, "next.config.mjs"), "utf8");
has(/if \(!line\) \{\s*await advanceLocal\(/.test(prod) && /if \(line !== "fal"\) \{\s*await advanceLocal\(/.test(prod), "off the fal line, a finished render is cut on this server");
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
const localCut = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(root, "src/lib/video", f), "utf8")).join("\n");
has(/label: "video:1", href: finalVideoUrl\(/.test(announce) && /dedupe_key: `video-final:/.test(announce), "a finished video is posted to the chat once, with the video in it");
has(/await announceFinal\(service, \{ videoId, version, origin/.test(localCut) && /landLineJob\(/.test(falRoute) && /if \(media\) await announceFinal\(/.test(readFileSync(join(root, "src/lib/video/line-results.ts"), "utf8")), "whichever way the cut was made — here or on fal");
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

/* The Runware production line, read from its source. */
const lineSrc = readFileSync(join(root, "src/lib/video/production.ts"), "utf8");
has(/syncModeFor\(voiceSeconds, clipSeconds\)/.test(lineSrc) && /mediaSeconds\(audioUrl\)/.test(lineSrc) && !/sync_mode: "loop"/.test(lineSrc), "lip sync is set from the measured line and clip, never a fixed loop");
has(/lipsyncTask\(/.test(lineSrc) && /avatarTask\(/.test(lineSrc) && /musicTask\(/.test(lineSrc), "lip sync, avatar and music each have a Runware path");
const lineRoute = readFileSync(join(root, "src/app/api/video/[id]/render/line/route.ts"), "utf8");
has(/verifyFalToken\(id, version, `line:/.test(lineRoute) && /settleRunwareLineJob\(/.test(lineRoute) && /named !== taskUUID/.test(lineRoute), "Runware's webhook takes only its own token, and asks Runware before believing it");
has(/settleRunwareLineJob\(/.test(readFileSync(join(root, "src/lib/video/state.ts"), "utf8")), "a quiet Runware job is asked about when the studio polls");
const mixSrc = ["compose-local.ts", "cut-filters.ts", "cut-settings.ts"].map((f) => readFileSync(join(root, "src/lib/video", f), "utf8")).join("\n");
has(/sidechaincompress=threshold=0\.05:ratio=8/.test(mixSrc) && /musicMixArgs\(\{ joined: input\.joined, music: musicPath/.test(mixSrc), "the score goes under the cut, ducked under the voice");

/* Media lengths, read from the header without ffmpeg (probe.ts). */
const Probe = await import(join(dir, "probe.js"));
{
  const wav = new Uint8Array(44 + 48000 * 2);
  const v = new DataView(wav.buffer);
  wav.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0); wav.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  wav.set([..."fmt "].map((c) => c.charCodeAt(0)), 12); v.setUint32(16, 16, true); v.setUint32(28, 32000, true);
  wav.set([..."data"].map((c) => c.charCodeAt(0)), 36); v.setUint32(40, 96000, true);
  has(Math.abs(Probe.seconds(wav) - 3) < 0.001, "a WAV's length from its data chunk and byte rate");
  const mp4 = new Uint8Array(64);
  const m = new DataView(mp4.buffer);
  mp4.set([..."ftyp"].map((c) => c.charCodeAt(0)), 4); mp4.set([..."mvhd"].map((c) => c.charCodeAt(0)), 20);
  m.setUint32(36, 1000); m.setUint32(40, 6500);
  has(Probe.seconds(mp4) === 6.5, "an MP4's length from its mvhd box");
  const mp3 = new Uint8Array(16000 + 4);
  mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
  has(Math.abs(Probe.mp3Seconds(mp3) - 1) < 0.01, "a CBR MP3's length from its bitrate (128 kbps × 1s = 16000 bytes)");
  has(Probe.seconds(new Uint8Array(10)) === null, "and null when it cannot tell — lip sync then cuts off, never repeats a line");
}


/* ── Uploads, stitching and video settings ───────────────────────────── */
console.log("\nuploads and stitching");
const A = await import(join(dir, "assets.js"));
const CS = await import(join(dir, "cut-settings.js"));
const CF = await import(join(dir, "cut-filters.js"));
const T = await import(join(dir, "timeline.js"));
const MF = await import(join(dir, "media-files.js"));
const id1 = "11111111-1111-4111-8111-111111111111", id2 = "22222222-2222-4222-8222-222222222222", id3 = "33333333-3333-4333-8333-333333333333";
has(A.assetKind("video/quicktime") === "video" && A.assetKind("audio/mpeg") === "audio" && A.assetKind("image/webp") === "image" && A.assetKind("application/pdf") === "document" && A.assetKind("application/zip") === "file", "an upload's kind comes from its MIME type");
has(A.uploadProblem({ mime: "video/mp4", size: 401 * 1024 * 1024 }) !== null && A.uploadProblem({ mime: "video/mp4", size: 10, durationS: 3700 }) !== null && A.uploadProblem({ mime: "video/mp4", size: 10, durationS: 3500 }) === null, "clips up to 400 MB and an hour");
has(A.uploadProblem({ mime: "audio/wav", size: 51 * 1024 * 1024 }) !== null && A.uploadProblem({ mime: "application/zip", size: 10 }) !== null, "sound up to 50 MB; other files are refused");
const vids = [
  { id: id1, kind: "video", name: "a.mov", mime: "video/quicktime", status: "ready", durationS: 8.4, width: 1080, height: 1920, hasAudio: true },
  { id: id2, kind: "image", name: "b.png", mime: "image/png", status: "ready", durationS: null, width: 1200, height: 900, hasAudio: null },
  { id: id3, kind: "audio", name: "song.mp3", mime: "audio/mpeg", status: "ready", durationS: 60, width: null, height: null, hasAudio: true },
];
const manifest = A.attachmentManifest(vids);
has(manifest.startsWith("ATTACHMENTS (authoritative, do not infer from the text):") && /- video x1: \[\{assetId: "1111/.test(manifest) && /- audio x1/.test(manifest) && /- image x1/.test(manifest), "the ATTACHMENTS block lists every upload by kind", manifest);
has(/If video x0, the user has NOT attached a video\. Never claim to see one\./.test(A.attachmentManifest([])), "with no video it says so, word for word");
has(A.attachmentIntent("stitch these together", vids) === "STITCH" && A.attachmentIntent("lip sync it to my voice", vids) === "LIPSYNC_VIDEO" && A.attachmentIntent("trim the start", vids) === "EDIT" && A.attachmentIntent("make a video", []) === "GENERATE" && A.attachmentIntent("make her say this script", [vids[1]]) === "AVATAR", "what a message asks of its attachments is routed by kind");

const stitched = T.stitchPlan({ assets: vids, answers: { aspect: "Match my clips", music: "My own audio file", transitions: "Hard cuts" } });
has(stitched.pipeline === "clip_edit" && stitched.scenes.length === 2 && stitched.scenes[0].source.assetId === id1 && stitched.scenes[1].engine === "image", "Edit my clips: every clip and picture, in upload order, as scenes");
has(stitched.aspect === "9:16" && stitched.cut.transition === "cut" && stitched.cut.music.source === "upload" && stitched.cut.music.assetId === id3 && stitched.cut.audio === "original", "shaped like the clips, with the answers' transitions, the person's song and the clips' own sound");
has(T.clipsAspect([{ kind: "video", width: 1920, height: 1080 }, { kind: "video", width: 1280, height: 720 }]) === "16:9", "landscape footage cuts landscape");
const qa = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 42, visual: "mine", source: { assetId: id1, trimStart: 2, trimEnd: 40 } }, { duration: 9, visual: "made", motionPrompt: "x" }] }, "clip_edit", {})).plan;
has(qa.scenes[0].source?.trimStart === 2 && qa.scenes[0].duration === 42 && qa.scenes.length === 3, "an uploaded scene is never split or rescaled; a long generated one still is");
has(L.normalizeSource({ assetId: "nope" }) === undefined && L.normalizeSource({ assetId: id1, speed: 9, volume: -1 }).speed === 4 && L.normalizeSource({ assetId: id1, speed: 9, volume: -1 }).volume === 0, "an upload reference is read strictly: a real id, speed 0.25–4, level 0–2");
has(L.sourceSeconds({ assetId: id1, trimStart: 2, trimEnd: 8, speed: 2 }, 10) === 3 && L.sourceSeconds({ assetId: id1 }, 7.5) === 7.5, "a trimmed, sped-up clip plays for its span ÷ speed");
const mixed = L.normalizePlan({ scenes: [{ duration: 6, visual: "mine", voiceover: "Hello there", source: { assetId: id1 } }, { duration: 5, visual: "made", motionPrompt: "x" }] }, "commercial_ad", {});
const mjobs = R.jobsFor(mixed, {});
has(mjobs.filter((j) => j.kind === "clip").length === 1 && mjobs.some((j) => j.kind === "voice" && j.n === 1), "an uploaded scene films nothing, but its line is still voiced");
has(E.renderCost(mixed, env) === E.CLIP_COST + E.VOICE_COST + E.cutCost(mixed, env), "and costs nothing to film — only its share of the cut");
has(E.readiness(stitched, {}).ready === true, "a stitch of uploads needs no generation engine at all");
const carried = ED.carryByContent(mixed, { ...mixed, scenes: [mixed.scenes[1], mixed.scenes[0]].map((s, i) => ({ ...s, n: i + 1 })) });
has(carried.refilm.length === 0 && carried.revoice.length === 0 && carried.carry.length === 2, "a reordered timeline reuses every clip and line it already had");
has(ED.carryByContent(mixed, { ...mixed, scenes: mixed.scenes.map((s) => (s.n === 2 ? { ...s, motionPrompt: "new" } : s)) }).refilm.join() === "2", "only a changed generated scene is filmed again");

console.log("\nvideo settings");
const strict = L.normalizeCut({ transition: "explode", fit: "fit-blur", fps: 60, resolution: "4k", musicVolume: 5, music: { source: "upload" } });
has(strict.fit === "fit-blur" && strict.fps === 60 && strict.transition === undefined && strict.resolution === undefined && strict.musicVolume === 2 && strict.music === undefined, "settings are read strictly: unknown values dropped, levels clamped, an upload needs its file");
const resolved = CS.resolveCut({ ...stitched, cut: undefined });
has(resolved.transition === "crossfade" && resolved.fit === "fit-blur" && resolved.fadeOut === true && CS.resolveCut(fixed).transition === "dip", "defaults: stitched footage crossfades on a blurred fit; generated videos keep the quick dip");
has(CS.frameSize("9:16", "1080p").join() === "1080,1920" && CS.frameSize("16:9", "720p").join() === "1280,720" && CS.frameSize("4:5", "720p").join() === "720,900", "the frame follows the shape and resolution");
has(CS.encoderFor("standard", 300).preset === "ultrafast" && CS.encoderFor("high", 20).crf === 18, "long cuts encode faster so they finish; high quality is a lower CRF");
has(CS.colorFilter("mono").includes("hue=s=0") && CS.colorFilter("none") === "", "colour grades are ffmpeg filters");
has(CF.atempoChain(4) === "atempo=2,atempo=2.0000" && CF.atempoChain(0.25) === "atempo=0.5,atempo=0.5000" && CF.atempoChain(1) === "", "sound keeps pace at any speed (atempo chained)");
has(/boxblur/.test(CF.fitFilter("fit-blur", 720, 1280)) && /pad=720:1280/.test(CF.fitFilter("fit-black", 720, 1280)) && /crop=720:1280/.test(CF.fitFilter("fill", 720, 1280)), "fill, fit on a blurred copy, fit on black");
const joinX = CF.joinArgs({ segments: [{ path: "a", seconds: 4 }, { path: "b", seconds: 5 }, { path: "c", seconds: 3 }], transition: "crossfade", duration: 0.5, listPath: "l", out: "o", encoder: { preset: "veryfast", crf: 21 } });
const graph = joinX.args[joinX.args.indexOf("-filter_complex") + 1];
has(/xfade=transition=fade:duration=0\.500:offset=3\.500\[v1\]/.test(graph) && /offset=8\.000\[v\]/.test(graph) && /acrossfade=d=0\.500\[a\]/.test(graph) && joinX.seconds === 11, "transitions overlap each pair at the right moment, and the cut is that much shorter", graph);
const joinCut = CF.joinArgs({ segments: [{ path: "a", seconds: 4 }, { path: "b", seconds: 5 }], transition: "cut", duration: 0.5, listPath: "l", out: "o", encoder: { preset: "veryfast", crf: 21 } });
has(joinCut.list === "file 'a'\nfile 'b'" && joinCut.args.includes("copy"), "a hard cut joins without encoding again");
has(CF.xfadeName("crossfade") === "fade" && CF.xfadeName("dip") === null && CF.xfadeName("slideleft") === "slideleft", "every transition is a real xfade");
has(!/sidechaincompress/.test(CF.musicMixArgs({ joined: "j", music: "m", out: "o", seconds: 10, spoken: true, duck: false }).join(" ")) && CF.musicMixArgs({ joined: "j", music: "m", out: "o", seconds: 10, spoken: true, start: 12 }).includes("12.00"), "ducking can be turned off; a song can start partway in");
has(CF.finishArgs({ source: "s", out: "o", loudness: false, silent: false }).includes("copy") && !CF.finishArgs({ source: "s", out: "o", loudness: false, silent: false }).join(" ").includes("loudnorm"), "even loudness can be turned off");
const words = CF.wordsFilter({ fontPath: "f", dir: "d", n: 1, caption: "hi", captionPosition: "top", captionSize: "large", captionStyle: "highlight" }, 720, 1280).join(",");
has(/fontcolor=0xFFE14D/.test(words) && /y=h\*0\.12/.test(words), "captions take the position, size and style asked for");
has(/zoompan=z='1\+0\.12\*on\/120'/.test(CF.stillVideoFilter({ width: 720, height: 1280, seconds: 4, fps: 30, fit: "fill", motion: "zoom-in" })), "a picture moves gently while it is on screen");

console.log("\npreparing uploads");
const phone = MF.readInspection("Duration: 00:00:06.00, start\n  Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1], 30 fps\n      displaymatrix: rotation of 90.00 degrees\n  Stream #0:1: Audio: aac");
has(phone.width === 1080 && phone.height === 1920 && phone.hasAudio && phone.seconds === 6, "a phone's rotated clip is measured upright");
const work = MF.workingCopyArgs({ source: "s", out: "o", hasAudio: false }).join(" ");
has(/anullsrc=r=48000/.test(work) && /fps=30/.test(work) && /-shortest/.test(work) && /\+faststart/.test(work), "a silent clip gets silence laid in, so every clip joins the same way");
const regRoute = readFileSync(join(root, "src/app/api/video/[id]/assets/route.ts"), "utf8");
has(/mimetype/.test(regRoute) && /startsWith\(`\$\{userId\}\/\$\{id\}\/uploads\/`\)/.test(regRoute) && /assets\/prepare\?asset=/.test(regRoute), "an upload's kind is re-checked from the stored object, its path from the owner, and it is prepared in its own route");
has(/createSignedUploadUrl/.test(readFileSync(join(root, "src/app/api/video/[id]/assets/upload-url/route.ts"), "utf8")), "files go straight to storage on a one-time address, never through a function body");
has(/"\/api\/video\/\[id\]\/assets\/prepare": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(readFileSync(join(root, "next.config.mjs"), "utf8")), "the preparing route carries the ffmpeg binary");
has(/fileUploads\(/.test(readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8")), "a render files the uploads as finished scenes");
has(/saveTimeline\(/.test(readFileSync(join(root, "src/app/api/video/[id]/timeline/route.ts"), "utf8")), "the studio's timeline and settings are saved and re-cut without filming again");
has(/attachmentManifest\(input\.assets/.test(readFileSync(join(root, "src/lib/video/director.ts"), "utf8")), "the Creative Director reads the ATTACHMENTS block first");
has(/clip_edit/.test(readFileSync(join(root, "supabase/migrations/20261110120000_video_uploads.sql"), "utf8")), "the database knows the new pipeline and upload kinds");


console.log("\nthe visual editor (no AI)");
const ET = await import(join(dir, "editor-timeline.js"));
const V = await import(join(dir, "voices.js"));
const edAssets = [{ id: id1, kind: "video", durationS: 10, url: "u1" }, { id: id2, kind: "image", durationS: null, url: "u2" }];
const edPlan = L.normalizePlan({ scenes: [
  { duration: 10, visual: "a", onScreenText: "Hi", voiceover: "Hello", source: { assetId: id1 } },
  { duration: 4, visual: "b", engine: "image", source: { assetId: id2 } },
  { duration: 5, visual: "c", motionPrompt: "x" },
], cut: { muted: [1] } }, "clip_edit", {});
const split = ET.splitAt(edPlan, 1, 4, edAssets);
has(split && split.scenes.length === 4 && split.scenes[0].source.trimEnd === 4 && split.scenes[1].source.trimStart === 4 && split.scenes[1].voiceover === "" && split.scenes[0].onScreenText === "Hi", "split at the playhead: two trims of the same file, the words and line stay on the first");
has(split && split.cut.muted.join() === "1,2", "both halves keep the clip's mute");
has(ET.splitAt(edPlan, 3, 2, edAssets) === null, "a generated scene is never split (that would film it again)");
const moved = ET.moveScene(edPlan, 3, 0);
has(moved.scenes.map((s) => s.visual).join("") === "cab" && moved.scenes.map((s) => s.n).join() === "1,2,3" && moved.cut.muted.join() === "2", "moving a scene renumbers the timeline; its mute moves with it");
has(ET.duplicateScene(edPlan, 2).scenes.length === 4 && ET.removeScene(edPlan, 2).scenes.length === 2 && ET.removeScene(L.normalizePlan({ scenes: [{ duration: 3, visual: "x", motionPrompt: "y" }] }, "clip_edit", {}), 1).scenes.length === 1, "duplicate and take out; the last scene always stays");
const trimmed = ET.trimEdge(edPlan, 1, "start", 2, edAssets);
has(trimmed.scenes[0].source.trimStart === 2 && trimmed.scenes[0].duration === 8, "dragging a clip's start edge moves its in-point");
has(ET.trimEdge(edPlan, 1, "end", 5, edAssets).scenes[0].source.trimEnd === undefined, "a clip can't be stretched past its own end");
has(ET.trimEdge(edPlan, 2, "end", 2, edAssets).scenes[1].duration === 6, "a picture's end edge sets how long it holds");
const segs = ET.segmentsFor(edPlan, edAssets, [{ scene: 3, engine: "video", status: "done", url: "c3" }]);
has(segs.map((x) => x.start).join() === "0,10,14" && segs[2].mediaUrl === "c3" && segs[1].kind === "image" && segs[0].volume === 0 && ET.timelineLength(segs) === 19, "the preview plays each scene from its place, with what is made, muted where muted");
has(ET.segmentAt(segs, 12).segment.n === 2 && ET.segmentAt(segs, 12).offset === 2, "the playhead finds its scene");
has(V.VOICES.length >= 20 && V.isVoiceId("English_Graceful_Lady") && !V.isVoiceId("Nobody"), "a real voice library, checked by id");
const voiced = L.normalizePlan({ scenes: [{ duration: 4, visual: "a", voiceover: "Hi there", motionPrompt: "x", voiceId: "French_MaleNarrator" }, { duration: 4, visual: "b", voiceover: "Mine", voiceAsset: id3, motionPrompt: "y" }], cut: { voiceId: "English_Comedian" } }, "commercial_ad", {});
const vjobs = R.jobsFor(voiced, {});
has(vjobs.find((j) => j.kind === "voice" && j.n === 1)?.voiceId === "French_MaleNarrator" && !vjobs.some((j) => j.kind === "voice" && j.n === 2), "a scene's own voice wins; a recorded line is used as it is, never re-made");
const revoiced = ED.carryByContent(voiced, { ...voiced, scenes: voiced.scenes.map((x) => (x.n === 1 ? { ...x, voiceId: "Spanish_Narrator" } : x)) });
has(revoiced.revoice.join() === "1" && revoiced.refilm.length === 0, "changing one scene's voice re-voices only that line");
const added = ED.applyEdit(edPlan, { reply: "", replan: false, scenes: [], add: [{ assetId: id2, after: 1 }] }, [{ id: id2, kind: "image", name: "p.png", durationS: null, status: "ready", mime: "image/png", width: 1, height: 1, hasAudio: null }]);
has(added.plan.scenes.length === 4 && added.plan.scenes[1].source.assetId === id2 && added.carry.length === 3, "the AI editor can put an upload into the video — free, nothing else changes");
has(/settleRunwareCredits\(quote, made\.cost\)/.test(readFileSync(join(root, "src/app/api/video/[id]/audio/route.ts"), "utf8")) && /lyrics/.test(read_runware()), "music on demand is charged at what Runware billed; songs take lyrics");
has(/decideEdit\(\{ plan, made, instruction, assets: uploads, model: agent\.apiId, \.\.\.files \}\)/.test(readFileSync(join(root, "src/app/api/video/[id]/assist/route.ts"), "utf8")), "the AI editor sees every upload and the timeline on screen, and saves nothing itself");
function read_runware() { return readFileSync(join(root, "src/lib/runware.ts"), "utf8"); }


console.log("\ncharacter lock");
const CA = await import(join(dir, "cast.js"));
const amaId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", kofiId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const castPlan = L.normalizePlan({
  characters: [{ id: amaId, name: "Ama", descriptor: "late twenties, dark brown skin, short coily black hair, gold hoop earrings, mustard linen shirt", voiceId: "English_Graceful_Lady" }, { id: kofiId, name: "Kofi", descriptor: "early thirties, tall, shaved head, round glasses, navy suit", voiceId: "English_Trustworth_Man" }, { id: "nope", name: "X", descriptor: "y" }],
  scenes: [
    { duration: 5, visual: "market", motionPrompt: "She walks through the market", characters: [amaId, "bbbbbbbb-bbbb-4bbb-8bbb-000000000009"], voiceover: "AMA: Fresh mangoes!" },
    { duration: 5, visual: "office", motionPrompt: "They shake hands", characters: [kofiId, amaId], voiceover: "KOFI: Deal." },
    { duration: 4, visual: "skyline", motionPrompt: "City skyline at dusk" },
  ],
}, "cinematic_short", {});
has(castPlan.characters.length === 2 && castPlan.scenes[0].characters.join() === amaId && castPlan.scenes[1].characters.join() === `${kofiId},${amaId}` && !castPlan.scenes[2].characters, "the cast is read strictly: real ids only, each scene keeps only characters the plan has");
const lock1 = CA.castPrompt("She walks through the market", CA.sceneCast(castPlan.scenes[0], castPlan));
has(lock1.includes("Character: Ama, late twenties, dark brown skin, short coily black hair, gold hoop earrings, mustard linen shirt.") && /exactly as in the reference images/.test(lock1), "every scene repeats the character's description word for word");
has(CA.castPrompt("x", CA.sceneCast(castPlan.scenes[1], castPlan)).indexOf("Kofi") < CA.castPrompt("x", CA.sceneCast(castPlan.scenes[1], castPlan)).indexOf("Ama") && /never swap, merge, duplicate or blend/.test(CA.castPrompt("x", CA.sceneCast(castPlan.scenes[1], castPlan))), "two characters are named in the order of their pictures, never swapped");
const refs = CA.castReferences(CA.sceneCast(castPlan.scenes[1], castPlan), { [amaId]: ["a1", "a2", "a3", "a4", "a5"], [kofiId]: ["k1", "k2", "k3", "k4", "k5"] });
has(refs.length === 9 && refs[0] === "k1" && refs[5] === "a1" && CA.castReferences([CA.sceneCast(castPlan.scenes[0], castPlan)[0]], { [amaId]: Array.from({ length: 12 }, (_, i) => `a${i}`) }).length === 9, "pictures are shared fairly between characters, front first, never more than nine");
has(CA.castVoice(castPlan.scenes[0], castPlan, "D") === "English_Graceful_Lady" && CA.castVoice(castPlan.scenes[1], castPlan, "D") === "English_Trustworth_Man" && CA.castVoice(castPlan.scenes[2], castPlan, "D") === "D", "a character speaks in their own voice; \"KOFI: …\" is read by Kofi");
const castJobs = R.jobsFor(castPlan, {});
has(castJobs.find((j) => j.kind === "voice" && j.n === 2)?.voiceId === "English_Trustworth_Man", "and the render orders the line in that voice");
has(/CHARACTERS \(locked/.test(CA.castManifest(castPlan.characters)) && /\[id aaaaaaaa/.test(CA.castManifest(castPlan.characters)) && /none/.test(CA.castManifest([])), "the planner and the editor read the cast, locked, before anything else");
const refRoute = C.routeClip({ pipeline: "cinematic_short", aspect: "16:9", fromFrame: true, tier: "credit", references: true }, { RUNWARE_API_KEY: "k", MINIMAX_API_KEY: "m" });
has(refRoute[0] === "h3-ref" && refRoute[1] === "seedance-ref" && refRoute.includes("minimax"), "a character scene is filmed from their pictures first (MiniMax H3, then Seedance 2.0), then from their front picture");
has(!C.routeClip({ pipeline: "cinematic_short", aspect: "16:9", fromFrame: false, tier: "best" }, { RUNWARE_API_KEY: "k" }).some((e) => e.endsWith("-ref")), "scenes without a character never use the reference engines");
has(C.parseProvider(C.providerOf("h3-ref", "1b4e28ba-2fa1-11d2-883f-0016d3cca427"))?.engine === "h3-ref", "a character clip's row reads back as its engine");
const reCast = ED.carryByContent(castPlan, { ...castPlan, scenes: castPlan.scenes.map((x) => (x.n === 3 ? { ...x, characters: [amaId] } : x)) });
has(reCast.refilm.join() === "3", "putting a character into a scene films only that scene again");
const castEdit = ED.normalizeEdit({ scenes: [{ n: 3, action: "keep", characters: [kofiId, "ffffffff-ffff-4fff-8fff-000000000000"] }] }, castPlan);
has(castEdit.scenes[0].characters.join() === kofiId && ED.applyEdit(castPlan, castEdit).refilm.join() === "3", "the AI editor can put a character in a scene — only real cast members");
has(!E.renderCost(castPlan, { RUNWARE_API_KEY: "k" }) || E.firstEngineFor(castPlan, castPlan.scenes[0], { RUNWARE_API_KEY: "k" }) === "h3-ref", "a character scene is priced on the engine that will film it");
const runwareSrc = readFileSync(join(root, "src/lib/runware.ts"), "utf8");
has(/referenceImages: input\.references\.slice\(0, 9\)/.test(runwareSrc) && /settings: \{ audio: false \}/.test(runwareSrc) && /bytedance:seedream@4\.5/.test(runwareSrc), "reference-to-video sends the pictures with every scene; the sheet is made once on Seedream");
has(/castPictures\(writer \?\? supabase, userId/.test(readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8")) && /\.eq\("user_id", ownerId\)/.test(readFileSync(join(root, "src/lib/video/characters.ts"), "utf8")), "a character's pictures are read for the video's owner only — never from a path the browser sent");
has(/source = 'generated' or consent_at is not null/.test(readFileSync(join(root, "supabase/migrations/20261112120000_video_characters.sql"), "utf8")), "a character made from a real person's photo needs the owner's recorded consent");

console.log("\nthe AI agent from the workspace");
const agentSrc = readFileSync(join(root, "src/lib/video/agent.ts"), "utf8");
has(/resolveModel\(asked\)/.test(agentSrc) && /modelAllowedOnPlan/.test(agentSrc) && /creditMultiplierFor/.test(agentSrc), "the agent picked is checked against the plan and charged at its rate");
has(/model: body\.model/.test(readFileSync(join(root, "src/app/api/build/route.ts"), "utf8")) && /model: input\.model/.test(readFileSync(join(root, "src/lib/video/workspace.ts"), "utf8")), "a message in the workspace plans and edits the video on the agent picked there");
has(/const model = input\.model \|\| DIRECTOR_MODEL/.test(readFileSync(join(root, "src/lib/video/director.ts"), "utf8")) && /complete\(input\.model \|\| DIRECTOR_MODEL/.test(readFileSync(join(root, "src/lib/video/editor.ts"), "utf8")), "the planner and the editor both run on it");


console.log("\nscene-to-scene continuity");
const CO = await import(join(dir, "continuity.js"));
const contPlan = L.normalizePlan({
  characters: [{ id: amaId, name: "Ama", descriptor: "late twenties, gold hoop earrings" }],
  scenes: [
    { duration: 5, visual: "a", motionPrompt: "Ama enters the market", characters: [amaId] },
    { duration: 5, visual: "b", motionPrompt: "Ama picks a mango", characters: [amaId] },
    { duration: 4, visual: "c", motionPrompt: "Skyline at dusk" },
    { duration: 4, visual: "d", motionPrompt: "The sun sets further", continues: true },
    { duration: 5, visual: "e", motionPrompt: "Ama at home", characters: [amaId], continues: false },
    { duration: 5, visual: "f", motionPrompt: "x", source: { assetId: id1 } },
    { duration: 5, visual: "g", motionPrompt: "after the upload", continues: true },
  ],
}, "cinematic_short", {});
const linksX = CO.continuityLinks(contPlan);
has(linksX.get(2) === 1 && !linksX.has(3) && linksX.get(4) === 3 && !linksX.has(5), "a scene sharing a character with the one before carries on; a marked one does too; \"cuts away\" never does");
has(!linksX.has(6) && linksX.get(7) === 6, "an upload never waits; a scene marked to carry on starts where the upload ends");
has(!CO.continuityLinks({ ...contPlan, scenes: contPlan.scenes.map((s) => (s.n === 7 ? { ...s, continues: undefined } : s)) }).has(7), "after an upload, a scene only carries on when asked");
has(CO.continuityLinks({ ...contPlan, cut: { continuity: false } }).size === 0, "continuity can be switched off for the whole video");
has(CO.longestRun(contPlan) === 2, "only linked runs are made one after another — the rest at once");
has(CO.withLastFrame(["c1", "c2", "c3"], "last").join() === "c1,c2,c3,last" && CO.withLastFrame(Array.from({ length: 9 }, (_, i) => `c${i}`), "last").length === 9 && CO.withLastFrame(Array.from({ length: 9 }, (_, i) => `c${i}`), "last")[8] === "last", "the character's pictures come first, the last frame after, never more than nine");
has(CO.awaitedScene(CO.awaitProvider(4)) === 4 && CO.awaitedScene("runware:x") === null, "a waiting scene's row says which scene it waits for");
has(CO.lastFrameArgs({ source: "s", out: "o" }).join(" ").includes("-sseof -0.25 -i s -frames:v 1"), "the last frame is read from the end of the clip");
const splitParts = L.qaAndRepair(L.normalizePlan({ scenes: [{ duration: 12, visual: "long", motionPrompt: "a long walk" }] }, "cinematic_short", { length: "12s" })).plan.scenes;
has(splitParts.length === 2 && splitParts[1].continues === true && CO.continuesFrom({ ...L.normalizePlan({}, "cinematic_short", {}), scenes: splitParts }, 2) === 1, "the parts of one long shot carry on from each other");
const sr = readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8");
has(/status: "queued", provider: awaitProvider\(waitsFor\)/.test(sr) && /releaseWaiting\(writer/.test(sr), "a render holds a continuing scene back, and starts it at once when the scene before is already made");
has(/if \(kind === "clip"\) await releaseWaiting/.test(readFileSync(join(root, "src/lib/video/results.ts"), "utf8")), "a landed clip — or a failed one — releases whoever waits on it");
const cs = readFileSync(join(root, "src/lib/video/continue-scene.ts"), "utf8");
has(/\.eq\("provider", row\.provider\)/.test(cs) && /withLastFrame\(own, lastFrame\)/.test(cs) && /lastFrame \?\? own\[0\]/.test(cs), "a waiting scene is claimed once, then filmed from the last frame (after the character's pictures, or as its first frame)");
has(/"\/api\/video\/\[id\]\/render\/continue": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(readFileSync(join(root, "next.config.mjs"), "utf8")), "the continue route carries ffmpeg");
has(/awaitedScene\(row\.provider\)/.test(readFileSync(join(root, "src/lib/video/state.ts"), "utf8")), "a lost hand-off is recovered when the studio polls");


console.log("\nmany characters, kept by the script");
const ids9 = Array.from({ length: 11 }, (_, i) => `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, "0")}`);
const names9 = ["Ama", "Kofi", "Esi", "Yaw", "Abena", "Kwame", "Akosua", "Kojo", "Adwoa", "Fiifi", "Efua"];
const bigCast = ids9.map((id, i) => ({ id, name: names9[i], descriptor: `${names9[i]}'s exact look` }));
has(CA.normalizeCast(bigCast).length === 11 && CA.MAX_CAST >= 11 && CA.MAX_SCENE_CAST === 9, "a video can hold a large cast, a scene up to nine people (one picture each at least)");
const pics = Object.fromEntries(ids9.map((id, i) => [id, [`${names9[i]}-front`, `${names9[i]}-side`, `${names9[i]}-full`]]));
const plan9 = CA.planReferences(bigCast.slice(0, 9), pics);
has(plan9.images.length === 9 && plan9.images.every((img) => img.endsWith("-front")) && plan9.slots.length === 9, "nine people in one scene: every one gets their front picture");
const plan3 = CA.planReferences(bigCast.slice(0, 3), pics);
has(plan3.images.length === 9 && plan3.slots.every((slot) => slot.to - slot.from === 2), "three people: three pictures each, shared fairly");
const plan2r = CA.planReferences(bigCast.slice(0, 2), pics, { reserve: 1 });
has(plan2r.images.length === 6 && CA.planReferences(bigCast.slice(0, 9), pics, { reserve: 1 }).images.length === 9, "a continuing scene's last frame takes a spare slot — never a character's only picture");
const lock3 = CA.castLock(bigCast.slice(0, 3), plan3);
has(/Reference images 1–3 show Ama: Ama's exact look\./.test(lock3) && /Reference images 7–9 show Esi/.test(lock3) && /3 people in this scene/.test(lock3), "the prompt says which pictures are whose, every description word for word", lock3);
const lock10 = CA.castLock(bigCast.slice(0, 10), CA.planReferences(bigCast.slice(0, 10), pics));
has(/Fiifi \(no picture — follow these words exactly\)/.test(lock10), "someone beyond nine pictures is still described exactly");
has(CA.splitDialogue("AMA: Are you coming? KOFI: Right behind you. ESI: Wait for me!").length === 3 && CA.splitDialogue("Just narration here.").length === 1, "a line with several speakers is split per speaker");
has(CA.mentionedCast({ shot: "wide", visual: "Ama hands Kofi a mango while Esi laughs", motionPrompt: "", voiceover: "", onScreenText: "" }, bigCast).join() === [ids9[0], ids9[1], ids9[2]].join() && CA.mentionedCast({ shot: "", visual: "the will of the people", motionPrompt: "", voiceover: "", onScreenText: "" }, [{ id: ids9[0], name: "Will", descriptor: "x" }]).length === 0, "the script names who is on screen (as names, not ordinary words)");
const scripted = L.qaAndRepair(L.normalizePlan({
  characters: bigCast.slice(0, 3),
  scenes: [
    { duration: 6, visual: "Ama and Kofi at the market stall", motionPrompt: "They talk", voiceover: "AMA: How much? KOFI: For you, two cedis." },
    { duration: 4, visual: "Esi waves from across the road", motionPrompt: "Esi waves" },
  ],
}, "cinematic_short", { length: "10s" }));
const ss = scripted.plan.scenes;
has(ss.length === 3 && ss[0].voiceover.startsWith("AMA:") && ss[1].voiceover.startsWith("KOFI:") && ss[1].continues === true, "the dialogue scene becomes one shot per speaker, the second carrying on from the first");
has(ss[0].characters?.join() === [ids9[0], ids9[1]].join() && ss[1].characters?.join() === [ids9[0], ids9[1]].join() && ss[2].characters?.join() === ids9[2], "each shot has exactly the people its script names");
has(CA.castVoice(ss[1], scripted.plan, "D") !== CA.castVoice(ss[0], scripted.plan, "D") || !bigCast[0].voiceId, "each speaker's shot is read in their own voice");
has(scripted.issues.some((i) => /one shot per speaker/.test(i.issue)) && scripted.issues.some((i) => /in the script here/.test(i.issue)), "and the studio says what it did");
const cs2 = readFileSync(join(root, "src/lib/video/continue-scene.ts"), "utf8");
has(/planReferences\(cast, [^\n]*\{ reserve: \(lastFrame \? 1 : 0\) \+ Math\.min\(look\.length, 3\) \}\)/.test(cs2) && /castPrompt\([^\n]*refPlan\)/.test(readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8")), "the render and continuation use the fair picture plan and say which pictures are whose");


console.log("\nno free work");
const PR = await import(join(dir, "pricing.js"));
has(PR.cutCredits(10) === 1 && PR.cutCredits(60) === 1 && PR.cutCredits(61) === 2 && PR.cutCredits(0) === 1, "a cut is 1 credit per started minute, at least 1");
has(PR.prepareCredits("video") === 0.5 && PR.prepareCredits("audio") === 0.1 && PR.STITCH_COST === 1, "preparing an upload and laying clips out are charged");
has(PR.reviewCredits(1) === 0.5 && PR.reviewCredits(2.5) === 1.25 && PR.creditsLabel(0.5) === "0.5 credits" && PR.creditsLabel(1) === "1 credit", "an AI look-over is charged at the agent's rate");
has(E.renderCost(stitched, {}) === E.cutCost(stitched, {}) && E.cutCost(stitched, {}) >= 1, "a stitch of uploads alone still pays for its cut");
const cl = readFileSync(join(root, "src/lib/video/compose-local.ts"), "utf8");
has(/cost: cutCredits\(total\)/.test(cl) && /dedupeKey: `video-cut:\$\{videoId\}:\$\{version\}`/.test(cl), "every cut made here is charged once per version, by its length");
const ae = readFileSync(join(root, "src/lib/video/apply-edit.ts"), "utf8");
has(/const needed = input\.charge \+ cutCost\(next\)/.test(ae) && ae.indexOf("const needed") < ae.indexOf("const { error: saveError }"), "a saved edit or a Sound switch is refused before anything is saved when the new cut cannot be paid for");
const srx = readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8");
has(/jobCost\(jobs\) \+ cutCost\(plan\)/.test(srx) && /return shortOf\(cutCost\(plan\)\)/.test(srx), "re-renders and edits with nothing to film still check the cut can be paid for");
has(/STITCH_COST/.test(readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8")) && /video-stitch:/.test(readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8")), "laying out clips is checked and charged");
has(/prepareCredits\(assetKind\(mime\)\)/.test(readFileSync(join(root, "src/app/api/video/[id]/assets/upload-url/route.ts"), "utf8")) && /video-prepare:/.test(readFileSync(join(root, "src/lib/video/prepare-asset.ts"), "utf8")), "an upload is checked before it is sent and charged once it is prepared");
const videoUi = ["src/app/dashboard/components/video/VideoSettings.tsx", "src/app/dashboard/components/video/VideoEditor.tsx", "src/app/dashboard/video/[id]/page.tsx", "src/app/api/video/[id]/assist/route.ts"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
has(!/for free|is free\b|— free|\. Free\./.test(videoUi) && !/Free\.'|free, and nothing/.test(readFileSync(join(root, "src/lib/video/workspace.ts"), "utf8")), "nothing in the studio says an edit is free");

console.log("\nthe AI speaks only when it helps");
has(ED.normalizeReview({ quiet: true }, castPlan).length === 0 && ED.normalizeReview({ quiet: false, suggestions: [] }, castPlan).length === 0, "all is well: the AI stays quiet");
const sug = ED.normalizeReview({ quiet: false, suggestions: [
  { title: "Put Kofi in scene 3", why: "The script names him there but he is not on screen.", edit: { scenes: [{ n: 3, action: "keep", characters: [kofiId] }] } },
  { title: "No-op", why: "Nothing", edit: {} },
  { title: "Start over", why: "x", edit: { replan: true, scenes: [] } },
  { title: "4", why: "a", edit: { cut: { captions: true } } },
  { title: "5", why: "b", edit: { cut: { captions: true } } },
] }, castPlan);
has(sug.length === 3 && sug[0].edit.scenes[0].characters[0] === kofiId && sug[0].edit.reply === sug[0].why, "a suggestion is a real, small edit — empty ones and \"start over\" are dropped, at most three");
const rv = readFileSync(join(root, "src/app/api/video/[id]/review/route.ts"), "utf8");
has(/skipped: "credits"/.test(rv) && rv.indexOf("currentBalance(") < rv.indexOf("reviewEdit(") && /chargeCredits\(service/.test(rv), "a look-over is checked before it runs, stays quiet without credit, and is charged when it runs");

console.log("\nlong films, references and continuations");
const LK = await import(join(dir, "look.js"));
const CH = await import(join(dir, "chapters.js"));
has(JSON.stringify(LK.pickFrames(["a", "b", "c"], 2)) === '["b","a"]' && LK.pickFrames(["a"], 0).length === 0, "a reference clip lends its middle frame first, within the room left");
const vidAsset = { id: "11111111-1111-4111-8111-111111111111", kind: "video", name: "beach.mov", durationS: 12, status: "ready" };
const filmBase = L.normalizePlan({ scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }] }, "cinematic_short", {});
const cont = T.withContinuation(filmBase, vidAsset);
has(cont.scenes.length === 3 && cont.scenes[1].source?.assetId === vidAsset.id && cont.scenes[2].continues === true && !cont.scenes[2].source && cont.scenes.map((s) => s.n).join() === "1,2,3", "Continue it: the clip goes in, then a new scene that starts where it ends");
has(CO.continuesFrom(cont, 3) === 2, "and that scene is filmed from the clip's last frame");
const again = T.withContinuation(cont, vidAsset);
has(again.scenes.length === 4 && again.scenes[2].continues === true && again.scenes[1].source, "continuing a clip already in the video adds the scene right after it");
const looked = T.toggleReference(filmBase, vidAsset.id);
has(looked.referenceClips?.[0] === vidAsset.id && !("referenceClips" in T.toggleReference(looked, vidAsset.id)), "a clip is marked as the look, and unmarked");
has(L.referenceClipsOf(["x", vidAsset.id, vidAsset.id]).length === 1 && L.normalizePlan({ referenceClips: [vidAsset.id], scenes: [{ duration: 3, visual: "a" }] }, "cinematic_short", {}).referenceClips?.[0] === vidAsset.id, "the look survives a save; anything that is not an upload id is dropped");
has(CO.uploadEnd({ trimEnd: 8 }, 12) > 7.9 && CO.uploadEnd({}, 12) > 11.9 && CO.frameAtArgs({ source: "a", out: "b", at: 7.92 }).join(" ").includes("-ss 7.920"), "a continuation starts on the frame where the clip was trimmed to end");
const chain = L.normalizePlan({ characters: [{ id: amaId, name: "Ama", description: "x" }], scenes: Array.from({ length: 14 }, (_, i) => ({ duration: 5, visual: "v", motionPrompt: "Ama walks", characters: [amaId] })) }, "cinematic_short", {});
const chainLinks = CO.continuityLinks(chain);
has(chainLinks.size < 13 && CO.longestRun(chain) <= CO.MAX_AUTO_RUN, `scenes linked only by a shared character restart every ${CO.MAX_AUTO_RUN}, so a long film is never made one clip at a time`, `run ${CO.longestRun(chain)}`);
const hourPlan = L.normalizePlan({ scenes: Array.from({ length: 450 }, (_, i) => ({ duration: 8, visual: `s${i}`, motionPrompt: "x" })) }, "cinematic_short", { length: "60 min" });
has(hourPlan.scenes.length === 450 && L.secondsFrom("60 min") === 3600, "a plan holds an hour of scenes");
has(P.PIPELINES.cinematic_short.questions.find((q) => q.id === "length").options.includes("60 min"), "a cinematic film can be up to 60 minutes");
has(CH.chaptersOf(hourPlan.scenes).length >= 25, "and it is cut in chapters");
const filmEditPlan = L.normalizePlan({ scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }, { duration: 5, visual: "b", motionPrompt: "y" }] }, "cinematic_short", {});
const filmUploads = [{ ...vidAsset, mime: "video/mp4", width: 1920, height: 1080, hasAudio: true }];
const contEdit = ED.normalizeEdit({ reply: "ok", continueFrom: [{ assetId: vidAsset.id, prompt: "She runs into the sea", seconds: 5 }, { assetId: "nope", prompt: "x" }], look: [vidAsset.id] }, filmEditPlan);
has(contEdit.continueFrom?.length === 1 && contEdit.look?.[0] === vidAsset.id, "the editor can continue a clip and set the look, and drops what is not an upload");
const contApplied = ED.applyEdit(filmEditPlan, contEdit, filmUploads);
has(contApplied.plan.scenes.length === 4 && contApplied.plan.scenes[2].source?.assetId === vidAsset.id && contApplied.plan.scenes[3].continues === true && contApplied.plan.scenes[3].motionPrompt === "She runs into the sea" && contApplied.plan.referenceClips?.[0] === vidAsset.id, "\"continue my clip\" puts the clip in and a new scene after it that starts where it ends; the look is set");
has(contApplied.carry.length === 2 && contApplied.carry.every((c) => c.clip), "the scenes already made carry over; only the new one is filmed");
has(!("referenceClips" in ED.applyEdit({ ...filmEditPlan, referenceClips: [vidAsset.id] }, ED.normalizeEdit({ look: [] }, filmEditPlan), filmUploads).plan), "an empty look stops matching");
const lenSrc = readFileSync(join(root, "src/lib/video/director.ts"), "utf8");
has(/directFilm/.test(lenSrc) && /Promise\.all\(\s*chapters\.map/.test(lenSrc) && /The chapter before ends on/.test(lenSrc), "a long film is outlined, then every chapter is written at once, each told how the ones beside it begin and end");
const filmPlan = readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8");
has(/agentCost\(PLAN_COST, agent\) \* calls/.test(filmPlan), "every planning call of a long film is paid for");
const filmCut = readFileSync(join(root, "src/lib/video/compose-local.ts"), "utf8");
has(/stableChapters\(/.test(filmCut) && /kick\(origin, videoId, version, p\.k\)/.test(filmCut) && /maybeJoin/.test(filmCut) && /streamToStorage/.test(filmCut), "a long cut: every changed chapter at once, then one join streamed into storage");
has(/partsOutput\(parts\.length, base\)/.test(filmCut), "if the single file cannot be stored, the film is kept as its parts");
has(/remote = Boolean\(upload && !still && Number\(upload\.duration_s\) > WORKING_COPY_SECONDS\)/.test(filmCut), "a long upload is read where it is stored, not copied onto the server");
const filmRender = readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8");
has(/inBatches\(\s*jobs,\s*8/.test(filmRender) && /lookFrames\(writer, plan\)/.test(filmRender), "hundreds of scenes are sent a few at a time, each with the look of the person's footage");

console.log("\nfull movies");
const fm = P.PIPELINES.full_movie;
has(fm.label === "Full Movie" && fm.questions.find((q) => q.id === "length").initial === "30 min" && fm.questions.find((q) => q.id === "length").options.includes("60 min"), "a Full Movie card: 30 minutes by default, up to an hour");
has(/Nollywood/.test(fm.template) && /@\[PHOTO OF MAIN CHARACTER\]/.test(fm.template) && /up to 9 photos, clips or songs/.test(fm.template) && /Act 4 \(27–30 min\)/.test(fm.template), "its sample is a Nigerian feature: references by @name, cast, four acts timed to 30 minutes");
has(fm.questions.find((q) => q.id === "language").options.includes("Nigerian Pidgin") && fm.questions.find((q) => q.id === "language").options.includes("Yoruba"), "dialogue in English, Pidgin, Yoruba, Igbo or Hausa");
has(fm.director.some((r) => /danfo/.test(r)) && fm.director.some((r) => /stereotypes/.test(r)), "the director keeps it real to Nigeria and respectful");
has(L.unfilledPlaceholders(fm.template).length >= 8, "the sample's blanks are asked for before planning");
has(A.handleFor("Lagos Street 2.MOV") === "@lagos-street-2" && [...A.handles([{ id: "a", name: "clip.mp4" }, { id: "b", name: "clip.mp4" }]).values()].join() === "@clip,@clip-2", "every upload has an @name, numbered when two share one");
has(/ref: "@/.test(A.attachmentManifest([{ id: "x", kind: "video", name: "Lagos.mp4", status: "ready", durationS: 5 }])), "the director sees each upload's @name");
has(/referenceClips/.test(readFileSync(join(root, "src/lib/video/director.ts"), "utf8")) && L.normalizePlan({ referenceClips: [vidAsset.id], scenes: [{ duration: 3, visual: "a" }] }, "full_movie", {}).referenceClips?.length === 1, "an @photo or @clip that sets the look becomes the film's look");

console.log("\nthe editor's layout");
const colored = L.normalizePlan({ scenes: [{ duration: 3, visual: "a", color: "mono" }, { duration: 3, visual: "b", color: "neon-pink" }] }, "cinematic_short", {});
has(colored.scenes[0].color === "mono" && colored.scenes[1].color === undefined, "a clip keeps its own filter; an unknown one is dropped");
has(ET.segmentsFor(colored, [], [])[0].color === "mono", "the preview knows a clip's own filter");
has(Object.keys(CS.COLOR_CSS).sort().join() === [...CS.COLORS].sort().join(), "every filter has a preview look");
has(/color: scene\.color \?\? cut\.color/.test(readFileSync(join(root, "src/lib/video/compose-local.ts"), "utf8")), "the export applies a clip's own filter over the video's");
const ed = readFileSync(join(root, "src/app/dashboard/components/video/VideoEditor.tsx"), "utf8");
const lib = readFileSync(join(root, "src/app/dashboard/components/video/EditorLibrary.tsx"), "utf8");
has(["Media", "Scenes", "Text", "Transitions", "Filters", "Cast", "Settings"].every((t) => lib.includes(`label: "${t}"`)), "the library has Media, Scenes, Text, Transitions, Filters, Cast and Settings");
has(/lg:grid-cols-\[360px_minmax\(0,1fr\)_340px\]/.test(ed) && /lg:col-span-3/.test(ed), "library, preview and inspector side by side, the timeline full width under them");
has(/ASSET_DRAG/.test(ed) && /onDropAsset/.test(ed) && /Magnet/.test(ed) && /Diamond/.test(ed) && /\{header\("music"/.test(ed), "the timeline takes media dragged in, snaps, marks transitions, and has track headers");
has(/!locked\.has\("video"\)\) splitHere\(\)/.test(ed), "a locked track is safe from the keyboard too");
const mp = readFileSync(join(root, "src/app/dashboard/components/video/MediaPanel.tsx"), "utf8");
has(/\["made", "Made here"\]/.test(mp) && /setData\(ASSET_DRAG/.test(mp), "media by kind (with what was made here), each tile dragged onto the timeline");

console.log("\nfinding videos");
const side = readFileSync(join(root, "src/app/dashboard/components/Sidebar.tsx"), "utf8");
has(/router\.push\("\/dashboard\/video"\)/.test(side) && /<span className="text-sm font-medium">Videos<\/span>/.test(side), "Videos has its own place in the sidebar");
const vp = readFileSync(join(root, "src/app/dashboard/video/page.tsx"), "utf8");
has(/\/dashboard\/video\/\$\{row\.id\}\/edit/.test(vp) && /create=video/.test(vp) && /type=full_movie/.test(vp), "the Videos page opens any video's editor and starts a new video or a full movie");
const pp = readFileSync(join(root, "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
has(/project\?\.intent === "video" && videoId/.test(pp) && /\/dashboard\/video\/\$\{videoId\}\/edit/.test(pp), "a video's workspace has an Editor button in its toolbar");
has(/searchParams\.get\("create"\) !== "video"/.test(readFileSync(join(root, "src/app/dashboard/page.tsx"), "utf8")), "Home opens on the Video tab when asked");

console.log("\nthe AI editor can do anything the manual editor can");
const clipA = { id: "22222222-2222-4222-8222-000000000001", kind: "video", name: "beach.mov", durationS: 20, status: "ready", mime: "video/mp4", width: 1920, height: 1080, hasAudio: true };
const anyPlan = L.normalizePlan({ music: "calm piano", cut: { color: "warm" }, scenes: [
  { duration: 20, visual: "beach", source: { assetId: clipA.id } },
  { duration: 5, visual: "b", motionPrompt: "A woman walks into the sea", voiceover: "She was free." },
  { duration: 5, visual: "c", motionPrompt: "Sunset over the water" },
] }, "cinematic_short", {});
const askEdit = (raw) => ED.applyEdit(anyPlan, ED.normalizeEdit(raw, anyPlan), [clipA]);
let res = askEdit({ scenes: [{ n: 1, action: "keep", trimStart: 3 }] });
has(res.plan.scenes[0].source.trimStart === 3 && res.refilm.length === 0, "\"cut the first 3 seconds of my clip\" trims it; nothing is filmed");
res = askEdit({ scenes: [{ n: 1, action: "keep", trimStart: 2, trimEnd: 10, speed: 2, volume: 0 }] });
has(res.plan.scenes[0].source.speed === 2 && res.plan.scenes[0].source.volume === 0 && res.plan.scenes[0].duration === 4, "speed it up 2x and silence it: 8 s of footage plays in 4");
res = askEdit({ scenes: [{ n: 3, action: "keep", color: "mono" }, { n: 2, action: "keep", color: "warm" }] });
has(res.plan.scenes[2].color === "mono" && res.plan.scenes[1].color === undefined && res.refilm.length === 0, "a filter on one scene; asking for the video's own filter clears the override");
res = askEdit({ scenes: [{ n: 2, action: "duplicate" }] });
has(res.plan.scenes.length === 4 && res.plan.scenes[2].motionPrompt === res.plan.scenes[1].motionPrompt && res.carry.filter((c) => c.from === 2).length === 2 && res.refilm.length === 0, "duplicate a scene: its clip and voice are reused, nothing filmed");
res = askEdit({ scenes: [{ n: 1, action: "split", at: 8 }] });
has(res.plan.scenes.length === 4 && res.plan.scenes[0].source.trimEnd === 8 && res.plan.scenes[1].source.trimStart === 8 && res.plan.scenes[1].source.assetId === clipA.id && res.plan.scenes[1].voiceover === "", "split my clip at 8 seconds: two scenes from the same file");
res = askEdit({ scenes: [{ n: 2, action: "split", at: 2 }] });
has(res.plan.scenes.length === 3, "a generated scene is not split (it is one shot); the editor is told to refilm instead");
res = askEdit({ scenes: [{ n: 3, action: "keep", continues: true }] });
has(res.plan.scenes[2].continues === true && res.refilm.includes(3), "\"make scene 3 carry on from scene 2\" films it again from the last frame");
res = askEdit({ aspect: "9:16", title: "Free", music: "upbeat afrobeat" });
has(res.plan.aspect === "9:16" && res.plan.title === "Free" && res.plan.music === "upbeat afrobeat" && res.plan.cut.music.source === "generate" && res.refilm.length === 0, "vertical, renamed, new music — nothing filmed");
res = askEdit({ music: "none" });
has(res.plan.cut.music.source === "none", "\"no music\" turns it off");
has(ED.normalizeEdit({ scenes: [{ n: 1, action: "keep", speed: 9, volume: -1, color: "neon", trimEnd: 1, trimStart: 5 }] }, anyPlan).scenes[0].speed === undefined, "impossible values are dropped, not applied");
const aiEdSrc = readFileSync(join(root, "src/lib/video/editor.ts"), "utf8");
has(["trimStart", "speed 0.25-4", "volume 0-2", "action \"duplicate\"", "action \"split\"", "continues on a generated scene", "aspect — the video's shape", "music — made music"].every((w) => aiEdSrc.includes(w)), "the editor's instructions name every one of these");
const musicSrc = readFileSync(join(root, "src/lib/video/apply-edit.ts"), "utf8");
has(/wantsMusic\(next\)/.test(musicSrc) && /engine: "music", provider: input\.music\.provider/.test(musicSrc) && /startMusic\(service, \{ video_id: videoId/.test(musicSrc), "an edited video keeps its music, or has it made again when the edit changed it");

console.log("\nthe Creative Director takes a change to a big plan");
const dirSrc = readFileSync(join(root, "src/lib/video/director.ts"), "utf8");
has(/complete\(model, system, parts, 20000\)/.test(dirSrc) && /for \(const attempt of \[0, 1\]\)/.test(dirSrc), "room for a whole revised plan, and one more try when the answer cannot be read");
has(/JSON\.stringify\(input\.previous\)\.slice\(0, 120_000\)/.test(dirSrc), "the director sees the whole current plan, not its first scenes");
has(/sayLlmError\(error\)/.test(dirSrc) && /could not plan this one \(\$\{lastProblem\}\)/.test(dirSrc), "when it still cannot, it says why");
has(L.withBrand("Follow quickstark.ai today") === "Follow QuickStark.Ai today" && L.BRAND === "QuickStark.Ai", "the name is spelt QuickStark.Ai everywhere in videos");

console.log("\nfiles for the Director: pictures, clips, sound and documents");
const CTX = await import(join(dir, "context-files.js"));
has(A.assetKind("application/pdf") === "document" && A.assetKind("text/markdown") === "document" && A.assetKind("text/plain") === "document" && A.documentMime("Script.MD") === "text/markdown" && A.documentMime("brand.pdf") === "application/pdf", "a PDF, a text or a Markdown file is a document (named by its extension when the browser does not say)");
has(A.uploadProblem({ mime: "application/pdf", size: 2 * 1024 * 1024 }) === null && A.uploadProblem({ mime: "application/pdf", size: 11 * 1024 * 1024 }) !== null && A.uploadProblem({ mime: "application/zip", size: 10 }) !== null, "documents up to 10 MB; other files are refused");
has(A.ACCEPT_ATTRIBUTE.includes(".pdf") && A.ACCEPT_ATTRIBUTE.includes("text/markdown"), "the file pickers take documents");
has(/document x1: \[\{assetId: "d1", ref: "@script"/.test(A.attachmentManifest([{ id: "d1", kind: "document", name: "Script.pdf", status: "ready" }])), "the Director's list of uploads names each document, by @name");
const ctxUploads = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, kind: "image", status: "ready", storage_path: `img${i}.png` })),
  { id: "v1", kind: "video", status: "ready", storage_path: "v.mp4", poster_path: "v.jpg" },
  { id: "a1", kind: "audio", status: "ready", storage_path: "a.mp3" },
  { id: "d1", kind: "document", status: "ready", storage_path: "s.pdf" },
];
const ctxPics = CTX.picturePaths(ctxUploads, ["v1"]);
has(ctxPics.length === Math.min(CTX.MAX_CONTEXT_PICTURES, ctxUploads.filter((u) => u.kind !== "audio" && u.kind !== "document").length) && CTX.MAX_CONTEXT_PICTURES >= 20 && ctxPics[0] === "v.jpg" && !ctxPics.includes("a.mp3") && !ctxPics.includes("s.pdf"), "up to twenty pictures, the look first (a clip by its frame), never a sound file or a document");
has(CTX.documentsOf(ctxUploads).length === 1 && CTX.documentsOf(Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, kind: "document", storage_path: `d${i}.txt` }))).length === 8 && CTX.MAX_CONTEXT_DOCUMENTS >= 10, "up to ten documents are read");
const ctxFileSrc = readFileSync(join(root, "src/lib/video/context-files.ts"), "utf8");
has(/mediaType: "application\/pdf"/.test(ctxFileSrc) && /slice\(0, MAX_DOCUMENT_CHARS\)/.test(ctxFileSrc), "a PDF is handed over whole; a text file as its text");
const ctxDirSrc = readFileSync(join(root, "src/lib/video/director.ts"), "utf8");
has(/\.\.\.documents, \{ type: "text" as const, text: shared \}\], 12000\)/.test(ctxDirSrc) && /\.\.\.images, \.\.\.documents/.test(ctxDirSrc) && /DOCUMENTS_NOTE/.test(ctxDirSrc), "the Director reads the documents — with the outline and with every chapter of a long film");
has(/contextFiles\(supabase, uploads, marked\)/.test(readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8")), "planning gathers the pictures and documents");
has(/contextFiles\(input\.writer/.test(readFileSync(join(root, "src/lib/video/apply-edit.ts"), "utf8")) && /contextFiles\(supabase, uploads/.test(readFileSync(join(root, "src/app/api/video/[id]/assist/route.ts"), "utf8")) && /DOCUMENTS_NOTE/.test(readFileSync(join(root, "src/lib/video/editor.ts"), "utf8")), "so does the AI editor, from the chat and from the editor");
has(/asset\.kind === "document"[\s\S]{0,200}status: "ready"/.test(readFileSync(join(root, "src/lib/video/prepare-asset.ts"), "utf8")), "a document is ready as soon as it is uploaded");
const ctxStudioSrc = readFileSync(join(root, "src/app/dashboard/video/[id]/page.tsx"), "utf8");
has(/uploadStudioFile\(props\.videoId, file\)/.test(ctxStudioSrc) && /Use the files I attached for this: \$\{attached\.map/.test(ctxStudioSrc) && /<Paperclip/.test(ctxStudioSrc), "the studio's change box has a paperclip, and the message names what was attached");
const ctxChatSrc = readFileSync(join(root, "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
has(/if \(project\.intent === "video"\) \{\s*await attachToVideo\(files\)/.test(ctxChatSrc) && /uploadStudioFile\(videoId, file\)/.test(ctxChatSrc) && /project\?\.intent === "video" \? VIDEO_ACCEPT : ACCEPT/.test(ctxChatSrc), "a file attached in the workspace chat of a video goes into the video's media, and its @name into the message");

console.log("\nthumbnails for every scene");
const vePosters = readFileSync(join(root, "src/app/dashboard/components/video/useClipPosters.ts"), "utf8");
const veSrc2 = readFileSync(join(root, "src/app/dashboard/components/video/VideoEditor.tsx"), "utf8");
has(/crossOrigin = "anonymous"/.test(vePosters) && /toDataURL\("image\/jpeg"/.test(vePosters) && /running >= 2/.test(vePosters) && /split\("\?"\)\[0\]/.test(vePosters), "a still is taken from each made clip in the browser, two at a time, kept for the tab whatever its signed link");
has(/useClipPosters\(rawSegments/.test(veSrc2) && /placeholderStyle\(`\$\{scene\?\.shot/.test(veSrc2) && /placeholderStyle\(`\$\{scene\.shot\}\$\{scene\.visual\}`\)/.test(veSrc2), "the filmstrip and the scene list show it; a scene still to be made gets its own colour, not stripes");

console.log("\nthe editor opens from the workspace and plays smoothly");
const wsSrc = readFileSync(join(root, "src/lib/video/workspace.ts"), "utf8");
const ppSrc = readFileSync(join(root, "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
has(/state:'open-editor'/.test(wsSrc) && /data\.state === "open-editor"/.test(ppSrc) && /window\.open\(path, "_blank", "noopener"\)/.test(ppSrc), "the board's Open the editor is opened by the workspace, signed in — not as a sandboxed tab that cannot load the video");
const playSrc = readFileSync(join(root, "src/app/dashboard/components/video/VideoEditor.tsx"), "utf8");
has(/if \(stalled\.current\) \{/.test(playSrc) && /v\.readyState >= 3 && !v\.seeking\) stalled\.current = false/.test(playSrc), "the clock waits while a clip loads and goes on as soon as it can play");
has(/!video\.seeking && video\.readyState >= 1 && Math\.abs\(video\.currentTime - expected\) > \(playing \? 0\.75 : 0\.12\)/.test(playSrc), "a clip is not re-seeked while it is loading or catching up");
has(/video\.poster = seg\.posterUrl/.test(playSrc) && /ref=\{nextRef\} preload="auto"/.test(playSrc), "its still shows instead of black, and the next clip loads ahead");


console.log("\nthe sound never clips or clicks");
const limitedMix = CF.sceneAudioFilter({ seconds: 5, ownSound: true, hasVoice: true });
has(/volume=1\.000,adelay/.test(limitedMix) && limitedMix.endsWith(`${CF.LIMITER}[a]`) && /alimiter=limit=0\.89/.test(CF.LIMITER), "a voice line goes in as it is (not boosted 1.5x) and a limiter keeps every scene under full scale");
has(CF.sceneAudioFilter({ seconds: 5, ownSound: true, hasVoice: false }).endsWith(`${CF.LIMITER}[a]`), "a scene with no voice is limited too");
const cutJoin = CF.joinArgs({ segments: [{ path: "a", seconds: 4 }, { path: "b", seconds: 5 }], transition: "cut", duration: 0.5, listPath: "l", out: "o", encoder: { preset: "veryfast", crf: 21 } }).args.join(" ");
has(/-c:v copy -c:a aac/.test(cutJoin) && !/-c copy/.test(cutJoin), "scenes joined by a cut copy the picture but encode the sound once more — no click at every join");
has(/go && voice\.paused/.test(playSrc) && /!go && !music\.paused/.test(playSrc), "in the editor, voice and music wait while a clip loads instead of running ahead and jumping back");


console.log("\nthe studio's Director edits only what was asked, and keeps the cast");
const planRoute = readFileSync(join(root, "src/app/api/video/[id]/plan/route.ts"), "utf8");
has(/editVideo\(\{ writer, userId, videoId: id, instruction: note/.test(planRoute) && planRoute.indexOf("editVideo(") < planRoute.indexOf("return planVideo("), "a change asked in the studio on a made video is an edit — every other clip reused — not a new plan rendered from scratch");
const edSrc = readFileSync(join(root, "src/lib/video/editor.ts"), "utf8");
has(/e\?\.characters\?\.length && JSON\.stringify/.test(edSrc), "an empty character list never takes the cast out of a scene (no re-film with a new face)");
has(/NEVER a reason to refilm/.test(edSrc) && /Characters are locked/.test(edSrc), "the editor is told text and sound never re-film, and characters are locked");
const chatPage = readFileSync(join(root, "src/app/dashboard/video/[id]/page.tsx"), "utf8");
const msgRoute = readFileSync(join(root, "src/app/api/video/[id]/messages/route.ts"), "utf8");
has(/setNote\(""\);\s*setAttached\(\[\]\);\s*void ask\(/.test(chatPage) && /role: "user", text/.test(chatPage) && /from\("video_messages"\)/.test(msgRoute), "a message leaves the box at once, drops into the chat and is stored");
has(/New session/.test(chatPage) && /sessionList\(messages/.test(chatPage), "a new session starts a fresh conversation; earlier ones are listed");
has(/messageId = params\.get\("message"\)/.test(msgRoute) && /removeMessage\(message\.id\)/.test(chatPage), "one message can be deleted from the conversation");
const llmSrc = readFileSync(join(root, "src/lib/ai/llm.ts"), "utf8");
has(/AbortSignal\.any\(\[stop, limit\]\)/.test(llmSrc) && /withStop\(request\.signal/.test(planRoute), "Stop aborts the request, and every model call it makes stops with it");
has(/if \(stopped\(\)\) return NextResponse\.json\(\{ error: "Stopped/.test(readFileSync(join(root, "src/lib/video/plan-video.ts"), "utf8")) && /if \(stopped\(\)\) return \{ ok: false, message: "Stopped/.test(readFileSync(join(root, "src/lib/video/apply-edit.ts"), "utf8")), "a stopped change saves and charges nothing");
has(/aria-label="Stop"/.test(chatPage) && /animate-spin rounded-full border-2/.test(chatPage) && /signal: controller\.signal/.test(chatPage), "while it works, the send button is a stop sign in a turning ring");
const dropSrc = readFileSync(join(root, "src/lib/use-file-drop.tsx"), "utf8");
has(/item\.kind === "file"/.test(dropSrc) && /Screenshot \$\{stamp\}/.test(dropSrc) && /carriesFiles/.test(dropSrc), "a pasted screenshot or dropped file is taken (and named), text still pastes as text");
for (const [file, call] of [["src/app/dashboard/video/[id]/page.tsx", "void attach(files)"], ["src/app/dashboard/components/workspace/ChatPanel.tsx", "void attachFiles(files)"], ["src/app/dashboard/page.tsx", "addFiles(files)"]]) {
  const src = readFileSync(join(root, file), "utf8");
  has(src.includes(`useFileDrop((files) => ${call}`) && /\{\.\.\.fileDrop\.zone\}/.test(src) && /onPaste=\{fileDrop\.onPaste\}/.test(src) && /<DropHint show=\{fileDrop\.dragging\}/.test(src), `${file.split("/").slice(-2).join("/")}: drop or paste a screenshot into the composer`);
}
const stillsSrc = readFileSync(join(root, "src/lib/video/scene-stills.ts"), "utf8");
const applySrc = readFileSync(join(root, "src/lib/video/apply-edit.ts"), "utf8");
const nextCfg = readFileSync(join(root, "next.config.mjs"), "utf8");
has(/wantsStills\(input\.instruction\)/.test(applySrc) && /\.\.\.context, stills, history, nudge \}/.test(applySrc) && /\.\.\.\(input\.stills \?\? \[\]\)/.test(edSrc), "a picture sent with a change: the editor sees a still of every made scene and finds the one it shows");
has(/tile=5x4/.test(stillsSrc) && /SINGLE_STILLS = 24/.test(stillsSrc) && /Say in reply which scene you matched/.test(stillsSrc), "short videos get one labelled still per scene, long films contact sheets; the editor says which scene it matched");
has(/"\/api\/video\/\[id\]\/plan": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(nextCfg) && /"\/api\/build": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(nextCfg), "the routes that edit carry ffmpeg for the stills");
has(/aria-expanded=\{showSessions\}/.test(chatPage) && /qs-director-sessions/.test(chatPage) && /"Today" : days === 1 \? "Yesterday"/.test(chatPage), "the sessions are a list grouped by day that folds away, and stays folded or open next time");
const msgSql = readFileSync(join(root, "supabase/migrations/20261113200000_video_messages.sql"), "utf8");
has(/enable row level security/.test(msgSql) && /p\.user_id = auth\.uid\(\)/.test(msgSql), "the chat is stored owner-only");
has(/export async function DELETE/.test(msgRoute) && /\.delete\(\)\.eq\("video_id", id\)\.eq\("session", number\)/.test(msgRoute) && /video_messages_owner_delete/.test(msgSql), "a session can be deleted, owner-only");
has(/setConfirming\(item\.session\)/.test(chatPage) && /removeSession\(item\.session\)/.test(chatPage) && /if \(!response\?\.ok\) setMessages\(before\)/.test(chatPage), "deleting asks once on the row, and comes back if the server says no");

console.log("\nthe brand's name: white, one corner, drawn by the cut");
const bm = L.normalizeCut({ brandMark: { text: "quickstark", position: "left" } });
has(bm.brandMark.text === "QuickStark.Ai" && bm.brandMark.position === "top-left" && bm.brandMark.when === "start" && L.normalizeBrandMark(null) === null && L.normalizeCut({ brandMark: { position: "bottom right", when: "all" } }).brandMark.position === "bottom-right", "a brand mark is read as written: \"left\" is the top-left, the opening by default, null takes it away");
const bmFilter = CF.wordsFilter({ fontPath: "f.ttf", dir: "d", n: 1, brand: "QuickStark.Ai", brandPosition: "top-left" }, 720, 1280).join(",");
has(/textfile=d\/brand-1\.txt:fontcolor=white:fontsize=\d+:x=\d+:y=\d+:shadowcolor/.test(bmFilter), "it is drawn pure white in its corner, with a soft shadow, never in a model's colours");
const bmClip = R.clipPrompt("A runner at dawn on a Lagos bridge. The QuickStark logo glows in green on a billboard. Golden light, slow push-in.");
has(!/quick ?stark|logo/i.test(bmClip.split("No subtitles")[0]) && /Lagos bridge/.test(bmClip) && /Golden light/.test(bmClip) && /logos, brand names, wordmarks/.test(R.NO_LETTERING), "a clip prompt never asks the video model to draw the brand or a logo");
const bmEd = L.normalizePlan({ cut: { brandMark: { text: "QuickStark.Ai", position: "top-left" } }, scenes: [{ duration: 5, visual: "a", motionPrompt: "x" }] }, "commercial_ad", {});
const bmGone = ED.applyEdit(bmEd, ED.normalizeEdit({ cut: { brandMark: null } }, bmEd));
const bmMoved = ED.applyEdit(bmEd, ED.normalizeEdit({ cut: { brandMark: { position: "bottom-left" } } }, bmEd));
has(!bmGone.plan.cut?.brandMark && bmMoved.plan.cut.brandMark.position === "bottom-left" && bmMoved.refilm.length === 0 && bmGone.refilm.length === 0, "the editor moves or removes the brand mark without re-filming anything");
const bmDir = readFileSync(join(root, "src/lib/video/director.ts"), "utf8");
has(/NEVER drawn by the video engines/.test(bmDir) && /use brandMark \(white is the only colour/.test(readFileSync(join(root, "src/lib/video/editor.ts"), "utf8")), "the Director and the editor are both told: the brand is the white brand mark, nowhere else");

console.log("\nthe video composers work like the workspace's");
const compSrc = readFileSync(join(root, "src/app/dashboard/video/[id]/page.tsx"), "utf8");
has(/box\.style\.height = `\$\{Math\.min\(box\.scrollHeight, 240\)\}px`/.test(compSrc) && /text-base leading-relaxed/.test(compSrc) && /!event\.nativeEvent\.isComposing/.test(compSrc), "the Director box grows with what is typed, is 16px on a phone, and Enter sends (Shift+Enter breaks the line)");
has(/flex flex-wrap gap-2/.test(compSrc) && /text-base text-ink outline-none placeholder:text-faint focus:border-line\/\[0\.25\] sm:h-9 sm:text-\[13px\]/.test(compSrc), "the per-scene ask wraps on a phone and never zooms it in");

console.log("\npublish is for websites only");
const pvSrc = readFileSync(join(root, "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
const wsSrc2 = readFileSync(join(root, "src/app/dashboard/components/workspace/Workspace.tsx"), "utf8");
const miSrc = readFileSync(join(root, "src/lib/media-intent.ts"), "utf8");
has(/MEDIA_INTENTS = \["video", "flier"\]/.test(miSrc) && /const publishable = !isMediaIntent\(project\?\.intent\)/.test(pvSrc) && (pvSrc.match(/\{publishable && /g) ?? []).length >= 3, "a video or flier project shows no Publish in the workspace header (phone and desktop) or the changes banner");
has(/onDeploy=\{isMediaIntent\(project\?\.intent\) \? undefined : requestPublish\}/.test(wsSrc2) && /onPublish=\{isMediaIntent\(project\?\.intent\) \? undefined : requestPublish\}/.test(wsSrc2) && /\{onPublish && \(/.test(readFileSync(join(root, "src/app/dashboard/components/workspace/BuildResultCard.tsx"), "utf8")), "nor on the build card or the phone's quick actions; websites keep it");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
