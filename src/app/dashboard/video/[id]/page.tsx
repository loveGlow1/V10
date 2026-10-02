"use client";

/* The Video Studio — Steps 3 to 8 for every pipeline.
 *
 *   3  the Creative Director makes the production plan
 *   4  the planned scenes, editable
 *   5  generation, through the router (needs connected engines)
 *   6  QA and automatic repair — shown as what was found and fixed
 *   7  preview: an animatic that plays the plan scene by scene
 *   8  export (script, plan), variation, and versions
 *
 * One page for all ten pipelines: what differs is in lib/video/pipelines.ts. */

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Loader2, Pause, Play, RotateCcw, ShieldCheck, Upload, Wand2, X } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PIPELINES, isPipelineId } from "@/lib/video/pipelines";
import { renderCost } from "@/lib/video/engines";
import { scriptText, totalSeconds, type ProductionPlan, type QaIssue, type Scene } from "@/lib/video/plan";

import { PIPELINE_ICON } from "../../components/video/VideoTypeGrid";

type Readiness = { ready: boolean; notes?: string[]; engines: { engine: string; label: string; health: string; required?: boolean }[] } | null;
type RenderRow = { scene: number; engine: string; status: string; error: string | null; url: string | null };
type Loaded = {
  video: { id: string; user_id: string; pipeline: string; title: string; brief: string; answers: Record<string, string>; status: string; current_version: number };
  latest: { version: number; plan: ProductionPlan; issues: QaIssue[]; note: string } | null;
  versions: { version: number; note: string; created_at: string }[];
  assets: { id: string; kind: string; storage_path: string }[];
  readiness: Readiness;
  renders: RenderRow[];
};

