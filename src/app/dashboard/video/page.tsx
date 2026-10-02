"use client";

/* Your videos — every Video Studio project, newest first. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { PIPELINES, isPipelineId } from "@/lib/video/pipelines";

import { PIPELINE_ICON } from "../components/video/VideoTypeGrid";

type Row = { id: string; title: string; pipeline: string; status: string; current_version: number; updated_at: string };

export default function VideosPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/video", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load your videos.");
        setRows(body.videos ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-[20px] font-semibold text-ink">Your videos</h1>
      </div>
      {error && <p className="mt-6 text-soft">{error}</p>}
      {!rows && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted" />}
      {rows?.length === 0 && (
        <p className="mt-8 text-center text-soft">
          No videos yet. Pick <span className="text-ink">Video</span> on <Link href="/dashboard" className="text-accent">Home</Link> to make one.
        </p>
      )}
      <ul className="mt-5 space-y-2">
        {rows?.map((row) => {
          const pipeline = isPipelineId(row.pipeline) ? PIPELINES[row.pipeline] : null;
          const Icon = pipeline ? PIPELINE_ICON[pipeline.icon] : null;
          return (
            <li key={row.id}>
              <Link href={`/dashboard/video/${row.id}`} className="flex items-center gap-3 rounded-[14px] border border-line/[0.08] bg-panel px-4 py-3 hover:border-line/[0.16]">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{row.title}</span>
                  <span className="text-[12px] text-muted">
                    {pipeline?.label} · {row.status} · v{row.current_version}
                  </span>
                </span>
                <span className="text-[12px] text-muted">{new Date(row.updated_at).toLocaleDateString()}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
