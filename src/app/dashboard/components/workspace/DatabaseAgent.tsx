"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Undo2 } from "lucide-react";

/* The database agent, in the Database panel: what is in the connected
 * database, how the app is wired to it, every change made to it, and its
 * health — with each fix offered as a surgery that is planned, dry-run and
 * shown before anything runs. Approve here is the same endpoint the chat's
 * Approve uses: /api/projects/[id]/backend/agent. */

type Status = "MATCHED" | "ADAPTABLE" | "MISSING" | "UNUSED" | "RISK";

type Analysis = {
  headline: string;
  relationships: { from: string; columns: string[]; to: string; refColumns: string[] }[];
  health: { severity: "red" | "amber" | "info"; message: string; object: string; fix: string | null }[];
  production: { level: "HIGH" | "LOW"; reasons: string[] };
  domain: { label: string } | null;
};

type Wiring = {
  items: { status: Status; app: string | null; db: string | null; detail: string }[];
  summary: string;
  recommendation: { path: string; reason: string };
};

type Surgery = {
  id: string;
  kind: string;
  name: string;
  summary: string;
  level: number;
  status: string;
  confirmation: string | null;
  error: string | null;
  plan: { rollback?: string; statements?: { sql: string; label: string; what: string }[]; warnings?: string[]; refused?: string[]; backups?: string[] } | null;
  created_at: string;
  applied_at: string | null;
};

type State = {
  available: boolean;
  unavailableReason: string | null;
  reconnect: boolean;
  scannedAt: string | null;
  map: { tables: { schema: string; name: string; rowEstimate: number; rls: boolean; kind: string }[] } | null;
  analysis: Analysis | null;
  wiring: Wiring | null;
  surgeries: Surgery[];
};

const ICON: Record<Status, string> = { MATCHED: "✅", ADAPTABLE: "🟡", MISSING: "🔴", UNUSED: "⚪", RISK: "⚠️" };
const PATH: Record<string, string> = { connect: "Connect as-is", surgery: "Surgery", new_project: "New project", side_by_side: "Side-by-side" };
const TABS = ["Map", "Wiring", "Surgeries", "Health"] as const;

