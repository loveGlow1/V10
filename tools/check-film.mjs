/* Checks long films (src/lib/video/chapters.ts, stream-upload.ts): the
 * chapter split, and a real join — parts made the way the cut makes them,
 * joined by copying, streamed out in storage-sized pieces, and read back as
 * one film of the right length with picture and sound.
 *
 *   node tools/check-film.mjs */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-film");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"], baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
  files: ["chapters.ts", "stream-upload.ts", "cut-filters.ts"].map((f) => join(process.cwd(), "src/lib/video", f)),
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
for (const entry of readdirSync(out, { recursive: true })) {
  if (!String(entry).endsWith(".js")) continue;
  const path = join(out, String(entry));
  const depth = String(entry).split("/").length - 1;
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/(from\s+["'])@\/([^"']+?)(["'])/g, (_, a, rest, c) => `${a}${"../".repeat(depth)}${rest}.js${c}`)
    .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (w, a, spec, c) => (spec.endsWith(".js") || spec.startsWith("ffmpeg") ? w : `${a}${spec}.js${c}`)));
}
const C = await import(join(out, "lib/video/chapters.js"));
const F = await import(join(out, "lib/video/cut-filters.js"));
/* stream-upload imports ffmpeg-static, resolved from the project. */
const S = await import(join(out, "lib/video/stream-upload.js")).catch(async () => {
  const src = join(out, "lib/video/stream-upload.js");
  writeFileSync(src, readFileSync(src, "utf8").replace(/from "ffmpeg-static"/, `from "${createRequire(import.meta.url).resolve("ffmpeg-static")}"`));
  return import(src);
});
const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

console.log("chapters");
const scenes = (count, seconds = 10) => Array.from({ length: count }, (_, i) => ({ n: i + 1, duration: seconds }));
has(C.chaptersOf(scenes(12)).length === 1, "a two-minute video is one run, as before");
const hour = C.chaptersOf(scenes(360));
has(hour.length >= 25 && hour.length <= 32, `an hour of 10s scenes is ${hour.length} chapters of about two minutes`);
has(hour.flat().length === 360 && hour.flat().every((n, i) => n === i + 1), "every scene once, in order");
const linked = scenes(30).map((s) => ({ ...s, continues: s.n === 13 }));
const cut = C.chaptersOf(linked);
has(!cut.some((ch) => ch[0] === 13), "a scene that carries on from the one before is not cut away from it", JSON.stringify(cut.map((c) => [c[0], c.at(-1)])));
has(C.chaptersOf([...scenes(13), { n: 14, duration: 5 }]).at(-1).includes(14) && C.chaptersOf([...scenes(13), { n: 14, duration: 5 }]).every((c) => c.length > 1), "a few seconds left over join the last chapter");
has(C.chapterStarts(scenes(30), C.chaptersOf(scenes(30)))[1] === 120, "the second chapter starts two minutes in");
has(C.musicOffset(10, 250, 120) === 20 && C.musicOffset(0, 50, 0) === 50, "the music carries on where it was, round again when it ends");
has(C.readPartsOutput(C.partsOutput(24, "u/v/v3"))?.count === 24 && C.readPartsOutput("storage:x") === null, "a film kept as parts says so on its row");
has(C.partOf(C.partProvider(7)) === 7 && C.partPath("a/b", 7) === "a/b/part-007.mp4", "parts are numbered and stored in order");
has(C.concatList(["https://x/a?t=1", "https://x/b'c"]).includes("file 'https://x/b'\\''c'"), "the join list quotes every address");
const args = C.streamJoinArgs({ list: "l.txt" });
has(args.includes("copy") && args.includes("pipe:1") && args.join(" ").includes("empty_moov"), "the join copies, never encodes, and streams");
const mix = F.musicMixArgs({ joined: "a.mp4", music: "m.mp3", out: "o.mp4", seconds: 120, spoken: true, loop: true, fadeIn: false, fadeOut: false, start: 30 });
has(mix.join(" ").includes("-stream_loop -1") && !mix.join(" ").includes("afade") && mix.join(" ").includes("anull"), "a middle part loops the music with no fades");
has(F.musicMixArgs({ joined: "a", music: "m", out: "o", seconds: 10, spoken: false }).join(" ").includes("afade=t=in"), "a short cut still fades its music in and out");

console.log("pieces");
async function* chunks(sizes) { for (const n of sizes) yield Buffer.alloc(n, 1); }
const got = [];
for await (const piece of S.pieces(chunks([5, 9, 3, 1]), 6)) got.push(piece.length);
has(JSON.stringify(got) === JSON.stringify([6, 6, 6]), "a stream is cut into pieces of exactly the size storage takes", JSON.stringify(got));
const tail = [];
for await (const piece of S.pieces(chunks([7]), 6)) tail.push(piece.length);
has(JSON.stringify(tail) === "[6,1]", "only the last piece is shorter");

console.log("a real join");
const dir = join(out, "join");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const parts = [];
for (let k = 1; k <= 3; k += 1) {
  const part = join(dir, `part-${k}.mp4`);
  /* As the cut finishes a part: H.264 yuv420p, 30 fps, AAC 48 kHz stereo, fast-start. */
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${3 + k}`,
    "-f", "lavfi", "-i", `sine=frequency=${300 + k * 100}:sample_rate=48000:duration=${3 + k}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", part]);
  parts.push(part);
}
const list = join(dir, "parts.txt");
writeFileSync(list, C.concatList(parts));
const film = join(dir, "film.mp4");
const sink = createWriteStream(film);
let bytes = 0;
let pieceCount = 0;
for await (const piece of S.pieces(S.ffmpegOutput(C.streamJoinArgs({ list }), 60_000), 64 * 1024)) {
  bytes += piece.length;
  pieceCount += 1;
  sink.write(piece);
}
await new Promise((r) => sink.end(r));
has(bytes > 10_000 && pieceCount > 1, `the film streamed out in ${pieceCount} pieces, ${Math.round(bytes / 1024)} KB`);
const probe = (() => { try { execFileSync(ffmpeg, ["-hide_banner", "-i", film], { stdio: ["ignore", "pipe", "pipe"] }); return ""; } catch (e) { return String(e.stderr); } })();
const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
has(Math.abs(seconds - 15) < 0.4, `one film as long as its parts together (${seconds}s of 15s)`, probe.slice(-400));
has(/Video: h264/.test(probe) && /Audio: aac/.test(probe), "with its picture and its sound");
/* Decodes end to end, with no errors. */
let clean = true;
try { execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-i", film, "-f", "null", "-"]); } catch { clean = false; }
has(clean, "plays through to the end without a broken frame");
let refused = false;
try { for await (const _ of S.ffmpegOutput(["-hide_banner", "-i", join(dir, "missing.mp4"), "-f", "mp4", "pipe:1"], 10_000)) { /* nothing */ } } catch { refused = true; }
has(refused, "a join that fails says so instead of storing half a film");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
