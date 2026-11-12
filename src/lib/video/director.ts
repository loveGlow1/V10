/* The Creative Director — the one model call every pipeline shares.
 *
 * It turns the idea, the pipeline and Step 2's answers into a production
 * plan: concept, strategy, consistency locks (product, creator, characters,
 * world, style), script, storyboard and scene list, each scene with the
 * prompt its engine will receive. The pipeline's own rules (pipelines.ts)
 * specialise it; everything after it — routing, QA, repair — is in plan.ts.
 *
 * Server-only. */

import Anthropic from "@anthropic-ai/sdk";

import { attachmentManifest, type StudioAsset } from "./assets";
import { castManifest, type PlanCharacter } from "./cast";
import { PIPELINES, type PipelineId } from "./pipelines";
import { MAX_CLIP_SECONDS, normalizePlan, qaAndRepair, secondsFrom, type ProductionPlan, type QaIssue } from "./plan";
import { withPolicy } from "@/lib/safety/policy";

export const DIRECTOR_MODEL = "claude-sonnet-5";

/* Whether the video is narrated, from the Voiceover choice. A narrated video
   is narrated throughout: a voice on the last line only reads as a video
   whose sound broke. Pure. */
export function narrationRule(voice: string | undefined): string {
  if (voice && /^(no voiceover|music only|none)$/i.test(voice.trim())) {
    return "No narration: leave every scene's voiceover empty; the story is told by picture, on-screen text and sound.";
  }
  const who = voice && /male/i.test(voice) ? `a ${voice.toLowerCase()} narrator` : "a narrator";
  return `Narrated throughout by ${who}: write a voiceover line for EVERY scene — a title card or beat of 2 seconds or less may stay silent — so the voice carries the video from the first scene to the last. Each line must be speakable within its scene's duration (about 2.5 words per second) and lines read as one continuous script.`;
}

function systemFor(pipeline: PipelineId, answers: Record<string, string>): string {
  const spec = PIPELINES[pipeline];
  const target = secondsFrom(answers.length);
  return `You are QuickStark's Creative Director. You plan a ${spec.label} video for production by AI generation engines.

PIPELINE: ${spec.stages.join(" → ")}

RULES FOR THIS PIPELINE:
${spec.director.map((rule) => `- ${rule}`).join("\n")}

RULES FOR EVERY VIDEO:
- Target length: ${target} seconds. Scene durations must add up to it.
- ATTACHMENTS (before the idea) lists the person's own uploads and is the only truth about them. A scene may use an uploaded clip or picture instead of generating one: set "source": {"assetId": "<an assetId from ATTACHMENTS>", "trimStart": 0, "trimEnd": 8} (seconds; leave the trims out to use it whole). Such a scene runs as long as its trimmed footage, needs no motionPrompt, and its engine is "video" for a clip or "image" for a picture. Never invent an assetId; never say there is footage when ATTACHMENTS says video x0.
- Each generated scene is ONE clip of 2 to ${MAX_CLIP_SECONDS} seconds. A longer beat in the idea's timeline becomes consecutive scenes (a 10-second beat is two 5-second scenes), each with its own part of the line and its own shot — a cut, a new angle or a closer framing.
- ${narrationRule(answers.voice)}
- Every scene's motionPrompt is self-contained: a generation engine sees only that prompt. Name subject, setting, lighting, lens/shot, camera move, motion, mood and aspect ratio.
- CHARACTERS (before the idea) are the people who recur. Every scene showing one lists their id in "characters" (who is on screen, in order) — as many as the scene has, up to nine; name each one in the visual and motionPrompt (by name) and say where each stands and what each does, so nobody is confused for another. Dialogue is "NAME: line", one speaker per scene (a back-and-forth is consecutive scenes). Their look comes from reference pictures and their locked description, so a prompt names them and says what they DO, never what they look like. Give recurring people only through CHARACTERS; with none set, describe a person fully in each prompt and keep it identical in "locks".
- A scene that carries straight on from the previous one (same place, same moment, the action continuing — not a cut to somewhere else) sets "continues": true; it is then filmed from the previous scene's last frame. Set "continues": false on a scene that deliberately cuts away. Scenes sharing a character continue by default.
- Anything else that must look the same in more than one scene (product, world, palette and type) goes in "locks" and is repeated word for word in each scene prompt that shows it.
- engine is one of: ${spec.engines.map((e) => `"${e}"`).join(", ")}. Use "avatar" only for a person speaking to camera with a line in voiceover.
- When the video names QuickStark itself, the name is always "QuickStark.ai" — in every voiceover line, on-screen text, title and CTA. Never a bare "QuickStark".
- Never depict or imitate a real, identifiable person or brand the user did not supply. No unsafe, hateful or sexual content.
- Write in the language the answers ask for (default English).

Reply with ONLY raw JSON, no markdown fences:
{"title":"","concept":"","strategy":"","aspect":"9:16|1:1|16:9|4:5","voice":"","music":"","hooks":[""],"locks":{"product":"","style":""},"cta":"",
 "scenes":[{"duration":3,"shot":"","visual":"","onScreenText":"","voiceover":"","sound":"","motionPrompt":"","engine":"${spec.defaultEngine}","characters":[],"continues":false}]}
A scene made from an upload adds "source":{"assetId":"","trimStart":0,"trimEnd":0}. You may also set "cut":{"transition":"crossfade|cut|fadeblack","captions":true,"audio":"voiceover|original|mix|none"} when the idea asks for it.`;
}