export default function DatabaseAgent({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Map");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [fresh, setFresh] = useState<{ open: boolean; orgs: { id: string; name: string }[]; regions: { id: string; label: string }[]; org: string; region: string }>({ open: false, orgs: [], regions: [], org: "", region: "eu-central-1" });

  const endpoint = `/api/projects/${projectId}/backend/agent`;

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) setState((await response.json()) as State);
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setNote(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      setNote(body.error ?? body.message ?? null);
      if (action === "approve" || action === "fix_wiring" || action === "undo" || action === "new_project") setTab("Surgeries");
      await load();
    } catch {
      setNote("That didn't get through. Nothing was changed.");
    } finally {
      setBusy(null);
      setTyped("");
    }
  }

  async function openFresh() {
    const response = await fetch(`/api/projects/${projectId}/backend/supabase`, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { organizations?: { id: string; name: string }[]; regions?: { id: string; label: string }[] };
    const orgs = body.organizations ?? [];
    setFresh({ open: true, orgs, regions: body.regions ?? [], org: orgs[0]?.id ?? "", region: "eu-central-1" });
  }

  if (!state) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[12px] text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the database agent…
      </p>
    );
  }
  if (!state.available) {
    return <p className="mt-4 text-[12px] leading-relaxed text-muted">{state.unavailableReason}</p>;
  }

  const pending = state.surgeries.find((s) => s.status === "planned");
  const button = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.09] px-2.5 text-[12px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink disabled:opacity-40";

  return (
    <div className="mt-5 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
          <Sparkles className="h-4 w-4 text-muted" /> Database agent
        </p>
        <button type="button" className={button} disabled={busy !== null} onClick={() => void act("scan")}>
          {busy === "scan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-scan database
        </button>
      </div>

      {state.analysis ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{state.analysis.headline}</p>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">Not scanned yet. Re-scan reads your database — read-only, nothing is changed.</p>
      )}
      {state.analysis?.production.level === "HIGH" && (
        <p className="mt-1.5 text-[11.5px] text-amber-400">Production database ({state.analysis.production.reasons.join(", ")}): every change is backed up first.</p>
      )}

      {state.wiring && (
        <div className="mt-3 rounded-lg border border-line/[0.07] p-2.5 text-[12px] leading-relaxed">
          <p className="text-ink">{state.wiring.summary}</p>
          <p className="mt-1 text-muted">
            Recommended: <span className="text-ink">{PATH[state.wiring.recommendation.path] ?? state.wiring.recommendation.path}</span> — {state.wiring.recommendation.reason}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy !== null} onClick={() => void act("wire")}>
              {busy === "wire" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Connect the app to these tables
            </button>
            {state.wiring.items.some((i) => i.status === "MISSING" || i.status === "RISK") && (
              <button type="button" className={button} disabled={busy !== null} onClick={() => void act("fix_wiring")}>
                {busy === "fix_wiring" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Plan the fixes
              </button>
            )}
            <button type="button" className={button} disabled={busy !== null} onClick={() => void openFresh()}>
              Start fresh in a new project
            </button>
          </div>
        </div>
      )}

      {fresh.open && (
        <div className="mt-3 rounded-lg border border-line/[0.07] p-2.5 text-[12px]">
          <p className="text-muted">A new Supabase project for this app. Your current database stays exactly as it is. Free plan: $0 (two active projects per organisation); paid organisations pay for its compute, from about $10/month.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select value={fresh.org} onChange={(e) => setFresh({ ...fresh, org: e.target.value })} className="h-8 rounded-lg border border-line/[0.1] bg-transparent px-2 text-ink">
              {fresh.orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select value={fresh.region} onChange={(e) => setFresh({ ...fresh, region: e.target.value })} className="h-8 rounded-lg border border-line/[0.1] bg-transparent px-2 text-ink">
              {fresh.regions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <button type="button" className={button} disabled={!fresh.org || busy !== null} onClick={() => { setFresh({ ...fresh, open: false }); void act("new_project", { organizationId: fresh.org, region: fresh.region }); }}>
              Plan it
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className={`mt-3 rounded-lg border p-2.5 text-[12px] ${pending.level >= 3 ? "border-red-500/40" : pending.level === 2 ? "border-amber-500/40" : "border-emerald-500/30"}`}>
          <p className="font-medium text-ink">Waiting for approval · L{pending.level}</p>
          <p className="mt-1 text-soft">{pending.summary}</p>
          {(pending.plan?.warnings ?? []).map((w) => (
            <p key={w} className="mt-1 text-amber-400">⚠️ {w}</p>
          ))}
          {(pending.plan?.refused ?? []).map((r) => (
            <p key={r} className="mt-1 text-red-400">⛔ {r}</p>
          ))}
          {pending.plan?.statements && pending.plan.statements.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted">SQL ({pending.plan.statements.length} statements)</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-layer/[0.04] p-2 font-mono text-[11px] text-soft">
                {pending.plan.statements.map((s) => `-- ${s.label}: ${s.what}\n${s.sql}`).join("\n\n")}
              </pre>
            </details>
          )}
          {pending.plan?.rollback && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted">Rollback</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-layer/[0.04] p-2 font-mono text-[11px] text-soft">{pending.plan.rollback}</pre>
            </details>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pending.confirmation && (
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${pending.confirmation}`} className="h-8 w-44 rounded-lg border border-red-500/40 bg-transparent px-2 font-mono text-ink outline-none" />
            )}
            <button
              type="button"
              className={button}
              disabled={busy !== null || Boolean(pending.plan?.refused?.length) || (pending.confirmation !== null && typed.trim() !== pending.confirmation)}
              onClick={() => void act("approve", { surgeryId: pending.id, confirmation: typed.trim() || null })}
            >
              {busy === "approve" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve
            </button>
            <button type="button" className={button} disabled={busy !== null} onClick={() => void act("cancel", { surgeryId: pending.id })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-soft">{note}</p>}

      <div className="mt-3 flex gap-1 border-b border-line/[0.07]">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-2.5 py-1.5 text-[12px] ${tab === t ? "border-b border-ink text-ink" : "text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Map" && (
        <div className="mt-2 text-[12px]">
          {(state.map?.tables ?? []).length === 0 && <p className="text-muted">No tables yet.</p>}
          <ul className="space-y-0.5">
            {(state.map?.tables ?? []).slice(0, 60).map((t) => (
              <li key={`${t.schema}.${t.name}`} className="flex justify-between gap-2">
                <span className="font-mono text-soft">{t.schema === "public" ? t.name : `${t.schema}.${t.name}`}</span>
                <span className={t.rls || t.kind !== "table" ? "text-muted" : "text-red-400"}>
                  ~{t.rowEstimate.toLocaleString()} rows{t.kind === "table" && !t.rls ? " · RLS off" : ""}
                </span>
              </li>
            ))}
          </ul>
          {(state.analysis?.relationships ?? []).length > 0 && (
            <>
              <p className="mt-3 text-muted">Relationships</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11.5px] text-soft">
                {state.analysis?.relationships.slice(0, 40).map((r) => (
                  <li key={`${r.from}.${r.columns.join(",")}`}>
                    {r.from.split(".").pop()}.{r.columns.join(",")} → {r.to.split(".").pop()}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "Wiring" && (
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed">
          {!state.wiring && <li className="text-muted">Build the app once, then the wiring report appears here.</li>}
          {state.wiring?.items.map((i, n) => (
            <li key={`${i.status}-${i.app}-${i.db}-${n}`} className="text-soft">
              {ICON[i.status]} <span className="text-muted">{i.status}</span> {i.detail}
            </li>
          ))}
        </ul>
      )}

      {tab === "Surgeries" && (
        <div className="mt-2 text-[12px]">
          {state.surgeries.length === 0 && <p className="text-muted">No database changes yet.</p>}
          <ul className="space-y-1.5">
            {state.surgeries.map((s) => (
              <li key={s.id} className="leading-relaxed">
                <span className="font-mono text-soft">{s.name}</span>{" "}
                <span className={s.status === "applied" ? "text-emerald-400" : s.status === "failed" ? "text-red-400" : "text-muted"}>{s.status}</span>{" "}
                <span className="text-muted">· L{s.level} · {new Date(s.applied_at ?? s.created_at).toLocaleString()}</span>
                <p className="text-muted">{s.summary}{s.error ? ` — ${s.error}` : ""}</p>
              </li>
            ))}
          </ul>
          {state.surgeries.some((s) => s.status === "applied" && s.kind === "migration") && (
            <button type="button" className={`${button} mt-2`} disabled={busy !== null} onClick={() => void act("undo")}>
              {busy === "undo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Undo the last database change
            </button>
          )}
        </div>
      )}

      {tab === "Health" && (
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
          {(state.analysis?.health ?? []).length === 0 && <li className="text-muted">No problems found.</li>}
          {state.analysis?.health.map((h, n) => (
            <li key={`${h.object}-${n}`} className="flex items-start justify-between gap-2">
              <span className={h.severity === "red" ? "text-red-400" : h.severity === "amber" ? "text-amber-400" : "text-muted"}>
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
                {h.message}
              </span>
              {h.fix && (
                <button type="button" className={button} disabled={busy !== null} onClick={() => void act("plan", { sql: h.fix, request: `fix: ${h.message.slice(0, 80)}` })}>
                  <RotateCcw className="h-3 w-3" /> Fix
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
