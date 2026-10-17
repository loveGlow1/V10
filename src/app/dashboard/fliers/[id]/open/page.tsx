"use client";

/* Opening a flier in the workspace from Your fliers. A flier made there goes
 * straight back to its project; an older one is given a project first (see
 * /api/flyers/[id]/workspace). */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export default function OpenFlierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/flyers/${id}/workspace`, { method: "POST" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { projectId?: string; error?: string } | null;
        if (!live) return;
        if (!response.ok || !body?.projectId) throw new Error(body?.error ?? "This flier could not be opened.");
        router.replace(`/dashboard/project/${body.projectId}`);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, router]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center text-soft">
      {error ? (
        <>
          <p>{error}</p>
          <Link href="/dashboard/fliers" className="text-accent">Back to Your fliers</Link>
        </>
      ) : (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
          <p className="text-[13px] text-muted">Opening it in the workspace…</p>
        </>
      )}
    </main>
  );
}
