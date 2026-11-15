"use client";

/* The credit history as monthly statements: pick a month, see what was spent
   and added, where it went, and every line — each charge with what it was
   for, its project and its time. Downloadable as CSV. Reads the person's own
   ledger (RLS: "Owners read their ledger"), a month at a time, in full. */

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Coins, Download, Loader2 } from "lucide-react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { formatCredits } from "../../credits";
import { categoryOf, monthKey, monthLabel, monthRange, shiftMonth, statementCsv, statementOf, type HistoryLine } from "../../credit-history";

const PAGE = 1000;

export function CreditStatement({ projectNames }: { projectNames: Map<string, string> }) {
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const [first, setFirst] = useState<string | null>(null);
  const [lines, setLines] = useState<HistoryLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  /* The oldest month there is anything for: the arrows stop there. */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = createSupabaseBrowserClient();
    void client
      .from("credit_ledger")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setFirst(data?.created_at ? monthKey(data.created_at as string) : thisMonth));
  }, [thisMonth]);

  /* Every line of the month — paged, never cut off. */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let live = true;
    setLines(null);
    setFailed(false);
    const client = createSupabaseBrowserClient();
    const { from, to } = monthRange(month);
    void (async () => {
      const all: HistoryLine[] = [];
      for (let page = 0; page < 50; page += 1) {
        const { data, error } = await client
          .from("credit_ledger")
          .select("id, action, credits, description, created_at, project_id, dedupe_key, source")
          .gte("created_at", from)
          .lt("created_at", to)
          .order("created_at", { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) {
          if (live) {
            setFailed(true);
            setLines([]);
          }
          return;
        }
        all.push(...(data ?? []).map((row) => ({ ...(row as HistoryLine), credits: Number((row as HistoryLine).credits) })));
        if (!data || data.length < PAGE) break;
      }
      if (live) setLines(all);
    })();
    return () => {
      live = false;
    };
  }, [month]);

  const statement = useMemo(() => statementOf(lines ?? []), [lines]);
  const canBack = first !== null && month > first;
  const canForward = month < thisMonth;

  function download() {
    if (!lines?.length) return;
    const blob = new Blob([statementCsv(lines, (id) => projectNames.get(id))], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-history-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const arrow = "flex h-8 w-8 items-center justify-center rounded-lg border border-line/[0.08] bg-layer/[0.03] text-soft transition-colors hover:text-ink disabled:opacity-30";

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-medium text-ink">Credit history</p>
        <div className="flex items-center gap-1.5">
          <button type="button" className={arrow} onClick={() => setMonth(shiftMonth(month, -1))} disabled={!canBack} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[124px] text-center text-sm text-ink">{monthLabel(month)}</span>
          <button type="button" className={arrow} onClick={() => setMonth(shiftMonth(month, 1))} disabled={!canForward} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!lines?.length}
            className="ml-1 flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.08] bg-layer/[0.03] px-3 text-[13px] text-soft transition-colors hover:text-ink disabled:opacity-30"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* The month at a glance. */}
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line/[0.07] bg-line/[0.07]">
        {(
          [
            ["Spent", statement.spent, `${statement.charges} ${statement.charges === 1 ? "charge" : "charges"}`],
            ["Added", statement.added, "Purchases and plan credits"],
            ["Expired", statement.expired, "Unused plan credits"],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className="bg-panel px-4 py-3">
            <p className="text-[12px] text-muted">{label}</p>
            <p className="mt-1 text-lg font-semibold text-ink">{lines === null ? "…" : formatCredits(value)}</p>
            <p className="truncate text-[11.5px] text-faint">{hint}</p>
          </div>
        ))}
      </div>

      {/* Where it went. */}
      {statement.byCategory.length > 0 && (
        <div className="mt-3 rounded-xl border border-line/[0.07] bg-layer/[0.02] px-4 py-3">
          <p className="text-[12px] text-muted">Where it went</p>
          <ul className="mt-2 space-y-1.5">
            {statement.byCategory.map((row) => (
              <li key={row.category} className="flex items-center gap-3 text-[13px]">
                <span className="w-32 shrink-0 text-soft">{row.category}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-layer/[0.06]">
                  <span className="block h-full rounded-full bg-accent/70" style={{ width: `${statement.spent ? Math.max(2, (row.credits / statement.spent) * 100) : 0}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-ink">{formatCredits(row.credits)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Every line, day by day. */}
      <div className="mt-3 rounded-xl border border-line/[0.07] bg-layer/[0.02]">
        {lines === null ? (
          <div className="flex h-[160px] items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        ) : lines.length === 0 ? (
          <div className="flex h-[160px] flex-col items-center justify-center px-6 text-center">
            <Coins className="h-5 w-5 text-faint" />
            <p className="mt-3 text-sm text-soft">{failed ? "History couldn't be loaded" : `Nothing in ${monthLabel(month)}`}</p>
            <p className="mt-1 text-[13px] text-muted">{failed ? "Close and reopen settings to try again." : "Every charge, purchase and plan credit appears here with what it was for."}</p>
          </div>
        ) : (
          <div className="divide-y divide-line/[0.06]">
            {statement.days.map((day) => (
              <div key={day.day}>
                <div className="flex items-center justify-between bg-layer/[0.03] px-4 py-1.5 text-[12px] text-muted">
                  <span>{new Date(day.lines[0].created_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                  {day.spent > 0 && <span className="tabular-nums">−{formatCredits(day.spent)}</span>}
                </div>
                <ul className="divide-y divide-line/[0.04]">
                  {day.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-4 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{line.description || line.action}</p>
                        <p className="truncate text-[12px] text-muted">
                          {new Date(line.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {categoryOf(line)}
                          {line.project_id && projectNames.get(line.project_id) ? ` · ${projectNames.get(line.project_id)}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm tabular-nums ${line.credits > 0 ? "text-accent" : line.credits < 0 ? "text-soft" : "text-faint"}`}>
                        {line.credits > 0 ? "+" : line.credits < 0 ? "−" : ""}
                        {formatCredits(Math.abs(line.credits))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
