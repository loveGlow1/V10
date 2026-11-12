/* Which AI agent plans and edits a video — the one the person picked in
 * their workspace (or in the editor), when their plan includes it and it can
 * run here; otherwise the studio's own default. Every model call a video makes
 * (the Creative Director, the editor, the editor's assistant) goes through
 * this, and is charged at that model's rate.
 *
 * Only models this deployment can call are offered (models.ts resolveModel);
 * the video calls speak Anthropic's API, so a model from another maker is
 * declined here with a reason until that maker is connected.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { modelAllowedOnPlan } from "@/app/dashboard/credits";
import { AUTO_MODEL, creditMultiplierFor, resolveModel } from "@/app/dashboard/models";
import { currentBalance } from "@/lib/credits-server";

export type VideoAgent = {
  /** Our id for it ("claude-opus-5-5"), what the picker shows. */
  id: string;
  name: string;
  /** What Anthropic's API calls it. */
  apiId: string;
  /** Credits are multiplied by this (1 for the default). */
  multiplier: number;
  /** Why the model asked for is not the one answering, when it is not. */
  declined?: string;
};

/** The default: the studio's own planner. */
export function defaultAgent(): VideoAgent {
  const model = resolveModel(AUTO_MODEL);
  return { id: AUTO_MODEL, name: model?.name ?? "Claude Sonnet 5", apiId: model?.apiId ?? AUTO_MODEL, multiplier: 1 };
}

/** The agent for this person and this request. Never throws. */
export async function videoAgentFor(service: SupabaseClient | null, userId: string, asked: unknown): Promise<VideoAgent> {
  const fallback = defaultAgent();
  if (typeof asked !== "string" || !asked || asked === "auto") return fallback;
  const model = resolveModel(asked);
  if (!model) return { ...fallback, declined: "that model isn't available here yet" };
  if (model.provider !== "claude") return { ...fallback, declined: `${model.name} can't edit videos yet` };
  try {
    const balance = service ? await currentBalance(service, userId) : null;
    if (balance && !modelAllowedOnPlan(model, balance.modelPlanId)) return { ...fallback, declined: `your plan doesn't include ${model.name}` };
  } catch {
    /* Unknown plan: the default answers. */
    return { ...fallback, declined: "your plan could not be checked" };
  }
  return { id: model.id, name: model.name, apiId: model.apiId ?? model.id, multiplier: creditMultiplierFor(model.id) };
}

/** A charge at the agent's rate. */
export const agentCost = (base: number, agent: Pick<VideoAgent, "multiplier">) => Math.max(1, Math.ceil(base * agent.multiplier));
