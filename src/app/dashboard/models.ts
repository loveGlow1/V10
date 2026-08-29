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
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    blurb: "Peak intelligence for ambitious apps",
    provider: "claude",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    blurb: "Intelligent and cost effective",
    provider: "claude",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    blurb: "Fastest, for small edits",
    provider: "claude",
  },

  // ChatGPT
  {
    id: "gpt-5",
    name: "GPT-5",
    blurb: "OpenAI's flagship for complex work",
    provider: "openai",
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    blurb: "Cheaper, for everyday changes",
    provider: "openai",
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 nano",
    blurb: "Cheapest, for small mechanical edits",
    provider: "openai",
  },

  // Gemini
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    blurb: "Google's flagship, strong over long context",
    provider: "google",
  },
  {
    id: "gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
    blurb: "Fast and inexpensive",
    provider: "google",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export function modelById(id: string) {
  return MODELS.find((model) => model.id === id) ?? MODELS[0];
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
