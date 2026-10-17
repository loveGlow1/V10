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
};

const RESTORED = /^Restored version (\d+)\b/i;
const LEGACY_REVERT = /^Reverted:/i;

/** The prompt a restore row is written with, so restoredFrom can be read back. */
export function restorePrompt(target: Version): string {
  return `Restored version ${target.number}: ${target.label}`.slice(0, 500);
}

function labelOf(prompt: string, restoredFrom: number | null): string {
  if (restoredFrom !== null) return `Restored version ${restoredFrom}`;
  if (LEGACY_REVERT.test(prompt)) return "Undo";
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return "Change";
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
}

/** Numbers rows (oldest first) and reads which version each restore copied. */
export function versionsFromRows(rows: { id: string; prompt: string | null; created_at: string }[]): Version[] {
  const out: Version[] = [];
  rows.forEach((row, index) => {
    const number = index + 1;
    const prompt = row.prompt ?? "";
    const named = RESTORED.exec(prompt);
    let restoredFrom: number | null = null;
    if (named) {
      const n = Number(named[1]);
      if (n >= 1 && n < number) restoredFrom = n;
    } else if (LEGACY_REVERT.test(prompt) && number >= 3) {
      restoredFrom = number - 2;
    }
    out.push({ number, id: row.id, prompt, createdAt: row.created_at, restoredFrom, label: labelOf(prompt, restoredFrom) });
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
  return versionsFromRows((data ?? []) as { id: string; prompt: string | null; created_at: string }[]);
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
  | { kind: "with"; phrase: string };

export type VersionRequest = { kind: "list" } | { kind: "goto"; target: Target };

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
  /\b(?:version|revision|v\s*\d+|(?:original|initial|very first)\s+(?:one|draft|design|site|website|page|build|app|layout)\b|the original\s*[?.!]*$|very first|first one|earlier one|older one|previous one|one before|from (?:yesterday|this morning|today|last night|\d+ \w+ ago|an? \w+ ago)|\d+\s*(?:versions|changes|edits|steps) (?:back|ago)|before (?:i|you|we)\b)/i;

/* A time of day: "at 3pm", "at 14:30", "at 9:05 am". */
const CLOCK = /\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

export function readVersionRequest(message: string): VersionRequest | null {
  const m = message.trim();
  if (!m) return null;
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

  const withChange =
    /\b(?:version|one|draft)\s+(?:where|with|when|that|in which|from when)\s+(?:i|you|we)?\s*(?:had\s+)?(?:added|changed|made|asked(?: for)?|put|removed|updated|built|moved|has|had|included)?\s*(.+)$/.exec(m);
  if (withChange) {
    const phrase = withChange[1].replace(/[?.!]+$/, "").trim();
    if (phrase) return { kind: "with", phrase };
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
  | { ok: true; version: Version; content: number; current: number; note: string | null }
  | { ok: false; message: string };

/**
 * The version to restore. `current` is what is showing now — the newest row,
 * or for a restore, the version it copied — so an undo steps back from what the
 * person is actually looking at.
 */
export function resolveTarget(versions: Version[], target: Target | null, timeZone = "UTC", now = new Date()): Resolved {
  const total = versions.length;
  if (total === 0) return { ok: false, message: "There are no versions of this project yet." };
  const current = contentOf(versions, total);
  const pick = (number: number, note: string | null = null): Resolved => {
    const version = versions[number - 1];
    return { ok: true, version, content: contentOf(versions, number), current, note };
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
      const number = current - wanted.steps;
      if (number < 1) {
        return {
          ok: false,
          message:
            current === 1
              ? "There's nothing to undo — you're on the first version of this project."
              : `You can go back at most ${current - 1} step${current - 1 === 1 ? "" : "s"} from here — the first version is version 1.`,
        };
      }
      return pick(number);
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
    case "before":
    case "with": {
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
      if (wanted.kind === "with") return pick(best.number, `the version where you asked: "${best.label}"`);
      if (best.number === 1) {
        return { ok: false, message: `"${best.label}" was the very first version, so there's nothing before it.` };
      }
      return pick(best.number - 1, `the version just before "${best.label}"`);
    }
  }
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
  const shown = versions.slice(-limit).reverse();
  const lines = shown.map((v) => {
    const mark = v.number === versions.length ? " ← showing now" : "";
    return `**Version ${v.number}** · ${formatWhen(v.createdAt, timeZone, now)} · ${v.label}${mark}`;
  });
  const older = versions.length > limit ? `\n\n…and ${versions.length - limit} older version${versions.length - limit === 1 ? "" : "s"}, back to version 1.` : "";
  const showing =
    current !== versions.length ? `\n\nWhat's showing now is the same as version ${current}.` : "";
  return `This project has ${versions.length} version${versions.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}${older}${showing}\n\nSay "go back to version 3", "undo", "the version from yesterday" or "before I added the footer" to restore one. A restore is a new version on top, so it can be undone too.`;
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
