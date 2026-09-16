import { MODELS, modelById, type Model } from "./models";

/* The agents the composer offers.
 *
 * ── What went wrong the first time ────────────────────────────────────────
 *
 * This list existed before and was deleted, for a reason worth keeping in
 * front of whoever changes it next: picking an agent set a LABEL and nothing
 * else. The build ran on a hardcoded "Q1" whatever the chip said, the settings
 * panel marked one "in use" from a prop nobody wrote to, and the chip was
 * reachable only on a phone. Somebody who chose Q2 got Q1, and nothing
 * anywhere said so.
 *
 * So the list is back with the one property that was missing: every agent that
 * is not marked `soon` names a real model, and choosing it sets that model
 * through the same provider both composers read. The choice is now the same
 * object the server is handed — see useModel. An agent that cannot do that
 * does not appear as selectable; it appears as what it is, which is a plan.
 *
 * ── Why a name of our own at all ──────────────────────────────────────────
 *
 * Because "Sonnet" and "Opus" are a vendor's product names, and which vendor
 * is behind a build is our problem rather than the customer's. Q1 and Q2
 * describe what somebody is choosing between — steady versus relentless —
 * which is the actual decision. The model is still named underneath, because
 * hiding it entirely from somebody paying per build would be the other kind of
 * dishonesty.
 */

export type Agent = {
  id: string;
  title: string;
  subtitle: string;
  /* The model this agent runs on. Null only for one that does not run yet, and
     the two are checked against each other below: an agent with no model and
     no `soon` is a bug, not a configuration. */
  model: string | null;
  /** On the roadmap, not selectable yet. */
  soon?: boolean;
};

export const AGENTS: Agent[] = [
  {
    id: "Q1",
    title: "Q1",
    subtitle: "Steady and thorough",
    /* The default the platform already builds on, named. Nothing about a Q1
       build changes today, which is the point: this is what people have been
       getting, finally with a name on it. */
    model: "claude-sonnet-5",
  },
  {
    id: "Q2",
    title: "Q2",
    subtitle: "Relentless, for the hard ones",
    model: "claude-opus-5",
  },
  {
    id: "Prototype",
    title: "Prototype",
    subtitle: "Fast drafts, rough edges",
    model: "claude-haiku-4-5",
  },
  /* Listed rather than hidden: it is the plan, and a list that quietly omits it
     reads as if it were never coming. `soon` is what stops it being chosen, and
     `model: null` is what makes that unambiguous in the data rather than only
     in the interface. */
  { id: "Mobile", title: "Mobile", subtitle: "Agent for mobile apps", model: null, soon: true },
];

/** The agent a model belongs to, so a chip can name what is actually running. */
export function agentForModel(modelId: string): Agent | null {
  return AGENTS.find((agent) => agent.model === modelId) ?? null;
}

/** The model an agent runs on, or null when it does not run yet. */
export function modelForAgent(agentId: string): Model | null {
  const agent = AGENTS.find((entry) => entry.id === agentId);
  if (!agent?.model) return null;
  return modelById(agent.model) ?? null;
}

/**
 * Whether every agent here is consistent with itself and with the model list.
 *
 * Exported so a check can assert it rather than a comment asking nicely. The
 * failure it guards is precisely the one that got this file deleted: an agent
 * offering a choice that leads nowhere.
 */
export function agentProblems(): string[] {
  const problems: string[] = [];

  for (const agent of AGENTS) {
    if (agent.soon) {
      if (agent.model !== null) {
        problems.push(`${agent.id} is marked coming soon and also names a model`);
      }
      continue;
    }
    if (!agent.model) {
      problems.push(`${agent.id} is selectable and runs on nothing`);
      continue;
    }
    if (!MODELS.some((model) => model.id === agent.model)) {
      problems.push(`${agent.id} names ${agent.model}, which is not a model this platform offers`);
    }
  }

  const named = AGENTS.filter((agent) => agent.model).map((agent) => agent.model);
  if (new Set(named).size !== named.length) {
    problems.push("two agents run on the same model, so the chip cannot name what is running");
  }

  return problems;
}
