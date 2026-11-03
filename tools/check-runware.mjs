#!/usr/bin/env node
/* Runware: one key for MiniMax H3 clips, MiniMax speech and stills.
 *
 *   npm run check:runware
 *
 * lib/runware.ts (the task shapes), lib/video/clip-engines.ts (where Runware
 * sits in each scene's chain) and the wiring around them. Offline. No key. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-runware");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"], baseUrl: root, paths: { "@/*": ["src/*"] } },
  files: [join(root, "src/lib/runware.ts"), join(root, "src/lib/video/clip-engines.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
for (const entry of readdirSync(out, { recursive: true })) {
  if (!String(entry).endsWith(".js")) continue;
  const path = join(out, String(entry));
  const depth = String(entry).split("/").length - 1;
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/(from\s+["'])@\/([^"']+?)(["'])/g, (_, a, rest, c) => `${a}${"../".repeat(depth)}${rest}.js${c}`)
    .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (w, a, spec, c) => (spec.endsWith(".js") ? w : `${a}${spec}.js${c}`)));
}
const W = await import(join(out, "lib/runware.js"));
const C = await import(join(out, "lib/video/clip-engines.js"));
const read = (p) => readFileSync(join(root, p), "utf8");

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

/* ── The video task ─────────────────────────────────────────────────── */
const text = W.videoTask({ taskUUID: "u", prompt: "a woman talks to camera", seconds: 6, aspect: "9:16", webhookUrl: "https://x/hook" });
has(text.taskType === "videoInference" && text.model === "minimax:h3@0", "a clip is a videoInference task on MiniMax H3 by default");
has(text.width === 768 && text.height === 1344, "9:16 from text is 768×1344 — vertical, not cropped", JSON.stringify(text));
has(text.deliveryMethod === "async" && text.webhookURL === "https://x/hook" && text.outputType === "URL", "queued async, reporting to our webhook, as a URL");
const framed = W.videoTask({ taskUUID: "u", prompt: "p", seconds: 6, aspect: "9:16", imageUrl: "https://img/a.png", webhookUrl: "https://x" });
has(framed.inputs?.frameImages?.[0]?.image === "https://img/a.png" && framed.inputs.frameImages[0].frame === "first" && framed.width === undefined, "from a still: the first frame, and no width/height beside it (H3 refuses both)");
has(W.videoTask({ taskUUID: "u", prompt: "p", seconds: 30, aspect: "1:1", webhookUrl: "x" }).duration === 15 && W.videoTask({ taskUUID: "u", prompt: "p", seconds: 1, aspect: "1:1", webhookUrl: "x" }).duration === 4, "durations are kept within H3's 4–15s");
has(W.videoTask({ taskUUID: "u", prompt: "p", seconds: 6, aspect: "16:9", webhookUrl: "x", model: "minimax:4@1" }).model === "minimax:4@1", "RUNWARE_VIDEO_MODEL can swap the model");
has(/out of credit/.test(W.runwareError([{ code: "insufficientCredits", message: "Insufficient credits" }], 402)) && /key was refused/.test(W.runwareError([], 401)), "Runware's refusals are said in plain words");

/* ── Routing ────────────────────────────────────────────────────────── */
const env = { RUNWARE_API_KEY: "k" };
has(C.routeClip({ pipeline: "ugc_influencer", aspect: "9:16", fromFrame: false, tier: "credit" }, env)[0] === "runware", "with only RUNWARE_API_KEY, a vertical UGC scene is filmed on Runware");
const both = { RUNWARE_API_KEY: "k", MINIMAX_API_KEY: "m" };
has(C.routeClip({ pipeline: "photo_to_video", aspect: "9:16", fromFrame: true, tier: "credit" }, both).slice(0, 2).join() === "runware,minimax", "credit tier: Runware's prepaid credit first, MiniMax direct behind it");
has(C.routeClip({ pipeline: "ugc_influencer", aspect: "16:9", fromFrame: false, tier: "economy" }, both)[0] === "runware", "economy tier: Runware first");
has(C.routeClip({ pipeline: "ugc_influencer", aspect: "9:16", fromFrame: false, tier: "credit" }, {}).length === 0, "without the key it is never in a chain");
has(C.parseProvider(C.providerOf("runware", "1b4e28ba-2fa1-11d2-883f-0016d3cca427"))?.engine === "runware", "a Runware row reads back as Runware");
has(C.voiceDirect({ RUNWARE_API_KEY: "k", N8N_WEBHOOK_URL: "x", N8N_WEBHOOK_TOKEN: "t" }, "credit") === true && C.canSpeak(env), "voice lines go to Runware's MiniMax speech when it is connected");

/* ── Wiring ─────────────────────────────────────────────────────────── */
const providers = read("src/lib/video/providers.ts");
has(/engine === "runware"[\s\S]*submitRunwareVideo/.test(providers) && /runwareVideoStatus\(id\)/.test(providers), "clips are submitted and read back through runware.ts");
has(/if \(runwareConfigured\(\)\)[\s\S]*runwareSpeak[\s\S]*speakMiniMax\(input\)/.test(providers), "speech: Runware first, MiniMax's own API as the fallback");
has(/body\.taskUUID/.test(read("src/app/api/video/[id]/render/clip/route.ts")), "the webhook recognises Runware's taskUUID — and still asks Runware before believing it");
has(/RUNWARE_API_KEY\) makers\.push\(\(\) => runwareStill/.test(read("src/lib/video/frames.ts")), "scene stills can be made on Runware");
has(/'runware-image': 'RUNWARE_API_KEY'/.test(read("src/lib/flyers/router.ts")) && /case 'runware-image'/.test(read("src/lib/flyers/run.ts")), "fliers can be drawn on Runware");
has(/id: "runware"[^\n]*RUNWARE_API_KEY/.test(read("src/lib/keys.ts")), "RUNWARE_API_KEY is on the keys page");
has(!/["']use client["']/.test(read("src/lib/runware.ts")) && /Server-only/.test(read("src/lib/runware.ts")), "runware.ts is server code — the key never reaches a browser");

console.log(`\n${failed ? `${failed} checks failed.` : "All Runware checks passed."} (${passed} passed)`);
process.exit(failed ? 1 : 0);
