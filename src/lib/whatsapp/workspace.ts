import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PLANS, PLAN_ORDER } from "@/app/dashboard/credits";

/* What the WhatsApp assistant may know about a linked account.
 *
 * READ-ONLY, on purpose and by construction: every call below is a select.
 * Nothing here writes, so no message — however it is worded — can move a
 * credit, change a plan or touch a project through the assistant. Credits
 * come only from purchases and plan grants in the app.
 *
 * Deliberately narrow, too: names, statuses, live links and balances. No
 * prompts, files, keys, emails, payment details or anyone else's data. */

export type WorkspaceSummary = {
  name: string | null;
  plan: string;
  /** Null when the account has never been charged and has no balance row yet. */
  credits: { available: number; monthly: number; rollover: number; topUp: number } | null;
  projects: Array<{
    name: string;
    kind: string | null;
    status: string | null;
    liveUrl: string | null;
    lastBuiltAt: string | null;
  }>;
  projectCount: number;
  recentActivity: Array<{ what: string; credits: number; at: string }>;
};

const round = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

export async function workspaceSummary(service: SupabaseClient, userId: string): Promise<WorkspaceSummary> {
  const [profile, balance, projects, ledger] = await Promise.all([
    service.from("user_profiles").select("full_name").eq("user_id", userId).maybeSingle<{ full_name: string | null }>(),
    service
      .from("credit_balances")
      .select("plan_id, daily, monthly, rollover, top_up")
      .eq("user_id", userId)
      .maybeSingle<{ plan_id: string | null; daily: number; monthly: number; rollover: number; top_up: number }>(),
    service
      .from("projects")
      .select("name, intent, status, published_url, last_build_at", { count: "exact" })
      .eq("user_id", userId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(10),
    service
      .from("credit_ledger")
      .select("action, credits, description, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const row = balance.data;
  const planId = PLAN_ORDER.find((id) => id === row?.plan_id) ?? "free";
  return {
    name: profile.data?.full_name?.trim() || null,
    plan: PLANS[planId].name,
    credits: row
      ? {
          available: round(Number(row.daily) + Number(row.monthly) + Number(row.rollover) + Number(row.top_up)),
          monthly: round(row.monthly),
          rollover: round(row.rollover),
          topUp: round(row.top_up),
        }
      : null,
    projects: (projects.data ?? []).map((p) => ({
      name: String(p.name ?? "Untitled"),
      kind: (p.intent as string | null) ?? null,
      status: (p.status as string | null) ?? null,
      liveUrl: (p.published_url as string | null) ?? null,
      lastBuiltAt: (p.last_build_at as string | null) ?? null,
    })),
    projectCount: projects.count ?? (projects.data ?? []).length,
    recentActivity: (ledger.data ?? []).map((l) => ({
      what: String(l.description || l.action || "activity"),
      credits: round(l.credits),
      at: String(l.created_at),
    })),
  };
}
