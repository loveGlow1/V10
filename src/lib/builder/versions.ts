/* A project's versions, and which one somebody means.
 *
 * Every change to a project — a build, an edit, a visual edit, a file saved in
 * the editor, a sync from GitHub, a restore — writes a new project_builds row,
 * and no path deletes an older one. So the rows ARE the version history: number
 * them oldest-first and version 3 is the third row, for as long as the project
 * exists.
 *
 * Undo used to know one thing: the row before the newest. That made "undo"
 * twice a toggle between the last two versions, and left "go back to version
 * 3", "the first version" and "yesterday's version" with nowhere to go. This
 * module answers them, and it is pure apart from the one read, so a check can
 * exercise every phrasing offline (tools/check-version-history.mjs).
 *
 * ── Restores, and why they record where they came from ──────────────────
 *
 * A restore is a new row carrying an older row's page and files, never a
 * deletion, so a restore can itself be undone. Its prompt starts "Restored
 * version K", and that is what makes repeated undo walk BACKWARDS instead of
 * toggling: undo asks "what is showing now?", and for a restore of K the answer
 * is K, so the step back lands on K-1. Rows written by the old undo say
 * "Reverted: …" and always restored the row two before them; that is read back
 * the same way. */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Version = {
  /** 1-based, oldest first. Stable: rows are never deleted. */
  number: number;
  id: string;
  prompt: string;
  createdAt: string;
  /** The version this row is a copy of, when it is a restore. */
  restoredFrom: number | null;
  /** What the change was, in a few words. */
  label: string;
  /** A fingerprint of its page and files: equal digests look identical. Null
      when it could not be read, and then nothing is treated as identical. */
  digest: string | null;
};

const RESTORED = /^Restored version (\d+)\b/i;
const LEGACY_REVERT = /^Reverted:/i;

/** The prompt a restore row is written with, so restoredFrom can be read back.
    An undo or a redo says so, which is what Redo reads to know what to put back. */
export function restorePrompt(target: Version, how?: "undo" | "redo"): string {
  return `Restored version ${target.number}${how ? ` (${how})` : ""}: ${target.label}`.slice(0, 500);
}

/* ── Redo ─────────────────────────────────────────────────────────────────
 *
 * Undo steps back; Redo puts back what the undos took away, newest first —
 * the stack every editor keeps. Read from the history itself: each undo row
 * pushes what was showing before it, each redo row pops one, and anything
 * else — a new change, or a version picked by name — clears it, so a redo
 * never lands on a version a newer change has replaced. */
const HOW = /^Restored version \d+ \((undo|redo)\)/i;

/** "Redo", "redo that", "redo the last undo" — and nothing longer: "redo the
    header" is a change to make, not a step forward. */
export const REDO_ASK = /^\s*(?:please\s+)?redo(?:\s+(?:it|that|this|the last undo|my last undo|the undo|the last change))?[.!\s]*$/i;

/** The version a redo puts back, or null when there is nothing to redo. */
export function redoTarget(versions: Version[]): number | null {
  const stack: number[] = [];
  let showing = 0;
  for (const version of versions) {
    const how = HOW.exec(version.prompt)?.[1]?.toLowerCase();
    if (how === "undo") {
      if (showing) stack.push(showing);
    } else if (how === "redo") {
      stack.pop();
    } else {
      stack.length = 0;
    }
    showing = contentOf(versions, version.number);
  }
  return stack.length ? stack[stack.length - 1] : null;
}

function labelOf(prompt: string, restoredFrom: number | null): string {
  if (restoredFrom !== null) return `Restored version ${restoredFrom}`;
  if (LEGACY_REVERT.test(prompt)) return "Undo";
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return "Change";
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
}

