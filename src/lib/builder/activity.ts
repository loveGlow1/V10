/* What the person watching is told is happening.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * The step recorder in steps.ts records what the SERVER did, and it is right
 * to: "Read the message as an edit to the page", "Changing several parts at
 * once — database, authentication, backend", "Stage 2 of 7", "reading
 * app/dashboard/page.tsx…". Every one of those is true, useful when something
 * has gone wrong, and exactly the wrong thing to put in front of somebody who
 * asked for a real-estate platform.
 *
 * Reported from use, more than once: a person watching their build saw the
 * pipeline narrating itself and could not tell whether anything was going
 * well. The vocabulary was the implementation's, not theirs.
 *
 * ── Why a translation and not a rewrite ───────────────────────────────────
 *
 * Forty call sites set those labels, and the labels are load-bearing: they
 * name the operation that failed when one fails, and the tests assert them. So
 * the ids stay, the recorder stays, and this maps id → what a person is told.
 * One table to read, one place to change the wording, and the technical line
 * survives underneath for whoever wants it — see `detail` on BuildStep, which
 * this never touches.
 *
 * ── What it must not do ───────────────────────────────────────────────────
 *
 * Never invent progress. The old panel's own comment put it best and it still
 * holds: a checklist ticking itself off on a timer would say a build was doing
 * things nobody can see it doing. So every item below corresponds to a step
 * the pipeline really records, and an item only reaches ✓ because its step
 * reported done. The ○ items are the ones still to come in a sequence that is
 * fixed — not a guess about how long anything will take.
 */

import type { BuildStep } from "./steps";

/** Where a row has got to. ✓ / ● / ○ in the panel. */
export type ItemState = "done" | "running" | "pending";

export type ActivityItem = {
  /** The recorder's id, kept so a failure can still be traced to its step. */
  id: string;
  /** What the person reads. */
  label: string;
  state: ItemState;
  /** The server's own line, carried for progressive disclosure only. */
  detail?: string;
  ms?: number;
};

export type ActivityPhase = {
  id: string;
  /** The heading above the list, e.g. "BUILDING YOUR PROJECT". */
  heading: string;
  items: ActivityItem[];
};

/** Which sequence a turn is following. An edit is not a build. */
export type Flow = "build" | "edit";

type PhaseSpec = {
  id: string;
  heading: string;
  /* The steps this phase covers, in the order they run, with the words used
     for each. A step id may appear in only one phase — the lookup below is
     built from this and a duplicate would make the phase a coin toss. */
  steps: { id: string; label: string }[];
};

/* ── A build ───────────────────────────────────────────────────────────────
 *
 * Four phases, not the seven a reader might expect, and the difference is
 * deliberate: a phase exists here only where the pipeline actually reports
 * something. Splitting "building the interface" from "adding functionality"
 * would look more detailed and mean less, because one model call produces both
 * and nothing in between is observable. A heading nothing can be true under is
 * a heading that lies.
 */
const BUILD_PHASES: PhaseSpec[] = [
  {
    id: "initializing",
    heading: "Initializing",
    steps: [
      { id: "open", label: "Opening your project" },
      { id: "intent", label: "Understanding your request" },
      { id: "page", label: "Reading what you have so far" },
      { id: "attachments", label: "Taking in what you attached" },
      { id: "kind", label: "Working out what you're building" },
    ],
  },
  {
    id: "planning",
    heading: "Planning your project",
    steps: [
      { id: "architecture", label: "Deciding what it needs" },
      { id: "design", label: "Establishing the design direction" },
      { id: "assets", label: "Choosing the imagery" },
      { id: "database", label: "Preparing your data" },
      { id: "stage", label: "Planning the work" },
      { id: "plan", label: "Planning the application structure" },
    ],
  },
  {
    id: "building",
    heading: "Building your project",
    steps: [
      { id: "prompt", label: "Preparing the brief" },
      { id: "orchestrator", label: "Building the experience" },
      { id: "build", label: "Building the experience" },
      { id: "edit", label: "Building the interface" },
    ],
  },
  {
    id: "finalizing",
    heading: "Finalizing",
    steps: [
      { id: "check", label: "Running quality checks" },
      { id: "qa", label: "Checking the visual result" },
      { id: "version", label: "Saving your project" },
      { id: "deploy", label: "Putting it online" },
      { id: "charge", label: "Finishing up" },
    ],
  },
];

/* ── A change to something that exists ─────────────────────────────────────
 *
 * §15's sequence, and it is a different story from a build: nothing is being
 * created, something is being found and altered without disturbing the rest.
 * The words say that, because "Building your project" over an edit is how a
 * person comes to believe their work was thrown away and rewritten.
 */
const EDIT_PHASES: PhaseSpec[] = [
  {
    id: "understanding",
    heading: "Updating your project",
    steps: [
      { id: "open", label: "Opening your project" },
      { id: "intent", label: "Understanding your request" },
      { id: "page", label: "Reading what you have so far" },
      { id: "attachments", label: "Taking in what you attached" },
      { id: "file", label: "Locating the relevant section" },
      { id: "plan", label: "Working out what to change" },
    ],
  },
  {
    id: "applying",
    heading: "Applying the changes",
    steps: [
      { id: "edit", label: "Making the change" },
      { id: "check", label: "Preserving what you already had" },
    ],
  },
  {
    id: "finishing",
    heading: "Finishing up",
    steps: [
      { id: "version", label: "Saving your project" },
      { id: "deploy", label: "Publishing the change" },
      { id: "charge", label: "Finishing up" },
    ],
  },
];

function specFor(flow: Flow): PhaseSpec[] {
  return flow === "edit" ? EDIT_PHASES : BUILD_PHASES;
}

