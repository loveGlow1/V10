"use client";

/* Your fliers — every brief from the Fliers tab, newest first. Each card is
 * the flier's final when one was made, else its first draft, and opens the
 * Flier Studio where it was made.
 *
 * Recently deleted is the other view: whatever was deleted in the last 15
 * days, to put back or to remove at once. After 15 days it is gone for good
 * (lib/flyers/trash.ts). */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { FLIER_RATIO, FlierThumb, type FlierCard } from "../components/FlierThumb";

type Deleted = {
  kind: "flier" | "image";
  id: string;
  path: string | null;
  headline: string;
  format: FlierCard["format"];
  thumb: string | null;
  daysLeft: number;
};

export default function FliersPage() {
  const [view, setView] = useState<"fliers" | "deleted">("fliers");
  const [rows, setRows] = useState<FlierCard[] | null>(null);
  const [deleted, setDeleted] = useState<Deleted[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    const trash = view === "deleted";
    fetch(trash ? "/api/flyers?trash=1" : "/api/flyers", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load your fliers.");
        if (trash) setDeleted(body.items ?? []);
        else setRows(body.fliers ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(item: Deleted, how: "restore" | "forever") {
    if (how === "forever" && !window.confirm("Delete it now? This cannot be undone.")) return;
    const key = `${item.id}:${item.path ?? ""}`;
    setBusy(key);
    const query = item.path ? `?path=${encodeURIComponent(item.path)}` : "";
    const response =
      how === "restore"
        ? await fetch(`/api/flyers/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restore: true, path: item.path ?? undefined }),
          }).catch(() => null)
        : await fetch(`/api/flyers/${item.id}${query}${query ? "&" : "?"}forever=1`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setError(how === "restore" ? "It could not be put back. Try again." : "It could not be deleted. Try again.");
      return;
    }
    load();
  }

  const tab = (id: typeof view, label: string) => (
    <button
      type="button"
      aria-pressed={view === id}
      onClick={() => setView(id)}
      className={`h-8 rounded-lg px-3 text-[13px] transition-colors ${view === id ? "bg-layer/[0.08] text-ink" : "text-muted hover:bg-layer/[0.04] hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-6 md:px-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-[20px] font-semibold text-ink">Your fliers</h1>
      </div>

      <div className="mt-4 inline-flex gap-1 rounded-xl border border-line/[0.07] bg-layer/[0.03] p-1">
        {tab("fliers", "All fliers")}
        {tab("deleted", "Recently deleted")}
      </div>

      {error && <p className="mt-6 text-soft">{error}</p>}

      {view === "fliers" && (
        <>
          {!rows && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted" />}
          {rows?.length === 0 && (
            <p className="mt-8 text-center text-soft">
              No fliers yet. Pick <span className="text-ink">Fliers</span> on <Link href="/dashboard" className="text-accent">Home</Link> and describe one.
            </p>
          )}
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {rows?.map((flier) => (
              <li key={flier.id} className="min-w-0">
                <FlierThumb flier={flier} />
                <p className="mt-1.5 truncate text-[13px] text-ink">{flier.headline || "Flier"}</p>
                <p className="text-[11.5px] text-muted">{new Date(flier.created_at).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {view === "deleted" && (
        <>
          <p className="mt-4 text-[13px] text-muted">Deleted fliers and images stay here for 15 days, then they are gone for good.</p>
          {!deleted && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted" />}
          {deleted?.length === 0 && <p className="mt-8 text-center text-soft">Nothing deleted.</p>}
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {deleted?.map((item) => {
              const key = `${item.id}:${item.path ?? ""}`;
              return (
                <li key={key} className="min-w-0">
                  <div className="overflow-hidden rounded-2xl border border-line/[0.08] bg-layer/[0.04] opacity-70" style={{ aspectRatio: FLIER_RATIO[item.format] ?? "2 / 3" }}>
                    {item.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumb} alt={item.headline || "Flier"} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[13px] text-ink">
                    {item.headline || "Flier"}
                    {item.kind === "image" && <span className="text-muted"> · one version</span>}
                  </p>
                  <p className="text-[11.5px] text-muted">
                    {item.daysLeft <= 1 ? "Gone within a day" : `Gone in ${item.daysLeft} days`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void act(item, "restore")}
                      disabled={busy !== null}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-line/[0.1] text-[12.5px] text-ink disabled:opacity-40"
                    >
                      {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(item, "forever")}
                      disabled={busy !== null}
                      aria-label="Delete now, for good"
                      title="Delete now, for good"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line/[0.1] text-soft hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
