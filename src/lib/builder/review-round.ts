/* The review round: after a build, the builder reads its own work and fixes
 * what the review found — once, for free, and only for real findings.
 *
 * The save route already inspects every build (lib/builder/qa) and records
 * the errors it found on the build row, qa_issues. Nothing fixed them: the
 * mechanical autofix only reaches single documents, and a model repair needs
 * a model call the save route has no room for. So the workspace, once a build
 * lands, asks for one more edit — and this file decides whether it gets one.
 *
 * ── Why the server writes the prompt ────────────────────────────────────
 *
 * A review round is free. If the browser could say what to fix, "free" would
 * be a way to have any edit done without paying for it. So the browser only
 * names the build; everything else is read from the build row here: which
 * errors, in what words, and whether a round is due at all.
 *
 * ── The guardrails ──────────────────────────────────────────────────────
 *
 *   ONLY FINDINGS   The prompt is made from the build's recorded errors and
 *                   nothing else, and asks for the smallest change to each.
 *   ONCE            One round per build, enforced by a keyed thread message
 *                   written before the round runs; a second request for the
 *                   same build is refused, even if the first round failed.
 *   NEVER NESTED    A round's own build is never reviewed again, so a fix
 *                   that leaves something behind cannot start a loop.
 *   LATEST, RECENT  Only the project's newest build, within REVIEW_WINDOW_MS
 *                   of landing — never an old version the person moved on
 *                   from.
 *   CAPPED          At most MAX_FINDINGS findings in one round.
 *   FREE            The round is not charged (see /api/build), so fixing the
 *                   builder's own mistakes never costs the person credits.
 *   VISIBLE         It goes through the ordinary edit path: a new version,
 *                   in the history, undoable like any other change.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordMessage } from "@/lib/thread-server";

export const REVIEW_MARK = "[review:";
export const MAX_FINDINGS = 8;
export const REVIEW_WINDOW_MS = 60 * 60_000;

export type Finding = { rule: string; message: string; viewport?: string | null };

/** The edit the round asks for. Pure: the findings decide every word. */
export function reviewPrompt(buildId: string, findings: Finding[]): string {
  const listed = findings
    .slice(0, MAX_FINDINGS)
    .map((f) => `- ${f.message.replace(/\s+/g, " ").trim().slice(0, 300)}${f.viewport ? ` (on ${f.viewport})` : ""}`)
    .join("\n");
  return [
    `${REVIEW_MARK}${buildId}] Fix what the automatic review of this build found.`,
    "",
    listed,
    "",
    "Fix each one with the smallest change that does it. Do not change anything else — not the design, the copy, the layout or the features.",
  ].join("\n");
}

export function isReviewPrompt(prompt: string | null | undefined): boolean {
  return (prompt ?? "").startsWith(REVIEW_MARK);
}

type BuildRow = { id: string; prompt: string | null; qa_issues: Finding[] | null; created_at: string };

export type Eligibility = { ok: true; prompt: string; findings: number } | { ok: false; reason: string };

/** The findings worth a round: errors with something to say, deduplicated. */
export function findingsOf(issues: unknown): Finding[] {
  if (!Array.isArray(issues)) return [];
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const raw of issues) {
    const issue = raw as Partial<Finding> | null;
    if (!issue || typeof issue.message !== "string" || !issue.message.trim()) continue;
    const key = `${issue.rule ?? ""}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rule: String(issue.rule ?? ""), message: issue.message, viewport: typeof issue.viewport === "string" ? issue.viewport : null });
  }
  return out;
}

export type Due = { due: true; buildId: string; findings: Finding[] } | { due: false; reason: string };

/**
 * Whether the project's newest build is due a review round. Read-only, so the
 * workspace can ask before it sends anything; reviewEligibility asks again,
 * and claims the round, when the round is requested.
 */
export async function reviewDue(
  service: SupabaseClient,
  projectId: string,
  buildId = "latest",
  now = Date.now(),
): Promise<Due> {
  const { data: latest, error } = await service
    .from("project_builds")
    .select("id, prompt, qa_issues, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<BuildRow>();
  if (error || !latest) return { due: false, reason: "There is no build to review." };
  if (buildId !== "latest" && latest.id !== buildId) return { due: false, reason: "A newer version exists, so that review is no longer needed." };
  if (isReviewPrompt(latest.prompt)) return { due: false, reason: "That version is already a review fix." };
  if (now - Date.parse(latest.created_at) > REVIEW_WINDOW_MS) return { due: false, reason: "That build is too old to review automatically." };
  const findings = findingsOf(latest.qa_issues);
  if (findings.length === 0) return { due: false, reason: "The review found nothing to fix." };
  /* A flier is artwork, not a website: the review's gates (routes, forms,
     loading states) do not apply to it, and an edit made from them only ever
     talks it into becoming an app. */
  const { count: flier } = await service
    .from("project_builds")
    .select("id", { count: "exact", head: true })
    .eq("id", latest.id)
    .or("html.ilike.*data-qs-flier*,html.ilike.*download png*");
  if ((flier ?? 0) > 0) return { due: false, reason: "Fliers are not reviewed as websites." };
  const { count } = await service
    .from("project_messages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("dedupe_key", `review:${latest.id}`);
  if ((count ?? 0) > 0) return { due: false, reason: "That build has already had its review round." };
  return { due: true, buildId: latest.id, findings };
}

/**
 * Whether `buildId` — or, as "latest", the project's newest build — is due a
 * review round, and the prompt for it. Claims the round as it answers yes, so
 * it can be answered yes only once.
 */
export async function reviewEligibility(
  service: SupabaseClient,
  input: { projectId: string; userId: string; buildId: string },
  now = Date.now(),
): Promise<Eligibility> {
  const due = await reviewDue(service, input.projectId, input.buildId, now);
  if (!due.due) return { ok: false, reason: due.reason };

  /* ONCE: the claim is a keyed message — the thread's unique index refuses a
     second one for the same build, whoever asks and however often. */
  const claimed = await recordMessage(service, {
    projectId: input.projectId,
    userId: input.userId,
    role: "system",
    body: `Reviewing the build — ${due.findings.length} ${due.findings.length === 1 ? "thing" : "things"} to fix. This round is free.`,
    dedupeKey: `review:${due.buildId}`,
  });
  if (!claimed.stored) {
    return { ok: false, reason: claimed.duplicate ? "That build has already had its review round." : "The review couldn't be started." };
  }

  return { ok: true, prompt: reviewPrompt(due.buildId, due.findings), findings: due.findings.length };
}