export type DirectorInput = {
  pipeline: PipelineId;
  brief: string;
  answers: Record<string, string>;
  /** Signed URLs of reference images (product, person, photo) and clip posters, at most three. */
  images?: string[];
  /** Everything the person uploaded: the ATTACHMENTS block is made from it. */
  assets?: StudioAsset[];
  /** The cast, locked: the CHARACTERS block is made from it. */
  characters?: PlanCharacter[];
  /** The model that plans (agent.ts); the studio's default otherwise. */
  model?: string;
  /** For a re-plan: what to change. */
  note?: string;
  previous?: ProductionPlan | null;
};

export type Directed = { plan: ProductionPlan; issues: QaIssue[]; outputTokens: number; /** Model calls made: one, or an outline and one per chapter for a long film. */ calls?: number };

/** Longer than this (seconds), a film is planned as an outline and then chapter by chapter. */
export const LONG_PLAN_SECONDS = 180;
/** About how long each planned chapter of a long film is (seconds). */
export const PLAN_CHAPTER_SECONDS = 240;

/** How many chapters a film of `seconds` is planned in. Pure. */
export function planChapterCount(seconds: number): number {
  return seconds > LONG_PLAN_SECONDS ? Math.max(2, Math.ceil(seconds / PLAN_CHAPTER_SECONDS)) : 1;
}

/** Splits `total` seconds over chapters as the outline asked, made to add up exactly. Pure. */
export function chapterSeconds(asked: number[], total: number): number[] {
  const count = asked.length;
  if (!count) return [];
  const clean = asked.map((s) => (Number.isFinite(s) && s > 0 ? s : total / count));
  const sum = clean.reduce((a, b) => a + b, 0) || 1;
  const scaled = clean.map((s) => Math.max(20, Math.round((s / sum) * total)));
  const diff = total - scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] = Math.max(20, scaled[scaled.length - 1] + diff);
  return scaled;
}

function readJson(raw: string): Record<string, unknown> {
  const text = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
}

async function ask(model: string, system: string, content: Anthropic.MessageParam["content"], maxTokens: number): Promise<{ json: Record<string, unknown>; outputTokens: number }> {
  const message = await new Anthropic().messages.create({ model, max_tokens: maxTokens, system: withPolicy(system), messages: [{ role: "user", content }] });
  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return { json: readJson(raw), outputTokens: message.usage.output_tokens };
}

type Outline = { title?: string; summary?: string; seconds?: number; setting?: string; characters?: string[]; opens?: string; ends?: string };

/* A long film: the outline first — its story in chapters, the locks, the
   voice and the music — then every chapter's scenes at once, each told the
   whole outline and how the chapters either side of it begin and end, so the
   story, the cast and the look carry straight through. */
