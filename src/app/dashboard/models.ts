/** The models the workspace composer offers, and what each one is for.

    Kept beside the agents rather than inside the panel that draws them: the
    chip, the picker and anything that later reports what a build cost all have
    to name the same list.

    Ordered the way the picker reads: Auto, then each maker's newest first —
    Claude, then ChatGPT, then Gemini. A model list goes stale faster than
    anything else in an app, so it is data in one file rather than markup spread
    through a panel: adding, renaming or retiring one is a line here. */
export type Provider = "auto" | "claude" | "openai" | "google";

export type Model = {
  id: string;
  /** What the chip and the row show. */
  name: string;
  blurb: string;
  provider: Provider;
  /** A pill beside the name, for the one worth pointing at. */
  badge?: string;
  /** Appended to the blurb in the warning colour — cost, mainly. */
  note?: string;
  /* ── What it takes to actually call the thing ──────────────────────────
   *
   * These sit on the same row as the label rather than in a second table
   * keyed by id, because a second table is a join, and a join is somewhere
   * for a model to exist in one half and not the other. Adding a model is
   * still one entry; it is just an entry that now says enough to be used.
   *
   * None of this is secret. The wire id and the endpoint are published
   * documentation; the key is read server-side from the environment and
   * never appears here. */
  /** What the provider's API calls this. Differs from `id` more often than
   *  not — the picker's ids are ours and outlive a vendor's renaming. */
  apiId?: string;
  /** The most output tokens worth asking for. A full page runs to about
   *  30k, so anything under that truncates mid-document — which is exactly
   *  how six builds died on 2026-08-30 against a 16k ceiling. */
  maxOutput?: number;
  /* ── Whether this deployment can actually call it ──────────────────────
   *
   * False while there is no working credential for the model's provider. The
   * key lives in n8n, not in this app's environment, so this cannot be
   * detected — it is asserted here and has to be flipped by hand when a
   * credential is attached. That is the honest arrangement: a flag someone
   * changes deliberately beats a probe that guesses.
   *
   * An unavailable model is still SHOWN in the picker, greyed and unpickable,
   * rather than hidden. Hiding it means a person who came for GPT-5 concludes
   * the product does not have it; showing it as "check back soon" tells them
   * it is coming and that today is not the day. The server refuses one too —
   * see resolveModel — because a picker is not a security boundary. */
  available?: boolean;
  /* ── What picking it costs the person who picked it ────────────────────
   *
   * A multiplier on the credit price of whatever they did, anchored on
   * AUTO_MODEL at 1. It is not a discount or a surcharge invented here: it is
   * the ratio of that model's published token price to the default's, so the
   * pool drains at roughly the rate the bill fills.
   *
   * Without it every model cost the same credits and only one of them cost us
   * the same money — which meant the cheapest thing a person could do was pick
   * the most expensive model, and the reprice that put generation above cost
   * was undone by anyone who opened the picker.
   *
   * Required on any model marked available; check:models enforces that,
   * because a model switched on without one is priced as though it were the
   * default and quietly sells the dearest thing at the cheapest price. */
  creditMultiplier?: number;
  /* ── How this model takes reasoning configuration ──────────────────────
   *
   * Not cosmetic. The 4.6-and-later family takes `thinking: {type:
   * "adaptive"}` and `output_config: {effort}`; Haiku 4.5 predates both and
   * REJECTS effort outright — it is a 400, not an ignored field. The same body
   * cannot be sent to both, which is why this is a property of the model
   * rather than a constant in the request builder.
   *
   *   "adaptive"  thinking: {type:"adaptive"} + output_config.effort
   *   "none"      neither field is sent at all
   *
   * "none" is a real choice for Haiku rather than a limitation worked around:
   * the model is here because it is the cheapest, and its budget_tokens form
   * of thinking would spend the saving it was picked for. */
  reasoning?: "adaptive" | "none";
  /* ── The cheapest plan allowed to pick it ──────────────────────────────
   *
   * Absent means every plan, which is the right default: a model nobody has
   * decided to gate should be available, not accidentally locked.
   *
   * Written as the literal union rather than importing PlanId, because
   * credits.ts imports THIS file for the credit multiplier and the reverse
   * import would be a cycle. credits.ts asserts at compile time that the two
   * stay identical — see PLAN_GATED_MODELS there — so this cannot drift into
   * naming a plan that does not exist.
   *
   * Enforced twice, and it has to be. The picker greys what a plan cannot
   * reach, and /api/build refuses it: a locked model is worth money, so the
   * picker is a courtesy and the route is the rule. */
  minPlan?: "free" | "standard" | "pro";
};

