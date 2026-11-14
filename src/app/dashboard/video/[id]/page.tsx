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
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Download, History, ImagePlus, MessageSquare, Loader2, Paperclip, Plus, Pause, Play, RotateCcw, Scissors, ShieldCheck, Sparkles, Trash2, Wand2, X } from "lucide-react";

import SaveFileButton from "@/components/SaveFileButton";
import { ACCEPT_ATTRIBUTE, formatSeconds, handleFor } from "@/lib/video/assets";
import { uploadStudioFile } from "@/lib/video/upload-client";
import { DropHint, useFileDrop } from "@/lib/use-file-drop";
import type { VideoMessage } from "@/app/api/video/[id]/messages/route";
import { PIPELINES, isPipelineId } from "@/lib/video/pipelines";
import { scriptText, sourceSeconds, totalSeconds, type ProductionPlan, type QaIssue, type Scene } from "@/lib/video/plan";
import { sceneFromAsset, toggleReference, withContinuation } from "@/lib/video/timeline";

import CharactersPanel from "../../components/video/CharactersPanel";
import MediaPanel, { type PanelAsset } from "../../components/video/MediaPanel";
import TimelineClip from "../../components/video/TimelineClip";
import VideoSettings from "../../components/video/VideoSettings";
import { PIPELINE_ICON } from "../../components/video/VideoTypeGrid";

type Readiness = { ready: boolean; notes?: string[]; engines: { engine: string; label: string; health: string; required?: boolean }[] } | null;
type RenderRow = { scene: number | null; engine: string; status: string; error: string | null; url: string | null; created_at?: string; updated_at?: string };
type Loaded = {
  video: { id: string; user_id: string; pipeline: string; title: string; brief: string; answers: Record<string, string>; status: string; current_version: number };
  latest: { version: number; plan: ProductionPlan; issues: QaIssue[]; note: string } | null;
  versions: { version: number; note: string; created_at: string }[];
  assets: (PanelAsset & { storage_path: string })[];
  readiness: Readiness;
  renders: RenderRow[];
  cost: number;
  final: string | null;
  /** A long film kept as its parts, in order (lib/video/chapters.ts). */
  parts?: string[];
};

const STEPS = ["Type", "Questions", "Plan", "Scenes", "Generate", "QA", "Preview", "Export"];
const HEALTH: Record<string, string> = {
  available: "Connected",
  disabled: "Not switched on",
  misconfigured: "Key missing",
  "no-adapter": "Not connected yet",
  "not-configured": "Not configured on the server",
};

