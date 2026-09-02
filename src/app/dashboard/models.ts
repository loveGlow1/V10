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
};

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
    blurb: "OpenAI's flagship for complex work",
    provider: "openai",
    apiId: "gpt-5",
    maxOutput: 32000,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    blurb: "Cheaper, for everyday changes",
    provider: "openai",
    apiId: "gpt-5-mini",
    maxOutput: 32000,
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 nano",
    blurb: "Cheapest, for small mechanical edits",
    provider: "openai",
    apiId: "gpt-5-nano",
    maxOutput: 16000,
  },

  // Gemini
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    blurb: "Google's flagship, strong over long context",
    provider: "google",
    apiId: "gemini-3-pro",
    maxOutput: 32000,
  },
  {
    id: "gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
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
 * Opus, because a build is one long call that has to produce a complete
 * document in one pass: eleven full sections, working interactions and a closing
 * </html>. That is the job the blueprints were written against. Auto is not the
 * place to save money — the picker is right there for anyone who wants to. */
export const AUTO_MODEL = "claude-opus-5";

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
