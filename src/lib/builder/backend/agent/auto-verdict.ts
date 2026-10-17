/* Whether a planned database change may be applied without a person.
 *
 * The one decision the database autopilot makes that a person would otherwise
 * make by pressing Approve — so it lives on its own, pure, and is taken twice:
 * by the autopilot when it plans, and again by approveSurgery on the stored
 * plan before anything runs. See autopilot.ts for the whole set of guardrails.
 *
 * Pure. Asserted by tools/check-db-agent.mjs.
 */

import type { SurgeryPlan } from "./surgery";

export const AUTOPILOT_MARK = "[autopilot]";
export const MAX_STATEMENTS = 60;
export const MAX_NEW_TABLES = 20;
export const MAX_AUTO_PER_HOUR = 3;

/* ── The verdict ──────────────────────────────────────────────────────────── */

export type AutoVerdict = { auto: true } | { auto: false; why: string };

/* `schema.table` or `table`, quotes off, lower case — so a policy on
   `public.notes` and a create of `notes` name the same thing. */
function key(name: string | null): string {
  const bare = (name ?? "").replace(/"/g, "").toLowerCase();
  return bare.includes(".") ? bare : `public.${bare}`;
}

const head = (sql: string) => sql.replace(/^\s*(--[^\n]*\n\s*)*/, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Whether a planned change may be applied without a person. Pure: the plan
 * alone decides it, so the planner and approveSurgery reach the same answer.
 */
export function autoVerdict(plan: Pick<SurgeryPlan, "statements" | "refused" | "confirmation" | "backups" | "previews">): AutoVerdict {
  if (plan.refused.length > 0) return { auto: false, why: plan.refused[0] };
  if (plan.confirmation) return { auto: false, why: "it is destructive and needs a typed confirmation" };
  if (plan.backups.length > 0 || plan.previews.length > 0) return { auto: false, why: "it changes rows or tables that already hold data" };
  if (plan.statements.length === 0) return { auto: false, why: "there is nothing in it" };
  if (plan.statements.length > MAX_STATEMENTS) return { auto: false, why: `it is ${plan.statements.length} statements, more than ${MAX_STATEMENTS} at once` };

  const born = new Set(
    plan.statements.filter((s) => /^CREATE( UNLOGGED)? TABLE/.test(head(s.sql))).map((s) => key(s.table)),
  );
  if (born.size > MAX_NEW_TABLES) return { auto: false, why: `it creates ${born.size} tables, more than ${MAX_NEW_TABLES} at once` };

  for (const s of plan.statements) {
    const h = head(s.sql);
    const what = s.what || h.toLowerCase();
    if (s.forbidden) return { auto: false, why: s.forbidden };
    if (s.level >= 3) return { auto: false, why: `one step ${what}` };

    /* The new tables themselves, and what is safe to add to any table. */
    if (/^CREATE( UNLOGGED)? TABLE/.test(h)) {
      if (/ AS /.test(h)) return { auto: false, why: "it copies data into a new table" };
      continue;
    }
    if (/^CREATE (UNIQUE )?INDEX/.test(h) && s.level <= 1) continue;
    if (/^CREATE TYPE/.test(h) && !/ AS RANGE/.test(h)) continue;
    if (/^COMMENT ON/.test(h)) continue;
    if (/^NOTIFY /.test(h)) continue;
    if (/^ALTER TABLE/.test(h) && / ADD /.test(h) && s.level === 1 && !/ CONSTRAINT | FOREIGN | PRIMARY | UNIQUE | CHECK /.test(h)) continue;

    /* Who can reach a table: only for one created in this same change. */
    const accessRule =
      /^CREATE POLICY/.test(h) ||
      (/^ALTER TABLE/.test(h) && / ENABLE ROW LEVEL SECURITY/.test(h)) ||
      /^GRANT (SELECT|INSERT|UPDATE|DELETE)/.test(h);
    if (accessRule) {
      if (born.has(key(s.table))) continue;
      return { auto: false, why: `it changes who can reach ${s.table ?? "an existing table"}, which already exists` };
    }

    return { auto: false, why: `one step ${what}` };
  }
  return { auto: true };
}
