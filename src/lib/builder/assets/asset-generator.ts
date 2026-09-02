import type { Quality, VisualSpec } from "@/lib/builder/assets/asset-types";
import { QUALITY_WIDTH } from "@/lib/builder/assets/asset-types";

/* Where pixels come from, behind one interface.
 *
 * The builder must not care which service produced an image, because the answer
 * changes: a stock library today, a generation model when bespoke imagery
 * matters, a different one when the first gets expensive or slow. Anything that
 * hard-codes a provider has to be rewritten on each of those days.
 *
 * Four operations, because those are the four a project actually needs over its
 * life: make one, change one, enlarge one, and ask whether an asynchronous job
 * has finished. Not every provider implements all four — a stock library cannot
 * edit or upscale — and the optional ones are optional so a provider can be
 * honest about that rather than pretend. */

export type GeneratedImage = {
  bytes: Buffer;
  contentType: string;
  width: number;
  height: number;
  provider: string;
  /** Attribution where the source requires it — Unsplash does. */
  credit?: { author: string; source: string; url: string };
};

/** An asynchronous provider answers with a handle first and pixels later. */
export type GenerationJob = {
  id: string;
  status: "pending" | "generating" | "ready" | "failed";
  image?: GeneratedImage;
  error?: string;
};

export type ImageProvider = {
  name: string;
  /** Whether it makes bespoke images or finds existing ones. Affects planning. */
  kind: "generative" | "library";
  generate(spec: VisualSpec, quality: Quality): Promise<GenerationJob>;
  /** Change an existing image — "make it warmer", "remove the background". */
  edit?(image: GeneratedImage, instruction: string): Promise<GenerationJob>;
  upscale?(image: GeneratedImage, factor: 2 | 4): Promise<GenerationJob>;
  /** For providers whose work is asynchronous. Synchronous ones return ready. */
  getStatus?(jobId: string): Promise<GenerationJob>;
};

/* The one place a spec becomes a sentence.
 *
 * Written out in the order a photographer would read it — subject, then where,
 * then how it is framed, then how it is lit, then how it should feel — and with
 * the two prohibitions last, because they are the two that generation models
 * most often ignore and last is where they are most likely to stick. */
export function promptFor(spec: VisualSpec): string {
  return [
    spec.subject,
    spec.environment,
    spec.composition,
    spec.lighting,
    spec.style,
    spec.mood,
    "photorealistic, professional photography",
    "no text, no lettering, no logos",
    "no watermark",
  ]
    .filter(Boolean)
    .join(", ");
}

export const widthFor = (quality: Quality): number => QUALITY_WIDTH[quality];

/* Trying providers in order until one answers.
 *
 * Failure is expected rather than exceptional: keys expire, rate limits are
 * hit, a search finds nothing for an unusual subject. So a provider that fails
 * is a provider that is skipped, and the caller gets a failed job rather than
 * an exception — because the project still has to be built and shipped either
 * way. */
export async function generateWithFallback(
  providers: ImageProvider[],
  spec: VisualSpec,
  quality: Quality,
): Promise<GenerationJob> {
  const problems: string[] = [];

  for (const provider of providers) {
    try {
      const job = await provider.generate(spec, quality);
      if (job.status === "ready" && job.image) return job;
      if (job.error) problems.push(`${provider.name}: ${job.error}`);
    } catch (error) {
      problems.push(`${provider.name}: ${(error as Error).message}`);
    }
  }

  return {
    id: "",
    status: "failed",
    error: problems.join(" · ") || "no provider is configured",
  };
}
