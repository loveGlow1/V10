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
};

/** What the picker shows against a model this deployment cannot reach yet. */
export const UNAVAILABLE_LABEL = "Check back soon";

/** Whether a model can be picked and run right now. Absent means yes: the
 *  common case should not need a field on every row. */
export function isModelAvailable(model: Model): boolean {
  return model.available !== false;
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
    blurb: "Always selects the best model",
    provider: "auto",
  },

  // Claude — newest first, then Opus, then down the range.
  {
    id: "claude-fable-5",
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
    name: "Claude Opus 5",
    blurb: "Peak intelligence for ambitious apps",
    provider: "claude",
    apiId: "claude-opus-5",
    maxOutput: 32000,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    blurb: "Intelligent and cost effective",
    provider: "claude",
    apiId: "claude-sonnet-5",
    maxOutput: 32000,
  },
  {
    id: "claude-haiku-4-5",
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

/* What "Auto" comes out as.
 *
 * Named rather than implied, because "Auto" is the default and therefore what
 * almost every build actually runs on — leaving that to fall out of list order
 * means the model most people use is decided by where someone pasted an entry.
 *
 * Sonnet, not Opus. This used to be Opus on the reasoning that a build is one
 * long call which has to produce a complete document in one pass and Auto was
 * "not the place to save money". The bill disagreed: Auto is what nearly every
 * build runs on, so "not the place to save money" meant every default build
 * cost Opus money — five dollars per million input and twenty-five per million
 * output, against Sonnet's two and ten. Two and a half times, on the path
 * almost nobody deviates from.
 *
 * Nobody is denied Opus by this. The picker is one click away and names it, and
 * a person who chooses it gets exactly what they chose. What changed is the
 * direction of the default: a build costs the cheaper capable model unless
 * somebody deliberately asks for the dearer one.
 *
 * Not Haiku, which is the cheapest thing here: its own entry says "for small
 * edits", and a full eleven-section page in one pass is not a small edit. Cost
 * EFFECTIVE, not cheapest — a build that comes back thin has to be run again,
 * and two Haiku builds and a re-brief cost more than one Sonnet build. */
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