/** Numbers rows (oldest first) and reads which version each restore copied. */
export function versionsFromRows(
  rows: { id: string; prompt: string | null; created_at: string }[],
  digests: ReadonlyMap<string, string> | null = null,
): Version[] {
  const out: Version[] = [];
  rows.forEach((row, index) => {
    const number = index + 1;
    const prompt = row.prompt ?? "";
    const named = RESTORED.exec(prompt);
    let restoredFrom: number | null = null;
    if (named) {
      const n = Number(named[1]);
      if (n >= 1 && n < number) restoredFrom = n;
    } else if (LEGACY_REVERT.test(prompt)) {
      /* The old undo did not record what it copied. With fingerprints, it is
         the newest earlier version that looks the same — and none means it
         copied nothing recognisable, so it stands as its own version. Without
         them, the old rule: it restored the row two before it. */
      const digest = digests?.get(row.id);
      if (digests && digest) {
        for (let earlier = out.length; earlier >= 1; earlier -= 1) {
          if (out[earlier - 1].digest === digest) {
            restoredFrom = earlier;
            break;
          }
        }
      } else if (number >= 3) {
        restoredFrom = number - 2;
      }
    }
    out.push({
      number,
      id: row.id,
      prompt,
      createdAt: row.created_at,
      restoredFrom,
      label: labelOf(prompt, restoredFrom),
      digest: digests?.get(row.id) ?? null,
    });
  });
  return out;
}

/* Enough for any real project; the newest are what people ask about. */
const MAX_VERSIONS = 1000;

export async function listVersions(service: SupabaseClient, projectId: string): Promise<Version[]> {
  const { data } = await service
    .from("project_builds")
    .select("id, prompt, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(MAX_VERSIONS);
  /* Fingerprints, so undo can step over versions identical to what is
     showing. Without the function (a database the schema has not reached)
     every version counts as different, which is how undo behaved before. */
  const { data: digests, error } = await service.rpc("project_version_digests", { p_project_id: projectId });
  const byId = error
    ? null
    : new Map(((digests ?? []) as { build_id: string; digest: string }[]).map((row) => [row.build_id, row.digest]));
  return versionsFromRows((data ?? []) as { id: string; prompt: string | null; created_at: string }[], byId);
}

/**
 * Builds that showed these words somewhere the current version does not — the
 * file that lost them, not a page that always had them. Null when the search
 * is unavailable, so the caller falls back to matching past requests.
 */
export async function versionsShowing(
  service: SupabaseClient,
  projectId: string,
  terms: string[],
  currentBuildId: string,
): Promise<Set<string> | null> {
  if (terms.length === 0) return null;
  const { data, error } = await service.rpc("project_versions_showing", {
    p_project_id: projectId,
    p_terms: terms,
    p_current: currentBuildId,
  });
  if (error) return null;
  return new Set(((data ?? []) as { build_id: string }[]).map((row) => row.build_id));
}

/* Words that describe a page rather than what is on it. */
const NOT_CONTENT = new Set(
  "the a an and or it its it's with of to in on for that this these those my our your was were had has have button buttons section sections page pages site website app tab tabs link links option options part bit thing things stuff one ones".split(" "),
);

/** The visible words a described state names: "the rent and buy" → rent, buy. */
export function termsOf(phrase: string): string[] {
  const out: string[] = [];
  for (const word of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 2 || word.length > 40 || NOT_CONTENT.has(word) || out.includes(word)) continue;
    out.push(word);
  }
  return out.slice(0, 6);
}

/** The original version whose content a row carries: itself, or what it restored. */
export function contentOf(versions: Version[], number: number): number {
  let current = number;
  for (let guard = 0; guard < versions.length; guard += 1) {
    const from = versions[current - 1]?.restoredFrom;
    if (!from) return current;
    current = from;
  }
  return current;
}

// ── What somebody asked for ──────────────────────────────────────────────

export type Target =
  | { kind: "number"; number: number }
  | { kind: "latest" }
  | { kind: "back"; steps: number }
  | { kind: "time"; at: Date; label: string }
  | { kind: "before"; phrase: string }
  /* "content": a state somebody remembers seeing ("when it had the rent and
     buy"), searched in what versions showed. "request": something somebody
     asked for ("where I added pricing"), searched in past requests. Each
     falls back to the other. */
  | { kind: "with"; phrase: string; by: "content" | "request" };

export type VersionRequest = { kind: "list"; recent?: boolean } | { kind: "goto"; target: Target };

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, a: 1, an: 1, couple: 2, few: 3,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, twentieth: 20,
};
const NUMBER_WORD = Object.keys(WORD_NUMBERS).filter((w) => w.length > 2).join("|");
const ORDINAL_WORD = Object.keys(ORDINALS).join("|");

function toCount(token: string): number | null {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return WORD_NUMBERS[lower] ?? null;
}

