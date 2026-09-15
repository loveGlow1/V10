"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  canAfford,
  creditCostOf,
  formatCredits,
  modelAllowedOnPlan,
  planRequiredFor,
  type PlanId,
} from "./credits";
import { DEFAULT_MODEL, MODELS, UNAVAILABLE_LABEL, isModelAvailable, modelById, type Model } from "./models";
import { useCredits } from "./useCredits";

/* Which model this account is working with — one answer, everywhere.
 *
 * ── Why this is a provider and not two useStates ──────────────────────────
 *
 * It was two useStates. Home held one and the workspace's composer held
 * another, each initialised to DEFAULT_MODEL on mount, and neither could see
 * the other. So a choice made on Home was gone by the time the workspace
 * opened, a choice made in the workspace was gone on the next visit, and the
 * account settings panel — which lists what the composer offers and marks one
 * "in use" — was reading a third value again, hardcoded to "Q1". Three places
 * describing one decision, none of them agreeing, and the person's own answer
 * the thing most likely to be discarded.
 *
 * Persisted, for the same reason. A picker that forgets what it was told on
 * every reload is not a preference, it is a per-page mood.
 *
 * ── What "reachable" means ────────────────────────────────────────────────
 *
 * Three different ways a model can be off the table, and they are not the same
 * sentence:
 *
 *   UNAVAILABLE   this deployment has no credential for that provider. Nothing
 *                 the person can do; it is on us, and it says so.
 *   PLAN          their plan does not include it. Something they can do, and
 *                 the one place in the product where somebody meets the
 *                 difference between the tiers while actually wanting it.
 *   CREDITS       their plan includes it and their balance does not reach one
 *                 message on it. Also something they can do, and a different
 *                 thing to do about it.
 *
 * The third was missing, and it was missing in a way that was worse than
 * absent: the picker showed the model as fully available, the server took the
 * request, found the balance short, and silently demoted it to the model its
 * heuristics would have chosen anyway — see pickedEditModel in
 * /api/build/route.ts, which returns null rather than refusing. The person
 * picked Opus, was charged, and got something else, with nothing anywhere
 * saying so. The gate is the same arithmetic the server runs, so the two
 * cannot disagree about what is affordable.
 */

export type Reach =
  | { ok: true }
  | { ok: false; why: "unavailable"; label: string }
  | { ok: false; why: "plan"; label: string; planName: string }
  | { ok: false; why: "credits"; label: string; needed: number };

export type ModelState = {
  /** The id in force — what a build will actually be sent. */
  model: string;
  /** The row for it, never null. */
  chosen: Model;
  /** What the person picked, before any correction. */
  picked: string;
  setModel: (id: string) => void;
  /** Whether a model can be chosen right now, and if not, what to say. */
  reach: (model: Model) => Reach;
};

const ModelContext = createContext<ModelState | null>(null);

/* One key, and a shape worth keeping simple: the id, nothing else. Anything
   richer here is state that can rot into disagreeing with MODELS. */
const REMEMBERED = "quickstark.model";

function remembered(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  try {
    const stored = window.localStorage.getItem(REMEMBERED);
    return stored && MODELS.some((model) => model.id === stored) ? stored : DEFAULT_MODEL;
  } catch {
    /* Private browsing, blocked storage. A forgotten preference is a small
       loss; a dashboard that will not render is not. */
    return DEFAULT_MODEL;
  }
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const { planId, balance } = useCredits();

  /* DEFAULT_MODEL on the first render whatever is stored, and read from storage
     in an effect. Reading localStorage during render makes the server's HTML
     and the browser's first pass disagree, which React discards the whole tree
     over — and the tree here is the dashboard. */
  const [picked, setPicked] = useState(DEFAULT_MODEL);

  useEffect(() => {
    setPicked(remembered());
  }, []);

  const setModel = useCallback((id: string) => {
    setPicked(id);
    try {
      window.localStorage.setItem(REMEMBERED, id);
    } catch {
      /* Chosen for this session even when it cannot be remembered past it. */
    }
  }, []);

  const reach = useCallback(
    (model: Model): Reach => {
      if (!isModelAvailable(model)) {
        return { ok: false, why: "unavailable", label: UNAVAILABLE_LABEL };
      }

      if (!modelAllowedOnPlan(model, planId as PlanId)) {
        const plan = planRequiredFor(model);
        const name = plan?.name ?? "a higher";
        return { ok: false, why: "plan", label: `Included with ${name}`, planName: name };
      }

      /* The same call the server makes before it honours a picked model. A
         balance that cannot cover one message on this model would have it
         quietly swapped for another, so it is said here instead. Auto is never
         gated: it exists precisely to come out as whatever the balance can
         run. */
      if (model.id !== DEFAULT_MODEL && balance) {
        const needed = creditCostOf("chat", { modelId: model.id });
        if (!canAfford(balance, needed)) {
          return {
            ok: false,
            why: "credits",
            label: `Needs ${formatCredits(needed)} credits`,
            needed,
          };
        }
      }

      return { ok: true };
    },
    [planId, balance],
  );

  /* What is actually in force. A model that was reachable when it was chosen
     and is not now — a plan that lapsed, a balance spent, a model retired —
     falls back to Auto rather than being sent to a server that would refuse it
     or silently substitute something else. The person's pick is kept as
     `picked` so the picker can still show what they asked for. */
  const model = useMemo(() => {
    const row = modelById(picked);
    return reach(row).ok ? row.id : DEFAULT_MODEL;
  }, [picked, reach]);

  const value: ModelState = {
    model,
    chosen: modelById(model),
    picked,
    setModel,
    reach,
  };

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel(): ModelState {
  const state = useContext(ModelContext);
  if (!state) {
    throw new Error("useModel must be used inside the dashboard's ModelProvider.");
  }
  return state;
}
