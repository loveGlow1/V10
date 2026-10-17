"use client";

/* Your fliers — every brief from the Fliers tab, newest first. Each card is
 * the flier's final when one was made, else its first draft, and opens the
 * Flier Studio where it was made. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { FlierThumb, type FlierCard } from "../components/FlierThumb";

export default function FliersPage() {
  const [rows, setRows] = useState<FlierCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/flyers", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load your fliers.");
        setRows(body.fliers ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-6 md:px-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-[20px] font-semibold text-ink">Your fliers</h1>
      </div>
      {error && <p className="mt-6 text-soft">{error}</p>}
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
    </main>
  );
}