/* Asking to see the history rather than to move through it. */
const LIST =
  /\b(?:show|list|see|view|display|give|tell)\b[^.?!]{0,30}\b(?:versions|version history|history|revisions|previous versions|past versions|all (?:the )?changes|changes (?:i|we|you) made)\b|^\s*(?:version history|versions|history|revisions)\s*[?.!]*\s*$|\b(?:what|which) (?:versions|revisions)\b|\bhow many (?:versions|revisions|changes)\b/i;

/* Moving: an undo verb, or a verb of going somewhere aimed at a version. */
const NAV =
  /\b(?:undo|revert|roll ?back|restore|go back|take (?:me|it|us) back|bring (?:back|it back)|put (?:it |the \w+ )?back|return|switch|jump|change it back|back to|reset|load|use|open|show me)\b/i;

/* Pointing at a version — without one, "switch the header" is just an edit. */
const POINTS_AT_VERSION =
  /\b(?:version|revision|v\s*\d+|(?:original|initial|very first)\s+(?:one|draft|design|site|website|page|build|app|layout)\b|the original\s*[?.!]*$|very first|first one|earlier one|older one|previous one|one before|from (?:yesterday|this morning|today|last night|\d+ \w+ ago|an? \w+ ago)|\d+\s*(?:versions|changes|edits|steps) (?:back|ago)|before (?:i|you|we)\b|when (?:it|the \w+) (?:still )?(?:had|has|showed|used to)|back to having)/i;

/* A time of day: "at 3pm", "at 14:30", "at 9:05 am". */
const CLOCK = /\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/* "recent versions", "my last few changes": the three most recent to pick from. */
const RECENT = /\b(?:recent|latest few|last (?:few|three|3)) (?:versions|changes|updates|edits)\b/i;

export function readVersionRequest(message: string): VersionRequest | null {
  const m = message.trim();
  if (!m) return null;
  if (RECENT.test(m) && !/\b(?:undo|revert|roll ?back|restore|go back|switch to|back to)\b/i.test(m)) {
    return { kind: "list", recent: true };
  }
  if (LIST.test(m) && !/\b(?:undo|revert|roll ?back|restore|go back|switch to|back to)\b/i.test(m)) {
    return { kind: "list" };
  }
  if (!NAV.test(m) || !POINTS_AT_VERSION.test(m)) return null;
  const target = parseTarget(m, new Date(), "UTC");
  return target ? { kind: "goto", target } : null;
}

/**
 * Which version a message points at, or null when it names none — in which
 * case an undo means one step back.
 *
 * `now` and `timeZone` are parameters so "yesterday" means the person's
 * yesterday, and so the check can pin both.
 */
