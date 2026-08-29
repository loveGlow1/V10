/** The models the workspace composer offers, and what each one is for.

    Kept beside the agents rather than inside the panel that draws them: the
    chip, the picker and anything that later reports what a build cost all have
    to name the same list. */
export type Model = {
  id: string;
  /** What the chip and the row show. */
  name: string;
  blurb: string;
  /** A pill beside the name, for the one worth pointing at. */
  badge?: string;
  /** Appended to the blurb in the warning colour — cost, mainly. */
  note?: string;
  /** Auto is the router rather than a model, and is drawn with its own mark. */
  auto?: boolean;
};

export const MODELS: Model[] = [
  {
    id: "auto",
    name: "Auto",
    blurb: "Always selects the best model",
    auto: true,
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    blurb: "Highest intelligence available",
    badge: "Top pick",
    note: "2x costlier",
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    blurb: "Peak intelligence for ambitious apps",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    blurb: "Intelligent and cost effective",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    blurb: "Fastest, for small edits",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export function modelById(id: string) {
  return MODELS.find((model) => model.id === id) ?? MODELS[0];
}

/** The chip has a toolbar's worth of room, so it drops the maker's name — the
    mark beside it already says whose model this is. */
export function shortModelName(model: Model) {
  return model.name.replace(/^Claude\s+/, "");
}