/** What the picker shows against a model this deployment cannot reach yet. */
export const UNAVAILABLE_LABEL = "Check back soon";

/** Whether a model can be picked and run right now. Absent means yes: the
 *  common case should not need a field on every row. */
export function isModelAvailable(model: Model): boolean {
  return model.available !== false;
}

/**
 * What a turn on this model costs, relative to a turn on AUTO_MODEL.
 *
 * Falls back to 1 for anything unrecognised, which is the safe direction for a
 * caller — an unknown id is charged the default rate rather than nothing. It is
 * not the safe direction for a model somebody switches on without setting one,
 * which is why check:models refuses that rather than leaving it to this.
 */
export function creditMultiplierFor(modelId: string | null | undefined): number {
  if (!modelId) return 1;
  const wanted = modelId === "auto" ? AUTO_MODEL : modelId;
  const model = MODELS.find((entry) => entry.id === wanted);
  const multiplier = model?.creditMultiplier;
  return typeof multiplier === "number" && multiplier > 0 ? multiplier : 1;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  auto: "",
  claude: "Claude",
  openai: "ChatGPT",
  google: "Gemini",
};

export const MODELS: Model[] = [
  {
    id: "auto",
    name: "Auto",
    /* It now does what this says. Auto starts at AUTO_MODEL and steps DOWN the
       ladder when the balance cannot cover that model's build — never up, so
       Auto can never spend more than the default. See autoModelFor() in
       credits.ts. */
    blurb: "Picks the best model your balance can run",
    provider: "auto",
  },

  // Claude — newest first, then Opus, then down the range.
  {
    id: "claude-fable-5",
    /* $10/$50 per Mtok against Sonnet's $2/$10 — five times the default, and
       the dearest thing on the menu. */
    creditMultiplier: 5,
    reasoning: "adaptive",
    /* The dearest model on the menu, behind the dearest plan. At 10x a
       twelve-section build is 80 credits — most of Standard's entire monthly
       grant in one press, which is the other reason this is not sold there. */
    minPlan: "pro",
    name: "Claude Fable 5",
    blurb: "Highest intelligence available",
    provider: "claude",
    badge: "Top pick",
    note: "2x costlier",
    apiId: "claude-fable-5-1",
    maxOutput: 32000,
  },
  {
    id: "claude-opus-5",
    /* $5/$25 per Mtok against Sonnet's $2/$10. */
    creditMultiplier: 2.5,
    reasoning: "adaptive",
    minPlan: "standard",
    name: "Claude Opus 5",
    blurb: "Peak intelligence for ambitious apps",
    provider: "claude",
    apiId: "claude-opus-5",
    maxOutput: 32000,
  },
  {
    id: "claude-sonnet-5",
    /* The anchor: AUTO_MODEL, so by definition 1. */
    creditMultiplier: 1,
    reasoning: "adaptive",
    name: "Claude Sonnet 5",
    blurb: "Intelligent and cost effective",
    provider: "claude",
    apiId: "claude-sonnet-5",
    maxOutput: 32000,
  },
  {
    id: "claude-haiku-4-5",
    /* $1/$5 per Mtok — half the default, and the reason Auto can fall back to
       it: half the price means half the door. */
    creditMultiplier: 0.5,
    /* Pre-4.6. See `reasoning` on the type: sending effort here is a 400. */
    reasoning: "none",
    name: "Claude Haiku 4.5",
    blurb: "Fastest, for small edits",
    provider: "claude",
    apiId: "claude-haiku-4-5-20251001",
    maxOutput: 32000,
  },

  // ChatGPT
  {
    id: "gpt-5",
    name: "GPT-5",
    /* No usable credential on the n8n instance: OpenAI is on the exhausted
       shared free pool, Google has none at all. */
    available: false,
    blurb: "OpenAI's flagship for complex work",
    provider: "openai",
    apiId: "gpt-5",
    maxOutput: 32000,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    /* No usable credential on the n8n instance: OpenAI is on the exhausted
       shared free pool, Google has none at all. */
    available: false,
    blurb: "Cheaper, for everyday changes",
    provider: "openai",
    apiId: "gpt-5-mini",
    maxOutput: 32000,
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 nano",
    /* No usable credential on the n8n instance: OpenAI is on the exhausted
       shared free pool, Google has none at all. */
    available: false,
    blurb: "Cheapest, for small mechanical edits",
    provider: "openai",
    apiId: "gpt-5-nano",
    maxOutput: 16000,
  },

  // Gemini
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    /* No usable credential on the n8n instance: OpenAI is on the exhausted
       shared free pool, Google has none at all. */
    available: false,
    blurb: "Google's flagship, strong over long context",
    provider: "google",
    apiId: "gemini-3-pro",
    maxOutput: 32000,
  },
  {
    id: "gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
    /* No usable credential on the n8n instance: OpenAI is on the exhausted
       shared free pool, Google has none at all. */
    available: false,
    blurb: "Fast and inexpensive",
    provider: "google",
    apiId: "gemini-2.5-flash",
    maxOutput: 32000,
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

/* What "Auto" comes out as, before affordability is considered.
 *
 * Sonnet: the most capable model that is still cheap enough to be a default,
 * and the one a Free account gets. Not Haiku — a build is one long call that
 * has to produce a complete document in one pass, and Haiku's own entry says
 * "for small edits". Not Opus, which costs 2.5x and is what Standard buys.
 *
 * This is the CEILING for Auto rather than a fixed answer. autoModelFor() in
 * credits.ts starts here and steps down to Haiku when the balance cannot cover
 * a Sonnet build, so somebody with 5 credits gets a Haiku build instead of a
 * refusal. It never steps up: Auto cannot cost more than this line says, and
 * reaching Opus or Fable is always a deliberate choice in the picker.
 *
 * EDIT_MODEL is deliberately different — edits run on Haiku, because an edit is
 * a search-and-replace over a page that already exists and happens all
 * afternoon. See src/lib/builder/edit.ts. */
export const AUTO_MODEL = "claude-sonnet-5";

export function modelById(id: string) {
  return MODELS.find((model) => model.id === id) ?? MODELS[0];
}

/** Every model that can actually be called — Auto is a pointer, not a model. */
export function callableModels(): Model[] {
  return MODELS.filter((model) => model.provider !== "auto");
}

/**
 * The model a build should run on, given what the composer sent.
 *
 * Resolves "Auto", rejects anything unknown, and never returns a row without
 * the facts needed to call it. Returns null rather than a fallback: a request
 * naming a model this app does not offer is a request from something that is
 * not this app, and quietly building it on Opus would hide that.
 */
export function resolveModel(id: unknown): Model | null {
  if (typeof id !== "string" || !id) return null;
  const wanted = id === "auto" ? AUTO_MODEL : id;
  const model = MODELS.find((entry) => entry.id === wanted);
  if (!model || model.provider === "auto") return null;
  /* Refused here as well as greyed in the picker. The picker is a courtesy to
     a person; this is the rule. Without it, a request naming an unavailable
     model reaches n8n, routes to a node whose credential is missing or spent,
     and fails minutes later having promised a build — the exact shape of
     failure the whole flag exists to prevent. */
  if (!isModelAvailable(model)) return null;
  return model.apiId && model.maxOutput ? model : null;
}

/** The chip has a toolbar's worth of room, so it drops the maker's name where
    the mark beside it already says whose model this is. */
export function shortModelName(model: Model) {
  return model.name.replace(/^Claude\s+/, "");
}

/** The list in the order it is drawn, with the heading each maker's run opens
    on. Auto stands alone above them and carries no heading. */
export function groupedModels() {
  const groups: { provider: Provider; label: string; models: Model[] }[] = [];
  for (const model of MODELS) {
    const last = groups[groups.length - 1];
    if (last && last.provider === model.provider) {
      last.models.push(model);
    } else {
      groups.push({
        provider: model.provider,
        label: PROVIDER_LABEL[model.provider],
        models: [model],
      });
    }
  }
  return groups;
}
