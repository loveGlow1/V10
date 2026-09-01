/* Putting the finished build's card back under the message that announced it.
 *
 * The card is drawn from view-only fields, so it never survived a reload: the
 * thread came back as words, and the page someone had just built was announced
 * by a bare sentence with nothing under it. Which meant the card only ever
 * existed inside the tab that watched the build land — and if that tab was
 * closed, or the wait gave up, it existed nowhere at all. That is why it looked
 * like the feature had not shipped.
 *
 * The row knows enough to rebuild it. The announcement carries kind
 * 'build_ready' — written by the save step, not guessed from the wording — and
 * its own timestamp is when the page actually landed, which is what the few
 * minutes of Download and Publish are counted from. Everything else is the
 * project as it stands.
 *
 * Only the most recent announcement gets a card. Older ones are history, and a
 * 150px thumbnail of today's page under each of them would be both heavy and
 * wrong: they announced a page that has since been replaced.
 */

/* Deliberately structural, and importing nothing.
 *
 * This file is a rule about a thread, not a part of the panel that draws one —
 * so it names only the fields it reads, and is compiled and checked on its own
 * by tools/check-brief.mjs. What it returns is checked against the real
 * BuildResult where it is used, in ChatPanel, which is where a drift between
 * the two would actually break something. */

/** The half of a stored message this rule reads. */
export type Announced = { kind?: string; at?: number };

/** The half of a project it needs to draw one. */
export type PageOwner = {
  id: string;
  name: string;
  preview_url?: string | null;
  last_build_at?: string | null;
};

/**
 * Which message in a thread should carry the card, or -1 for none.
 *
 * Separate from building the card itself because this is the part with edges:
 * a thread with no builds in it, a thread whose builds are all older than the
 * page now on the preview, a project with no page at all.
 */
export function cardIndex(thread: Announced[], hasPage: boolean): number {
  if (!hasPage) return -1;
  for (let at = thread.length - 1; at >= 0; at--) {
    if (thread[at].kind === "build_ready" && typeof thread[at].at === "number") return at;
  }
  return -1;
}

export type Card = {
  projectId: string;
  name: string;
  kind?: string;
  at: number;
  hasPage: boolean;
  stamp: string | null;
};

/** The card for the build that message announced. */
export function cardFor(project: PageOwner, at: number, kind: string | undefined): Card {
  return {
    projectId: project.id,
    name: project.name,
    kind,
    at,
    hasPage: true,
    stamp: project.last_build_at ?? null,
  };
}