async function directFilm(input: DirectorInput, target: number): Promise<Directed | { error: string }> {
  const model = input.model || DIRECTOR_MODEL;
  const count = planChapterCount(target);
  const shared = [
    attachmentManifest(input.assets ?? []),
    castManifest(input.characters ?? []),
    `IDEA:\n${input.brief.slice(0, 6000)}`,
    Object.entries(input.answers).map(([key, value]) => `${key}: ${value}`).join("\n") && `CHOICES:\n${Object.entries(input.answers).map(([key, value]) => `${key}: ${value}`).join("\n")}`,
    input.previous ? `CURRENT FILM (revise it, keep what works): ${input.previous.title} — ${input.previous.concept}\nScenes so far: ${input.previous.scenes.length}` : "",
    input.note ? `CHANGE REQUESTED:\n${input.note.slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const images = (input.images ?? []).slice(0, 3).map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));

  const outlineSystem = `${systemFor(input.pipeline, input.answers)}

THIS IS A LONG FILM of ${Math.round(target / 60)} minutes. Do not write scenes yet. Plan it in exactly ${count} chapters that tell one complete story with a beginning, middle and end, and that flow into each other. Reply with ONLY raw JSON:
{"title":"","concept":"","strategy":"","aspect":"9:16|1:1|16:9|4:5","voice":"","music":"","hooks":[""],"locks":{"style":"","world":""},"cta":"",
 "chapters":[{"title":"","summary":"what happens, 3-5 sentences","seconds":${Math.round(target / count)},"setting":"","characters":["character ids on screen"],"opens":"the first image","ends":"the last image"}]}`;

  let outline: Record<string, unknown>;
  let outputTokens = 0;
  try {
    const answer = await ask(model, outlineSystem, [...images, { type: "text" as const, text: shared }], 8000);
    outline = answer.json;
    outputTokens += answer.outputTokens;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video director (outline):", error);
    return { error: "The Creative Director could not outline this film. Try again in a moment." };
  }
  const chapters = (Array.isArray(outline.chapters) ? (outline.chapters as Outline[]) : []).slice(0, Math.max(count, 2) + 4);
  if (chapters.length < 2) return { error: "The Creative Director could not break this film into chapters. Add more of the story to your idea and try again." };
  const lengths = chapterSeconds(chapters.map((c) => Number(c.seconds)), target);
  const outlineText = chapters.map((c, i) => `${i + 1}. ${c.title ?? ""} (${lengths[i]}s) — ${c.summary ?? ""} [setting: ${c.setting ?? ""}]`).join("\n");
  const locks = JSON.stringify(outline.locks ?? {});

  const written = await Promise.all(
    chapters.map(async (chapter, i) => {
      const system = `${systemFor(input.pipeline, { ...input.answers, length: `${lengths[i]}s` })}

YOU ARE WRITING CHAPTER ${i + 1} OF ${chapters.length} of one film: "${String(outline.title ?? "")}". Concept: ${String(outline.concept ?? "")}
THE WHOLE FILM:
${outlineText}
LOCKS (repeat them word for word in every prompt that shows them): ${locks}
Voice: ${String(outline.voice ?? "")}. Keep every character, place and look exactly as in the rest of the film.
${i > 0 ? `The chapter before ends on: ${chapters[i - 1].ends ?? chapters[i - 1].summary ?? ""}. Your first scene follows straight on from it.` : "This chapter opens the film."}
${i < chapters.length - 1 ? `The next chapter opens on: ${chapters[i + 1].opens ?? chapters[i + 1].summary ?? ""}. End so it follows naturally.` : "This chapter ends the film: land the ending and the final image."}
Write only THIS chapter: ${chapter.summary ?? ""}. Its scenes add up to ${lengths[i]} seconds. Keep each field brief (a motionPrompt under 60 words). Reply with ONLY raw JSON: {"scenes":[...]} in the scene shape above.`;
      try {
        const answer = await ask(model, system, [{ type: "text" as const, text: shared }], 12000);
        return { scenes: Array.isArray(answer.json.scenes) ? (answer.json.scenes as unknown[]) : [], outputTokens: answer.outputTokens };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`video director (chapter ${i + 1}):`, error);
        return { scenes: [] as unknown[], outputTokens: 0 };
      }
    }),
  );
  const missing = written.map((w, i) => (w.scenes.length ? 0 : i + 1)).filter(Boolean);
  if (missing.length) return { error: `The Creative Director could not write chapter ${missing.join(", ")} of this film. Try again in a moment.` };
  outputTokens += written.reduce((sum, w) => sum + w.outputTokens, 0);

  const parsed: Record<string, unknown> = { ...outline, scenes: written.flatMap((w) => w.scenes), characters: input.characters ?? [] };
  delete parsed.chapters;
  const { plan, issues } = qaAndRepair(normalizePlan(parsed, input.pipeline, input.answers));
  if (plan.scenes.length === 0) return { error: "The Creative Director returned no scenes. Try again, or add more detail to your idea." };
  return { plan, issues, outputTokens, calls: 1 + chapters.length };
}

export async function direct(input: DirectorInput): Promise<Directed | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The Creative Director is not configured on this server." };
  const target = secondsFrom(input.answers.length);
  if (target > LONG_PLAN_SECONDS) return directFilm(input, target);

  const answers = Object.entries(input.answers).map(([key, value]) => `${key}: ${value}`).join("\n");
  const text = [
    attachmentManifest(input.assets ?? []),
    castManifest(input.characters ?? []),
    `IDEA:\n${input.brief.slice(0, 6000)}`,
    answers && `CHOICES:\n${answers}`,
    input.images?.length ? `REFERENCE IMAGES: ${input.images.length} attached (reference pictures, and a frame from each uploaded clip). Describe what must stay consistent from them in "locks".` : "",
    input.previous ? `CURRENT PLAN (revise it, keep what works):\n${JSON.stringify(input.previous).slice(0, 12000)}` : "",
    input.note ? `CHANGE REQUESTED:\n${input.note.slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const content: Anthropic.MessageParam["content"] = [
    ...(input.images ?? []).slice(0, 3).map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
    { type: "text" as const, text },
  ];

  try {
    const message = await new Anthropic().messages.create({
      model: input.model || DIRECTOR_MODEL,
      max_tokens: 8000,
      system: withPolicy(systemFor(input.pipeline, input.answers)),
      messages: [{ role: "user", content }],
    });
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    /* The cast is the person's, never the model's: it is set here, and only
       the scene tags the model wrote are read against it. */
    parsed.characters = input.characters ?? [];
    const { plan, issues } = qaAndRepair(normalizePlan(parsed, input.pipeline, input.answers));
    if (plan.scenes.length === 0) return { error: "The Creative Director returned no scenes. Try again, or add more detail to your idea." };
    return { plan, issues, outputTokens: message.usage.output_tokens, calls: 1 };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video director:", error);
    return { error: "The Creative Director could not plan this one. Try again in a moment." };
  }
}
