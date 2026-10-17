"use client";

/* The Flier Studio — what the Fliers tab opens. Image generation, not a web
 * page: the brief is read into a flier spec (lib/flyers/brief.ts) and the
 * image models make it (lib/flyers/run.ts).
 *
 *   drafts   four variations of the brief, each a finished image
 *   view     tap one to see it full size
 *   save     that exact image — on a phone, the share sheet ("Save Image"
 *            puts it in Photos); on a computer, a .png download
 *   more     four more variations of the same brief
 *
 * There is no separate "final": the models make each draft at full quality,
 * and a final made again from the brief came back as a different picture
 * rather than the one that was picked. What you see is what you save.
 * (Finals made before this still open here, read-only.)
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2, PenLine, RefreshCw, X } from "lucide-react";

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
  const [open, setOpen] = useState<Image | null>(null);
  const [busy, setBusy] = useState<null | "again" | "save">(null);
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

  /* Four more of the same brief, as a new flier of their own. */
  async function more() {
    if (!job) return;
    setBusy("again");
    setNote(null);
    const response = await fetch("/api/flyers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ again: job.id }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(null);
    if (!response?.ok || !body?.id) {
      setNote(body?.error ?? "More versions could not be started. Try again.");
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
          <p className="text-[12px] text-muted">{final ? "Final · Flier Studio" : "Flier Studio"}</p>
          <h1 className="truncate text-[20px] font-semibold text-ink">{job.headline || "Your flier"}</h1>
        </div>
      </header>

      {working && (
        <div className="mt-6 flex items-center gap-2.5 rounded-2xl border border-line/[0.08] bg-layer/[0.03] px-4 py-3 text-[14px] text-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {final ? "Making your final — usually under a minute…" : "Designing four versions — usually 20–40 seconds…"}
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
                  onClick={() => setOpen(image)}
                  aria-label={`See version ${index + 1} full size`}
                  className="relative overflow-hidden rounded-2xl border border-line/[0.08] transition hover:border-line/[0.2]"
                  style={{ aspectRatio: ratio }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={`Version ${index + 1}`} className="h-full w-full object-cover" />
                </button>
              ) : (
                <div key={index} className="animate-pulse rounded-2xl bg-layer/[0.06]" style={{ aspectRatio: ratio }} />
              ),
            )}
          </section>

          {job.status === "done" && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="w-full text-[13px] text-muted">Tap a version to see it full size and save it.</p>
              <button type="button" onClick={() => void more()} disabled={busy !== null} className={`${button} border border-line/[0.1] text-ink`}>
                {busy === "again" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                4 more versions
              </button>
              <Link href="/dashboard" className={`${button} text-soft`}>
                <PenLine className="h-4 w-4" /> New brief
              </Link>
            </div>
          )}

          {job.finals.length > 0 && (
            <section className="mt-8">
              <h2 className="text-[14px] font-medium text-ink">Made earlier</h2>
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

      {/* One version, full size — the exact image Save hands over. */}
      {open?.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Flier, full size"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt={job.headline} onClick={(event) => event.stopPropagation()} className="max-h-[75vh] w-auto max-w-full rounded-2xl" />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void save(open);
            }}
            disabled={busy === "save"}
            className={`${button} bg-accent text-onSolid`}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isPhone() ? "Save to Photos" : "Download PNG"}
          </button>
          {note && <p className="text-center text-[13px] text-white/70">{note}</p>}
        </div>
      )}
    </main>
  );
}