export function parseTarget(message: string, now: Date, timeZone: string): Target | null {
  const m = message.toLowerCase().replace(/[’']/g, "'");

  /* "version 3", "v3", "version #3", "revision 2", "version three". */
  const numbered =
    /\b(?:version|revision|v)\s*#?\s*(\d{1,4})\b/.exec(m) ??
    new RegExp(`\\b(?:version|revision)\\s+(${NUMBER_WORD})\\b`).exec(m);
  if (numbered) {
    const n = toCount(numbered[1]);
    if (n && n > 0) return { kind: "number", number: n };
  }

  /* "the 3rd version", "the third version", "the second one". */
  const ordinalDigits = /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:version|revision|one|draft)\b/.exec(m);
  if (ordinalDigits) return { kind: "number", number: Number(ordinalDigits[1]) };

  /* Counted back first: "the second to last", "the one before last". */
  if (/\b(?:second[- ]to[- ]last|second[- ]last|one before (?:the )?(?:last|previous|that))\b/.test(m)) {
    return { kind: "back", steps: 2 };
  }

  const ordinalWord = new RegExp(`\\b(${ORDINAL_WORD})\\s+(?:version|revision|one|draft|design|build)\\b`).exec(m);
  if (ordinalWord) return { kind: "number", number: ORDINALS[ordinalWord[1]] };

  /* "the original" on its own, or the original version/site/page — not "the
     original spacing on the hero", which is one part, not the whole. */
  if (
    /\b(?:original|initial|very first|first ever)\s+(?:version|one|draft|design|site|website|page|build|app|layout)\b|\bthe (?:original|initial|very first)\s*[?.!]*$|\b(?:the beginning|the start)\b/.test(m)
  ) {
    return { kind: "number", number: 1 };
  }

  /* "the latest version" after an undo means forward again. "the last
     version" does NOT: in ordinary English it is the one before this. */
  if (/\b(?:latest|newest|most recent)\s+(?:version|one|change|edit)\b/.test(m)) return { kind: "latest" };

  /* "3 versions back", "two changes ago", "undo the last 2 changes". */
  const counted =
    new RegExp(`\\b(\\d+|${NUMBER_WORD})\\s+(?:versions|changes|edits|steps|revisions|updates)\\s+(?:back|ago|earlier)\\b`).exec(m) ??
    new RegExp(`\\b(?:undo|revert|roll ?back|drop|scrap)\\s+(?:the\\s+)?(?:last|previous|past)\\s+(\\d+|${NUMBER_WORD})\\s+(?:versions|changes|edits|steps|revisions|updates|things)\\b`).exec(m) ??
    new RegExp(`\\bback\\s+(\\d+|${NUMBER_WORD})\\s+(?:versions|changes|edits|steps)\\b`).exec(m);
  if (counted) {
    const n = toCount(counted[1]);
    if (n && n > 0) return { kind: "back", steps: n };
  }

  /* A change named by what it was: "before I added the footer". Read before
     the time rules, which would take "before" for a time. */
  const before = /\bbefore\s+(?:i|you|we)?\s*(?:had\s+)?(?:added|add|changed|change|made|make|did|do|asked(?: for)?|put|removed|remove|updated|update|built|moved|the)?\s*(.+)$/.exec(m);
  if (before) {
    const phrase = before[1].replace(/[?.!]+$/, "").trim();
    const asTime = timeTarget(phrase, now, timeZone);
    if (asTime) return asTime;
    if (phrase && !/^(?:that|this|it|then|now)$/.test(phrase)) return { kind: "before", phrase };
  }

  /* How it looked: "when it had the rent and buy", "back to having a dark
     header". Searched in what the versions showed, newest first. */
  const state =
    /\b(?:back to |from |back )?(?:when|where)\s+(?:it|the (?:site|website|page|app|home ?page|landing page))\s+(?:still\s+)?(?:had|has|showed|was showing|used to (?:have|show)|included|contained)\s+(.+)$/.exec(m) ??
    /\bback to having\s+(.+)$/.exec(m);
  if (state) {
    const phrase = state[1].replace(/[?.!]+$/, "").trim();
    if (phrase) return { kind: "with", phrase, by: "content" };
  }

  const withChange =
    /\b(?:version|one|draft)\s+(?:where|with|when|that|in which|from when)\s+(?:(i|you|we)\s+)?(?:had\s+)?(added|changed|made|asked(?: for)?|put|removed|updated|built|moved|has|had|included)?\s*(.+)$/.exec(m);
  if (withChange) {
    const phrase = withChange[3].replace(/[?.!]+$/, "").trim();
    /* A person who did something ("where I added") names a request; a
       version that has something ("with the testimonials") names content. */
    const by = withChange[1] || /^(?:added|changed|made|asked|put|removed|updated|built|moved)/.test(withChange[2] ?? "") ? "request" : "content";
    if (phrase) return { kind: "with", phrase, by };
  }

  const timed = timeTarget(m, now, timeZone);
  if (timed) return timed;

  if (/\b(?:previous|last|earlier|older|prior|one before)\b/.test(m)) return { kind: "back", steps: 1 };
  return null;
}

// ── Time, in the person's own time zone ──────────────────────────────────

/** The wall-clock parts of `at` in `timeZone`. */
function zoned(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** The instant a wall-clock time in `timeZone` happens. */
function fromZoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i += 1) {
    const seen = zoned(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += Date.UTC(year, month - 1, day, hour, minute) - seenAsUtc;
  }
  return new Date(guess);
}

/** Midnight at the start of the day `offsetDays` from today, in `timeZone`. */
function dayStart(now: Date, timeZone: string, offsetDays: number): Date {
  const today = zoned(now, timeZone);
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
  return fromZoned(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), 0, 0, timeZone);
}