/* Steps only a build ever reports. Working out what to build, what it should
   look like and what pictures it needs are decisions taken once, before
   anything is generated; an edit is handed a project that has already made
   them. */
const ONLY_IN_A_BUILD = ["kind", "design", "assets", "architecture", "database", "prompt", "orchestrator"];

/**
 * Which sequence a turn followed, read from what it reported.
 *
 * Derived rather than passed, and that is not laziness: the caller rendering a
 * STORED timeline — a message from last week, reopened — does not know what
 * intent produced it, and a prop it had to guess would be a second source of
 * truth that could disagree with the steps sitting right beside it. The steps
 * are the evidence, and they are unambiguous: a build decides what to build, an
 * edit is given it.
 */
export function flowFor(steps: BuildStep[]): Flow {
  const ids = new Set(steps.map((step) => step.id));
  if (ONLY_IN_A_BUILD.some((id) => ids.has(id))) return "build";
  if (ids.has("file") || ids.has("edit") || ids.has("check")) return "edit";
  return "build";
}

/**
 * The phrase for one step id, or null when there is none.
 *
 * Exported so a caller holding a single step — a failure message, a stored
 * timeline — can say the same thing this panel says about it, rather than
 * falling back to the server's own wording in one place and not the other.
 */
export function phraseFor(id: string, flow: Flow = "build"): string | null {
  for (const phase of specFor(flow)) {
    const found = phase.steps.find((step) => step.id === id);
    if (found) return found.label;
  }
  return null;
}

/* Steps the pipeline records that are not part of the story being told — a
 * question answered, a download, a clarification. Each one is a whole turn on
 * its own rather than a stage of a build, so it gets its own single-row phase
 * rather than being wedged into a sequence it is not part of. */
const STANDALONE: Record<string, string> = {
  answer: "Looking through your project for the answer",
  clarify: "Working out what to ask you",
  download: "Preparing your download",
  history: "Looking up the previous version",
  restore: "Putting the previous version back",
  upgrade: "Adding what this needs",
};

/**
 * The phases to show, given the steps that have actually been reported.
 *
 * ── The rules, which are the whole of this ────────────────────────────────
 *
 * A phase appears once anything in it has started, and every phase after the
 * current one appears too — that is what makes the list a sequence somebody
 * can read ahead in rather than a log that scrolls. Within a phase every step
 * is listed, done ones first as they land, and the ones still to come sit at ○.
 *
 * A step that never runs is DROPPED rather than left pending: not every build
 * has a database, and a row that will never tick is a row that reads as stuck.
 * The rule for "never" is simply "something after it has finished", which is
 * exactly what the recorder is able to prove.
 */
export function activityFor(steps: BuildStep[], flow: Flow = "build"): ActivityPhase[] {
  const spec = specFor(flow);

  /* Where each id sits in the whole sequence, so "overtaken" is a comparison
     rather than a search. */
  const order = new Map<string, number>();
  spec.forEach((phase, phaseIndex) => {
    phase.steps.forEach((step, stepIndex) => {
      order.set(step.id, phaseIndex * 1000 + stepIndex);
    });
  });

  const reported = new Map<string, BuildStep>();
  for (const step of steps) {
    /* The last word wins: begin streams `running` and mark closes it `done`,
       and the recorder merges them by id — see stepRecorder. */
    reported.set(step.id, step);
  }

  /* How far the turn has got, measured by the furthest step that has reported
     anything at all. */
  let furthest = -1;
  for (const [id, step] of reported) {
    const at = order.get(id);
    if (at === undefined) continue;
    if (step.state !== "pending" && at > furthest) furthest = at;
  }

  const phases: ActivityPhase[] = [];

  for (const [phaseIndex, phase] of spec.entries()) {
    const items: ActivityItem[] = [];

    for (const [stepIndex, step] of phase.steps.entries()) {
      const at = phaseIndex * 1000 + stepIndex;
      const got = reported.get(step.id);

      if (got) {
        items.push({
          id: step.id,
          label: step.label,
          state: got.state === "pending" ? "pending" : got.state,
          detail: got.detail,
          ms: got.ms,
        });
        continue;
      }

      /* Not reported. Still to come, unless the turn has already gone past it
         — in which case this build simply does not have that step, and a row
         that will never tick is worse than no row. */
      if (at > furthest) items.push({ id: step.id, label: step.label, state: "pending" });
    }

    /* A phase with nothing in it is a heading over an empty list. */
    if (items.length > 0) phases.push({ id: phase.id, heading: phase.heading, items });
  }

  /* Anything that is its own turn rather than a stage of one. Appended rather
     than merged, because these do not belong to a sequence — see STANDALONE. */
  const extra: ActivityItem[] = [];
  for (const step of steps) {
    const label = STANDALONE[step.id];
    if (!label) continue;
    extra.push({
      id: step.id,
      label,
      state: step.state === "pending" ? "pending" : step.state,
      detail: step.detail,
      ms: step.ms,
    });
  }
  if (extra.length > 0) {
    phases.push({ id: "standalone", heading: "Working on it", items: extra });
  }

  return phases;
}

/**
 * The one line to show when there is no room for a list.
 *
 * The heading of whatever is happening now, which is the answer to "what is it
 * doing" — and the last finished phase when nothing is running, which is the
 * answer to "did it work".
 */
export function headlineFor(steps: BuildStep[], flow: Flow = "build"): string {
  const phases = activityFor(steps, flow);
  const live = phases.find((phase) => phase.items.some((item) => item.state === "running"));
  if (live) return live.heading;

  const started = phases.filter((phase) => phase.items.some((item) => item.state === "done"));
  return started.length > 0 ? started[started.length - 1].heading : "Getting started";
}