const STEPS = ["Type", "Questions", "Plan", "Scenes", "Generate", "QA", "Preview", "Export"];
const HEALTH: Record<string, string> = {
  available: "Connected",
  disabled: "Not switched on",
  misconfigured: "Key missing",
  "no-adapter": "Not connected yet",
  "not-configured": "Not configured on the server",
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VideoStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "plan" | "save" | "render" | "upload">(null);
  const [draft, setDraft] = useState<ProductionPlan | null>(null);
  const [issues, setIssues] = useState<QaIssue[]>([]);
  const [note, setNote] = useState("");
  const [renderResult, setRenderResult] = useState<{ ok: boolean; text: string } | null>(null);
  const autoPlanned = useRef(false);

  const load = useCallback(async (keepDraft = false) => {
    const response = await fetch(`/api/video/${id}`, { cache: "no-store" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as (Loaded & { error?: string }) | null;
    if (!response?.ok || !body?.video) {
      setError(body?.error ?? "Could not open this video.");
      return null;
    }
    setData(body);
    /* A background refresh while rendering must not throw away unsaved edits. */
    if (!keepDraft) {
      setDraft(body.latest?.plan ?? null);
      setIssues(body.latest?.issues ?? []);
    }
    return body;
  }, [id]);

  const plan = useCallback(
    async (payload: Record<string, unknown> = {}, kind: "plan" | "save" = "plan") => {
      setBusy(kind);
      setError(null);
      const response = await fetch(`/api/video/${id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
      if (!response?.ok) setError(body?.error ?? "The plan could not be made. Try again.");
      else {
        setNote("");
        await load();
      }
      setBusy(null);
    },
    [id, load],
  );

  useEffect(() => {
    void (async () => {
      const loaded = await load();
      /* Pipelines that need no reference are planned on arrival; the others
         wait for the upload step. */
      if (loaded && !loaded.latest && !autoPlanned.current && isPipelineId(loaded.video.pipeline) && !PIPELINES[loaded.video.pipeline].needsReference) {
        autoPlanned.current = true;
        void plan();
      }
    })();
  }, [load, plan]);

  const pipeline = data && isPipelineId(data.video.pipeline) ? PIPELINES[data.video.pipeline] : null;
  const dirty = useMemo(() => Boolean(draft && data?.latest && JSON.stringify(draft) !== JSON.stringify(data.latest.plan)), [draft, data]);

  const status = data?.video.status;
  const step = !data?.latest ? (busy === "plan" ? 2 : 1) : status === "ready" ? 7 : status === "rendering" ? 4 : 3;

  /* While a render runs, its jobs report in one by one; check every few seconds. */
  useEffect(() => {
    if (status !== "rendering") return;
    const timer = window.setInterval(() => void load(true), 6000);
    return () => window.clearInterval(timer);
  }, [status, load]);

  async function upload(files: FileList | null) {
    if (!files?.length || !data || !pipeline) return;
    setBusy("upload");
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      for (const file of Array.from(files).slice(0, 3)) {
        const path = `${data.video.user_id}/${id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error: upError } = await supabase.storage.from("video-assets").upload(path, file, { contentType: file.type });
        if (upError) throw upError;
        await supabase.from("video_assets").insert({ video_id: id, user_id: data.video.user_id, kind: pipeline.needsReference ?? "reference", storage_path: path, mime: file.type });
      }
      await load();
    } catch {
      setError("That file could not be uploaded. Images up to 10 MB work best.");
    }
    setBusy(null);
  }

  async function render(retryFailed = false) {
    setBusy("render");
    setRenderResult(null);
    const response = await fetch(`/api/video/${id}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; queued?: number; failed?: number; missing?: { label: string; health: string }[] } | null;
    if (response?.ok) {
      setRenderResult({ ok: true, text: `Rendering ${body?.queued ?? 0} jobs${body?.failed ? ` (${body.failed} could not be sent)` : ""}. Clips arrive one by one — usually within a few minutes.` });
      await load(true);
    }
    else
      setRenderResult({
        ok: false,
        text: body?.missing?.length
          ? `${body.error} Needed: ${body.missing.map((m) => `${m.label} (${HEALTH[m.health] ?? m.health})`).join(", ")}. Your plan, script and preview are ready to use meanwhile.`
          : (body?.error ?? "Could not start the render."),
      });
    setBusy(null);
  }

  const editScene = (n: number, patch: Partial<Scene>) =>
    setDraft((current) => (current ? { ...current, scenes: current.scenes.map((scene) => (scene.n === n ? { ...scene, ...patch } : scene)) } : current));

  if (error && !data) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <p className="text-soft">{error}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent">Back to Home</Link>
      </main>
    );
  }
  if (!data || !pipeline) {
    return (
      <main className="flex flex-1 items-center justify-center py-24 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }

  const Icon = PIPELINE_ICON[pipeline.icon];
  const shown = draft;

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-5 md:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            {Icon && <Icon className="h-3.5 w-3.5" />} {pipeline.label} · Video Studio
          </p>
          <h1 className="truncate text-[20px] font-semibold text-ink">{shown?.title ?? data.video.title}</h1>
        </div>
        {data.versions.length > 0 && (
          <span className="rounded-full border border-line/[0.08] px-3 py-1 text-[12px] text-muted">
            Version {data.latest?.version} of {data.versions.length}
          </span>
        )}
      </header>

      {/* Steps */}
      <ol className="mt-5 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
        {STEPS.map((label, index) => {
          const done = index < step + 1 && !(index === 4 && !renderResult?.ok);
          return (
            <li key={label} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] ${done ? "bg-layer/[0.08] text-ink" : "text-muted"}`}>
              {done ? <Check className="h-3 w-3" /> : <span className="w-3 text-center">{index + 1}</span>}
              {label}
            </li>
          );
        })}
      </ol>

      {error && <p role="alert" className="mt-4 rounded-[10px] border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[13px] text-danger">{error}</p>}

      {/* References, before the first plan for pipelines that use them */}
      {pipeline.needsReference && (
        <section className="mt-5 rounded-[16px] border border-line/[0.08] bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-medium text-ink">
                {pipeline.needsReference === "product" ? "Product references" : pipeline.needsReference === "person" ? "Your reference photos" : "Your photo"}
              </h2>
              <p className="text-[12.5px] text-muted">
                {pipeline.needsReference === "product"
                  ? "The product is locked to these images in every scene."
                  : pipeline.needsReference === "person"
                    ? "Used only to set up your presenter. You confirmed you have the right to this likeness and voice."
                    : "The source frame. Motion is added; the subject is kept."}{" "}
                {data.assets.length > 0 && `${data.assets.length} uploaded.`}
              </p>
            </div>
            <div className="flex gap-2">
              <label className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line/[0.1] bg-layer/[0.04] px-3.5 text-[13px] text-ink hover:bg-layer/[0.08]">
                {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
              </label>
              {!data.latest && (
                <button onClick={() => void plan()} disabled={busy !== null} className="flex h-9 items-center gap-2 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid disabled:opacity-50">
                  {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Create production plan
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {!shown && busy === "plan" && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center text-soft">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <p>The Creative Director is planning your {pipeline.label.toLowerCase()}…</p>
          <p className="text-[12.5px] text-muted">{pipeline.stages.join(" → ")}</p>
        </div>
      )}
      {!shown && busy !== "plan" && !pipeline.needsReference && (
        <div className="mt-10 text-center">
          <button onClick={() => void plan()} className="inline-flex h-10 items-center gap-2 rounded-full bg-solid px-5 text-[14px] font-medium text-onSolid">
            <Wand2 className="h-4 w-4" /> Create production plan
          </button>
        </div>
      )}

      {shown && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            {/* Step 3: the plan */}
            <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
              <h2 className="text-[14px] font-medium text-ink">Production plan</h2>
              <p className="mt-1 text-[12px] text-muted">
                {shown.aspect} · {totalSeconds(shown)}s of {shown.target}s · {shown.scenes.length} scenes
              </p>
              {shown.concept && <p className="mt-3 text-[13.5px] leading-relaxed text-soft">{shown.concept}</p>}
              {shown.strategy && (
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  <span className="text-soft">Strategy:</span> {shown.strategy}
                </p>
              )}
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                {shown.voice && (<div><dt className="inline text-muted">Voice: </dt><dd className="inline text-soft">{shown.voice}</dd></div>)}
                {shown.music && (<div><dt className="inline text-muted">Music: </dt><dd className="inline text-soft">{shown.music}</dd></div>)}
                {shown.cta && (<div><dt className="inline text-muted">CTA: </dt><dd className="inline text-soft">{shown.cta}</dd></div>)}
              </dl>
              {Object.keys(shown.locks).length > 0 && (
                <div className="mt-3 space-y-1">
                  {Object.entries(shown.locks).map(([key, value]) => (
                    <p key={key} className="text-[12.5px] text-muted">
                      <span className="mr-1 rounded bg-layer/[0.08] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-soft">{key} lock</span> {value}
                    </p>
                  ))}
                </div>
              )}
              {shown.hooks.length > 0 && (
                <div className="mt-3">
                  <p className="text-[12px] text-muted">Hook variations</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12.5px] text-soft">
                    {shown.hooks.map((hook) => (<li key={hook}>{hook}</li>))}
                  </ol>
                </div>
              )}
            </section>

            {/* Step 4: scenes */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-medium text-ink">Scenes</h2>
                {dirty && (
                  <div className="flex gap-2">
                    <button onClick={() => setDraft(data.latest?.plan ?? null)} className="h-8 rounded-full px-3 text-[12.5px] text-muted hover:text-ink">Discard</button>
                    <button onClick={() => void plan({ plan: draft }, "save")} disabled={busy !== null} className="flex h-8 items-center gap-1.5 rounded-full bg-solid px-3.5 text-[12.5px] font-medium text-onSolid disabled:opacity-50">
                      {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save as new version
                    </button>
                  </div>
                )}
              </div>
              {shown.scenes.map((scene) => (
                <article key={scene.n} className="rounded-[14px] border border-line/[0.08] bg-panel p-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-semibold text-ink">Scene {scene.n}</span>
                    <label className="flex items-center gap-1 text-muted">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={scene.duration}
                        onChange={(e) => editScene(scene.n, { duration: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                        className="w-12 rounded border border-line/[0.1] bg-transparent px-1 text-center text-ink"
                      />
                      s
                    </label>
                    <span className="rounded-full bg-layer/[0.08] px-2 py-0.5 uppercase tracking-wide text-soft">{scene.engine}</span>
                    {scene.shot && <span className="text-muted">{scene.shot}</span>}
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-soft">{scene.visual}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-[11.5px] text-muted">
                      On screen
                      <input value={scene.onScreenText} onChange={(e) => editScene(scene.n, { onScreenText: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]" />
                    </label>
                    <label className="text-[11.5px] text-muted">
                      Voiceover
                      <textarea rows={2} value={scene.voiceover} onChange={(e) => editScene(scene.n, { voiceover: e.target.value })} className="mt-0.5 w-full resize-y rounded-lg border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]" />
                    </label>
                  </div>
                  <details className="mt-2 text-[12px] text-muted">
                    <summary className="cursor-pointer select-none">Generation prompt{scene.sound ? " and sound" : ""}</summary>
                    <p className="mt-1 leading-relaxed">{scene.motionPrompt}</p>
                    {scene.sound && <p className="mt-1">Sound: {scene.sound}</p>}
                  </details>
                </article>
              ))}
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {/* Step 7: preview */}
            {data.renders.some((r) => r.engine === "video" && r.status === "done" && r.url) ? (
              <FinalCut plan={data.latest?.plan ?? shown} renders={data.renders} />
            ) : (
              <Animatic plan={shown} />
            )}

            {/* Step 5: generate */}
            <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
              <button
                onClick={() => void render()}
                disabled={busy !== null || dirty || status === "rendering"}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-solid text-[14px] font-medium text-onSolid disabled:opacity-50"
              >
                {busy === "render" || status === "rendering" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {status === "rendering" ? "Rendering…" : data.renders.length ? "Render again" : "Generate video"}
                {status !== "rendering" && data.latest && <span className="text-[12px] opacity-70">· {renderCost(data.latest.plan)} credits</span>}
              </button>
              {data.renders.length > 0 && <RenderProgress renders={data.renders} />}
              {data.renders.some((r) => r.status === "failed") && status !== "rendering" && (
                <button onClick={() => void render(true)} disabled={busy !== null} className="mt-2 flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /> Retry failed scenes
                </button>
              )}
              {data.readiness?.notes?.map((text) => (
                <p key={text} className="mt-2 text-[12px] leading-snug text-muted">{text}</p>
              ))}
              {dirty && <p className="mt-2 text-[12px] text-muted">Save your scene edits first.</p>}
              {renderResult && <p className={`mt-2 text-[12.5px] leading-relaxed ${renderResult.ok ? "text-emerald-400" : "text-soft"}`}>{renderResult.text}</p>}
              {data.readiness && (
                <ul className="mt-3 space-y-1">
                  {data.readiness.engines.map((engine) => (
                    <li key={engine.engine} className="flex justify-between text-[12px]">
                      <span className="text-soft">{engine.label}</span>
                      <span className={engine.health === "available" ? "text-emerald-400" : "text-muted"}>{HEALTH[engine.health] ?? engine.health}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Step 6: QA */}
            {issues.length > 0 && (
              <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
                <h2 className="flex items-center gap-1.5 text-[14px] font-medium text-ink"><ShieldCheck className="h-4 w-4" /> Checked and repaired</h2>
                <ul className="mt-2 space-y-1.5">
                  {issues.map((issue, index) => (
                    <li key={index} className="flex gap-2 text-[12.5px] leading-snug">
                      {issue.repaired ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />}
                      <span className="text-soft">{issue.scene ? `Scene ${issue.scene}: ` : ""}{issue.issue}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Revise, variation, export, versions */}
            <section className="space-y-3 rounded-[16px] border border-line/[0.08] bg-panel p-4">
              <div>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ask for a change — e.g. make the hook funnier"
                  className="w-full resize-none rounded-lg border border-line/[0.1] bg-transparent px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-muted focus:border-line/[0.25]"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => void plan({ note })} disabled={busy !== null || !note.trim()} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink disabled:opacity-40">
                    {busy === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Revise
                  </button>
                  <button onClick={() => void plan({ note: "Create a variation: a different hook and fresh visuals, keeping the same product, message, locks and length." })} disabled={busy !== null} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink disabled:opacity-40">
                    <RotateCcw className="h-3.5 w-3.5" /> Create variation
                  </button>
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted">A new plan uses 1 credit. Saving your own edits is free.</p>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-line/[0.06] pt-3">
                <button onClick={() => download(`${shown.title || "video"}-script.txt`, scriptText(shown), "text/plain")} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink">
                  <Download className="h-3.5 w-3.5" /> Script
                </button>
                <button onClick={() => download(`${shown.title || "video"}-plan.json`, JSON.stringify(shown, null, 2), "application/json")} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink">
                  <Download className="h-3.5 w-3.5" /> Plan (JSON)
                </button>
              </div>
              {data.versions.length > 1 && (
                <ul className="space-y-0.5 border-t border-line/[0.06] pt-3 text-[12px] text-muted">
                  {data.versions.slice(0, 8).map((v) => (
                    <li key={v.version} className={v.version === data.latest?.version ? "text-soft" : ""}>
                      v{v.version} · {v.note || "Plan"}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

/* Step 7 before any engine renders: the plan played as an animatic — each
   scene for its duration, its on-screen text over the frame and its line as
   a caption — so timing and script can be judged now. */
function Animatic({ plan }: { plan: ProductionPlan }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const total = Math.max(1, totalSeconds(plan));

  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - elapsed * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const t = (now - started) / 1000;
      if (t >= total) {
        setElapsed(total);
        setPlaying(false);
        return;
      }
      setElapsed(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  let acc = 0;
  const current = plan.scenes.find((scene) => {
    acc += scene.duration;
    return elapsed < acc;
  }) ?? plan.scenes[plan.scenes.length - 1];
  const ratio = plan.aspect === "9:16" ? "9 / 16" : plan.aspect === "1:1" ? "1 / 1" : plan.aspect === "4:5" ? "4 / 5" : "16 / 9";

  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-3">
      <div className="mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: ratio, maxHeight: 420 }}>
        <div key={current?.n} className="relative flex h-full w-full flex-col justify-between bg-gradient-to-br from-[#1b2340] via-[#121218] to-[#2a1630] p-4">
          <span className="text-[10.5px] uppercase tracking-wider text-white/50">Scene {current?.n} · {current?.shot}</span>
          <div className="text-center">
            {current?.onScreenText && <p className="text-[clamp(16px,4vw,22px)] font-bold leading-tight text-white">{current.onScreenText}</p>}
            <p className="mx-auto mt-2 line-clamp-3 max-w-[90%] text-[11.5px] leading-snug text-white/55">{current?.visual}</p>
          </div>
          <p className="min-h-[2.5em] rounded bg-black/50 px-2 py-1 text-center text-[12px] leading-snug text-white">{current?.voiceover}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <button
          onClick={() => {
            if (elapsed >= total) setElapsed(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play animatic"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-solid text-onSolid"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-layer/[0.1]">
          <div className="h-full bg-accent" style={{ width: `${(elapsed / total) * 100}%` }} />
        </div>
        <span className="w-14 text-right text-[11.5px] tabular-nums text-muted">
          {Math.floor(elapsed)}s / {total}s
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted">Animatic preview — timing, text and script. The rendered video replaces it once generation is connected.</p>
    </section>
  );
}

/* Where each scene's clip and voice line stand, one row per scene. */
function RenderProgress({ renders }: { renders: RenderRow[] }) {
  const scenes = [...new Set(renders.map((r) => r.scene))].sort((a, b) => a - b);
  const mark = (row?: RenderRow) =>
    !row ? null : row.status === "done" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : row.status === "failed" ? <X className="h-3.5 w-3.5 text-warn" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />;
  const done = renders.filter((r) => r.status === "done").length;
  return (
    <div className="mt-3">
      <p className="text-[12px] text-muted">{done} of {renders.length} jobs done</p>
      <ul className="mt-1.5 space-y-1">
        {scenes.map((n) => {
          const clip = renders.find((r) => r.scene === n && r.engine === "video");
          const voice = renders.find((r) => r.scene === n && r.engine === "voice");
          const failure = [clip, voice].find((r) => r?.status === "failed")?.error;
          return (
            <li key={n} className="text-[12px]">
              <span className="flex items-center gap-2 text-soft">
                Scene {n}
                <span className="flex items-center gap-1 text-muted">clip {mark(clip)}</span>
                {voice && <span className="flex items-center gap-1 text-muted">voice {mark(voice)}</span>}
              </span>
              {failure && <span className="block truncate text-[11.5px] text-muted" title={failure}>{failure}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Step 7 once clips exist: the cut, played scene by scene — each clip with its
   voice line and its on-screen text and caption over it. Assembled in the
   player rather than into one file: the clips and voice are real, the join is
   here. Each clip can be downloaded on its own. */
function FinalCut({ plan, renders }: { plan: ProductionPlan; renders: RenderRow[] }) {
  const scenes = plan.scenes
    .map((scene) => ({
      scene,
      clip: renders.find((r) => r.scene === scene.n && r.engine === "video" && r.status === "done")?.url ?? null,
      voice: renders.find((r) => r.scene === scene.n && r.engine === "voice" && r.status === "done")?.url ?? null,
    }))
    .filter((entry) => entry.clip);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = scenes[Math.min(index, scenes.length - 1)];
  const ratio = plan.aspect === "9:16" ? "9 / 16" : plan.aspect === "1:1" ? "1 / 1" : plan.aspect === "4:5" ? "4 / 5" : "16 / 9";

  useEffect(() => {
    if (!playing) return;
    void videoRef.current?.play().catch(() => setPlaying(false));
    if (audioRef.current && current?.voice) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {});
    }
  }, [index, playing, current?.voice]);

  /* A scene ends when its clip AND its line have ended: clips are at most 6s,
     so a longer line plays over the clip's held last frame. */
  const ended = useRef({ clip: false, voice: false });
  useEffect(() => {
    ended.current = { clip: false, voice: !current?.voice };
  }, [index, current?.voice]);
  function finish(part: "clip" | "voice") {
    ended.current[part] = true;
    if (!ended.current.clip || !ended.current.voice) return;
    if (index + 1 < scenes.length) setIndex(index + 1);
    else {
      setPlaying(false);
      setIndex(0);
    }
  }

  if (!current) return null;
  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-3">
      <div className="relative mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: ratio, maxHeight: 420 }}>
        <video
          ref={videoRef}
          key={current.clip}
          src={current.clip ?? undefined}
          playsInline
          muted={Boolean(current.voice)}
          className="h-full w-full object-cover"
          onEnded={() => finish("clip")}
        />
        {current.voice && <audio ref={audioRef} key={current.voice} src={current.voice} onEnded={() => finish("voice")} />}
        {current.scene.onScreenText && (
          <p className="pointer-events-none absolute inset-x-3 top-[38%] text-center text-[clamp(16px,4vw,24px)] font-bold leading-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,.7)]">
            {current.scene.onScreenText}
          </p>
        )}
        {current.scene.voiceover && (
          <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded bg-black/55 px-2 py-1 text-center text-[12px] leading-snug text-white">
            {current.scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "")}
          </p>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <button
          onClick={() => {
            if (playing) {
              videoRef.current?.pause();
              audioRef.current?.pause();
            }
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play the cut"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-solid text-onSolid"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="flex flex-1 gap-1">
          {scenes.map((entry, i) => (
            <button
              key={entry.scene.n}
              onClick={() => setIndex(i)}
              aria-label={`Scene ${entry.scene.n}`}
              className={`h-1.5 flex-1 rounded-full ${i === index ? "bg-accent" : i < index ? "bg-layer/[0.35]" : "bg-layer/[0.12]"}`}
            />
          ))}
        </div>
        <span className="text-[11.5px] tabular-nums text-muted">
          {index + 1}/{scenes.length}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {scenes.map((entry) => (
          <a key={entry.scene.n} href={entry.clip ?? "#"} download className="flex h-7 items-center gap-1 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-soft hover:text-ink">
            <Download className="h-3 w-3" /> Clip {entry.scene.n}
          </a>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted">
        {scenes.length < plan.scenes.length ? `${plan.scenes.length - scenes.length} scene(s) still missing. ` : ""}
        The cut plays the real clips and voice in order. A single MP4 export needs a compose engine — coming next.
      </p>
    </section>
  );
}
