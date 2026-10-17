"use client";

/* One flier on Home and on Your fliers: its final when one was made, else its
 * first draft, at the flier's own shape, opening the Flier Studio. */

import Link from "next/link";
import { Loader2 } from "lucide-react";

export type FlierCard = {
  id: string;
  finalId: string | null;
  projectId?: string | null;
  status: "queued" | "running" | "done" | "failed";
  headline: string;
  format: "portrait" | "square" | "landscape" | "story";
  created_at: string;
  thumb: string | null;
};

export const FLIER_RATIO: Record<FlierCard["format"], string> = { portrait: "2 / 3", square: "1 / 1", landscape: "3 / 2", story: "9 / 16" };

export function FlierThumb({ flier, className = "" }: { flier: FlierCard; className?: string }) {
  return (
    <Link
      /* Into the workspace, where it can be changed — straight to its project,
         or through /open, which gives an older flier one. */
      href={flier.projectId ? `/dashboard/project/${flier.projectId}` : `/dashboard/fliers/${flier.id}/open`}
      className={`group relative block overflow-hidden rounded-2xl border border-line/[0.08] bg-layer/[0.04] ${className}`}
      style={{ aspectRatio: FLIER_RATIO[flier.format] ?? "2 / 3" }}
    >
      {flier.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flier.thumb} alt={flier.headline || "Flier"} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
      ) : (
        <span className="flex h-full items-center justify-center px-3 text-center text-[12px] text-muted">
          {flier.status === "failed" ? "Could not be made" : <Loader2 className="h-4 w-4 animate-spin" />}
        </span>
      )}
      {flier.finalId && (
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-white">HD</span>
      )}
    </Link>
  );
}