/* A file name from a title: the same rule the file routes use. */
const slug = (title: string) =>
  (title || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";

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
  const [busy, setBusy] = useState<null | "plan" | "save" | "render">(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductionPlan | null>(null);
  const [issues, setIssues] = useState<QaIssue[]>([]);
  const [note, setNote] = useState("");
  const [renderResult, setRenderResult] = useState<{ ok: boolean; text: string } | null>(null);
  const autoPlanned = useRef(false);
  const planAbort = useRef<AbortController | null>(null);

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
    async (payload: Record<string, unknown> = {}, kind: "plan" | "save" = "plan"): Promise<{ ok: boolean; error?: string; version?: number | null; message?: string }> => {
      setBusy(kind);
      setError(null);
      /* The AI agent picked in the editor (or the workspace) plans too. */
      let model = "auto";
      try {
        model = window.localStorage.getItem("qs-video-agent") || "auto";
      } catch {
        /* Auto. */
      }
      /* Stop aborts this request; the server stops the model with it and
         saves and charges nothing (lib/ai/llm.ts withStop). */
      const controller = new AbortController();
      planAbort.current = controller;
      const response = await fetch(`/api/video/${id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, ...payload }),
        signal: controller.signal,
      }).catch(() => null);
      planAbort.current = null;
      if (controller.signal.aborted) {
        setBusy(null);
        return { ok: false, error: "Stopped — nothing was changed or charged." };
      }
      const body = (await response?.json().catch(() => null)) as { error?: string; message?: string; edited?: boolean } | null;
      if (!response?.ok) {
        const message = body?.error ?? "The plan could not be made. Try again.";
        setError(message);
        setBusy(null);
        return { ok: false, error: message };
      }
      setNote("");
      const loaded = await load();
      setBusy(null);
      return { ok: true, version: loaded?.latest?.version ?? null, message: body?.edited ? body.message : undefined };
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

  /* Uploads are prepared on the server (probe, working copy, poster): check
     back until each is ready. */
  const preparing = Boolean(data?.assets.some((asset) => asset.status === "processing"));
  useEffect(() => {
    if (!preparing || status === "rendering") return;
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [preparing, status, load]);

  /* The timeline and settings, saved: what was made is reused, and the cut
     is made again, charged by its length (POST /timeline). */
  async function saveDraft() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    setSaved(null);
    const response = await fetch(`/api/video/${id}/timeline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: draft }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; message?: string; recut?: boolean } | null;
    if (!response?.ok) setError(body?.error ?? "Your changes could not be saved. Try again.");
    else {
      setSaved(body?.recut ? `${body.message ?? "Saved."}` : "Saved as a new version.");
      await load();
    }
    setBusy(null);
  }

  const assetById = (assetId: string) => data?.assets.find((asset) => asset.id === assetId);
  const moveScene = (n: number, by: -1 | 1) =>
    setDraft((current) => {
      if (!current) return current;
      const scenes = [...current.scenes];
      const at = scenes.findIndex((scene) => scene.n === n);
      const to = at + by;
      if (at < 0 || to < 0 || to >= scenes.length) return current;
      [scenes[at], scenes[to]] = [scenes[to], scenes[at]];
      return { ...current, scenes: scenes.map((scene, index) => ({ ...scene, n: index + 1 })), cut: renumberMuted(current, scenes) };
    });
  const removeScene = (n: number) =>
    setDraft((current) => {
      if (!current || current.scenes.length <= 1) return current;
      const scenes = current.scenes.filter((scene) => scene.n !== n);
      return { ...current, scenes: scenes.map((scene, index) => ({ ...scene, n: index + 1 })), cut: renumberMuted(current, scenes) };
    });
  const addAsset = (asset: PanelAsset) =>
    setDraft((current) => (current ? { ...current, scenes: [...current.scenes, sceneFromAsset(asset, current.scenes.length + 1)] } : current));
  const setMuted = (n: number, muted: boolean) =>
    setDraft((current) => {
      if (!current) return current;
      const list = new Set(current.cut?.muted ?? []);
      if (muted) list.add(n);
      else list.delete(n);
      return { ...current, cut: { ...(current.cut ?? {}), muted: [...list].sort((a, b) => a - b) } };
    });

  async function render(retryFailed = false) {
    setBusy("render");
    setRenderResult(null);
    const response = await fetch(`/api/video/${id}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; queued?: number; failed?: number; missing?: { label: string; health: string }[] } | null;
    if (response?.ok) {
      setRenderResult({ ok: true, text: `Generating ${body?.queued ?? 0} pieces${body?.failed ? ` (${body.failed} could not be sent)` : ""}. Clips arrive one by one — usually within a few minutes.` });
      await load(true);
    }
    else
      setRenderResult({
        ok: false,
        text: body?.missing?.length
          ? `${body.error} Needed: ${body.missing.map((m) => `${m.label} (${HEALTH[m.health] ?? m.health})`).join(", ")}. Your plan, script and preview are ready to use meanwhile.`
          : (body?.error ?? "Could not start generating."),
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
        <Link href={`/dashboard/video/${id}/edit`} className="flex h-9 items-center gap-2 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid">
          <Scissors className="h-4 w-4" /> Open editor
        </Link>
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

      {/* The person's own clips, sound and pictures — for every video. */}
      <MediaPanel
        videoId={id}
        assets={data.assets}
        title={
          pipeline.needsReference === "clips"
            ? "Your clips"
            : pipeline.needsReference === "product"
              ? "Product references and your media"
              : pipeline.needsReference === "person"
                ? "Your reference photos and media"
                : pipeline.needsReference === "photo"
                  ? "Your photo and media"
                  : "Your media"
        }
        description={
          pipeline.needsReference === "clips"
            ? "Upload the pieces of your video in order — they're stitched into one, with the transitions, sound and look you choose below."
            : pipeline.needsReference === "product"
              ? "The product is locked to these images in every scene. Add your own clips or music too."
              : pipeline.needsReference === "person"
                ? "Used only to set up your presenter. You confirmed you have the right to this likeness and voice."
                : pipeline.needsReference === "photo"
                  ? "The source frame: motion is added, the subject is kept."
                  : "Add your own clips, pictures or music — mix them with the generated scenes, or use your own song."
        }
        role={pipeline.needsReference === "product" || pipeline.needsReference === "person" || pipeline.needsReference === "photo" ? pipeline.needsReference : undefined}
        inTimeline={new Set((shown?.scenes ?? []).flatMap((scene) => (scene.source ? [scene.source.assetId] : [])))}
        musicAssetId={shown?.cut?.music?.source === "upload" ? shown.cut.music.assetId : null}
        onAdd={shown ? addAsset : undefined}
        onUseMusic={shown ? (asset) => setDraft((current) => (current ? { ...current, cut: { ...(current.cut ?? {}), music: asset ? { source: "upload", assetId: asset.id } : { source: "none" } } } : current)) : undefined}
        references={new Set(shown?.referenceClips ?? [])}
        onReference={shown ? (asset) => setDraft((current) => (current ? toggleReference(current, asset.id) : current)) : undefined}
        onContinue={shown ? (asset) => setDraft((current) => (current ? withContinuation(current, asset) : current)) : undefined}
        onChanged={() => load(true)}
      >
        {!data.latest && pipeline.needsReference && (
          <button
            onClick={() => void plan(pipeline.needsReference === "clips" ? { stitch: true } : {})}
            disabled={busy !== null || (pipeline.needsReference === "clips" && !data.assets.some((asset) => asset.status !== "failed" && asset.kind !== "audio" && asset.kind !== "render" && asset.kind !== "document"))}
            className="flex h-9 items-center gap-2 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid disabled:opacity-50"
          >
            {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : pipeline.needsReference === "clips" ? <Scissors className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
            {pipeline.needsReference === "clips" ? "Stitch my clips" : "Create production plan"}
          </button>
        )}
      </MediaPanel>

      <div className="mt-4">
        <CharactersPanel
          videoId={id}
          cast={shown?.characters ?? []}
          photos={data.assets}
          onCast={(cast) => {
            const ids = new Set(cast.map((c) => c.id));
            setDraft((current) =>
              current
                ? {
                    ...current,
                    characters: cast.length ? cast : undefined,
                    scenes: current.scenes.map((scene) => (scene.characters ? { ...scene, characters: scene.characters.filter((cid) => ids.has(cid)) } : scene)),
                  }
                : current,
            );
          }}
        />
      </div>

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
        /* The workspace: the video and its scenes, with the Director's chat
           beside them — ask for a change in words and get a new version, the
           way an app is edited. On a phone: the video, then the chat, then
           the scenes. */
        <div className="mt-5 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
            {/* Step 7: preview */}
            {data.final || data.renders.some((r) => (r.engine === "video" || r.engine === "avatar") && r.status === "done" && r.url) ? (
              <FinalCut plan={data.latest?.plan ?? shown} renders={data.renders} final={data.final} parts={data.parts ?? []} title={shown.title} />
            ) : (
              <Animatic plan={shown} />
            )}
            {/* Step 5: generate */}
            <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
              {/* Generate is for a video not yet made; changes after that make only what they need. */}
              {(!data.renders.length || status === "rendering") && (
              <button
                onClick={() => void render()}
                disabled={busy !== null || dirty || status === "rendering"}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-solid text-[14px] font-medium text-onSolid disabled:opacity-50"
              >
                {busy === "render" || status === "rendering" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {status === "rendering" ? "Generating…" : "Generate video"}
                {status !== "rendering" && data.latest && <span className="text-[12px] opacity-70">· {data.cost} credits</span>}
              </button>
              )}
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
          </div>

          <DirectorChat
            versions={data.versions}
            current={data.latest?.version ?? null}
            title={shown.title}
            scenes={shown.scenes.length}
            seconds={totalSeconds(shown)}
            renders={data.renders}
            status={status ?? ""}
            busy={busy}
            note={note}
            setNote={setNote}
            onAsk={(text) => plan({ note: text })}
            onStop={() => planAbort.current?.abort()}
            onRender={() => void render()}
            canRender={!dirty && status !== "rendering"}
            cost={data.cost}
            videoId={id}
            onUploaded={() => void load(true)}
          />

          <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-2">
            <VideoSettings plan={shown} audioAssets={data.assets} onChange={(next) => setDraft(next)} />
            {saved && !dirty && <p className="text-[12.5px] text-emerald-400">{saved}</p>}
            {/* Step 4: scenes — the timeline */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-medium text-ink">Scenes <span className="text-[12px] font-normal text-muted">· {formatSeconds(timelineSeconds(shown, data.assets))} · {shown.scenes.length}</span></h2>
                {dirty && (
                  <div className="flex gap-2">
                    <button onClick={() => setDraft(data.latest?.plan ?? null)} className="h-8 rounded-full px-3 text-[12.5px] text-muted hover:text-ink">Discard</button>
                    <button onClick={() => void saveDraft()} disabled={busy !== null || status === "rendering"} className="flex h-8 items-center gap-1.5 rounded-full bg-solid px-3.5 text-[12.5px] font-medium text-onSolid disabled:opacity-50">
                      {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {data.renders.length ? "Save and re-cut" : "Save as new version"}
                    </button>
                  </div>
                )}
              </div>
              {shown.scenes.map((scene) => (
                <article key={scene.n} className="rounded-[14px] border border-line/[0.08] bg-panel p-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-semibold text-ink">Scene {scene.n}</span>
                    <span className="ml-auto flex gap-1 sm:order-last">
                      <button onClick={() => moveScene(scene.n, -1)} disabled={scene.n === 1} aria-label={`Move scene ${scene.n} earlier`} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-layer/[0.08] hover:text-ink disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => moveScene(scene.n, 1)} disabled={scene.n === shown.scenes.length} aria-label={`Move scene ${scene.n} later`} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-layer/[0.08] hover:text-ink disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button onClick={() => removeScene(scene.n)} disabled={shown.scenes.length <= 1} aria-label={`Remove scene ${scene.n}`} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-layer/[0.08] hover:text-danger disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                    {scene.source ? null : (
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
                    )}
                    <span className="rounded-full bg-layer/[0.08] px-2 py-0.5 uppercase tracking-wide text-soft">{scene.source ? (scene.engine === "image" ? "your picture" : scene.engine === "avatar" ? "your clip · lip sync" : "your clip") : scene.engine}</span>
                    {scene.shot && <span className="text-muted">{scene.shot}</span>}
                  </div>
                  {scene.source ? (
                    <TimelineClip
                      source={scene.source}
                      asset={assetById(scene.source.assetId)}
                      muted={Boolean(shown.cut?.muted?.includes(scene.n))}
                      duration={scene.duration}
                      onSource={(source) => editScene(scene.n, { source, duration: sourceSeconds(source, assetById(scene.source!.assetId)?.durationS) ?? scene.duration })}
                      onMute={(muted) => setMuted(scene.n, muted)}
                      onDuration={(duration) => editScene(scene.n, { duration })}
                    />
                  ) : (
                    <p className="mt-2 text-[13px] leading-relaxed text-soft">{scene.visual}</p>
                  )}
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
                  {!scene.source && <details className="mt-2 text-[12px] text-muted">
                    <summary className="cursor-pointer select-none">Generation prompt{scene.sound ? " and sound" : ""}</summary>
                    <p className="mt-1 leading-relaxed">{scene.motionPrompt}</p>
                    {scene.sound && <p className="mt-1">Sound: {scene.sound}</p>}
                  </details>}
                  <SceneAsk n={scene.n} disabled={busy !== null} onAsk={(text) => void plan({ note: `Change only scene ${scene.n}, keep every other scene exactly as it is: ${text}` })} />
                </article>
              ))}
            </section>
            {/* Step 3: the plan */}
            <details className="group rounded-[16px] border border-line/[0.08] bg-panel p-4">
              <summary className="cursor-pointer select-none list-none text-[14px] font-medium text-ink">Production plan <span className="text-[12px] font-normal text-muted group-open:hidden">· show</span></summary>
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
            </details>
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
            <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
              <div className="flex flex-wrap gap-2 ">
                <button onClick={() => download(`${shown.title || "video"}-script.txt`, scriptText(shown), "text/plain")} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink">
                  <Download className="h-3.5 w-3.5" /> Script
                </button>
                <button onClick={() => download(`${shown.title || "video"}-plan.json`, JSON.stringify(shown, null, 2), "application/json")} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink">
                  <Download className="h-3.5 w-3.5" /> Plan (JSON)
                </button>
              </div>
            </section>
          </div>
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

/* What is being made, live: one bar for the whole job, the stages (clips,
   voice, music, the final file), and a tile per scene — each coloured by
   where it stands, with how long it has been running. The page polls while
   anything runs, so this moves on its own; failures are said once. */
function RenderProgress({ renders }: { renders: RenderRow[] }) {
  /* A clock for the live times: ticks while something runs. */
  const [now, setNow] = useState(() => Date.now());
  const running = renders.some((r) => r.status === "running" || r.status === "queued");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  useEffect(() => setSeenAt(Date.now()), [renders]);

  const total = renders.length;
  const done = renders.filter((r) => r.status === "done").length;
  const failed = renders.filter((r) => r.status === "failed");
  const active = renders.filter((r) => r.status === "running").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const scenes = [...new Set(renders.filter((r) => r.scene !== null).map((r) => r.scene))].sort((a, b) => (a ?? 0) - (b ?? 0)) as number[];
  const music = renders.find((r) => r.engine === "music");
  const compose = renders.find((r) => r.engine === "compose");
  const parts = renders.filter((r) => r.engine === "part");
  const since = (iso?: string) => (iso ? ago(now - new Date(iso).getTime()) : "");

  const stage = (label: string, rows: RenderRow[]) => {
    if (!rows.length) return null;
    const ok = rows.filter((r) => r.status === "done").length;
    const bad = rows.some((r) => r.status === "failed");
    const busy = rows.some((r) => r.status === "running" || r.status === "queued");
    return (
      <li key={label} className="flex items-center gap-2 rounded-lg bg-layer/[0.04] px-2.5 py-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok === rows.length ? "bg-emerald-400/15 text-emerald-400" : busy ? "bg-accent/15 text-accent" : bad ? "bg-warn/15 text-warn" : "bg-layer/[0.08] text-muted"}`}>
          {ok === rows.length ? <Check className="h-3 w-3" /> : busy ? <Loader2 className="h-3 w-3 animate-spin" /> : bad ? <X className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-current" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-soft">{label}</span>
        <span className="text-[11.5px] tabular-nums text-muted">{rows.length > 1 ? `${ok}/${rows.length}` : ok ? "done" : busy ? "working" : bad ? "failed" : "waiting"}</span>
      </li>
    );
  };

  return (
    <div className="mt-4 space-y-3">
      {/* The whole job. */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">
            {running ? "Making your video" : failed.length ? "Finished with gaps" : "All made"}
          </p>
          <p className="text-[11.5px] tabular-nums text-muted">
            {done}/{total} · {pct}%
          </p>
        </div>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-layer/[0.08]">
          <span className="h-full bg-emerald-400 transition-all duration-700" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
          <span className="h-full animate-pulse bg-accent/60 transition-all duration-700" style={{ width: `${(active / Math.max(1, total)) * 100}%` }} />
          <span className="h-full bg-warn/60 transition-all duration-700" style={{ width: `${(failed.length / Math.max(1, total)) * 100}%` }} />
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {running ? `Live · ${active} working now · updated ${ago(now - seenAt)} ago` : `Last change ${since(renders.map((r) => r.updated_at ?? "").sort().pop())} ago`}
        </p>
      </div>

      {/* The stages. */}
      <ul className="grid grid-cols-2 gap-1.5">
        {stage("Clips", renders.filter((r) => r.engine === "video" || r.engine === "avatar"))}
        {stage("Voice-over", renders.filter((r) => r.engine === "voice"))}
        {music && stage("Music", [music])}
        {parts.length > 0 && compose?.status !== "done" ? stage("Film parts", parts) : compose && stage("Final MP4", [compose])}
      </ul>

      {/* A tile per scene. */}
      {scenes.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11.5px] text-muted">Scenes</p>
          <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {scenes.map((n) => {
              const rows = renders.filter((r) => r.scene === n);
              const isDone = rows.every((r) => r.status === "done");
              const isBad = rows.some((r) => r.status === "failed");
              const isBusy = rows.some((r) => r.status === "running" || r.status === "queued");
              const live = rows.find((r) => r.status === "running");
              const what = rows.map((r) => `${r.engine === "video" ? "clip" : r.engine === "avatar" ? "lip sync" : r.engine}: ${r.status === "done" ? "made" : r.status === "failed" ? "not made" : r.status}`).join(" · ");
              return (
                <li
                  key={n}
                  title={`Scene ${n} — ${what}${live?.created_at ? ` · running ${since(live.created_at)}` : ""}`}
                  className={`relative flex h-9 flex-col items-center justify-center rounded-lg border text-[11.5px] tabular-nums transition-colors ${
                    isDone ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : isBusy ? "border-accent/30 bg-accent/[0.08] text-accent" : isBad ? "border-warn/25 bg-warn/[0.07] text-warn" : "border-line/[0.08] bg-layer/[0.03] text-muted"
                  }`}
                >
                  {n}
                  {isBusy && <span className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-accent/20"><span className="block h-full w-1/2 animate-pulse rounded-full bg-accent" /></span>}
                  {live?.created_at && <span className="absolute -top-1.5 right-0.5 rounded bg-panel px-0.5 text-[9px] text-muted">{since(live.created_at)}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* What did not work, said once. */}
      {failed.length > 0 && !running && (
        <p className="rounded-lg border border-warn/20 bg-warn/[0.06] px-3 py-2 text-[12px] text-soft">
          {failureSummary(failed)}
        </p>
      )}
    </div>
  );
}

/* "12s", "3m", "1h 5m". Pure. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ""}`.trim();
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* The failed jobs in one sentence: which scenes, and that nothing was charged. Pure. */
function failureSummary(failed: RenderRow[]): string {
  const scenes = [...new Set(failed.map((r) => r.scene).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  const declined = failed.some((r) => /sensitive|safety|moderation|policy/i.test(r.error ?? ""));
  const list = scenes.length > 6 ? `${scenes.length} scenes` : scenes.length === 1 ? `Scene ${scenes[0]}` : `Scenes ${scenes.slice(0, -1).join(", ")} and ${scenes[scenes.length - 1]}`;
  const extra = failed.some((r) => r.scene === null) ? (scenes.length ? " and the final steps" : "The final steps") : "";
  return `${scenes.length ? list : ""}${extra} weren't made${declined ? " — the engine declined some of them" : ""}. Nothing was charged for ${failed.length === 1 ? "it" : "them"}. Retry, or ask for a change first.`;
}

/* Step 7 once clips exist: the cut, played scene by scene — each clip with its
   voice line and its on-screen text and caption over it. Assembled in the
   player rather than into one file: the clips and voice are real, the join is
   here. Each clip can be downloaded on its own. */
function FinalCut({ plan, renders, final, parts, title }: { plan: ProductionPlan; renders: RenderRow[]; final: string | null; parts: string[]; title: string }) {
  if (parts.length > 1) return <FilmInParts parts={parts} plan={plan} title={title} />;
  if (final) return <FinishedVideo url={final} plan={plan} renders={renders} title={title} />;
  return <SceneByScene plan={plan} renders={renders} />;
}

/* The composed MP4: one file, played as itself, downloadable. Music that was
   kept out of the file (it would bury the voice) plays low under it. */
function FinishedVideo({ url, plan, renders, title }: { url: string; plan: ProductionPlan; renders: RenderRow[]; title: string }) {
  const music = renders.find((r) => r.engine === "music" && r.status === "done")?.url ?? null;
  const spoken = plan.scenes.some((scene) => scene.voiceover.trim());
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const ratio = plan.aspect === "9:16" ? "9 / 16" : plan.aspect === "1:1" ? "1 / 1" : plan.aspect === "4:5" ? "4 / 5" : "16 / 9";
  const withMusic = Boolean(music && spoken);
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = 0.18;
  }, [withMusic]);
  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-3">
      <div className="mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: ratio, maxHeight: 460 }}>
        <video
          ref={videoRef}
          src={url}
          controls
          playsInline
          className="h-full w-full object-contain"
          onPlay={() => withMusic && void musicRef.current?.play().catch(() => {})}
          onPause={() => musicRef.current?.pause()}
          onSeeked={() => {
            if (musicRef.current && videoRef.current) musicRef.current.currentTime = videoRef.current.currentTime;
          }}
        />
        {withMusic && music && <audio ref={musicRef} src={music} />}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <SaveFileButton url={url} name={`${slug(title)}.mp4`} type="video/mp4" className="flex h-9 items-center gap-1.5 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid">
          Download MP4
        </SaveFileButton>
        {withMusic && music && (
          <SaveFileButton url={music} name={`${slug(title)}-music.mp3`} type="audio/mpeg" className="flex h-9 items-center gap-1.5 rounded-full border border-line/[0.1] px-3.5 text-[13px] text-ink">
            Music track
          </SaveFileButton>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted">
        {withMusic ? "The MP4 carries the voice; music plays here and downloads as its own track. " : ""}Captions are not burned in — add them on the platform, or use the script.
      </p>
    </section>
  );
}

/* A long film kept as its parts: played straight through, one part after
   another, and each part saved on its own. */
function FilmInParts({ parts, plan, title }: { parts: string[]; plan: ProductionPlan; title: string }) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ratio = plan.aspect === "9:16" ? "9 / 16" : plan.aspect === "1:1" ? "1 / 1" : plan.aspect === "4:5" ? "4 / 5" : "16 / 9";
  useEffect(() => {
    if (playing) void videoRef.current?.play().catch(() => setPlaying(false));
  }, [at, playing]);
  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-3">
      <div className="mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: ratio, maxHeight: 460 }}>
        <video
          ref={videoRef}
          key={parts[at]}
          src={parts[at]}
          controls
          playsInline
          className="h-full w-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={(e) => !e.currentTarget.ended && setPlaying(false)}
          onEnded={() => (at + 1 < parts.length ? setAt(at + 1) : setPlaying(false))}
        />
      </div>
      <p className="mt-2 text-[12.5px] text-soft">Part {at + 1} of {parts.length} — plays straight on into the next.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {parts.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setAt(i)}
            className={`h-7 rounded-full border px-2.5 text-[12px] ${i === at ? "border-accent text-ink" : "border-line/[0.1] text-muted hover:text-ink"}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <SaveFileButton url={parts[at]} name={`${slug(title)}-part-${at + 1}.mp4`} type="video/mp4" className="flex h-9 items-center gap-1.5 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid">
          Download part {at + 1}
        </SaveFileButton>
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted">This film is long, so it is kept in parts that join seamlessly. Each part downloads as its own MP4.</p>
    </section>
  );
}

function SceneByScene({ plan, renders }: { plan: ProductionPlan; renders: RenderRow[] }) {
  const scenes = plan.scenes
    .map((scene) => {
      /* A lip-synced or avatar scene is the picture AND its line, so it plays
         with its own sound and no separate voice. */
      const talking = renders.find((r) => r.scene === scene.n && r.engine === "avatar" && r.status === "done")?.url ?? null;
      return {
        scene,
        clip: talking ?? renders.find((r) => r.scene === scene.n && r.engine === "video" && r.status === "done")?.url ?? null,
        voice: talking ? null : (renders.find((r) => r.scene === scene.n && r.engine === "voice" && r.status === "done")?.url ?? null),
      };
    })
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
        {scenes.map((entry) =>
          entry.clip ? (
            <SaveFileButton key={entry.scene.n} url={entry.clip} name={`clip-${entry.scene.n}.mp4`} type="video/mp4" iconClassName="h-3 w-3" className="flex h-7 items-center gap-1 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-soft hover:text-ink">
              Clip {entry.scene.n}
            </SaveFileButton>
          ) : null,
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted">
        {scenes.length < plan.scenes.length ? `${plan.scenes.length - scenes.length} scene(s) still missing. ` : ""}
        The cut plays the real clips and voice in order. A single MP4 export needs a compose engine — coming next.
      </p>
    </section>
  );
}

/* Why a render made nothing, in words a person can act on — never the
   provider's log line. */
function renderFailure(renders: RenderRow[]): string | null {
  const failed = renders.filter((render) => render.status === "failed");
  if (failed.length === 0 || renders.some((render) => render.status === "done" && render.url)) return null;
  const errors = failed.map((render) => render.error ?? "").join(" ");
  if (/payment required|402|insufficient|out of credit|quota|balance/i.test(errors)) {
    return "The video engine's account is out of credit, so no clips were made and nothing was charged. Once it's topped up, press Retry failed scenes — your plan is kept.";
  }
  if (/sensitive|safety|moderation|policy/i.test(errors)) {
    return "The video engine declined some scenes. Ask me to tone them down, then generate again.";
  }
  return "The clips could not be made this time and nothing was charged. Press Retry failed scenes, or ask me for a change first.";
}

/* A version's note, as the person said it. */
function spoken(note: string): string | null {
  if (!note || note === "First plan" || note === "Planned again") return null;
  if (note === "Your edits") return "I edited the scenes myself.";
  const scene = note.match(/^Change only scene (\d+), keep every other scene exactly as it is: ([\s\S]*)$/);
  if (scene) return `Scene ${scene[1]}: ${scene[2]}`;
  if (note.startsWith("Create a variation:")) return "Make a variation.";
  return note;
}

const QUICK = [
  { label: "Variation", note: "Create a variation: a different hook and fresh visuals, keeping the same product, message, locks and length." },
  { label: "Shorter", note: "Make it shorter and punchier — cut it to about 15 seconds, keeping the hook and the CTA." },
  { label: "Funnier hook", note: "Make the opening hook funnier and more scroll-stopping." },
  { label: "Different creator", note: "Use a different creator — a different look and voice — and keep them identical in every shot." },
];

/* The sessions of a video's chat, newest first, each named by its first request. Pure. */
type SessionItem = { session: number; title: string; when: string; group: string; count: number };

function sessionList(messages: VideoMessage[], active: number): SessionItem[] {
  const out: SessionItem[] = [];
  const today = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  /* Only sessions that hold something, and the one open now. */
  const numbers = [...new Set([...messages.map((m) => m.session), active])].sort((a, b) => b - a);
  for (const k of numbers) {
    const own = messages.filter((m) => m.session === k);
    const first = own.find((m) => m.role === "user") ?? own[0];
    const last = own[own.length - 1];
    const title = first ? first.text.split("\n")[0].slice(0, 80) : k === 1 ? "First session" : "New session";
    const at = last ? new Date(last.created_at) : today;
    const days = Math.round((day(today) - day(at)) / 86_400_000);
    const group = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
    const when = days <= 0 ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    out.push({ session: k, title, when: last ? when : "now", group, count: own.filter((m) => m.role === "user").length });
  }
  return out;
}

/* The Director's chat: every version as a turn of the conversation, the
   render's outcome said plainly, and a box to ask for the next change. */
function DirectorChat(props: {
  versions: { version: number; note: string; created_at: string }[];
  current: number | null;
  title: string;
  scenes: number;
  seconds: number;
  renders: RenderRow[];
  status: string;
  busy: string | null;
  note: string;
  setNote: (value: string) => void;
  onAsk: (text: string) => Promise<{ ok: boolean; error?: string; version?: number | null; message?: string }>;
  onRender: () => void;
  /** Stops the change being made, for real. */
  onStop: () => void;
  canRender: boolean;
  cost: number;
  /** For the paperclip: files go into this video's media, which the director reads. */
  videoId: string;
  onUploaded: () => void;
}) {
  const { versions, current, busy, note, setNote, onAsk } = props;
  /* Files attached to this message: uploaded into the video's media, and
     named in the message so the director knows they are for this change. */
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  /* The + menu: Add images, Add files. */
  const [addOpen, setAddOpen] = useState(false);
  const addMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !addMenu.current?.contains(event.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [addOpen]);
  /* Grows with what is typed, up to a third of a phone screen, then scrolls. */
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = composer.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 240)}px`;
  }, [note]);
  const [attached, setAttached] = useState<{ name: string; handle: string }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachError(null);
    for (const file of Array.from(files).slice(0, 9)) {
      setUploading(file.name);
      const result = await uploadStudioFile(props.videoId, file);
      if (!result.ok) {
        setAttachError(result.error);
        continue;
      }
      setAttached((list) => [...list, { name: file.name, handle: handleFor(file.name) }]);
    }
    setUploading(null);
    props.onUploaded();
  };
  /* A screenshot pasted, or files dropped on the box, attach like the paperclip. */
  const fileDrop = useFileDrop((files) => void attach(files), { disabled: busy !== null });
  /* The conversation, kept message by message in sessions (video_messages):
     what was asked drops into the chat and is stored the moment it is sent,
     and the Director's answer — a new version or why not — follows it. */
  const [messages, setMessages] = useState<VideoMessage[]>([]);
  const [session, setSession] = useState<number | null>(null);
  /* The list of sessions: open by default, folded away with one click, and
     remembered folded or open for next time. */
  const [showSessions, setShowSessions] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("qs-director-sessions") === "closed") setShowSessions(false);
    } catch {
      /* Open. */
    }
  }, []);
  const toggleSessions = () =>
    setShowSessions((open) => {
      try {
        window.localStorage.setItem("qs-director-sessions", open ? "closed" : "open");
      } catch {
        /* Not remembered. */
      }
      return !open;
    });
  useEffect(() => {
    let alive = true;
    void fetch(`/api/video/${props.videoId}/messages`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { messages?: VideoMessage[] } | null) => {
        if (alive && body?.messages) setMessages(body.messages);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [props.videoId]);
  const latestSession = messages.reduce((max, m) => Math.max(max, m.session), 1);
  const active = session ?? latestSession;
  const sessions = sessionList(messages, active);
  /* Deleting a session: asked once on the row, then gone — its messages,
     not the versions it made. The open one gives way to the newest left. */
  const [confirming, setConfirming] = useState<number | null>(null);
  /* One message out of the conversation (the version it made stays). */
  const removeMessage = async (messageId: string) => {
    const before = messages;
    setMessages((list) => list.filter((m) => m.id !== messageId));
    if (messageId.startsWith("local-")) return;
    const response = await fetch(`/api/video/${props.videoId}/messages?message=${encodeURIComponent(messageId)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setMessages(before);
  };
  const removeSession = async (number: number) => {
    setConfirming(null);
    const before = messages;
    setMessages((list) => list.filter((m) => m.session !== number));
    if (number === active) {
      const left = before.filter((m) => m.session !== number).reduce((max, m) => Math.max(max, m.session), 0);
      setSession(left || Math.max(latestSession, active) + 1);
    }
    const response = await fetch(`/api/video/${props.videoId}/messages?session=${number}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setMessages(before);
  };
  const shown = messages.filter((m) => m.session === active);
  /* Versions made before anything was kept here belong to the first session. */
  const firstKept = messages[0]?.created_at ?? null;
  const earlier = active === 1 ? [...versions].reverse().filter((v) => !firstKept || v.created_at < firstKept) : [];

  const keep = async (message: Omit<VideoMessage, "id" | "created_at">) => {
    const local: VideoMessage = { ...message, id: `local-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString() };
    setMessages((list) => [...list, local]);
    const response = await fetch(`/api/video/${props.videoId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { message?: VideoMessage } | null;
    if (body?.message) setMessages((list) => list.map((m) => (m.id === local.id ? body.message! : m)));
  };

  const ask = async (text: string) => {
    if (busy !== null) return;
    const number = active;
    setSession(number);
    void keep({ session: number, role: "user", text, version: null, failed: false });
    const result = await onAsk(text);
    await keep(
      result.ok
        ? { session: number, role: "director", text: result.message ?? (result.version ? `Done — here's version ${result.version}.` : "Done."), version: result.version ?? null, failed: false }
        : { session: number, role: "director", text: result.error ?? "That change could not be made. Nothing was charged — try again.", version: null, failed: true },
    );
  };

  const end = useRef<HTMLDivElement>(null);
  const failure = props.status !== "rendering" ? renderFailure(props.renders) : null;
  const rendered = props.renders.some((render) => render.status === "done" && render.url);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [versions.length, busy, failure, shown.length]);

  const send = () => {
    const text = note.trim();
    if ((!text && !attached.length) || busy !== null || uploading) return;
    const files = attached.length ? `\n\nUse the files I attached for this: ${attached.map((a) => a.handle).join(", ")}.` : "";
    /* Out of the box and into the chat at once. */
    setNote("");
    setAttached([]);
    void ask(`${text || "Use the files I attached."}${files}`);
  };

  const newSession = () => {
    setSession(Math.max(latestSession, active) + 1);
    setShowSessions(false);
    setNote("");
    setAttached([]);
  };

  return (
    <section
      aria-label="Ask the Director for changes"
      className="flex min-h-[320px] flex-col rounded-[16px] border border-line/[0.08] bg-panel lg:sticky lg:top-4 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:self-start"
    >
      <header className="flex items-center gap-2 border-b border-line/[0.06] px-4 py-3">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-[14px] font-medium text-ink">Director</h2>
        <button
          type="button"
          onClick={newSession}
          disabled={busy !== null || (shown.length === 0 && active > latestSession)}
          title="Start a new session — a fresh conversation; this one stays in the list"
          className="ml-auto flex h-7 items-center gap-1 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-ink transition hover:bg-layer/[0.08] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> New session
        </button>
      </header>

      <div className="border-b border-line/[0.06]">
        <button
          type="button"
          onClick={toggleSessions}
          aria-expanded={showSessions}
          aria-controls="director-sessions"
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted transition hover:text-ink"
        >
          <History className="h-3.5 w-3.5" />
          Sessions
          <span className="rounded-full bg-layer/[0.08] px-1.5 py-px text-[10.5px] normal-case tracking-normal text-soft">{sessions.length}</span>
          {!showSessions && (
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-normal normal-case tracking-normal text-soft">{sessions.find((item) => item.session === active)?.title}</span>
          )}
          <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform duration-200 ${showSessions ? "" : "-rotate-90"}`} />
        </button>
        <div id="director-sessions" className={`grid transition-[grid-template-rows] duration-200 ease-out ${showSessions ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <nav aria-label="Sessions" className="min-h-0 overflow-hidden">
            <ul className="max-h-60 overflow-y-auto px-2 pb-2">
              {sessions.map((item, i) => (
                <li key={item.session}>
                  {(i === 0 || sessions[i - 1].group !== item.group) && (
                    <p className="px-2 pb-1 pt-2 text-[10.5px] font-medium text-muted">{item.group}</p>
                  )}
                  <div className={`group relative flex items-center rounded-lg transition ${item.session === active ? "bg-layer/[0.08] text-ink" : "text-soft hover:bg-layer/[0.04] hover:text-ink"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                        setSession(item.session);
                      }}
                      aria-current={item.session === active ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-3 pr-1 text-left"
                    >
                      <span aria-hidden className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition ${item.session === active ? "bg-accent" : "bg-transparent"}`} />
                      <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${item.session === active ? "text-accent" : "text-muted group-hover:text-soft"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] leading-5">{item.title}</span>
                        <span className="block text-[10.5px] leading-4 text-muted">
                          {item.count ? `${item.count} ${item.count === 1 ? "message" : "messages"}` : "Empty"} · {item.when}
                        </span>
                      </span>
                    </button>
                    {item.count > 0 &&
                      (confirming === item.session ? (
                        <span className="flex shrink-0 items-center gap-1 pr-1.5">
                          <button type="button" onClick={() => void removeSession(item.session)} className="h-6 rounded-full bg-danger/[0.15] px-2 text-[11px] font-medium text-danger hover:bg-danger/[0.25]">
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} aria-label="Keep this session" className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-ink">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(item.session)}
                          disabled={busy !== null && item.session === active}
                          aria-label={`Delete the session “${item.title}”`}
                          title="Delete this session"
                          className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-layer/[0.1] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0 [@media(hover:none)]:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {earlier.map((turn) => {
          const said = spoken(turn.note);
          return (
            <div key={`v${turn.version}`} className="space-y-2">
              {said && <p className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-md bg-layer/[0.08] px-3 py-2 text-ink">{said}</p>}
              <p className="mr-6 text-soft">
                {turn.version === 1 ? "Here's the plan" : "Done — here's version " + turn.version}
                {turn.version === current ? ` · ${props.scenes} scenes, ${props.seconds}s.` : "."}
                {turn.version === current && !rendered && props.status !== "rendering" && " Generate it when you're happy."}
              </p>
            </div>
          );
        })}
        {active > 1 && shown.length === 0 && (
          /* An empty chat: one quiet line, nothing to read through. */
          <div className="flex h-full min-h-[120px] items-center justify-center">
            <p className="text-center text-[12.5px] text-muted">What would you like to change?</p>
          </div>
        )}
        {shown.map((message) => {
          const remove = (
            <button
              type="button"
              onClick={() => void removeMessage(message.id)}
              aria-label="Delete this message"
              title="Delete this message"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-layer/[0.1] hover:text-danger focus-visible:opacity-100 group-hover/msg:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          );
          return message.role === "user" ? (
            <div key={message.id} className="group/msg ml-8 flex items-start justify-end gap-1">
              {remove}
              <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-layer/[0.08] px-3 py-2 text-ink">{message.text}</p>
            </div>
          ) : (
            <div key={message.id} className="group/msg mr-6 flex items-start gap-1">
              <p className={message.failed ? "min-w-0 flex-1 rounded-xl border border-warn/25 bg-warn/[0.07] px-3 py-2 text-soft" : "min-w-0 flex-1 text-soft"}>
                {message.text}
                {!message.failed && message.version === current && (
                  <span className="mt-1 block text-[11px] text-muted">Version {message.version} · {props.scenes} scenes · {props.seconds}s</span>
                )}
              </p>
              {remove}
            </div>
          );
        })}
        {props.status === "rendering" && (
          <p className="flex items-center gap-2 text-soft"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating the clips — they arrive one by one, usually within a few minutes.</p>
        )}
        {failure && <p className="rounded-xl border border-warn/25 bg-warn/[0.07] px-3 py-2 text-soft">{failure}</p>}
        {busy === "plan" && (
          <p className="flex items-center gap-2 text-soft"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working on it…</p>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-line/[0.06] p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((quick) => (
            <button
              key={quick.label}
              type="button"
              onClick={() => void ask(quick.note)}
              disabled={busy !== null}
              /* A warm clay, like Claude's own: only these quick-ask chips. */
              className="h-7 rounded-full border border-[#E8915F]/40 bg-[#E8915F]/[0.12] px-2.5 text-[12px] font-medium text-[#F0A274] transition hover:border-[#E8915F]/70 hover:bg-[#E8915F]/[0.2] hover:text-[#F7B58C] active:scale-[0.98] disabled:opacity-40"
            >
              {quick.label}
            </button>
          ))}
        </div>
        {(attached.length > 0 || uploading || attachError) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {attached.map((a) => (
              <span key={a.handle} className="flex h-7 max-w-[220px] items-center gap-1 rounded-full border border-line/[0.1] bg-layer/[0.04] pl-2.5 pr-1 text-[11.5px] text-ink" title={a.name}>
                <span className="truncate">{a.handle}</span>
                <button type="button" onClick={() => setAttached((list) => list.filter((x) => x.handle !== a.handle))} aria-label={`Don't use ${a.name} for this change`} className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-ink"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {uploading && <span className="flex items-center gap-1 text-[11.5px] text-muted"><Loader2 className="h-3 w-3 animate-spin" /> {uploading}</span>}
            {attachError && <span role="alert" className="text-[11.5px] text-danger">{attachError}</span>}
          </div>
        )}
        {/* The composer, laid out like the workspace's own: the words get the
            full width on top and grow with what is typed, the paperclip and
            send (or stop) sit underneath, and the type is 16px so a phone
            never zooms in on it. */}
        <div
          {...fileDrop.zone}
          className="relative flex w-full flex-col rounded-[22px] border-[1.5px] border-line/[0.11] bg-sunken p-3 transition-colors focus-within:border-line/[0.22]"
        >
          <DropHint show={fileDrop.dragging} />
          <input ref={fileInput} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
          <input ref={imageInput} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
          <textarea
            ref={composer}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onPaste={fileDrop.onPaste}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line — as in the workspace.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            aria-label="Ask the Director for a change"
            placeholder="Ask for a change — e.g. make her sound more excited"
            className="max-h-60 min-h-[52px] w-full resize-none bg-transparent px-1 text-base leading-relaxed text-ink outline-none placeholder:text-faint sm:text-[14.5px]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div ref={addMenu} className="relative">
              <button
                type="button"
                onClick={() => setAddOpen((open) => !open)}
                disabled={busy !== null || Boolean(uploading)}
                aria-label="Add images or files"
                aria-haspopup="menu"
                aria-expanded={addOpen}
                title="Add images or files — or paste a screenshot, or drop files here"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-layer/[0.14] active:scale-[0.97] disabled:opacity-40 ${addOpen ? "bg-layer/[0.14]" : "bg-layer/[0.08]"}`}
              >
                <Plus className={`h-[18px] w-[18px] transition-transform ${addOpen ? "rotate-45" : ""}`} />
              </button>
              {addOpen && (
                <div role="menu" className="absolute bottom-11 left-0 z-20 w-48 overflow-hidden rounded-xl border border-line/[0.1] bg-panel p-1 shadow-xl shadow-black/30">
                  {(
                    [
                      ["Add images", ImagePlus, imageInput],
                      ["Add files", Paperclip, fileInput],
                    ] as const
                  ).map(([label, Icon, input]) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddOpen(false);
                        input.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] text-ink transition-colors hover:bg-layer/[0.08] focus-visible:bg-layer/[0.08] focus-visible:outline-none"
                    >
                      <Icon className="h-4 w-4 text-soft" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {busy === "plan" ? (
              /* Working: a stop sign inside a turning ring — pressing it stops
                 the change for real (nothing saved, nothing charged). */
              <button
                type="button"
                onClick={props.onStop}
                aria-label="Stop"
                title="Stop — nothing is changed or charged"
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-layer/[0.16] text-ink transition hover:bg-layer/[0.24] active:scale-[0.97]"
              >
                <span aria-hidden className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
                <span aria-hidden className="block h-[11px] w-[11px] rounded-[3px] bg-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={busy !== null || Boolean(uploading) || (!note.trim() && !attached.length)}
                aria-label="Send"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-[0.97] disabled:cursor-not-allowed ${note.trim() || attached.length ? "bg-solid/[0.88] text-onSolid hover:bg-solid" : "bg-layer/[0.1] text-ink/40"}`}
              >
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
        {/* Only before anything is made: after that, every change asked for
            makes just what it needs — there is no "make it all again". */}
        {props.current !== null && !rendered && (
        <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={props.onRender}
              disabled={busy !== null || !props.canRender}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-medium text-onSolid disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" /> Generate · {props.cost}
            </button>
        </div>
        )}
      </div>
    </section>
  );
}

/* "Change this scene" — a request about one scene, kept to that scene. */
function SceneAsk({ n, disabled, onAsk }: { n: number; disabled: boolean; onAsk: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1.5 text-[12px] text-accent hover:underline">
        <Wand2 className="h-3.5 w-3.5" /> Change this scene
      </button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onAsk(text.trim());
        setText("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`What should change in scene ${n}?`}
        className="h-10 min-w-[12rem] flex-1 rounded-xl border border-line/[0.1] bg-sunken px-3 text-base text-ink outline-none placeholder:text-faint focus:border-line/[0.25] sm:h-9 sm:text-[13px]"
      />
      <button type="submit" disabled={disabled || !text.trim()} className="h-9 rounded-full bg-solid px-3 text-[12.5px] font-medium text-onSolid disabled:opacity-40">
        Change
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className="h-9 w-9 rounded-full text-muted hover:text-ink">
        <X className="mx-auto h-4 w-4" />
      </button>
    </form>
  );
}

/* Mutes follow their scenes when the timeline is reordered or cut. */
function renumberMuted(plan: ProductionPlan, reordered: Scene[]): ProductionPlan["cut"] {
  if (!plan.cut?.muted?.length) return plan.cut;
  const muted = reordered.flatMap((scene, index) => (plan.cut?.muted?.includes(scene.n) ? [index + 1] : []));
  return { ...plan.cut, muted };
}

/* The timeline's running time: uploads by their trimmed length, the rest by plan. */
function timelineSeconds(plan: ProductionPlan, assets: PanelAsset[]): number {
  return plan.scenes.reduce((sum, scene) => {
    if (scene.source && scene.engine !== "image") {
      const asset = assets.find((a) => a.id === scene.source?.assetId);
      return sum + (sourceSeconds(scene.source, asset?.durationS) ?? scene.duration);
    }
    return sum + scene.duration;
  }, 0);
}