function timeTarget(text: string, now: Date, timeZone: string): Target | null {
  const m = text.toLowerCase();
  const ago = new RegExp(`\\b(\\d+|${NUMBER_WORD}|an?)\\s+(minute|min|hour|hr|day|week)s?\\s+ago\\b`).exec(m);
  if (ago) {
    const n = toCount(ago[1]) ?? 1;
    const unit = ago[2].startsWith("min") ? 60_000 : ago[2].startsWith("h") ? 3_600_000 : ago[2] === "day" ? 86_400_000 : 7 * 86_400_000;
    return { kind: "time", at: new Date(now.getTime() - n * unit), label: `${ago[0]}` };
  }
  /* A clock time first, so "at 11:30 yesterday" is 11:30 yesterday rather
     than the end of yesterday. */
  const clock = CLOCK.exec(m);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    const meridiem = clock[3]?.toLowerCase();
    if (hour > 23 || minute > 59) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const yesterday = /\byesterday\b/.test(m);
    const base = zoned(new Date(dayStart(now, timeZone, yesterday ? -1 : 0).getTime() + 12 * 3_600_000), timeZone);
    let at = fromZoned(base.year, base.month, base.day, hour, minute, timeZone);
    /* Today's time that has not happened yet meant yesterday's. */
    if (!yesterday && at.getTime() > now.getTime()) at = new Date(at.getTime() - 86_400_000);
    return { kind: "time", at: new Date(at.getTime() + 59_999), label: clock[0].trim() + (yesterday ? " yesterday" : "") };
  }
  /* "yesterday" is the last version made during yesterday; "last night" the
     last one before six this morning; "this morning" the last before noon. */
  if (/\b(?:last night)\b/.test(m)) {
    return { kind: "time", at: new Date(dayStart(now, timeZone, 0).getTime() + 6 * 3_600_000), label: "last night" };
  }
  if (/\byesterday\b/.test(m)) {
    return { kind: "time", at: new Date(dayStart(now, timeZone, 0).getTime() - 1), label: "yesterday" };
  }
  if (/\bthis morning\b/.test(m)) {
    return { kind: "time", at: new Date(dayStart(now, timeZone, 0).getTime() + 12 * 3_600_000), label: "this morning" };
  }
  if (/\b(?:earlier today|start of (?:the )?day|this afternoon)\b/.test(m)) {
    const label = /afternoon/.test(m) ? "this afternoon" : "earlier today";
    const at = /afternoon/.test(m) ? new Date(dayStart(now, timeZone, 0).getTime() + 18 * 3_600_000) : dayStart(now, timeZone, 0);
    return { kind: "time", at, label };
  }
  return null;
}

// ── Resolving it against the history ────────────────────────────────────

const STOP = new Set(
  "the a an and or to of in on for with my our your it this that i you we me add added adding change changed make made put new section page site please can could would version one".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(?:ing|ed|es|s)$/, ""));
}

/** How well a version's prompt matches a described change, 0 to 1. */
function matchScore(phrase: string, prompt: string): number {
  const wanted = words(phrase);
  if (wanted.length === 0) return 0;
  const have = new Set(words(prompt));
  return wanted.filter((w) => have.has(w)).length / wanted.length;
}

export type Resolved =
  | {
      ok: true;
      version: Version;
      content: number;
      current: number;
      note: string | null;
      /** It looks exactly like what is showing now: nothing to restore. */
      alreadyShowing: boolean;
    }
  | { ok: false; message: string };

/**
 * The version to restore. `current` is what is showing now — the newest row,
 * or for a restore, the version it copied — so an undo steps back from what the
 * person is actually looking at.
 */
