"use client";

/* Your videos — the Videos section: every Video Studio project, newest
 * first, each with its picture of where it stands and a way straight into
 * its editor. Reached from the sidebar (Videos), from Home's Videos chip
 * (View all), and New video starts one on Home's Video tab. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Popcorn, Scissors } from "lucide-react";

import { PIPELINES, isPipelineId } from "@/lib/video/pipelines";

import { PIPELINE_ICON } from "../components/video/VideoTypeGrid";

type Row = { id: string; title: string; pipeline: string; status: string; current_version: number; updated_at: string; project_id?: string | null };

/* Where a video stands, in words. */
const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "text-muted bg-layer/[0.06]" },
  planning: { label: "Planning", tone: "text-sky-300 bg-sky-400/10" },
  planned: { label: "Plan ready", tone: "text-sky-300 bg-sky-400/10" },
  rendering: { label: "Being made", tone: "text-amber-300 bg-amber-400/10" },
  ready: { label: "Ready", tone: "text-emerald-300 bg-emerald-400/10" },
  failed: { label: "Needs attention", tone: "text-danger bg-danger/10" },
};

export default function VideosPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("all");

  useEffect(() => {
    fetch("/api/video", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load your videos.");
        setRows(body.videos ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  /* Only the kinds this person has made, as filters. */
  const kinds = useMemo(() => [...new Set((rows ?? []).map((row) => row.pipeline).filter(isPipelineId))], [rows]);
  const shown = (rows ?? []).filter((row) => kind === "all" || row.pipeline === kind);

  return (
    <main className="relative z-10 mx-auto w-full max-w-4xl flex-1 px-4 pb-20 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-[20px] font-semibold text-ink">Your videos</h1>
        <Link href="/dashboard?create=video&type=full_movie" className="flex h-9 items-center gap-1.5 rounded-full border border-line/[0.1] px-3.5 text-[13px] text-ink hover:bg-layer/[0.06]">
          <Popcorn className="h-4 w-4" /> Full movie
        </Link>
        <Link href="/dashboard?create=video" className="flex h-9 items-center gap-1.5 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid">
          <Plus className="h-4 w-4" /> New video
        </Link>
      </div>

      {kinds.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Videos by kind">
          {["all", ...kinds].map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kind === id}
              onClick={() => setKind(id)}
              className={`h-8 rounded-full px-3 text-[12.5px] ${kind === id ? "bg-layer/[0.1] text-ink" : "text-muted hover:text-ink"}`}
            >
              {id === "all" ? "All" : isPipelineId(id) ? PIPELINES[id].label : id}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-6 text-soft">{error}</p>}
      {!rows && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted" />}
      {rows?.length === 0 && (
        <div className="mt-10 rounded-[16px] border border-dashed border-line/[0.15] p-8 text-center">
          <p className="text-[15px] text-ink">No videos yet</p>
          <p className="mt-1 text-[13px] text-muted">Make an ad, a short, a full movie — or upload your clips and cut them in the editor.</p>
          <Link href="/dashboard?create=video" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid">
            <Plus className="h-4 w-4" /> New video
          </Link>
        </div>
      )}

      <ul className="mt-5 space-y-2">
        {shown.map((row) => {
          const pipeline = isPipelineId(row.pipeline) ? PIPELINES[row.pipeline] : null;
          const Icon = pipeline ? PIPELINE_ICON[pipeline.icon] : null;
          const status = STATUS[row.status] ?? { label: row.status, tone: "text-muted bg-layer/[0.06]" };
          return (
            <li key={row.id} className="flex items-center gap-2 rounded-[14px] border border-line/[0.08] bg-panel px-3 py-2.5 hover:border-line/[0.16]">
              <Link href={row.project_id ? `/dashboard/project/${row.project_id}` : `/dashboard/video/${row.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-layer/[0.06]">{Icon && <Icon className="h-4 w-4 text-soft" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{row.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                    {pipeline?.label}
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${status.tone}`}>{status.label}</span>
                    <span>v{row.current_version} · {new Date(row.updated_at).toLocaleDateString()}</span>
                  </span>
                </span>
              </Link>
              <Link
                href={`/dashboard/video/${row.id}/edit`}
                title="Open the editor — media, timeline, text, transitions, filters, music and voice"
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.08] px-3 text-[12.5px] font-medium text-accent hover:bg-accent/[0.14]"
              >
                <Scissors className="h-3.5 w-3.5" /> Editor
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
