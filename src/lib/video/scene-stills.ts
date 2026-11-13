/* A still from every made scene, for the AI editor — so a screenshot or
 * picture the person sends ("change this", "remove the text here") is matched
 * to the scene it shows, by eye, instead of guessed from the plan's words.
 *
 *   up to 24 scenes   one small still each, labelled "SCENE n" in the message
 *   more              contact sheets of 20 (5 across, 4 down), each labelled
 *                     with the scenes it holds, read left to right, top down
 *
 * A frame a third of the way in (a first frame is often black or mid-fade),
 * taken with ffmpeg straight from the clip's link — only the bytes around
 * that moment are read. The person's own clips use the poster made at upload.
 *
 * Only asked for when the message comes with a picture (wantsStills).
 * Never throws: a scene that cannot be read is left out, and without ffmpeg
 * there are simply no stills.
 *
 * Server-only. Routes that call it carry the ffmpeg binary (next.config.mjs). */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";

import type { LlmPart } from "@/lib/ai/llm";

import type { ProductionPlan } from "./plan";
import { signedUrl } from "./production";

const exec = promisify(execFile);

/** One still per scene up to this many; contact sheets beyond. */
export const SINGLE_STILLS = 24;
/** Scenes per contact sheet (5 across, 4 down). */
export const SHEET_SIZE = 20;
/** The most scenes looked at (15 sheets). */
export const MAX_STILL_SCENES = 300;

/** Whether a message comes with a picture to match against the scenes. Pure. */
export function wantsStills(instruction: string): boolean {
  return /screenshot|screen shot|attached|this (scene|shot|frame|image|picture|part|one)|in (the|this) (image|picture|photo|screenshot)|look at (this|the) (image|picture)|\bimage\b|\bpicture\b|\bphoto\b|@[\w-]+\.(png|jpe?g|webp|heic)/i.test(instruction);
}

/** Where in a clip its still is taken (seconds). Pure. */
export const stillAt = (seconds: number) => Math.max(0.2, Math.min(1.5, (Number(seconds) || 3) / 3));

/** ffmpeg: one small still from a clip at a moment. Pure. */
export function stillArgs(input: { url: string; at: number; out: string; height?: number }): string[] {
  const height = input.height ?? 240;
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", input.at.toFixed(2), "-i", input.url,
    "-frames:v", "1",
    /* Every still the same square box, so they tile: fitted, then padded. */
    "-vf", `scale=${height}:${height}:force_original_aspect_ratio=decrease,pad=${height}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-q:v", "5", input.out,
  ];
}

/** ffmpeg: numbered stills into contact sheets of SHEET_SIZE. Pure. */
export function sheetArgs(input: { pattern: string; out: string }): string[] {
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input.pattern, "-vf", "tile=5x4:padding=4:margin=4:color=0x202020", "-q:v", "4", input.out];
}

/** The scenes in each contact sheet, in order. Pure. */
export function sheetGroups(scenes: number[]): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < scenes.length; i += SHEET_SIZE) groups.push(scenes.slice(i, i + SHEET_SIZE));
  return groups;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

type Done = (scene: number, engine: string) => { output_path: string | null } | undefined;

/** Stills of the made scenes, as message parts, in scene order. */
export async function sceneStills(
  service: SupabaseClient,
  input: { videoId: string; plan: ProductionPlan; done: Done; posters?: Map<string, string> },
): Promise<LlmPart[]> {
  if (!ffmpegPath) return [];
  const dir = `/tmp/qs-stills-${input.videoId}-${Date.now()}`;
  try {
    await mkdir(dir, { recursive: true });
    const scenes = input.plan.scenes.slice(0, MAX_STILL_SCENES);
    const taken: number[] = [];
    const index = new Map(scenes.map((scene, i) => [scene.n, i]));
    await inBatches(scenes, 6, async (scene) => {
      const own = scene.source?.assetId ? input.posters?.get(scene.source.assetId) : null;
      const output = own ? `storage:${own}` : (input.done(scene.n, "avatar") ?? input.done(scene.n, "video"))?.output_path ?? null;
      const url = await signedUrl(service, output);
      if (!url) return;
      const out = `${dir}/still-${String(index.get(scene.n)).padStart(4, "0")}.jpg`;
      try {
        await exec(ffmpegPath as string, stillArgs({ url, at: own ? 0 : stillAt(scene.duration), out }), { timeout: 25_000 });
        taken.push(scene.n);
      } catch {
        /* Left out. */
      }
    });
    taken.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
    if (!taken.length) return [];

    const parts: LlmPart[] = [
      {
        type: "text",
        text: "SCENE STILLS — what each made scene actually looks like (a frame a third of the way in). When the person sends a screenshot or picture and means a scene (\"this\", \"here\", \"the one in the picture\"), find the scene it matches by comparing it with these — the people, setting, colours, framing and any words on screen — and make the change there. Say in reply which scene you matched. If it matches none, say so rather than guessing.",
      },
    ];
    const file = async (n: number) => readFile(`${dir}/still-${String(index.get(n)).padStart(4, "0")}.jpg`);
    if (taken.length <= SINGLE_STILLS) {
      for (const n of taken) {
        parts.push({ type: "text", text: `SCENE ${n}:` });
        parts.push({ type: "file", mediaType: "image/jpeg", base64: (await file(n)).toString("base64") });
      }
      return parts;
    }
    /* Contact sheets: the stills renumbered in a row, tiled 5 x 4. */
    for (const [k, group] of sheetGroups(taken).entries()) {
      const sheetDir = `${dir}/sheet-${k}`;
      await mkdir(sheetDir, { recursive: true });
      for (const [j, n] of group.entries()) {
        await writeFile(`${sheetDir}/${String(j).padStart(3, "0")}.jpg`, await file(n));
      }
      const out = `${dir}/sheet-${k}.jpg`;
      try {
        await exec(ffmpegPath as string, sheetArgs({ pattern: `${sheetDir}/%03d.jpg`, out }), { timeout: 30_000 });
      } catch {
        continue;
      }
      parts.push({ type: "text", text: `SHEET ${k + 1} — scenes ${group.join(", ")}, in that order: left to right, then the next row down (5 across).` });
      parts.push({ type: "file", mediaType: "image/jpeg", base64: (await readFile(out)).toString("base64") });
    }
    return parts.length > 1 ? parts : [];
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