export function resolveTarget(
  versions: Version[],
  target: Target | null,
  timeZone = "UTC",
  now = new Date(),
  /* Builds that showed the described words where the current one does not —
     see versionsShowing. Only for a "with" target. */
  showing: ReadonlySet<string> | null = null,
): Resolved {
  const total = versions.length;
  if (total === 0) return { ok: false, message: "There are no versions of this project yet." };
  const current = contentOf(versions, total);
  const showingDigest = versions[total - 1].digest;
  const looksLikeNow = (version: Version) =>
    contentOf(versions, version.number) === current || (showingDigest !== null && version.digest === showingDigest);
  const pick = (number: number, note: string | null = null): Resolved => {
    const version = versions[number - 1];
    return { ok: true, version, content: contentOf(versions, number), current, note, alreadyShowing: looksLikeNow(version) };
  };
  const wanted = target ?? { kind: "back", steps: 1 };

  switch (wanted.kind) {
    case "number": {
      if (wanted.number > total) {
        return {
          ok: false,
          message: `There's no version ${wanted.number} — this project has ${total} version${total === 1 ? "" : "s"} so far.`,
        };
      }
      return pick(wanted.number);
    }
    case "latest": {
      /* Forward again: the newest version that is not itself a restore. */
      for (let n = total; n >= 1; n -= 1) if (!versions[n - 1].restoredFrom) return pick(n);
      return pick(total);
    }
    case "back": {
      /* Counted in versions that LOOK different. A step back onto a copy of
         what is showing changes nothing anybody can see, and reads as an undo
         that did not work; a run of identical versions is one step. */
      let steps = 0;
      let last: string | null = showingDigest;
      let skipped = 0;
      for (let number = current - 1; number >= 1; number -= 1) {
        const version = versions[number - 1];
        if (version.digest !== null && (looksLikeNow(version) || version.digest === last)) {
          skipped += 1;
          continue;
        }
        steps += 1;
        last = version.digest;
        if (steps === wanted.steps) {
          return pick(number, skipped > 0 ? "the last version that looks different from what's showing" : null);
        }
      }
      return {
        ok: false,
        message:
          steps === 0
            ? current === 1
              ? "There's nothing to undo — you're on the first version of this project."
              : "There's nothing to undo — every earlier version looks the same as what's showing now."
            : `You can go back at most ${steps} step${steps === 1 ? "" : "s"} from here — that reaches version 1.`,
      };
    }
    case "time": {
      let found: Version | null = null;
      for (const version of versions) if (new Date(version.createdAt).getTime() <= wanted.at.getTime()) found = version;
      if (!found) {
        return {
          ok: false,
          message: `There's no version from ${wanted.label} — the first version was made ${formatWhen(versions[0].createdAt, timeZone, now)}.`,
        };
      }
      return pick(found.number);
    }
    case "with": {
      /* How it looked: the newest version that still showed it, where the
         current one does not. Newest first, because the most recent time it
         was there is nearly always the one meant. */
      const byContent = (): Resolved | null => {
        if (!showing) return null;
        for (let number = total; number >= 1; number -= 1) {
          const version = versions[number - 1];
          if (showing.has(version.id) && !looksLikeNow(version)) {
            return pick(number, `the most recent version that still had ${wanted.phrase}`);
          }
        }
        return null;
      };
      if (wanted.by === "content") {
        const found = byContent();
        if (found) return found;
        if (showing) {
          /* The search ran and nothing showed it anywhere the current version
             lacks it: it is showing now, or it never was. Falling back to old
             requests here would restore some version that merely MENTIONED it
             — for something that is already on the page. */
          return {
            ok: false,
            message: `No earlier version had ${wanted.phrase} anywhere it's missing now — it looks like it's already showing. Ask me to "show versions" if you meant a different version.`,
          };
        }
      }
      const asked = byRequest(versions, wanted.phrase);
      if (asked) return pick(asked.number, `the version where you asked: "${asked.label}"`);
      const found = byContent();
      if (found) return found;
      return {
        ok: false,
        message: `I couldn't find a version matching "${wanted.phrase}". Ask me to "show versions" to see the list, then name one by its number.`,
      };
    }
    case "before": {
      let best: Version | null = null;
      let bestScore = 0;
      for (const version of versions) {
        if (version.restoredFrom || LEGACY_REVERT.test(version.prompt)) continue;
        const s = matchScore(wanted.phrase, version.prompt);
        /* Newest wins a tie: the latest time somebody asked for it. */
        if (s >= bestScore && s > 0) {
          best = version;
          bestScore = s;
        }
      }
      if (!best || bestScore < 0.5) {
        return {
          ok: false,
          message: `I couldn't find a change matching "${wanted.phrase}". Ask me to "show versions" to see the list, then name one by its number.`,
        };
      }
      if (best.number === 1) {
        return { ok: false, message: `"${best.label}" was the very first version, so there's nothing before it.` };
      }
      return pick(best.number - 1, `the version just before "${best.label}"`);
    }
  }
}

