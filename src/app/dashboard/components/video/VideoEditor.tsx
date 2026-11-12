"use client";

/* The visual editor — cut a video the way CapCut does, by hand.
 *
 *   preview    plays the timeline in the browser as it stands: each clip
 *              from its in-point at its speed and level, pictures moving,
 *              voice lines and the music under them, words on screen
 *   timeline   four tracks — video, words, voice, music — on one time axis:
 *              drag a clip to move it, drag its edges to trim, click to put
 *              the playhead there; split at the playhead, duplicate, delete,
 *              undo and redo
 *   inspector  whatever is selected: a clip's trim, speed, level, mute, its
 *              words and its voice line (another voice, made now, or the
 *              person's own recording); the music (made now from a prompt —
 *              with lyrics for a song — the person's file, or none)
 *   settings   every video setting (VideoSettings)
 *   AI         optional: ask in words; the proposal lands on the timeline to
 *              keep, change or undo. Nothing else here needs a model.
 *
 * Saving makes a new version and cuts it again from what was already made —
 * free. Export makes whatever is missing (generated scenes, voice lines) and
 * the final MP4. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  RotateCcw,
  Copy,
  Download,
  Loader2,
  Music,
  Pause,
  Play,
  Redo2,
  Scissors,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { formatSeconds } from "@/lib/video/assets";
import { resolveCut } from "@/lib/video/cut-settings";
import { canSplit, duplicateScene, moveScene, removeScene, segmentAt, segmentsFor, splitAt, timelineLength, trimEdge, withScenes, type Segment } from "@/lib/video/editor-timeline";
import type { ProductionPlan, Scene } from "@/lib/video/plan";
import { sceneFromAsset } from "@/lib/video/timeline";
import { REVIEW_COST, creditsLabel, cutCredits } from "@/lib/video/pricing";
import { VOICES, voiceLabel } from "@/lib/video/voices";

import { callableModels, isModelAvailable } from "@/app/dashboard/models";
import { MAX_SCENE_CAST, type PlanCharacter } from "@/lib/video/cast";
import { continuesFrom } from "@/lib/video/continuity";

import CharactersPanel from "./CharactersPanel";
import MediaPanel, { type PanelAsset } from "./MediaPanel";
import TimelineClip from "./TimelineClip";
import VideoSettings from "./VideoSettings";

type RenderRow = { scene: number | null; engine: string; status: string; error: string | null; url: string | null };
type Loaded = {
  video: { id: string; pipeline: string; title: string; status: string; current_version: number };
  latest: { version: number; plan: ProductionPlan } | null;
  assets: (PanelAsset & { storage_path: string })[];
  renders: RenderRow[];
  cost: number;
  final: string | null;
};
type Selection = { type: "scene"; n: number } | { type: "music" } | { type: "voice" } | null;
type Chat = { who: "you" | "ai"; text: string };

const RATIO: Record<string, string> = { "9:16": "9 / 16", "1:1": "1 / 1", "16:9": "16 / 9", "4:5": "4 / 5" };
const field = "w-full rounded-lg border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]";
const chip = "flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink hover:bg-layer/[0.08] disabled:opacity-40";

export default function VideoEditor({ id }: { id: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraftRaw] = useState<ProductionPlan | null>(null);
  const [past, setPast] = useState<ProductionPlan[]>([]);
  const [future, setFuture] = useState<ProductionPlan[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(40);
  const [busy, setBusy] = useState<null | "save" | "export" | "assist" | "music" | "voice" | "stitch">(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chat, setChat] = useState<Chat[]>([]);
  const [ask, setAsk] = useState("");
  /* The AI agent that answers — the same choice as the workspace's picker,
     remembered on this device. */
  const agents = useMemo(() => callableModels().filter((m) => isModelAvailable(m) && m.provider === "claude"), []);
  const [agent, setAgentRaw] = useState("auto");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("qs-video-agent");
      if (saved) setAgentRaw(saved);
    } catch {
      /* Private window: Auto. */
    }
  }, []);
  const setAgent = (id: string) => {
    setAgentRaw(id);
    try {
      window.localStorage.setItem("qs-video-agent", id);
    } catch {
      /* Not remembered. */
    }
  };
  /* Smart suggestions: after each save the AI looks the edit over and speaks
     only when something is worth changing. Charged per look (pricing.ts). */
  const [smart, setSmartRaw] = useState(true);
  const [suggestions, setSuggestions] = useState<{ title: string; why: string; plan: ProductionPlan; refilm: number[]; base: string }[]>([]);
  const [reviewed, setReviewed] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("qs-video-smart") === "off") setSmartRaw(false);
    } catch {
      /* On. */
    }
  }, []);
  const setSmart = (on: boolean) => {
    setSmartRaw(on);
    try {
      window.localStorage.setItem("qs-video-smart", on ? "on" : "off");
    } catch {
      /* Not remembered. */
    }
  };
  /* Scenes taken out, kept here to put back with one tap. */
  const [removed, setRemoved] = useState<{ scene: Scene; index: number }[]>([]);

  const load = useCallback(
    async (keepDraft = false) => {
      const response = await fetch(`/api/video/${id}`, { cache: "no-store" }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as (Loaded & { error?: string }) | null;
      if (!response?.ok || !body?.video) {
        setError(body?.error ?? "Could not open this video.");
        return null;
      }
      setData(body);
      if (!keepDraft) {
        setDraftRaw(body.latest?.plan ?? null);
        setPast([]);
        setFuture([]);
      }
      return body;
    },
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.video.status;
  const preparing = Boolean(data?.assets.some((a) => a.status === "processing"));
  useEffect(() => {
    if (status !== "rendering" && !preparing) return;
    const timer = window.setInterval(() => void load(true), status === "rendering" ? 5000 : 4000);
    return () => window.clearInterval(timer);
  }, [status, preparing, load]);

  /* Every change goes through here, so it can be undone. */
  const change = useCallback(
    (next: ProductionPlan | null | ((current: ProductionPlan) => ProductionPlan | null)) => {
      setDraftRaw((current) => {
        if (!current) return current;
        const value = typeof next === "function" ? next(current) : next;
        if (!value || value === current) return current;
        setPast((p) => [...p.slice(-60), current]);
        setFuture([]);
        return value;
      });
    },
    [],
  );
  const undo = () => {
    if (!past.length || !draft) return;
    setFuture((f) => [draft, ...f]);
    setDraftRaw(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || !draft) return;
    setPast((p) => [...p, draft]);
    setDraftRaw(future[0]);
    setFuture((f) => f.slice(1));
  };

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const segments = useMemo(() => (draft ? segmentsFor(draft, assets, data?.renders ?? []) : []), [draft, assets, data]);
  const total = timelineLength(segments);
  const dirty = Boolean(draft && data?.latest && JSON.stringify(draft) !== JSON.stringify(data.latest.plan));
  const cut = draft ? resolveCut(draft) : null;
  const musicUrl = useMemo(() => {
    if (!draft || !cut || cut.music.source === "none") return null;
    if (cut.music.source === "upload") return assets.find((a) => a.id === cut.music.assetId)?.url ?? null;
    return data?.renders.find((r) => r.engine === "music" && r.status === "done")?.url ?? null;
  }, [draft, cut, assets, data]);

  /* ── Playback ──────────────────────────────────────────────────────── */
  const clock = useRef<{ t0: number; from: number } | null>(null);
  useEffect(() => {
    if (!playing) return;
    clock.current = { t0: performance.now(), from: time >= total ? 0 : time };
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const c = clock.current;
      if (!c) return;
      const t = c.from + (now - c.t0) / 1000;
      if (t >= total) {
        setTime(total);
        setPlaying(false);
        return;
      }
      if (now - last > 66) {
        last = now;
        setTime(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);
  const seek = (t: number) => {
    const value = Math.max(0, Math.min(total, t));
    setTime(value);
    if (playing) clock.current = { t0: performance.now(), from: value };
  };

  const current = segmentAt(segments, time);
  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const loaded = useRef<{ video?: string; voice?: string; music?: string }>({});

  useEffect(() => {
    const seg = current?.segment;
    const offset = current?.offset ?? 0;
    const video = videoRef.current;
    if (video) {
      if (seg?.kind === "video" && seg.mediaUrl) {
        if (loaded.current.video !== seg.mediaUrl) {
          loaded.current.video = seg.mediaUrl;
          video.src = seg.mediaUrl;
        }
        const expected = seg.from + offset * seg.speed;
        if (Math.abs(video.currentTime - expected) > 0.3) video.currentTime = expected;
        video.playbackRate = seg.speed;
        video.volume = Math.max(0, Math.min(1, seg.volume * (cut && (cut.audio === "voiceover" && seg.voiceUrl) ? 0.22 : cut?.audio === "none" ? 0 : 1)));
        if (playing && video.paused) void video.play().catch(() => {});
        if (!playing && !video.paused) video.pause();
      } else if (!video.paused) video.pause();
    }
    const voice = voiceRef.current;
    if (voice) {
      const url = cut?.audio === "original" || cut?.audio === "none" ? null : seg?.voiceUrl ?? null;
      if (url) {
        if (loaded.current.voice !== url) {
          loaded.current.voice = url;
          voice.src = url;
        }
        const expected = offset - 0.15;
        if (expected < 0 || (voice.duration && expected > voice.duration)) {
          if (!voice.paused) voice.pause();
        } else {
          if (Math.abs(voice.currentTime - expected) > 0.3) voice.currentTime = expected;
          voice.volume = Math.min(1, cut?.voiceVolume ?? 1);
          if (playing && voice.paused) void voice.play().catch(() => {});
          if (!playing && !voice.paused) voice.pause();
        }
      } else if (!voice.paused) voice.pause();
    }
    const music = musicRef.current;
    if (music) {
      if (musicUrl && cut) {
        if (loaded.current.music !== musicUrl) {
          loaded.current.music = musicUrl;
          music.src = musicUrl;
        }
        const expected = time + (cut.music.source === "upload" ? cut.music.start : 0);
        if (Math.abs(music.currentTime - expected) > 0.4) music.currentTime = expected;
        const spoken = Boolean(seg?.voiceUrl) && cut.audio !== "original";
        music.volume = Math.max(0, Math.min(1, cut.musicVolume * (spoken && cut.duck ? 0.18 : spoken ? 0.3 : 0.7)));
        if (playing && music.paused) void music.play().catch(() => {});
        if (!playing && !music.paused) music.pause();
      } else if (!music.paused) music.pause();
    }
  }, [current, time, playing, cut, musicUrl]);

  /* ── Saving and export ─────────────────────────────────────────────── */
  async function save(): Promise<boolean> {
    if (!draft) return false;
    setBusy("save");
    setError(null);
    const response = await fetch(`/api/video/${id}/timeline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: draft }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; message?: string; recut?: boolean } | null;
    setBusy(null);
    if (!response?.ok) {
      setError(body?.error ?? "Your edit could not be saved. Try again.");
      return false;
    }
    setNote(body?.recut ? `${body.message ?? "Saved."}` : "Saved.");
    const saved = draft;
    await load();
    if (smart) void review(saved, true);
    return true;
  }

  /* The AI's look over the edit. Quiet unless something is worth saying. */
  async function review(plan: ProductionPlan, automatic = false) {
    if (!automatic) setBusy("assist");
    const response = await fetch(`/api/video/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, model: agent }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { quiet?: boolean; skipped?: string; suggestions?: { title: string; why: string; plan: ProductionPlan; refilm: number[] }[]; charged?: number } | null;
    if (!automatic) setBusy(null);
    if (!response?.ok || !body) return;
    if (body.skipped === "credits") {
      if (!automatic) setReviewed("Top up to have the AI look over your edit.");
      return;
    }
    const base = JSON.stringify(plan);
    setSuggestions((body.suggestions ?? []).map((sugg) => ({ ...sugg, base })));
    setReviewed(body.quiet ? `Looked over — all good${body.charged ? ` · ${creditsLabel(body.charged)}` : ""}.` : body.charged ? `${creditsLabel(body.charged)} for the look-over.` : null);
  }

  async function applySuggestion(index: number) {
    const sugg = suggestions[index];
    if (!sugg || !draft) return;
    setSuggestions((list) => list.filter((_, i) => i !== index));
    /* Made against the timeline as it was: applied as it is when nothing
       has changed since, otherwise asked again against what is there now. */
    if (JSON.stringify(draft) === sugg.base) change(sugg.plan);
    else await assistWith(sugg.why);
  }

  async function exportVideo() {
    if (dirty && !(await save())) return;
    const fresh = await load(true);
    if (fresh && fresh.renders.length && !dirty) {
      setNote(fresh.final ? "Your video is ready below." : "It's being cut — it appears here when it's done.");
      if (fresh.video.status === "rendering" || fresh.final) return;
    }
    if (fresh?.renders.length) return;
    setBusy("export");
    const response = await fetch(`/api/video/${id}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!response?.ok) setError(body?.error ?? "The export could not start.");
    else setNote("Exporting — the finished video appears here when it's done.");
    await load(true);
  }

  async function stitch() {
    setBusy("stitch");
    const response = await fetch(`/api/video/${id}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stitch: true }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!response?.ok) setError(body?.error ?? "Could not start the timeline.");
    await load();
  }

  async function assist() {
    await assistWith(ask.trim());
  }

  async function assistWith(text: string) {
    if (!text || !draft) return;
    setBusy("assist");
    setChat((c) => [...c, { who: "you", text }]);
    setAsk("");
    const response = await fetch(`/api/video/${id}/assist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: text, plan: draft, model: agent }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; reply?: string; plan?: ProductionPlan | null; refilm?: number[]; agent?: { name: string; declined?: string }; charged?: number } | null;
    setBusy(null);
    if (!response?.ok) {
      setChat((c) => [...c, { who: "ai", text: body?.error ?? "The AI editor couldn't answer just now." }]);
      return;
    }
    if (body?.plan) change(body.plan);
    setChat((c) => [
      ...c,
      { who: "ai", text: `${body?.agent?.declined ? `(${body.agent.name} answered — ${body.agent.declined}.) ` : ""}${body?.reply ?? "Done."}${body?.plan ? " It's on the timeline — keep it, change it, or Undo." : ""}${body?.refilm?.length ? ` Scene${body.refilm.length === 1 ? "" : "s"} ${body.refilm.join(", ")} will be filmed again on export.` : ""}` },
    ]);
  }

  async function makeAudio(payload: Record<string, unknown>): Promise<PanelAsset | null> {
    setBusy(payload.type === "music" ? "music" : "voice");
    setError(null);
    const response = await fetch(`/api/video/${id}/audio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string; asset?: PanelAsset; charged?: number } | null;
    setBusy(null);
    if (!response?.ok || !body?.asset) {
      setError(body?.error ?? "That could not be made just now.");
      return null;
    }
    setNote(`Made — ${body.charged ?? 1} credit${body.charged === 1 ? "" : "s"}.`);
    await load(true);
    return body.asset;
  }

  /* ── Keyboard: space, S, Delete, ⌘Z / ⇧⌘Z ──────────────────────────── */
  const selected = selection?.type === "scene" ? draft?.scenes.find((s) => s.n === selection.n) ?? null : null;
  const takeOut = (n: number) => {
    if (!draft || draft.scenes.length <= 1) return;
    const index = draft.scenes.findIndex((s) => s.n === n);
    if (index < 0) return;
    setRemoved((r) => [{ scene: draft.scenes[index], index }, ...r].slice(0, 30));
    change((p) => removeScene(p, n));
    setSelection(null);
  };
  const putBack = (entry: { scene: Scene; index: number }) => {
    change((p) => withScenes(p, [...p.scenes.slice(0, entry.index), entry.scene, ...p.scenes.slice(entry.index)]));
    setRemoved((r) => r.filter((x) => x !== entry));
  };
  const splitHere = () => {
    if (!draft || !current) return;
    const next = splitAt(draft, current.segment.n, current.offset, assets);
    if (next) {
      change(next);
      setSelection({ type: "scene", n: current.segment.n + 1 });
    } else setNote(canSplit(draft.scenes.find((s) => s.n === current.segment.n)!) ? "Move the playhead further inside the clip to split it." : "Generated scenes can't be split; trim them instead.");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((p) => !p);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey) splitHere();
      else if ((event.key === "Delete" || event.key === "Backspace") && selected) takeOut(selected.n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error && !data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-soft">{error}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent">Back to Home</Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex flex-1 items-center justify-center py-24 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }

  const audioAssets = assets.filter((a) => a.kind === "audio" && a.status !== "failed");
  const rendering = status === "rendering";
  const renderRows = data.renders.filter((r) => r.scene !== null || r.engine !== "compose");
  const doneRows = renderRows.filter((r) => r.status === "done").length;

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1400px] flex-1 px-3 pb-16 pt-4 md:px-5">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/video/${id}`} aria-label="Back to the studio" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.08] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1 basis-[60%] sm:basis-auto">
          <p className="text-[11.5px] text-muted">Editor · {formatSeconds(total)} · {draft?.scenes.length ?? 0} scene{draft?.scenes.length === 1 ? "" : "s"}</p>
          <h1 className="truncate text-[17px] font-semibold text-ink">{draft?.title ?? data.video.title}</h1>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <button onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (⌘Z)" className={chip}><Undo2 className="h-3.5 w-3.5" /></button>
        <button onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (⇧⌘Z)" className={chip}><Redo2 className="h-3.5 w-3.5" /></button>
        <button onClick={() => setShowSettings((s) => !s)} disabled={!draft} className={chip}><SlidersHorizontal className="h-3.5 w-3.5" /> Settings</button>
        <button onClick={() => void save()} disabled={!dirty || busy !== null || rendering} className={chip}>
          {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save{data.renders.length && dirty ? ` · re-cut ${creditsLabel(cutCredits(total))}` : ""}
        </button>
        <button onClick={() => void exportVideo()} disabled={!draft || busy !== null || rendering} className="flex h-8 items-center gap-1.5 rounded-full bg-solid px-3.5 text-[12.5px] font-medium text-onSolid disabled:opacity-50">
          {busy === "export" || rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {rendering ? `Exporting ${doneRows}/${renderRows.length}` : data.renders.length ? "Save & export" : `Export${data.cost ? ` · ${data.cost} credit${data.cost === 1 ? "" : "s"}` : ""}`}
        </button>
        </div>
      </header>
      {error && <p role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      {note && !error && <p className="mt-3 text-[12.5px] text-emerald-400">{note}</p>}
      {data.final && !rendering && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-soft">
          Finished video:
          <a href={`/api/video/${id}/file?v=${data.video.current_version}`} target="_blank" rel="noopener" className="text-accent underline">play</a>
          <a href={`/api/video/${id}/file?v=${data.video.current_version}&download=1`} className="text-accent underline">download MP4</a>
        </p>
      )}

      {!draft ? (
        <div className="mt-4">
          <MediaPanel videoId={id} assets={assets} title="Your clips" description="Upload the pieces of your video. They go on the timeline in the order you add them." inTimeline={new Set()} onChanged={() => load(true)}>
            <button onClick={() => void stitch()} disabled={busy !== null || !assets.some((a) => a.kind !== "audio" && a.kind !== "render" && a.status !== "failed")} className="flex h-9 items-center gap-2 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid disabled:opacity-50">
              {busy === "stitch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />} Put them on the timeline
            </button>
          </MediaPanel>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Preview */}
            <section className="min-w-0 rounded-[16px] border border-line/[0.08] bg-panel p-3">
              <Preview plan={draft} segment={current?.segment ?? null} offset={current?.offset ?? 0} videoRef={videoRef} />
              <audio ref={voiceRef} preload="auto" />
              <audio ref={musicRef} preload="auto" />
              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={() => seek(0)} aria-label="To the start" className="flex h-8 w-8 items-center justify-center rounded-full text-soft hover:text-ink"><SkipBack className="h-4 w-4" /></button>
                <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} className="flex h-9 w-9 items-center justify-center rounded-full bg-solid text-onSolid">
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <span className="text-[12px] tabular-nums text-muted">{formatSeconds(time)} / {formatSeconds(total)}</span>
                <span className="ml-auto hidden text-[11px] text-muted sm:inline">Preview — transitions and colour are added on export.</span>
              </div>
              <Storyboard
                plan={draft}
                segments={segments}
                assets={assets}
                selected={selected?.n ?? null}
                current={current?.segment.n ?? null}
                removed={removed}
                onSelect={(n) => {
                  setSelection({ type: "scene", n });
                  const seg = segments.find((s) => s.n === n);
                  if (seg) seek(seg.start);
                }}
                onMove={(n, by) => change((p) => moveScene(p, n, p.scenes.findIndex((s) => s.n === n) + by))}
                onRemove={takeOut}
                onPutBack={putBack}
              />
            </section>

            {/* Inspector */}
            <aside className="min-w-0 space-y-3">
              {selection?.type === "scene" && selected ? (
                <SceneInspector
                  scene={selected}
                  plan={draft}
                  assets={assets}
                  audioAssets={audioAssets}
                  busy={busy}
                  canSplitHere={Boolean(current && current.segment.n === selected.n && canSplit(selected))}
                  onChange={(next) => change(next)}
                  onSplit={splitHere}
                  onRemove={takeOut}
                  onClose={() => setSelection(null)}
                  makeVoice={async (text, voiceId) => {
                    const asset = await makeAudio({ type: "voice", text, voiceId });
                    if (asset) change((p) => ({ ...p, scenes: p.scenes.map((s) => (s.n === selected.n ? { ...s, voiceover: text, voiceId, voiceAsset: asset.id } : s)) }));
                  }}
                />
              ) : selection?.type === "music" || selection?.type === "voice" ? (
                <SoundInspector
                  plan={draft}
                  audioAssets={audioAssets}
                  total={total}
                  busy={busy}
                  onChange={(next) => change(next)}
                  onClose={() => setSelection(null)}
                  makeMusic={async (payload) => {
                    const asset = await makeAudio({ type: "music", ...payload });
                    if (asset) change((p) => ({ ...p, cut: { ...(p.cut ?? {}), music: { source: "upload", assetId: asset.id } } }));
                  }}
                />
              ) : (
                <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4 text-[12.5px] leading-relaxed text-muted">
                  <p className="text-[13.5px] font-medium text-ink">Edit by hand</p>
                  <p className="mt-1">Edit freely, then Save: each save makes the new cut ({creditsLabel(cutCredits(total))} at this length — 1 credit per started minute). Click a clip on the timeline to trim it, change its speed or sound, its words or its voice. Drag clips to reorder; drag their edges to trim. <b className="text-soft">Space</b> plays, <b className="text-soft">S</b> splits at the playhead, <b className="text-soft">Delete</b> removes, <b className="text-soft">⌘Z</b> undoes.</p>
                  <button onClick={() => setSelection({ type: "music" })} className={`${chip} mt-3`}><Music className="h-3.5 w-3.5" /> Music and voice</button>
                </section>
              )}

              {/* The AI editor — optional */}
              <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink"><Sparkles className="h-4 w-4 text-accent" /> AI editor <span className="text-[11.5px] font-normal text-muted">· optional</span></p>
                  <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="AI agent" className="h-7 rounded-full border border-line/[0.1] bg-panel px-2 text-[11.5px] text-ink">
                    <option value="auto">Auto</option>
                    {agents.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.creditMultiplier && m.creditMultiplier !== 1 ? ` · ${m.creditMultiplier}× credits` : ""}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">Pick any AI agent from your workspace. It sees your clips, characters, timeline and settings; its change lands on the timeline to keep or undo. From 1 credit an answer. With smart suggestions on, it looks over each save and speaks only when something is worth changing.</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[12px] text-soft">
                    <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
                    Smart suggestions after each save · {creditsLabel(REVIEW_COST)} a look
                  </label>
                  <button onClick={() => draft && void review(draft)} disabled={!draft || busy !== null} className="text-[11.5px] text-accent disabled:opacity-40">Look over my edit</button>
                </div>
                {reviewed && !suggestions.length && <p className="mt-1.5 text-[11.5px] text-muted">{reviewed}</p>}
                {suggestions.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {suggestions.map((sugg, i) => (
                      <li key={`${sugg.title}-${i}`} className="rounded-[12px] border border-accent/30 bg-accent/[0.05] p-2.5">
                        <p className="text-[12.5px] font-medium text-ink">{sugg.title}</p>
                        <p className="mt-0.5 text-[12px] leading-snug text-soft">{sugg.why}</p>
                        {sugg.refilm.length > 0 && <p className="mt-0.5 text-[11px] text-muted">Films scene{sugg.refilm.length === 1 ? "" : "s"} {sugg.refilm.join(", ")} again on export.</p>}
                        <div className="mt-1.5 flex gap-1.5">
                          <button onClick={() => void applySuggestion(i)} className="flex h-7 items-center rounded-full bg-solid px-3 text-[11.5px] font-medium text-onSolid">Apply</button>
                          <button onClick={() => setSuggestions((list) => list.filter((_, j) => j !== i))} className="flex h-7 items-center rounded-full px-3 text-[11.5px] text-muted hover:text-ink">Dismiss</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {chat.length > 0 && (
                  <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-[12.5px]">
                    {chat.map((m, i) => (
                      <li key={i} className={m.who === "you" ? "text-soft" : "text-ink"}><span className="text-muted">{m.who === "you" ? "You: " : "AI: "}</span>{m.text}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void assist();
                    }}
                    placeholder="e.g. put the beach clip first and end on my logo"
                    className={field}
                  />
                  <button onClick={() => void assist()} disabled={!ask.trim() || busy !== null} aria-label="Ask the AI editor" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-solid text-onSolid disabled:opacity-50">
                    {busy === "assist" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  </button>
                </div>
              </section>
            </aside>
          </div>

          {/* Timeline */}
          <Timeline
            plan={draft}
            segments={segments}
            time={time}
            total={total}
            pps={pps}
            selection={selection}
            hasMusic={Boolean(cut && cut.music.source !== "none")}
            musicLabel={cut?.music.source === "upload" ? assets.find((a) => a.id === cut.music.assetId)?.name ?? "Your music" : "Music made on export"}
            onZoom={(z) => setPps(Math.max(8, Math.min(160, z)))}
            onSeek={seek}
            onSelect={setSelection}
            onMove={(n, index) => change((p) => moveScene(p, n, index))}
            onTrim={(n, edge, delta) => change((p) => trimEdge(p, n, edge, delta, assets))}
            onSplit={splitHere}
            onDuplicate={() => selected && change((p) => duplicateScene(p, selected.n))}
            onDelete={() => selected && takeOut(selected.n)}
            canEditSelected={Boolean(selected)}
          />

          {showSettings && (
            <div className="mt-4">
              <VideoSettings plan={draft} audioAssets={assets} onChange={(next) => change(next)} />
            </div>
          )}

          <div className="mt-4">
            <CharactersPanel
              videoId={id}
              cast={draft.characters ?? []}
              photos={assets}
              onCast={(next) => change((p) => withCast(p, next))}
            />
          </div>

          <MediaPanel
            videoId={id}
            assets={assets}
            title="Media"
            description="Your uploads and the sound made here. Add a clip or picture to the end of the timeline, or use a sound file as the music."
            inTimeline={new Set(draft.scenes.flatMap((s) => (s.source ? [s.source.assetId] : [])))}
            musicAssetId={cut?.music.source === "upload" ? cut.music.assetId : null}
            onAdd={(asset) => change((p) => ({ ...p, scenes: [...p.scenes, sceneFromAsset(asset, p.scenes.length + 1)] }))}
            onUseMusic={(asset) => change((p) => ({ ...p, cut: { ...(p.cut ?? {}), music: asset ? { source: "upload", assetId: asset.id } : { source: "none" } } }))}
            onChanged={() => load(true)}
          />
        </>
      )}
    </main>
  );
}

/* ── Preview ─────────────────────────────────────────────────────────── */
function Preview({ plan, segment, offset, videoRef }: { plan: ProductionPlan; segment: Segment | null; offset: number; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const cut = resolveCut(plan);
  const fit = cut.fit === "fill" ? "object-cover" : "object-contain";
  const zoom = segment?.kind === "image" && cut.stillMotion !== "none" ? 1 + 0.12 * (cut.stillMotion === "zoom-out" ? 1 - offset / segment.seconds : offset / segment.seconds) : 1;
  const filter = { none: "", vivid: "saturate(1.35) contrast(1.06)", warm: "sepia(0.18) saturate(1.1)", cool: "hue-rotate(-8deg) saturate(0.95)", cinematic: "contrast(1.1) saturate(0.88)", mono: "grayscale(1) contrast(1.08)", vintage: "sepia(0.35) saturate(0.85)" }[cut.color];
  const captionY = cut.captionPosition === "top" ? "top-[8%]" : cut.captionPosition === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[8%]";
  const captionSize = cut.captionSize === "small" ? "text-[12px]" : cut.captionSize === "large" ? "text-[18px]" : "text-[14px]";
  const captionStyle = cut.captionStyle === "box" ? "bg-black/70 text-white" : cut.captionStyle === "highlight" ? "text-[#FFE14D] [text-shadow:0_0_3px_#000,0_0_3px_#000]" : "text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]";
  const showCaption = cut.captions && segment?.caption && cut.audio !== "original";
  return (
    <div className="relative mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: RATIO[plan.aspect] ?? "16 / 9", maxHeight: "56vh" }}>
      {cut.fit === "fit-blur" && segment?.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={segment.posterUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
      )}
      <video ref={videoRef} playsInline muted={false} className={`absolute inset-0 h-full w-full ${fit} ${segment?.kind === "video" ? "" : "invisible"}`} style={{ filter }} />
      {segment?.kind === "image" && segment.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={segment.mediaUrl} alt="" className={`absolute inset-0 h-full w-full ${fit}`} style={{ transform: `scale(${zoom})`, filter }} />
      )}
      {segment?.kind === "pending" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#1b2340] via-[#121218] to-[#2a1630] p-4 text-center">
          <span className="text-[10.5px] uppercase tracking-wider text-white/50">Scene {segment.n} · made on export</span>
          <span className="line-clamp-3 max-w-[90%] text-[12px] text-white/70">{segment.label}</span>
        </div>
      )}
      {segment?.text && <p className="absolute left-0 right-0 top-[10%] px-4 text-center text-[clamp(14px,3.5vw,24px)] font-extrabold text-white [text-shadow:0_2px_10px_rgba(0,0,0,.8)]">{segment.text}</p>}
      {showCaption && <p className={`absolute left-[8%] right-[8%] ${captionY} rounded-md px-2 py-1 text-center font-semibold ${captionSize} ${captionStyle}`}>{segment!.caption}</p>}
    </div>
  );
}

/* ── Storyboard: every scene in order, at a glance ───────────────────── */
function Storyboard(props: {
  plan: ProductionPlan;
  segments: Segment[];
  assets: PanelAsset[];
  selected: number | null;
  current: number | null;
  removed: { scene: Scene; index: number }[];
  onSelect: (n: number) => void;
  onMove: (n: number, by: -1 | 1) => void;
  onRemove: (n: number) => void;
  onPutBack: (entry: { scene: Scene; index: number }) => void;
}) {
  const statusOf = (scene: Scene, seg: Segment | undefined): { text: string; tone: string } => {
    const asset = scene.source ? props.assets.find((a) => a.id === scene.source?.assetId) : undefined;
    if (scene.source && !asset) return { text: "Upload missing", tone: "text-danger bg-danger/10" };
    if (asset?.status === "processing") return { text: "Preparing", tone: "text-amber-300 bg-amber-400/10" };
    if (seg?.kind === "pending") return { text: "Made on export", tone: "text-sky-300 bg-sky-400/10" };
    return { text: "Ready", tone: "text-emerald-300 bg-emerald-400/10" };
  };
  return (
    <div className="mt-3 border-t border-line/[0.08] pt-3">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Scenes</p>
      <ol className="space-y-1">
        {props.plan.scenes.map((scene, index) => {
          const seg = props.segments.find((s) => s.n === scene.n);
          const status = statusOf(scene, seg);
          const thumb = seg?.posterUrl ?? (seg?.kind === "image" ? seg.mediaUrl : null);
          const active = props.selected === scene.n;
          return (
            <li key={`${scene.n}-${scene.source?.assetId ?? scene.motionPrompt.slice(0, 20)}`}>
              <div className={`group flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 ${active ? "bg-layer/[0.1]" : "hover:bg-layer/[0.05]"}`}>
                <button onClick={() => props.onSelect(scene.n)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className={`relative h-9 w-14 shrink-0 overflow-hidden rounded-[6px] bg-layer/[0.1] ${props.current === scene.n ? "ring-2 ring-accent" : ""}`}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Sparkles className="absolute inset-0 m-auto h-3.5 w-3.5 text-muted" />
                    )}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9.5px] font-semibold text-white">{index + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{seg?.label ?? `Scene ${scene.n}`}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {formatSeconds(seg?.seconds ?? scene.duration)}
                      {scene.onScreenText ? ` · “${scene.onScreenText}”` : ""}
                      {scene.voiceover || scene.voiceAsset ? " · voice-over" : ""}
                      {continuesFrom(props.plan, scene.n) !== null ? " · ↳ carries on" : ""}
                      {scene.characters?.length ? ` · ${scene.characters.map((cid) => props.plan.characters?.find((c) => c.id === cid)?.name ?? "").filter(Boolean).join(", ")}` : ""}
                    </span>
                  </span>
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10.5px] sm:inline ${status.tone}`}>{status.text}</span>
                </button>
                <span className="flex shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                  <button onClick={() => props.onMove(scene.n, -1)} disabled={index === 0} aria-label="Move earlier" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button onClick={() => props.onMove(scene.n, 1)} disabled={index === props.plan.scenes.length - 1} aria-label="Move later" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button onClick={() => props.onRemove(scene.n)} disabled={props.plan.scenes.length <= 1} aria-label="Take this scene out" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-danger disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {props.removed.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-dashed border-line/[0.15] p-2">
          <p className="text-[11px] text-muted">Taken out — tap to put back</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {props.removed.map((entry, i) => (
              <button key={i} onClick={() => props.onPutBack(entry)} className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-ink hover:bg-layer/[0.08]">
                <RotateCcw className="h-3 w-3 shrink-0" />
                <span className="truncate">{entry.scene.source ? props.assets.find((a) => a.id === entry.scene.source?.assetId)?.name ?? "Your clip" : entry.scene.shot || entry.scene.visual.slice(0, 30) || "Scene"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────── */
function Timeline(props: {
  plan: ProductionPlan;
  segments: Segment[];
  time: number;
  total: number;
  pps: number;
  selection: Selection;
  hasMusic: boolean;
  musicLabel: string;
  onZoom: (pps: number) => void;
  onSeek: (t: number) => void;
  onSelect: (s: Selection) => void;
  onMove: (n: number, index: number) => void;
  onTrim: (n: number, edge: "start" | "end", delta: number) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canEditSelected: boolean;
}) {
  const { segments, pps, total } = props;
  const width = Math.max(320, total * pps + 80);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ n: number; edge: "start" | "end"; x0: number; delta: number } | null>(null);
  const dragging = useRef<number | null>(null);
  const step = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : 10;
  const seekFrom = (event: React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    props.onSeek((event.clientX - box.left) / pps);
  };
  const lengthOf = (s: Segment) => (drag && drag.n === s.n ? Math.max(0.3, s.seconds + (drag.edge === "end" ? drag.delta : -drag.delta)) : s.seconds);
  const leftOf = (s: Segment) => (drag && drag.n === s.n && drag.edge === "start" ? s.start + drag.delta : s.start);
  const sceneOf = (n: number): Scene | undefined => props.plan.scenes.find((s) => s.n === n);
  const isSel = (n: number) => props.selection?.type === "scene" && props.selection.n === n;

  return (
    <section className="mt-4 rounded-[16px] border border-line/[0.08] bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button onClick={props.onSplit} title="Split at the playhead (S)" className={chip}><Scissors className="h-3.5 w-3.5" /> Split</button>
        <button onClick={props.onDuplicate} disabled={!props.canEditSelected} className={chip}><Copy className="h-3.5 w-3.5" /> Duplicate</button>
        <button onClick={props.onDelete} disabled={!props.canEditSelected} className={chip}><Trash2 className="h-3.5 w-3.5" /> Take out</button>
        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => props.onZoom(pps / 1.5)} aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-full text-soft hover:text-ink"><ZoomOut className="h-4 w-4" /></button>
          <button onClick={() => props.onZoom(pps * 1.5)} aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-full text-soft hover:text-ink"><ZoomIn className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="flex">
      <div className="w-14 shrink-0 select-none pr-1 text-[10.5px] font-medium text-muted" aria-hidden>
        <div className="h-5" />
        <div className="mt-1.5 flex h-16 items-center">Video</div>
        <div className="mt-1 flex h-6 items-center">Words</div>
        <div className="mt-1 flex h-6 items-center">Voice</div>
        <div className="mt-1 flex h-6 items-center">Music</div>
      </div>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1">
        <div className="relative select-none" style={{ width }}>
          {/* Ruler */}
          <div className="relative h-5 cursor-pointer border-b border-line/[0.08]" onClick={seekFrom}>
            {Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).map((t) => (
              <span key={t} className="absolute top-0 text-[10px] tabular-nums text-muted" style={{ left: t * pps }}>
                <span className="absolute left-0 top-3 h-2 w-px bg-line/[0.25]" />
                {formatSeconds(t)}
              </span>
            ))}
          </div>
          {/* Video track */}
          <div className="relative mt-1.5 h-16" onClick={(e) => e.target === e.currentTarget && seekFrom(e)}>
            {segments.map((s, index) => {
              const scene = sceneOf(s.n);
              return (
                <div
                  key={s.n}
                  draggable
                  onDragStart={(e) => {
                    dragging.current = s.n;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragging.current;
                    dragging.current = null;
                    if (from === null || from === s.n) return;
                    const box = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > box.left + box.width / 2;
                    const fromIndex = segments.findIndex((x) => x.n === from);
                    let to = index + (after ? 1 : 0);
                    if (fromIndex < to) to -= 1;
                    props.onMove(from, to);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onSelect({ type: "scene", n: s.n });
                    props.onSeek(s.start + Math.min(s.seconds - 0.05, (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps));
                  }}
                  className={`group absolute top-0 h-16 cursor-grab overflow-hidden rounded-[8px] border ${isSel(s.n) ? "border-accent ring-2 ring-accent/40" : "border-line/[0.15]"} bg-layer/[0.08]`}
                  style={{ left: leftOf(s) * pps, width: Math.max(14, lengthOf(s) * pps - 2) }}
                  title={`${s.label} · ${s.seconds.toFixed(1)}s`}
                >
                  {s.posterUrl || (s.kind === "image" && s.mediaUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.posterUrl ?? s.mediaUrl ?? ""} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70" />
                  ) : null}
                  <span className="pointer-events-none absolute bottom-0.5 left-1.5 right-1.5 truncate text-[10.5px] font-medium text-white [text-shadow:0_1px_3px_#000]">
                    {s.n}. {scene?.source ? s.label : scene?.shot || "Generated"} · {lengthOf(s).toFixed(1)}s
                  </span>
                  {(["start", "end"] as const).map((edge) => (
                    <span
                      key={edge}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        setDrag({ n: s.n, edge, x0: e.clientX, delta: 0 });
                      }}
                      onPointerMove={(e) => drag && drag.n === s.n && drag.edge === edge && setDrag({ ...drag, delta: (e.clientX - drag.x0) / pps })}
                      onPointerUp={() => {
                        if (drag && drag.n === s.n && Math.abs(drag.delta) > 0.02) props.onTrim(s.n, edge, drag.delta);
                        setDrag(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute top-0 h-full w-2.5 cursor-ew-resize bg-white/0 hover:bg-white/40 ${edge === "start" ? "left-0 rounded-l-[8px]" : "right-0 rounded-r-[8px]"} ${isSel(s.n) ? "bg-white/30" : ""}`}
                      aria-label={edge === "start" ? "Trim the start" : "Trim the end"}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          {/* Words track */}
          <div className="relative mt-1 h-6">
            {segments.map((s) =>
              s.text ? (
                <button key={s.n} onClick={() => props.onSelect({ type: "scene", n: s.n })} className="absolute top-0 h-6 truncate rounded-[6px] bg-sky-500/25 px-1.5 text-left text-[10.5px] text-sky-100" style={{ left: s.start * pps, width: Math.max(14, s.seconds * pps - 2) }}>
                  T · {s.text}
                </button>
              ) : null,
            )}
          </div>
          {/* Voice track */}
          <div className="relative mt-1 h-6">
            {segments.map((s) =>
              s.caption || sceneOf(s.n)?.voiceAsset ? (
                <button key={s.n} onClick={() => props.onSelect({ type: "scene", n: s.n })} className={`absolute top-0 h-6 truncate rounded-[6px] px-1.5 text-left text-[10.5px] ${s.voiceUrl ? "bg-violet-500/30 text-violet-100" : "bg-violet-500/15 text-violet-200/70"}`} style={{ left: s.start * pps, width: Math.max(14, s.seconds * pps - 2) }} title={s.voiceUrl ? "Voice line ready" : "Voice line made on export"}>
                  🎙 {s.caption || "Recording"}
                </button>
              ) : null,
            )}
          </div>
          {/* Music track */}
          <div className="relative mt-1 h-6">
            <button onClick={() => props.onSelect({ type: "music" })} className={`absolute top-0 h-6 truncate rounded-[6px] px-1.5 text-left text-[10.5px] ${props.hasMusic ? "bg-emerald-500/25 text-emerald-100" : "border border-dashed border-line/[0.2] text-muted"} ${props.selection?.type === "music" ? "ring-2 ring-accent/50" : ""}`} style={{ left: 0, width: Math.max(140, total * pps - 2) }}>
              ♪ {props.hasMusic ? props.musicLabel : "Add music"}
            </button>
          </div>
          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" style={{ left: props.time * pps }}>
            <span className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-accent" />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}

/* ── Inspectors ──────────────────────────────────────────────────────── */
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13.5px] font-medium text-ink">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-ink"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function SceneInspector(props: {
  scene: Scene;
  plan: ProductionPlan;
  assets: PanelAsset[];
  audioAssets: PanelAsset[];
  busy: string | null;
  canSplitHere: boolean;
  onChange: (next: ProductionPlan) => void;
  onSplit: () => void;
  onRemove: (n: number) => void;
  onClose: () => void;
  makeVoice: (text: string, voiceId: string) => Promise<void>;
}) {
  const { scene, plan } = props;
  const set = (patch: Partial<Scene>) => props.onChange({ ...plan, scenes: plan.scenes.map((s) => (s.n === scene.n ? { ...s, ...patch } : s)) });
  const asset = scene.source ? props.assets.find((a) => a.id === scene.source?.assetId) : undefined;
  const muted = Boolean(plan.cut?.muted?.includes(scene.n));
  const voiceAsset = scene.voiceAsset ? props.audioAssets.find((a) => a.id === scene.voiceAsset) : undefined;
  const videoVoice = plan.cut?.voiceId;
  const [voiceId, setVoiceId] = useState(scene.voiceId ?? videoVoice ?? VOICES[0].id);
  useEffect(() => setVoiceId(scene.voiceId ?? videoVoice ?? VOICES[0].id), [scene.n, scene.voiceId, videoVoice]);

  return (
    <Panel title={`Scene ${scene.n} · ${scene.source ? (scene.engine === "image" ? "your picture" : "your clip") : "generated"}`} onClose={props.onClose}>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={props.onSplit} disabled={!props.canSplitHere} className={chip}><Scissors className="h-3.5 w-3.5" /> Split here</button>
        <button onClick={() => props.onChange(duplicateScene(plan, scene.n))} className={chip}><Copy className="h-3.5 w-3.5" /> Duplicate</button>
        <button onClick={() => props.onRemove(scene.n)} disabled={plan.scenes.length <= 1} className={chip}><Trash2 className="h-3.5 w-3.5" /> Take out</button>
      </div>
      {scene.source ? (
        <TimelineClip
          source={scene.source}
          asset={asset}
          muted={muted}
          duration={scene.duration}
          onSource={(source) => set({ source })}
          onMute={(on) => {
            const list = new Set(plan.cut?.muted ?? []);
            if (on) list.add(scene.n);
            else list.delete(scene.n);
            props.onChange({ ...plan, cut: { ...(plan.cut ?? {}), muted: [...list].sort((a, b) => a - b) } });
          }}
          onDuration={(duration) => set({ duration })}
          compact
        />
      ) : (
        <>
          <label className="block text-[11.5px] text-muted">
            Length (seconds)
            <input type="number" min={1} max={30} value={scene.duration} onChange={(e) => set({ duration: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className={field} />
          </label>
          <label className="block text-[11.5px] text-muted">
            What is filmed <span className="text-muted/80">(changing it films this scene again on export)</span>
            <textarea rows={3} value={scene.motionPrompt} onChange={(e) => set({ motionPrompt: e.target.value })} className={`${field} resize-y`} />
          </label>
        </>
      )}
      {!scene.source && plan.scenes[0]?.n !== scene.n && (
        <label className="block text-[11.5px] text-muted">
          From the scene before
          <select
            value={scene.continues === true ? "yes" : scene.continues === false ? "no" : "auto"}
            onChange={(e) => set({ continues: e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined })}
            className={field}
          >
            <option value="auto">Automatic — carries on when it shares a character</option>
            <option value="yes">Carries on — starts where the last scene ended</option>
            <option value="no">Cuts away — a fresh shot</option>
          </select>
          <span className="mt-0.5 block text-[11px]">
            {continuesFrom(plan, scene.n) !== null ? "Filmed from the last frame of the scene before, so the place, light and look carry straight on." : "Filmed on its own, at the same time as the others."}
          </span>
        </label>
      )}
      {!scene.source && (plan.characters?.length ?? 0) > 0 && (
        <div>
          <p className="text-[11.5px] text-muted">Who&apos;s in this scene <span className="text-muted/80">(they look exactly like their pictures)</span></p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {plan.characters!.map((c) => {
              const on = scene.characters?.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    const ids = on ? (scene.characters ?? []).filter((x) => x !== c.id) : [...(scene.characters ?? []), c.id].slice(0, MAX_SCENE_CAST);
                    set({ characters: ids.length ? ids : undefined });
                  }}
                  className={`flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] ${on ? "border-accent/50 bg-accent/[0.08] text-accent" : "border-line/[0.1] text-ink hover:bg-layer/[0.08]"}`}
                >
                  {on ? "✓ " : "+ "}{c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <label className="block text-[11.5px] text-muted">
        Words on screen
        <input value={scene.onScreenText} onChange={(e) => set({ onScreenText: e.target.value.slice(0, 200) })} placeholder="e.g. Summer sale" className={field} />
      </label>
      <div className="space-y-2 rounded-[12px] border border-line/[0.08] p-3">
        <p className="text-[12px] font-medium text-ink">Voice-over</p>
        <textarea
          rows={2}
          value={scene.voiceover}
          onChange={(e) => {
            /* New words make a voice made here out of date; a recording of
               the person's own stays theirs. */
            const madeHere = voiceAsset?.name.startsWith("Voice ·");
            set({ voiceover: e.target.value.slice(0, 600), ...(madeHere ? { voiceAsset: undefined } : {}) });
          }}
          placeholder="What is said over this scene (also its caption)"
          className={`${field} resize-y`}
        />
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={field}>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label} · {v.language}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => void props.makeVoice(scene.voiceover.trim(), voiceId)} disabled={!scene.voiceover.trim() || props.busy !== null} className={chip}>
            {props.busy === "voice" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {voiceAsset ? "Make it again" : "Make the voice now"}
          </button>
          <button onClick={() => set({ voiceId, voiceAsset: undefined })} disabled={!scene.voiceover.trim()} className={chip} title="The voice is made on export, in this voice">Use this voice on export</button>
          {(scene.voiceover || scene.voiceAsset) && <button onClick={() => set({ voiceover: "", voiceAsset: undefined, voiceId: undefined })} className={chip}>Remove voice-over</button>}
        </div>
        <label className="block text-[11.5px] text-muted">
          Or use a recording (upload it under Media)
          <select value={scene.voiceAsset ?? ""} onChange={(e) => set({ voiceAsset: e.target.value || undefined })} className={field}>
            <option value="">{scene.voiceover.trim() ? `Generated · ${voiceLabel(scene.voiceId ?? videoVoice) || "the video's voice"}` : "None"}</option>
            {props.audioAssets.map((a) => (
              <option key={a.id} value={a.id}>{a.name || "Recording"}{a.durationS ? ` · ${formatSeconds(a.durationS)}` : ""}</option>
            ))}
          </select>
        </label>
        {voiceAsset?.url && <audio src={voiceAsset.url} controls className="h-8 w-full" />}
      </div>
    </Panel>
  );
}

function SoundInspector(props: {
  plan: ProductionPlan;
  audioAssets: PanelAsset[];
  total: number;
  busy: string | null;
  onChange: (next: ProductionPlan) => void;
  onClose: () => void;
  makeMusic: (payload: { prompt: string; seconds: number; lyrics?: string; vocalLanguage?: string }) => Promise<void>;
}) {
  const { plan } = props;
  const cut = resolveCut(plan);
  const [prompt, setPrompt] = useState(plan.music || "");
  const [seconds, setSeconds] = useState(Math.max(30, Math.ceil(props.total)));
  const [song, setSong] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState("en");
  const setCut = (patch: Partial<NonNullable<ProductionPlan["cut"]>>) => props.onChange({ ...plan, cut: { ...(plan.cut ?? {}), ...patch } });
  const value = cut.music.source === "upload" && cut.music.assetId ? `upload:${cut.music.assetId}` : cut.music.source;
  const current = cut.music.source === "upload" ? props.audioAssets.find((a) => a.id === cut.music.assetId) : undefined;

  return (
    <Panel title="Music and voice" onClose={props.onClose}>
      <label className="block text-[11.5px] text-muted">
        Music
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setCut({ music: v.startsWith("upload:") ? { source: "upload", assetId: v.slice(7) } : { source: v as "generate" | "none" } });
          }}
          className={field}
        >
          <option value="none">No music</option>
          <option value="generate">Make music on export</option>
          {props.audioAssets.map((a) => (
            <option key={a.id} value={`upload:${a.id}`}>{a.name || "Audio"}{a.durationS ? ` · ${formatSeconds(a.durationS)}` : ""}</option>
          ))}
        </select>
      </label>
      {current?.url && <audio src={current.url} controls className="h-8 w-full" />}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11.5px] text-muted">
          Level · {Math.round(cut.musicVolume * 100)}%
          <input type="range" min={0} max={2} step={0.05} value={cut.musicVolume} onChange={(e) => setCut({ musicVolume: Number(e.target.value) })} className="mt-1 block w-full accent-accent" />
        </label>
        {cut.music.source === "upload" && (
          <label className="text-[11.5px] text-muted">
            Start the song at (s)
            <input type="number" min={0} step={0.5} value={cut.music.start} onChange={(e) => setCut({ music: { source: "upload", assetId: cut.music.assetId, start: Math.max(0, Number(e.target.value) || 0) } })} className={field} />
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-soft">
        <input type="checkbox" checked={cut.duck} onChange={(e) => setCut({ duck: e.target.checked })} /> Lower the music while someone speaks
      </label>

      <div className="space-y-2 rounded-[12px] border border-line/[0.08] p-3">
        <p className="text-[12px] font-medium text-ink">Make music now</p>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Genre, mood, instruments — e.g. upbeat afrobeat, warm guitar, light drums" className={field} />
        <label className="block text-[11.5px] text-muted">
          Length · {seconds}s
          <input type="range" min={30} max={300} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-1 block w-full accent-accent" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-soft">
          <input type="checkbox" checked={song} onChange={(e) => setSong(e.target.checked)} /> A song with lyrics
        </label>
        {song && (
          <>
            <textarea rows={4} value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 3000))} placeholder={"[verse]\nYour lyrics here…\n[chorus]\n…"} className={`${field} resize-y`} />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
              {[["en", "English"], ["fr", "French"], ["es", "Spanish"], ["pt", "Portuguese"], ["de", "German"], ["sw", "Swahili"], ["ar", "Arabic"], ["hi", "Hindi"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"]].map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </>
        )}
        <button
          onClick={() => void props.makeMusic({ prompt, seconds, ...(song && lyrics.trim().length >= 10 ? { lyrics, vocalLanguage: language } : {}) })}
          disabled={prompt.trim().length < 3 || props.busy !== null || (song && lyrics.trim().length < 10)}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-full bg-solid text-[13px] font-medium text-onSolid disabled:opacity-50"
        >
          {props.busy === "music" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />} Make it
        </button>
        <p className="text-[11px] text-muted">Each one is kept under Media — switch between them any time.</p>
      </div>

      <label className="block text-[11.5px] text-muted">
        Voice for every generated line
        <select value={plan.cut?.voiceId ?? ""} onChange={(e) => setCut({ voiceId: e.target.value || undefined })} className={field}>
          <option value="">The video&apos;s voice</option>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label} · {v.language}</option>
          ))}
        </select>
        <span className="mt-0.5 block text-[11px]">Changing it re-voices the lines on export (1 credit each).</span>
      </label>
    </Panel>
  );
}

/* A new cast in the draft: scenes keep only characters still in it. */
function withCast(plan: ProductionPlan, cast: PlanCharacter[]): ProductionPlan {
  const ids = new Set(cast.map((c) => c.id));
  return {
    ...plan,
    characters: cast.length ? cast : undefined,
    scenes: plan.scenes.map((scene) => {
      if (!scene.characters) return scene;
      const kept = scene.characters.filter((cid) => ids.has(cid));
      return { ...scene, characters: kept.length ? kept : undefined };
    }),
  };
}
