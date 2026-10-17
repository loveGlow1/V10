"use client";

/* The Flier Studio — what the Fliers tab opens. Image generation, not a web
 * page: the brief is read into a flier spec (lib/flyers/brief.ts) and the
 * image models make it (lib/flyers/run.ts).
 *
 *   drafts   four quick variations of the brief
 *   pick     tap the one to take forward
 *   final    the chosen draft made again at full quality
 *   save     on a phone, the share sheet — "Save Image" puts it in Photos;
 *            on a computer, a .png download
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Loader2, RotateCcw, Sparkles } from "lucide-react";

type Image = { path: string; provider: string; url: string | null };
type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  stage: "preview" | "final";
  parentId: string | null;
  error: string | null;
  headline: string;
  format: "portrait" | "square" | "landscape" | "story";
  images: Image[];
  finals: { id: string; status: string; images: Image[] }[];
};

const RATIO: Record<Job["format"], string> = { portrait: "2 / 3", square: "1 / 1", landscape: "3 / 2", story: "9 / 16" };

function fileName(headline: string) {
  return `${(headline || "flier").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "flier"}.png`;
}

const isPhone = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent)));

export default function FlierStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "final" | "again" | "save">(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/flyers/${id}`, { cache: "no-store" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as (Job & { error?: string }) | null;
    if (!response?.ok || !body) {
      setError(body?.error ?? "This flier could not be opened.");
      return;
    }
    setJob(body);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Images arrive in tens of seconds; the page watches until they do. */
  const working = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [working, load]);

  async function makeFinal() {
    if (!job || !picked) return;
    setBusy("final");
    setNote(null);
    const response = await fetch("/api/flyers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "final", parentJobId: job.id, selectedPreviewPath: picked }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(null);
    if (!response?.ok || !body?.id) {
      setNote(body?.error ?? "The final could not be started. Try again.");
      return;
    }
    router.push(`/dashboard/fliers/${body.id}`);
  }

  async function save(image: Image) {
    if (!image.url || !job) return;
    setBusy("save");
    setNote(null);
    try {
      const blob = await (await fetch(image.url)).blob();
      const file = new File([blob], fileName(job.headline), { type: blob.type || "image/png" });
      if (isPhone() && navigator.canShare?.({ files: [file] })) {
        /* The share sheet's "Save Image" puts it straight into Photos. */
        await navigator.share({ files: [file], title: job.headline || "Flier" }).catch((reason: unknown) => {
          if ((reason as { name?: string })?.name !== "AbortError") throw reason;
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setNote(`Downloaded ${file.name}`);
      }
    } catch {
      setNote("The image could not be saved. Long-press it and choose Save to Photos instead.");
    }
    setBusy(null);
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <p className="text-soft">{error}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent">Back to Home</Link>
      </main>
    );
  }
  if (!job) {
    return (
      <main className="flex flex-1 items-center justify-center py-24 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }

  const final = job.stage === "final";
  const ratio = RATIO[job.format] ?? "2 / 3";
  const button =
    "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-opacity disabled:opacity-40";

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:px-6">
      <header className="flex items-center gap-3">
        <Link
          href={final && job.parentId ? `/dashboard/fliers/${job.parentId}` : "/dashboard/fliers"}
          aria-label={final ? "Back to the drafts" : "Back to your fliers"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted">{final ? "Final · Flier Studio" : "Drafts · Flier Studio"}</p>
          <h1 className="truncate text-[20px] font-semibold text-ink">{job.headline || "Your flier"}</h1>
        </div>
      </header>

      {working && (
        <div className="mt-6 flex items-center gap-2.5 rounded-2xl border border-line/[0.08] bg-layer/[0.03] px-4 py-3 text-[14px] text-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {final ? "Making your final at full quality — usually under a minute…" : "Designing four drafts — usually 20–40 seconds…"}
        </div>
      )}

      {job.status === "failed" && (
        <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-[14px] text-danger">
          {job.error ?? "The images could not be made."}
        </div>
      )}

      {/* Drafts: pick one. A final: the image, large, and Save. */}
      {final ? (
        <section className="mt-6 flex flex-col items-center gap-4">
          {job.images[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.images[0].url} alt={job.headline} className="max-h-[70vh] w-auto max-w-full rounded-2xl shadow-2xl" />
          ) : (
            <div className="w-full max-w-md animate-pulse rounded-2xl bg-layer/[0.06]" style={{ aspectRatio: ratio }} />
          )}
          {job.images[0]?.url && (
            <button type="button" onClick={() => void save(job.images[0])} disabled={busy === "save"} className={`${button} bg-accent text-onSolid`}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isPhone() ? "Save to Photos" : "Download PNG"}
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(job.images.length ? job.images : Array.from({ length: 4 }, () => null)).map((image, index) =>
              image?.url ? (
                <button
                  key={image.path}
                  type="button"
                  onClick={() => setPicked(image.path)}
                  aria-pressed={picked === image.path}
                  className={`relative overflow-hidden rounded-2xl border-2 transition ${picked === image.path ? "border-accent" : "border-transparent"}`}
                  style={{ aspectRatio: ratio }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={`Draft ${index + 1}`} className="h-full w-full object-cover" />
                  {picked === image.path && (
                    <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-onSolid">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              ) : (
                <div key={index} className="animate-pulse rounded-2xl bg-layer/[0.06]" style={{ aspectRatio: ratio }} />
              ),
            )}
          </section>

          {job.status === "done" && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void makeFinal()} disabled={!picked || busy !== null} className={`${button} bg-accent text-onSolid`}>
                {busy === "final" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make it final (HD)
              </button>
              {picked && (
                <button type="button" onClick={() => void save(job.images.find((image) => image.path === picked)!)} disabled={busy !== null} className={`${button} border border-line/[0.1] text-ink`}>
                  <Download className="h-4 w-4" /> Save this draft
                </button>
              )}
              <Link href="/dashboard" className={`${button} text-soft`}>
                <RotateCcw className="h-4 w-4" /> New brief
              </Link>
              {!picked && <p className="w-full text-[13px] text-muted">Tap the draft you like, then make it final.</p>}
            </div>
          )}

          {job.finals.length > 0 && (
            <section className="mt-8">
              <h2 className="text-[14px] font-medium text-ink">Finals</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                {job.finals.map((entry) => (
                  <Link key={entry.id} href={`/dashboard/fliers/${entry.id}`} className="w-28 overflow-hidden rounded-xl border border-line/[0.08]" style={{ aspectRatio: ratio }}>
                    {entry.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.images[0].url} alt="Final" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {note && <p className="mt-4 text-center text-[13px] text-soft">{note}</p>}
    </main>
  );
}