/** The newest past request that matches a described change, or null. */
function byRequest(versions: Version[], phrase: string): Version | null {
  let best: Version | null = null;
  let bestScore = 0;
  for (const version of versions) {
    if (version.restoredFrom || LEGACY_REVERT.test(version.prompt)) continue;
    const s = matchScore(phrase, version.prompt);
    if (s >= bestScore && s > 0) {
      best = version;
      bestScore = s;
    }
  }
  return best && bestScore >= 0.5 ? best : null;
}

/**
 * The most recent versions that look different from each other and from what
 * is showing, newest first — the few somebody is most likely to want.
 */
export function recentDistinct(versions: Version[], count = 3, excluding: readonly number[] = []): Version[] {
  const total = versions.length;
  if (total === 0) return [];
  const current = contentOf(versions, total);
  const showing = versions[total - 1].digest;
  const seen = new Set<string>();
  if (showing) seen.add(showing);
  const out: Version[] = [];
  for (let number = total; number >= 1 && out.length < count; number -= 1) {
    const version = versions[number - 1];
    if (excluding.includes(number) || contentOf(versions, number) === current) continue;
    if (version.digest !== null) {
      if (seen.has(version.digest)) continue;
      seen.add(version.digest);
    }
    out.push(version);
  }
  return out;
}

// ── Saying it ───────────────────────────────────────────────────────────

export function formatWhen(iso: string, timeZone: string, now = new Date()): string {
  const at = new Date(iso);
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at);
  const startToday = dayStart(now, zone, 0).getTime();
  if (at.getTime() >= startToday) return `today at ${time}`;
  if (at.getTime() >= startToday - 86_400_000) return `yesterday at ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(at);
  return `${date} at ${time}`;
}

/** The history, newest first, as a reply. */
export function describeVersions(versions: Version[], timeZone: string, now = new Date(), limit = 15): string {
  if (versions.length === 0) return "This project has no versions yet.";
  const current = contentOf(versions, versions.length);
  /* The first version each fingerprint appeared in, so a copy can say so. */
  const firstWith = new Map<string, number>();
  for (const v of versions) if (v.digest && !firstWith.has(v.digest)) firstWith.set(v.digest, v.number);
  const line = (v: Version) => {
    const mark = v.number === versions.length ? " ← showing now" : "";
    const twin = v.digest ? firstWith.get(v.digest) : undefined;
    const same = twin !== undefined && twin !== v.number && !v.restoredFrom ? ` (looks the same as version ${twin})` : "";
    return `**Version ${v.number}** · ${formatWhen(v.createdAt, timeZone, now)} · ${v.label}${same}${mark}`;
  };
  const shown = versions.slice(-limit).reverse();
  const older = versions.length > limit ? `\n\n…and ${versions.length - limit} older version${versions.length - limit === 1 ? "" : "s"}, back to version 1.` : "";
  const showing =
    current !== versions.length ? `\n\nWhat's showing now is the same as version ${current}.` : "";
  return `This project has ${versions.length} version${versions.length === 1 ? "" : "s"}:\n\n${shown.map(line).join("\n")}${older}${showing}\n\nSay "go back to version 3", "undo", "the version from yesterday" or "when it had the pricing table" to restore one. A restore is a new version on top, so it can be undone too.`;
}

/** The three most recent versions that look different from now, to pick from. */
export function describeRecent(versions: Version[], timeZone: string, now = new Date()): string {
  const recent = recentDistinct(versions, 3);
  if (recent.length === 0) {
    return versions.length <= 1
      ? "This project only has one version so far, so there's nothing earlier to go back to."
      : "Every earlier version looks the same as what's showing now, so there's nothing different to go back to.";
  }
  const lines = recent.map((v, i) => `${i + 1}. **Version ${v.number}** · ${formatWhen(v.createdAt, timeZone, now)} · ${v.label}`);
  return `Your ${recent.length === 1 ? "most recent earlier version" : `${recent.length} most recent earlier versions`}, newest first:\n\n${lines.join("\n")}\n\nThe first one is what "undo" goes back to. Say "go back to version ${recent[0].number}" — or name any other.`;
}

/** A time zone the person sent, or UTC when it is missing or not real. */
export function safeTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}
