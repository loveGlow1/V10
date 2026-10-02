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

import { PIPELINES, type PipelineId } from "./pipelines";
import { normalizePlan, qaAndRepair, secondsFrom, type ProductionPlan, type QaIssue } from "./plan";

export const DIRECTOR_MODEL = "claude-sonnet-5";

function systemFor(pipeline: PipelineId, answers: Record<string, string>): string {
  const spec = PIPELINES[pipeline];
  const target = secondsFrom(answers.length);
  return `You are QuickStark's Creative Director. You plan a ${spec.label} video for production by AI generation engines.

PIPELINE: ${spec.stages.join(" → ")}

RULES FOR THIS PIPELINE:
${spec.director.map((rule) => `- ${rule}`).join("\n")}

RULES FOR EVERY VIDEO:
- Target length: ${target} seconds. Scene durations must add up to it.
- Every scene's motionPrompt is self-contained: a generation engine sees only that prompt. Name subject, setting, lighting, lens/shot, camera move, motion, mood and aspect ratio.
- Anything that must look the same in more than one scene (product, creator, characters, world, palette and type) goes in "locks" and is repeated word for word in each scene prompt that shows it.
- engine is one of: ${spec.engines.map((e) => `"${e}"`).join(", ")}. Use "avatar" only for a person speaking to camera with a line in voiceover.
- Never depict or imitate a real, identifiable person or brand the user did not supply. No unsafe, hateful or sexual content.
- Write in the language the answers ask for (default English).

Reply with ONLY raw JSON, no markdown fences:
{"title":"","concept":"","strategy":"","aspect":"9:16|1:1|16:9|4:5","voice":"","music":"","hooks":[""],"locks":{"product":"","style":""},"cta":"",
 "scenes":[{"duration":3,"shot":"","visual":"","onScreenText":"","voiceover":"","sound":"","motionPrompt":"","engine":"${spec.defaultEngine}"}]}`;
}

export type DirectorInput = {
  pipeline: PipelineId;
  brief: string;
  answers: Record<string, string>;
  /** Signed URLs of reference images (product, person, photo), at most three. */
  images?: string[];
  /** For a re-plan: what to change. */
  note?: string;
  previous?: ProductionPlan | null;
};

export async function direct(input: DirectorInput): Promise<{ plan: ProductionPlan; issues: QaIssue[]; outputTokens: number } | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The Creative Director is not configured on this server." };

  const answers = Object.entries(input.answers).map(([key, value]) => `${key}: ${value}`).join("\n");
  const text = [
    `IDEA:\n${input.brief.slice(0, 6000)}`,
    answers && `CHOICES:\n${answers}`,
    input.images?.length ? `REFERENCE IMAGES: ${input.images.length} attached. Describe what must stay consistent from them in "locks".` : "",
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
      model: DIRECTOR_MODEL,
      max_tokens: 8000,
      system: systemFor(input.pipeline, input.answers),
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
    const { plan, issues } = qaAndRepair(normalizePlan(parsed, input.pipeline, input.answers));
    if (plan.scenes.length === 0) return { error: "The Creative Director returned no scenes. Try again, or add more detail to your idea." };
    return { plan, issues, outputTokens: message.usage.output_tokens };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video director:", error);
    return { error: "The Creative Director could not plan this one. Try again in a moment." };
  }
}
