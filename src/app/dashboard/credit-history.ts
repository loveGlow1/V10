/* The credit history, month by month: what came in, what went out, and what
 * every charge was for — so a person can look back at any month and account
 * for each credit.
 *
 * Every line is a row of credit_ledger: a charge (negative), a purchase or
 * grant (positive), plan credits that arrived or expired (source 'plan').
 * Pure: the settings panel and tools/check-credit-history.mjs use it. */

export type HistoryLine = {
  id: string;
  action: string;
  credits: number;
  description: string | null;
  created_at: string;
  project_id: string | null;
  dedupe_key: string | null;
  source: string | null;
};

export type Category = "Video" | "Websites & apps" | "Fliers" | "Agent" | "Publishing" | "Hosting" | "Chat" | "Credits added" | "Plan credits" | "Other";

/** What a line was for, in a word the person recognises. Pure. */
export function categoryOf(line: Pick<HistoryLine, "action" | "credits" | "description" | "dedupe_key" | "source">): Category {
  const key = line.dedupe_key ?? "";
  const text = line.description ?? "";
  if (line.source === "plan") return "Plan credits";
  if (line.action === "topup" || (line.action === "grant" && line.credits !== 0)) return "Credits added";
  if (line.action === "grant") return "Plan credits";
  if (key.startsWith("video-") || /^(Video|Clips stitched|Upload prepared|Character:)/.test(text)) return "Video";
  if (key.startsWith("flyer:") || key.startsWith("flier") || /^(Flyer|Flier)/i.test(text)) return "Fliers";
  if (key.startsWith("agent:") || /^Agent session/.test(text)) return "Agent";
  if (line.action === "publish") return "Publishing";
  if (line.action === "runtime") return "Hosting";
  if (line.action === "chat") return "Chat";
  if (line.action === "generate") return "Websites & apps";
  return "Other";
}

/** "2026-11" for a moment, in the person's own time zone. Pure. */
export function monthKey(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The first and last instant of a month ("2026-11"), local time, as ISO. Pure. */
export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

/** The month before or after ("2026-11", -1 → "2026-10"). Pure. */
export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
}

/** "November 2026". Pure. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export type Statement = {
  spent: number;
  added: number;
  expired: number;
  charges: number;
  byCategory: { category: Category; credits: number; count: number }[];
  /** Newest day first, each day's lines newest first. */
  days: { day: string; lines: HistoryLine[]; spent: number }[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/** A month's lines, summed and grouped for reading. Pure. */
export function statementOf(lines: HistoryLine[]): Statement {
  let spent = 0;
  let added = 0;
  let expired = 0;
  let charges = 0;
  const cats = new Map<Category, { credits: number; count: number }>();
  const days = new Map<string, HistoryLine[]>();
  const sorted = [...lines].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const line of sorted) {
    const category = categoryOf(line);
    if (line.credits < 0 && category !== "Plan credits" && category !== "Credits added") {
      spent += -line.credits;
      charges += 1;
      const c = cats.get(category) ?? { credits: 0, count: 0 };
      cats.set(category, { credits: c.credits - line.credits, count: c.count + 1 });
    } else if (line.credits < 0) expired += -line.credits;
    else added += line.credits;
    const day = new Date(line.created_at).toDateString();
    days.set(day, [...(days.get(day) ?? []), line]);
  }
  return {
    spent: round(spent),
    added: round(added),
    expired: round(expired),
    charges,
    byCategory: [...cats.entries()].map(([category, c]) => ({ category, credits: round(c.credits), count: c.count })).sort((a, b) => b.credits - a.credits),
    days: [...days.entries()].map(([day, list]) => ({
      day,
      lines: list,
      spent: round(list.filter((l) => l.credits < 0 && categoryOf(l) !== "Plan credits" && categoryOf(l) !== "Credits added").reduce((s, l) => s - l.credits, 0)),
    })),
  };
}

/** A month's history as a CSV file's text: one row per line, oldest first. Pure. */
export function statementCsv(lines: HistoryLine[], projectName: (id: string) => string | undefined): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = [...lines]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((line) => [
      new Date(line.created_at).toISOString(),
      categoryOf(line),
      line.description ?? line.action,
      line.project_id ? projectName(line.project_id) ?? "" : "",
      line.credits.toFixed(2),
    ].map((v) => cell(String(v))).join(","));
  return ["Date (UTC),Category,Description,Project,Credits", ...rows].join("\n");
}
