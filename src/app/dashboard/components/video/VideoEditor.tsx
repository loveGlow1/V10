"use client";

/* The visual editor — cut a video by hand, laid out like a desktop editor:
 *
 *   library    (left) what goes into the video, a tab each — Media (by
 *              kind, dragged onto the timeline), Scenes, Text, Transitions,
 *              Filters (for one clip or the whole video), Cast, Settings
 *              (EditorLibrary.tsx)
 *   preview    (centre) plays the timeline in the browser as it stands, with
 *              the clip's filter and words, and an hours:minutes:seconds:
 *              frames timecode
 *   inspector  (right) the selected clip or sound — trim, speed, level,
 *              words, voice — or the AI editor, in tabs
 *   timeline   (bottom, full width) Video, Filter, Text, Voice and Music
 *              tracks, each with a lock and (for sound) a mute; filmstrips;
 *              transition markers between clips; drag to move, edges to
 *              trim (snapping to the playhead and other clips), drop media
 *              in from the library; split, duplicate, delete, undo, redo
 *
 * On a phone: preview, timeline, library, inspector, one under another.
 * Nothing here needs a model; the AI editor is optional. Saving makes a new
 * version and cuts it again from what was already made. Export makes
 * whatever is missing (generated scenes, voice lines) and the final MP4. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  RotateCcw,
  Copy,
  Diamond,
  Download,
  Film,
  Eye,
  Lock,
  Magnet,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
  Captions,
  Image as ImageIcon,
  Palette,
  Shuffle,
  Type as TypeIcon,
} from "lucide-react";

import { formatSeconds } from "@/lib/video/assets";
import { COLOR_CSS, LABELS, resolveCut, type ResolvedCut } from "@/lib/video/cut-settings";
import { canSplit, duplicateScene, moveScene, removeScene, segmentAt, segmentsFor, splitAt, timelineLength, trimEdge, withScenes, type MadeLibrary, type Segment } from "@/lib/video/editor-timeline";
import type { ProductionPlan, Scene } from "@/lib/video/plan";
import { sceneFromAsset, toggleReference, withContinuation } from "@/lib/video/timeline";
import { REVIEW_COST, creditsLabel, cutCredits, ownClipsOnly, ownCutCredits } from "@/lib/video/pricing";
import { ONE_RUN_SECONDS } from "@/lib/video/chapters";
import { VOICES, voiceLabel } from "@/lib/video/voices";

import { callableModels, isModelAvailable } from "@/app/dashboard/models";
import { MAX_SCENE_CAST, type PlanCharacter } from "@/lib/video/cast";
import { continuesFrom } from "@/lib/video/continuity";

import CharactersPanel from "./CharactersPanel";
import EditorLibrary, { type LibraryTab } from "./EditorLibrary";
import { STRIP_FRAMES, placeholderStyle, spriteFrame, stripUrl } from "./useClipPosters";
import MediaPanel, { ASSET_DRAG, type PanelAsset } from "./MediaPanel";
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
  /** Every clip and voice line made in any version, by content (state.ts). */
  library?: MadeLibrary;
  /** "Edit my clips": the account's free exports of its own clips (free-exports.ts). */
  freeExports?: { left: number; thisVideo: boolean; own: boolean; total: number };
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
  /* The phone's bottom tools bring their panel into view. */
  const libraryRef = useRef<HTMLElement>(null);
  const inspectRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<null | "save" | "export" | "assist" | "music" | "voice" | "stitch">(null);
  /* Which library tab is open, and whether the right column shows the selection or the AI. */
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("media");
  const [rightTab, setRightTab] = useState<"inspect" | "ai">("inspect");
  const openTool = (tab: LibraryTab) => {
    setLibraryTab(tab);
    window.requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openInspect = (next: Selection) => {
    setSelection(next);
    setRightTab("inspect");
    window.requestAnimationFrame(() => inspectRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const [locked, setLocked] = useState<Set<TrackId>>(new Set());
  const [chat, setChat] = useState<Chat[]>([]);
  const [ask, setAsk] = useState("");
  /* The AI agent that answers — the same choice as the workspace's picker,
     remembered on this device. */
  const agents = useMemo(() => callableModels().filter((m) => isModelAvailable(m)), []);
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
  const rawSegments = useMemo(() => (draft ? segmentsFor(draft, assets, data?.renders ?? [], data?.library) : []), [draft, assets, data]);
  /* A still from every made clip, so generated scenes show their picture
     in the filmstrip and the scene list like uploads do — made on the server,
     so it shows on an iPhone too (useClipPosters.ts stripUrl). */
  const segments = rawSegments.map((s) =>
    !s.posterUrl && s.kind === "video" && s.mediaUrl ? { ...s, posterUrl: stripUrl(id, s.mediaUrl, { count: 1, from: s.from, seconds: s.seconds * (s.speed || 1) }) } : s,
  );
  const total = timelineLength(segments);
  /* Generated scenes with no clip yet — never filmed, or failed last time. */
  const missingScenes = segments.filter((seg) => seg.kind === "pending").length;
  const dirty = Boolean(draft && data?.latest && JSON.stringify(draft) !== JSON.stringify(data.latest.plan));
  /* "Edit my clips", made easy: once the uploads are read they go straight
     onto the timeline — no button to find — and every clip uploaded after
     that lands on the end, the way clips dropped into CapCut do. A clip the
     person took off the timeline is never put back. */
  const ownEdit = data?.video.pipeline === "clip_edit";
  const autoStitched = useRef(false);
  const seenAssets = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data || !ownEdit) return;
    const visual = assets.filter((a) => (a.kind === "video" || a.kind === "image" || a.kind === "photo") && a.status !== "failed");
    if (!draft) {
      if (autoStitched.current || busy !== null || !visual.length || assets.some((a) => a.status === "processing")) return;
      const timer = window.setTimeout(() => {
        autoStitched.current = true;
        void stitch();
      }, 1200);
      return () => window.clearTimeout(timer);
    }
    const ready = (a: PanelAsset) => a.status !== "processing";
    if (seenAssets.current === null) {
      seenAssets.current = new Set(assets.filter(ready).map((a) => a.id));
      return;
    }
    const seen = seenAssets.current;
    const onTimeline = new Set(draft.scenes.flatMap((scene) => (scene.source ? [scene.source.assetId] : [])));
    const fresh = visual.filter((a) => ready(a) && !seen.has(a.id) && !onTimeline.has(a.id));
    assets.filter(ready).forEach((a) => seen.add(a.id));
    if (fresh.length) change((p) => ({ ...p, scenes: [...p.scenes, ...fresh.map((a, i) => sceneFromAsset(a, p.scenes.length + 1 + i))] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, draft, ownEdit, busy]);
  const free = data?.freeExports;
  const ownCut = Boolean(draft && ownClipsOnly(draft));
  const cut = draft ? resolveCut(draft) : null;
  const musicUrl = useMemo(() => {
    if (!draft || !cut || cut.music.source === "none") return null;
    if (cut.music.source === "upload") return assets.find((a) => a.id === cut.music.assetId)?.url ?? null;
    return data?.renders.find((r) => r.engine === "music" && r.status === "done")?.url ?? null;
  }, [draft, cut, assets, data]);

  /* ── Playback ──────────────────────────────────────────────────────── */
  const clock = useRef<{ t0: number; from: number } | null>(null);
  /* True while the clip on screen is still loading or seeking: the clock
     waits for it rather than running ahead and dragging it back. */
  const stalled = useRef(false);
  useEffect(() => {
    if (!playing) return;
    clock.current = { t0: performance.now(), from: time >= total ? 0 : time };
    let frame = 0;
    let last = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const c = clock.current;
      if (!c) return;
      /* Held while the picture catches up — the time it spent waiting is not
         played — and let go the moment the clip can play. */
      if (stalled.current) {
        const v = videoRef.current;
        if (v && v.readyState >= 3 && !v.seeking) stalled.current = false;
        else {
          c.t0 += now - previous;
          /* Nudged while it loads: a paused clip is not fetched by every browser. */
          if (v && v.paused) void v.play().catch(() => {});
        }
      }
      previous = now;
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
  const loaded = useRef<{ video?: string; voice?: string; music?: string; next?: string }>({});
  /* Two players taking turns, like an editor's A/B decks: the one on screen
     plays the clip under the playhead while the other already holds the
     next clip, loaded and paused on its first frame. At the cut they swap —
     no new download starting at the cut, so no blurry still, no stall and no
     crackle from the sound stopping and starting. (One player changing its
     src at every cut was all three; and an iPhone ignores preload, so the
     old hidden "next" player never loaded anything there.) */
  const slotA = useRef<HTMLVideoElement>(null);
  const slotB = useRef<HTMLVideoElement>(null);
  const slotUrl = useRef<[string | null, string | null]>([null, null]);
  const activeRef = useRef<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);

  useEffect(() => {
    const seg = current?.segment;
    const offset = current?.offset ?? 0;
    const slots = [slotA.current, slotB.current] as const;
    if (seg?.kind === "video" && seg.mediaUrl && slotUrl.current[activeRef.current] !== seg.mediaUrl) {
      const other = (1 - activeRef.current) as 0 | 1;
      const was = slots[activeRef.current];
      if (slotUrl.current[other] === seg.mediaUrl && slots[other]) {
        /* The cut: the waiting player, already loaded, takes over. */
        if (was) {
          was.muted = true;
          was.pause();
        }
        activeRef.current = other;
        setActiveSlot(other);
      } else if (was) {
        /* Nothing waiting (a jump on the timeline): load it here. */
        slotUrl.current[activeRef.current] = seg.mediaUrl;
        was.src = seg.mediaUrl;
      }
    }
    const video = slots[activeRef.current];
    videoRef.current = video;
    if (video) {
      if (seg?.kind === "video" && seg.mediaUrl) {
        video.muted = false;
        const expected = seg.from + offset * seg.speed;
        const ready = video.readyState >= 3 && !video.seeking;
        stalled.current = playing && !ready;
        /* Moved only when it has really drifted, and never while it is still
           loading or seeking: re-seeking a clip that is catching up is what
           flashed black and stuttered. */
        if (!video.seeking && video.readyState >= 1 && Math.abs(video.currentTime - expected) > (playing ? 0.75 : 0.12)) video.currentTime = expected;
        video.playbackRate = seg.speed;
        video.volume = Math.max(0, Math.min(1, seg.volume * (cut && (cut.audio === "voiceover" && seg.voiceUrl) ? 0.22 : cut?.audio === "none" ? 0 : 1)));
        if (playing && video.paused) void video.play().catch(() => {});
        if (!playing && !video.paused) video.pause();
      } else {
        stalled.current = false;
        if (!video.paused) video.pause();
      }
    }
    /* The next clip, into the other player: loaded and held on its first
       frame, muted, so the cut to it is instant. A muted inline play is the
       one way an iPhone will fetch it; it is paused again at once. */
    const upcoming = seg ? segments.find((s) => s.start >= seg.start + seg.seconds - 0.01 && s.kind === "video" && s.mediaUrl) : undefined;
    const spare = (1 - activeRef.current) as 0 | 1;
    const ahead = slots[spare];
    if (ahead) {
      if (upcoming?.mediaUrl && upcoming.mediaUrl !== slotUrl.current[activeRef.current] && slotUrl.current[spare] !== upcoming.mediaUrl) {
        slotUrl.current[spare] = upcoming.mediaUrl;
        const at = upcoming.from;
        ahead.muted = true;
        ahead.src = upcoming.mediaUrl;
        ahead.addEventListener(
          "loadedmetadata",
          () => {
            ahead.currentTime = at;
            void ahead
              .play()
              .then(() => {
                if (slotUrl.current[activeRef.current] !== upcoming.mediaUrl) {
                  ahead.pause();
                  ahead.currentTime = at;
                }
              })
              .catch(() => {});
          },
          { once: true },
        );
      } else if (!ahead.paused && slotUrl.current[spare] !== slotUrl.current[activeRef.current]) {
        ahead.pause();
      }
    }
    /* Voice and music wait with the picture: left playing through a stall,
       they ran ahead and were dragged back when it caught up — heard as
       cracks and skips. */
    const go = playing && !stalled.current;
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
          if (go && voice.paused) void voice.play().catch(() => {});
          if (!go && !voice.paused) voice.pause();
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
        if (go && music.paused) void music.play().catch(() => {});
        if (!go && !music.paused) music.pause();
      } else if (!music.paused) music.pause();
    }
  }, [current, time, playing, cut, musicUrl, segments]);

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
    if (!fresh) return;
    if (fresh.video.status === "rendering") {
      setNote("It's being made — it appears here when it's done.");
      return;
    }
    if (fresh.final && !missingScenes) {
      setNote("Your video is ready below.");
      return;
    }
    /* Only what was never made is filmed or voiced; every clip and line
       already made (in any version) is used as it is. */
    setBusy("export");
    const response = await fetch(`/api/video/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fresh.renders.length ? { onlyMissing: true, reuseEarlier: true } : {}),
    }).catch(() => null);
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
      } else if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey && !locked.has("video")) splitHere();
      else if ((event.key === "Delete" || event.key === "Backspace") && selected && !locked.has("video")) takeOut(selected.n);
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
    <main className="qs-studio relative z-10 mx-auto w-full max-w-[1400px] flex-1 px-3 pb-28 pt-4 md:px-5 lg:pb-16">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/video/${id}`} aria-label="Back to the studio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/[0.08] text-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1 basis-[60%] sm:basis-auto">
          <p className="text-[11.5px] text-muted">Editor · {formatSeconds(total)} · {draft?.scenes.length ?? 0} scene{draft?.scenes.length === 1 ? "" : "s"}</p>
          <h1 className="truncate text-[17px] font-semibold text-ink">{draft?.title ?? data.video.title}</h1>
        </div>
        {/* One row on a phone: undo, redo, settings and save on the left, export on the right. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <button onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (⌘Z)" className={chip}><Undo2 className="h-3.5 w-3.5" /></button>
        <button onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (⇧⌘Z)" className={chip}><Redo2 className="h-3.5 w-3.5" /></button>
        <button onClick={() => setLibraryTab("settings")} disabled={!draft} className={chip}><SlidersHorizontal className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Settings</span></button>
        <button onClick={() => void save()} disabled={!dirty || busy !== null || rendering} className={chip}>
          {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
        <button onClick={() => void exportVideo()} disabled={!draft || busy !== null || rendering} className="ml-auto flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-solid px-3.5 text-[12.5px] font-medium text-onSolid disabled:opacity-50 sm:ml-0">
          {busy === "export" || rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {rendering ? `Exporting ${doneRows}/${renderRows.length}` : data.renders.length ? (missingScenes ? `Make ${missingScenes} missing scene${missingScenes === 1 ? "" : "s"}` : "Save & export") : `Export${data.cost ? ` · ${creditsLabel(data.cost)}` : free?.own ? " · Free" : ""}`}
        </button>
        </div>
      </header>
      {(ownEdit || ownCut) && free && (
        /* Own clips: upload, arrange and trim free; only Export is paid — and the first three videos not even that. */
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-[#E8915F]/25 bg-[#E8915F]/[0.07] px-3 py-2 text-[12.5px] text-soft">
          <span className="font-medium text-[#E8915F]">{free.thisVideo ? "This video exports free" : free.left > 0 ? `${free.left} of ${free.total} free exports left` : `Export ${creditsLabel(ownCutCredits(total))}`}</span>
          <span>
            {free.thisVideo
              ? "— it's one of your free tries. Uploading, arranging and trimming your clips is always free."
              : free.left > 0
                ? `— your first ${free.total} videos of your own clips export free. Uploading, arranging and trimming is always free.`
                : "— half a credit per started minute. Uploading, arranging and trimming your clips is free."}
          </span>
        </p>
      )}
      {error && <p role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      {note && !error && <p className="mt-3 text-[12.5px] text-emerald-400">{note}</p>}
      {data.final && !rendering && (
        /* The finished video as a card of its own: what it is on the left,
           Play and Download as real buttons on the right — not two links in a line. */
        <section aria-label="Finished video" className="qs-final-card mt-3 flex flex-wrap items-center gap-3 rounded-[16px] p-2.5 pr-3 sm:flex-nowrap">
          <span aria-hidden className="qs-final-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]">
            <Film className="h-5 w-5 text-white" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white">
              Finished video <span className="h-1.5 w-1.5 rounded-full bg-[#7CF2B8] shadow-[0_0_6px_#7CF2B8]" aria-hidden />
            </span>
            <span className="block truncate text-[11.5px] text-white/55">
              Version {data.video.current_version} · {`${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`} · MP4
            </span>
          </span>
          <span className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <a
              href={`/api/video/${id}/file?v=${data.video.current_version}`}
              target="_blank"
              rel="noopener"
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-semibold text-black shadow-[0_6px_18px_-6px_rgba(255,255,255,0.45)] transition hover:bg-white/90 active:scale-[0.98] sm:flex-none"
            >
              <Play className="h-3.5 w-3.5 fill-current" /> Play
            </a>
            <a
              href={`/api/video/${id}/file?v=${data.video.current_version}&download=1`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-4 text-[12.5px] font-semibold text-white transition hover:bg-white/[0.14] active:scale-[0.98] sm:flex-none"
            >
              <Download className="h-3.5 w-3.5" /> Download MP4
            </a>
          </span>
        </section>
      )}

      {!draft ? (
        <div className="mt-4">
          <MediaPanel videoId={id} assets={assets} title="Your clips" description={ownEdit ? "Drop in the clips you shot — any camera, any app. They go onto the timeline by themselves, in the order you add them; then trim, reorder and export." : "Upload the pieces of your video. They go on the timeline in the order you add them."} inTimeline={new Set()} onChanged={() => load(true)}>
            <button onClick={() => void stitch()} disabled={busy !== null || !assets.some((a) => a.kind !== "audio" && a.kind !== "render" && a.kind !== "document" && a.status !== "failed")} className="flex h-9 items-center gap-2 rounded-full bg-solid px-4 text-[13px] font-medium text-onSolid disabled:opacity-50">
              {busy === "stitch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />} Put them on the timeline
            </button>
          </MediaPanel>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 lg:grid lg:grid-cols-[360px_minmax(0,1fr)_340px] lg:grid-rows-[min(64vh,680px)_auto]">
            {/* Library: what goes into the video */}
            <section ref={libraryRef} className="order-3 flex min-h-[320px] min-w-0 scroll-mt-4 flex-col rounded-[16px] border border-line/[0.08] bg-panel p-3 lg:order-none lg:min-h-0">
              <EditorLibrary
                tab={libraryTab}
                onTab={setLibraryTab}
                plan={draft}
                selected={selected ?? null}
                sample={(selected ? segments.find((s) => s.n === selected.n) : current?.segment)?.posterUrl ?? null}
                onChange={(next) => change(next)}
                media={
                  <MediaPanel
                    variant="library"
                    videoId={id}
                    assets={assets}
                    title="Media"
                    description=""
                    inTimeline={new Set(draft.scenes.flatMap((s) => (s.source ? [s.source.assetId] : [])))}
                    musicAssetId={cut?.music.source === "upload" ? cut.music.assetId : null}
                    onAdd={(asset) => change((p) => ({ ...p, scenes: [...p.scenes, sceneFromAsset(asset, p.scenes.length + 1)] }))}
                    onUseMusic={(asset) => change((p) => ({ ...p, cut: { ...(p.cut ?? {}), music: asset ? { source: "upload", assetId: asset.id } : { source: "none" } } }))}
                    references={new Set(draft.referenceClips ?? [])}
                    onReference={(asset) => change((p) => toggleReference(p, asset.id))}
                    onContinue={(asset) => change((p) => withContinuation(p, asset))}
                    onChanged={() => load(true)}
                  />
                }
                scenes={
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
                }
                cast={<CharactersPanel videoId={id} cast={draft.characters ?? []} photos={assets} onCast={(next) => change((p) => withCast(p, next))} />}
                settings={<VideoSettings plan={draft} audioAssets={assets} onChange={(next) => change(next)} />}
              />
            </section>

            {/* Preview */}
            <section className="order-1 flex min-w-0 flex-col rounded-[16px] border border-line/[0.08] bg-panel p-3 lg:order-none lg:min-h-0">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="w-full">
                  <Preview videoId={id} plan={draft} segment={current?.segment ?? null} offset={current?.offset ?? 0} slots={[slotA, slotB]} active={activeSlot} />
                </div>
              </div>
              <audio ref={voiceRef} preload="auto" />
              <audio ref={musicRef} preload="auto" />
              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={() => seek(0)} aria-label="To the start" className="flex h-8 w-8 items-center justify-center rounded-full text-soft hover:text-ink"><SkipBack className="h-4 w-4" /></button>
                <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} className="flex h-9 w-9 items-center justify-center rounded-full bg-solid text-onSolid">
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <span className="rounded-[8px] bg-layer/[0.06] px-2 py-1 font-mono text-[12px] tabular-nums text-ink" title="Hours:minutes:seconds:frames">{timecode(time, cut?.fps ?? 30)}</span>
                <span className="font-mono text-[12px] tabular-nums text-muted">/ {timecode(total, cut?.fps ?? 30)}</span>
                <span className="ml-auto hidden text-[11px] text-muted xl:inline">Transitions are added on export.</span>
              </div>
            </section>

            {/* Right: the selection, or the AI editor */}
            <aside ref={inspectRef} className="order-4 flex min-w-0 scroll-mt-4 flex-col rounded-[16px] border border-line/[0.08] bg-panel p-3 lg:order-none lg:min-h-0">
              <div className="flex gap-1 rounded-full bg-layer/[0.06] p-0.5 text-[12px]" role="tablist">
                <button role="tab" aria-selected={rightTab === "inspect"} onClick={() => setRightTab("inspect")} className={`h-7 flex-1 rounded-full ${rightTab === "inspect" ? "bg-layer/[0.16] text-ink" : "text-muted"}`}>
                  {selection?.type === "scene" && selected ? `Clip ${draft.scenes.findIndex((s) => s.n === selected.n) + 1}` : selection ? "Sound" : "Edit"}
                </button>
                <button role="tab" aria-selected={rightTab === "ai"} onClick={() => setRightTab("ai")} className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-full ${rightTab === "ai" ? "bg-layer/[0.16] text-ink" : "text-muted"}`}>
                  <Sparkles className="h-3.5 w-3.5 text-accent" /> AI editor{suggestions.length ? ` · ${suggestions.length}` : ""}
                </button>
              </div>
              <div className="mt-2.5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
                {rightTab === "inspect" ? (
                  <>
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
                  <p className="mt-1">Edit freely and Save — saving is free and never films anything. {ownCut ? <>Export joins your clips into the final video ({free && (free.thisVideo || free.left > 0) ? "free — one of your free tries" : `${creditsLabel(ownCutCredits(total))} at this length — half a credit per started minute`}).</> : <>Export makes the final video ({total > ONE_RUN_SECONDS ? `up to ${creditsLabel(cutCredits(total))} — only the parts you changed are cut and charged again` : `${creditsLabel(cutCredits(total))} at this length`} — 1 credit per started minute), filming only scenes that were never made.</>} Click a clip on the timeline to trim it, change its speed or sound, its words or its voice. Drag clips to reorder; drag their edges to trim. <b className="text-soft">Space</b> plays, <b className="text-soft">S</b> splits at the playhead, <b className="text-soft">Delete</b> removes, <b className="text-soft">⌘Z</b> undoes.</p>
                  <button onClick={() => setSelection({ type: "music" })} className={`${chip} mt-3`}><Music className="h-3.5 w-3.5" /> Music and voice</button>
                </section>
              )}

                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </aside>

          {/* Timeline: under all three, full width; second on a phone */}
          <div className="order-2 min-w-0 lg:order-none lg:col-span-3">
          <Timeline
            videoId={id}
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
            onSelect={(next) => {
              setSelection(next);
              if (next) setRightTab("inspect");
            }}
            onMove={(n, index) => change((p) => moveScene(p, n, index))}
            onTrim={(n, edge, delta) => change((p) => trimEdge(p, n, edge, delta, assets))}
            onSplit={splitHere}
            onDuplicate={() => selected && change((p) => duplicateScene(p, selected.n))}
            onDelete={() => selected && takeOut(selected.n)}
            canEditSelected={Boolean(selected)}
            cut={cut}
            onCut={(patch) => change((p) => ({ ...p, cut: { ...(p.cut ?? {}), ...patch } }))}
            onOpenTab={(tab) => setLibraryTab(tab)}
            locked={locked}
            onLocked={setLocked}
            onClearText={(n) => change((p) => ({ ...p, scenes: p.scenes.map((scene) => (scene.n === n ? { ...scene, onScreenText: "" } : scene)) }))}
            onDropAsset={(assetId, index) => {
              const asset = assets.find((a) => a.id === assetId);
              if (!asset) return;
              change((p) => {
                const scenes = [...p.scenes];
                scenes.splice(Math.max(0, Math.min(index, scenes.length)), 0, sceneFromAsset(asset, 0));
                return { ...p, scenes: scenes.map((scene, i) => ({ ...scene, n: i + 1 })) };
              });
            }}
          />
          </div>
          </div>
        </>
      )}
      {/* On a phone: the tools along the bottom, one tap from anywhere. Each
          opens its panel and brings it into view; the timeline stays put. */}
      {draft && (
        <nav aria-label="Editing tools" className="fixed inset-x-0 bottom-0 z-40 border-t border-line/[0.08] bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-stretch justify-between px-1">
            {(
              [
                { label: "Edit", icon: Scissors, go: () => openTool("scenes") },
                { label: "Audio", icon: Music, go: () => openInspect({ type: "music" }) },
                { label: "Text", icon: TypeIcon, go: () => openTool("text") },
                { label: "Effects", icon: Shuffle, go: () => openTool("transitions") },
                { label: "Media", icon: ImageIcon, go: () => openTool("media") },
                { label: "Captions", icon: Captions, go: () => openTool("settings") },
                { label: "Filters", icon: Palette, go: () => openTool("filters") },
              ] as const
            ).map(({ label, icon: Icon, go }) => (
              <button key={label} type="button" onClick={go} className="flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[10.5px] text-soft active:text-ink">
                <Icon className="h-5 w-5" strokeWidth={1.6} />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </main>
  );
}

/** "00:01:05:12" — hours, minutes, seconds and frames. Pure. */
export function timecode(seconds: number, fps: number): string {
  const total = Math.max(0, seconds);
  const frames = Math.floor((total % 1) * fps + 1e-6);
  const s = Math.floor(total);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}:${pad(Math.min(frames, fps - 1))}`;
}

/* ── Preview ─────────────────────────────────────────────────────────── */
function Preview({ videoId, plan, segment, offset, slots, active }: { videoId: string; plan: ProductionPlan; segment: Segment | null; offset: number; slots: [React.RefObject<HTMLVideoElement | null>, React.RefObject<HTMLVideoElement | null>]; active: 0 | 1 }) {
  const cut = resolveCut(plan);
  const fit = cut.fit === "fill" ? "object-cover" : "object-contain";
  const zoom = segment?.kind === "image" && cut.stillMotion !== "none" ? 1 + 0.12 * (cut.stillMotion === "zoom-out" ? 1 - offset / segment.seconds : offset / segment.seconds) : 1;
  /* The clip's own filter, else the video's. */
  const filter = COLOR_CSS[segment?.color ?? cut.color];
  const captionY = cut.captionPosition === "top" ? "top-[8%]" : cut.captionPosition === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[8%]";
  const captionSize = cut.captionSize === "small" ? "text-[12px]" : cut.captionSize === "large" ? "text-[18px]" : "text-[14px]";
  const captionStyle = cut.captionStyle === "box" ? "bg-black/70 text-white" : cut.captionStyle === "highlight" ? "text-[#FFE14D] [text-shadow:0_0_3px_#000,0_0_3px_#000]" : "text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]";
  const showCaption = cut.captions && segment?.caption && cut.audio !== "original";
  /* Under the player while a clip first loads: the clip's own opening frame,
     sharp (made on the server at full size) — not a small timeline still
     stretched, which is what made every scene start blurred. */
  const still = segment?.kind === "video" && segment.mediaUrl ? stripUrl(videoId, segment.mediaUrl, { count: 1, from: segment.from, seconds: 0.2, height: 720 }) : (segment?.posterUrl ?? null);
  return (
    <div className="relative mx-auto overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: RATIO[plan.aspect] ?? "16 / 9", maxHeight: "56vh" }}>
      {cut.fit === "fit-blur" && still && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={still} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
      )}
      {segment?.kind === "video" && still && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={still} alt="" className={`absolute inset-0 h-full w-full ${fit}`} style={{ filter }} />
      )}
      {/* The two players (A/B): the one in use on top; the other waits, loaded, behind it — not display:none, which an iPhone would not load. */}
      {slots.map((ref, i) => (
        <video
          key={i}
          ref={ref}
          playsInline
          preload="auto"
          muted={i !== active}
          aria-hidden={i !== active}
          className={`absolute inset-0 h-full w-full ${fit} ${segment?.kind === "video" && i === active ? "z-[1] opacity-100" : "pointer-events-none opacity-0"}`}
          style={{ filter }}
        />
      ))}
      {segment?.kind === "image" && segment.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={segment.mediaUrl} alt="" className={`absolute inset-0 h-full w-full ${fit}`} style={{ transform: `scale(${zoom})`, filter }} />
      )}
      {segment?.kind === "pending" && (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#1b2340] via-[#121218] to-[#2a1630] p-4 text-center">
          <span className="text-[10.5px] uppercase tracking-wider text-white/50">Scene {segment.n} · made on export</span>
          <span className="line-clamp-3 max-w-[90%] text-[12px] text-white/70">{segment.label}</span>
        </div>
      )}
      {segment?.text && <p className="absolute left-0 right-0 top-[10%] z-[2] px-4 text-center text-[clamp(14px,3.5vw,24px)] font-extrabold text-white [text-shadow:0_2px_10px_rgba(0,0,0,.8)]">{segment.text}</p>}
      {showCaption && <p className={`absolute left-[8%] right-[8%] z-[2] ${captionY} rounded-md px-2 py-1 text-center font-semibold ${captionSize} ${captionStyle}`}>{segment!.caption}</p>}
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
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Scenes in order · {props.plan.scenes.length}</p>
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
                  <span className={`relative h-9 w-14 shrink-0 overflow-hidden rounded-[6px] bg-layer/[0.1] ${props.current === scene.n ? "ring-2 ring-accent" : ""}`} style={thumb ? undefined : placeholderStyle(`${scene.shot}${scene.visual}`)}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Sparkles className="absolute inset-0 m-auto h-3.5 w-3.5 text-white/70" />
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
type TrackId = "video" | "filter" | "words" | "voice" | "music";

/* The timeline, laid out the way the phone editors people know are: the
 * playhead stays still in the middle and the tracks slide under it. Playing
 * scrolls them; dragging the tracks left and right scrubs. Each clip is a
 * filmstrip of its own frames, with a plain marker between clips; empty
 * tracks offer "Add audio" and "Add text" instead of blank rows. */
function Timeline(props: {
  videoId: string;
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
  cut: ResolvedCut | null;
  onCut: (patch: Partial<NonNullable<ProductionPlan["cut"]>>) => void;
  onOpenTab: (tab: LibraryTab) => void;
  /** An upload dragged in from the library, put before the clip at `index`. */
  onDropAsset: (assetId: string, index: number) => void;
  /** Takes the words off a clip. */
  onClearText: (n: number) => void;
  /** Tracks locked against changes (the keyboard respects them too). */
  locked: Set<TrackId>;
  onLocked: (next: Set<TrackId>) => void;
}) {
  const { segments, pps, total, cut } = props;
  const length = Math.max(1, total * pps);
  const scroller = useRef<HTMLDivElement>(null);
  /* Half the visible width: the empty run before 0:00 and after the end, so
     the first and last frame can both sit under the centred playhead. */
  const [half, setHalf] = useState(160);
  const [drag, setDrag] = useState<{ n: number; edge: "start" | "end"; x0: number; delta: number } | null>(null);
  const [snap, setSnap] = useState(true);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  /* Whether the person is moving the tracks (then the scroll sets the time)
     or the time is moving them (then the time sets the scroll). */
  const scrubbing = useRef(false);
  const settle = useRef<number | null>(null);
  const step = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : pps >= 4 ? 30 : 60;
  const locked = props.locked;
  const isLocked = (track: TrackId) => locked.has(track);
  const toggleLock = (track: TrackId) => {
    const next = new Set(locked);
    if (next.has(track)) next.delete(track);
    else next.add(track);
    props.onLocked(next);
  };

  /* The run before and after: half of whatever width the timeline has. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHalf(Math.max(40, Math.round(el.clientWidth / 2)));
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  /* The time moves the tracks — unless the person is moving them. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || scrubbing.current) return;
    const target = Math.round(props.time * pps);
    if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target;
  }, [props.time, pps, half]);

  const startScrub = () => {
    scrubbing.current = true;
    if (settle.current) window.clearTimeout(settle.current);
  };
  /* The time as of now, for the re-sync below. */
  const timeNow = useRef(props.time);
  timeNow.current = props.time;
  const endScrubSoon = () => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      scrubbing.current = false;
      /* A press that was a click (the ruler, a clip) moved the time without
         moving the tracks: line them back up under the playhead. */
      const el = scroller.current;
      if (el) {
        const target = Math.round(timeNow.current * pps);
        if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target;
      }
    }, 160);
  };

  const seekFrom = (event: React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    props.onSeek(Math.max(0, Math.min(total, (event.clientX - box.left) / pps)));
  };
  const lengthOf = (s: Segment) => (drag && drag.n === s.n ? Math.max(0.3, s.seconds + (drag.edge === "end" ? drag.delta : -drag.delta)) : s.seconds);
  const leftOf = (s: Segment) => (drag && drag.n === s.n && drag.edge === "start" ? s.start + drag.delta : s.start);
  const sceneOf = (n: number): Scene | undefined => props.plan.scenes.find((s) => s.n === n);
  const isSel = (n: number) => props.selection?.type === "scene" && props.selection.n === n;
  /* Snapping: a trimmed edge lands on the playhead or another clip's edge when it comes within 8 px. */
  const snapped = (s: Segment, edge: "start" | "end", delta: number) => {
    if (!snap) return delta;
    const at = (edge === "end" ? s.start + s.seconds : s.start) + delta;
    const targets = [props.time, ...segments.flatMap((x) => (x.n === s.n ? [] : [x.start, x.start + x.seconds]))];
    const near = targets.find((t) => Math.abs(t - at) * pps < 8);
    return near === undefined ? delta : near - (edge === "end" ? s.start + s.seconds : s.start);
  };
  /* Where a dropped upload goes: before the first clip whose middle is right of the pointer. */
  const indexAt = (x: number) => {
    const t = x / pps;
    const at = segments.findIndex((s) => t < s.start + s.seconds / 2);
    return at < 0 ? segments.length : at;
  };
  const color = cut?.color ?? "none";
  const anyFilter = color !== "none" || segments.some((s) => s.color && s.color !== color);
  const anyText = segments.some((s) => s.text);
  const anyVoice = segments.some((s) => s.caption || sceneOf(s.n)?.voiceAsset);
  const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const TILE = 56;

  const header = (track: TrackId, label: string, height: string, sound?: { on: boolean; toggle: () => void; what: string }) => (
    <div className={`flex items-center gap-0.5 ${height}`}>
      <span className="w-[46px] truncate text-[10.5px] font-medium text-muted">{label}</span>
      <button type="button" onClick={() => toggleLock(track)} aria-label={`${isLocked(track) ? "Unlock" : "Lock"} the ${label} track`} title={isLocked(track) ? "Locked — click to edit again" : "Lock this track"} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-ink">
        {isLocked(track) ? <Lock className="h-3 w-3 text-amber-300" /> : <Unlock className="h-3 w-3" />}
      </button>
      {sound && (
        <button type="button" onClick={sound.toggle} aria-label={sound.on ? `Mute ${sound.what}` : `Unmute ${sound.what}`} title={sound.on ? `Mute ${sound.what}` : `Unmute ${sound.what}`} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-ink">
          {sound.on ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3 text-danger" />}
        </button>
      )}
    </div>
  );

  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel py-3">
      <div className="mb-1 flex flex-nowrap items-center gap-1 px-3 sm:gap-1.5">
        <span className="mr-1 shrink-0 whitespace-nowrap font-mono text-[12.5px] tabular-nums text-ink">
          {mmss(props.time)} <span className="text-muted">/ {mmss(total)}</span>
        </span>
        <button onClick={props.onSplit} disabled={isLocked("video")} title="Split at the playhead (S)" className={chip}><Scissors className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Split</span></button>
        <button onClick={props.onDuplicate} disabled={!props.canEditSelected || isLocked("video")} title="Duplicate" className={chip}><Copy className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Duplicate</span></button>
        <button onClick={props.onDelete} disabled={!props.canEditSelected || isLocked("video")} title="Delete" className={chip}><Trash2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Delete</span></button>
        <button onClick={() => setSnap((v) => !v)} aria-pressed={snap} title="Snap edges to the playhead and to other clips" className={`${chip} ${snap ? "border-accent/50 text-accent" : ""}`}><Magnet className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Snap</span></button>
        <span className="ml-auto flex shrink-0 items-center">
          <button onClick={() => props.onZoom(pps / 1.5)} aria-label="Zoom out" className="flex h-8 w-7 items-center justify-center rounded-full text-soft hover:text-ink sm:w-8"><ZoomOut className="h-4 w-4" /></button>
          <button onClick={() => props.onZoom(pps * 1.5)} aria-label="Zoom in" className="flex h-8 w-7 items-center justify-center rounded-full text-soft hover:text-ink sm:w-8"><ZoomIn className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="flex">
        {/* Track headers: lock and mute — on a phone the tracks get the full width. */}
        <div className="hidden w-[92px] shrink-0 select-none border-r border-line/[0.06] pl-3 pr-1 sm:block">
          <div className="h-7" />
          {header("video", "Video", "h-16", cut ? { on: cut.originalVolume > 0, toggle: () => props.onCut({ originalVolume: cut.originalVolume > 0 ? 0 : 1 }), what: "the clips' own sound" } : undefined)}
          {anyFilter && <div className="mt-1.5">{header("filter", "Filter", "h-7")}</div>}
          {anyVoice && <div className="mt-1.5">{header("voice", "Voice", "h-7", cut ? { on: cut.voiceVolume > 0, toggle: () => props.onCut({ voiceVolume: cut.voiceVolume > 0 ? 0 : 1 }), what: "the voice-over" } : undefined)}</div>}
          <div className="mt-1.5">{header("music", "Audio", "h-9", cut ? { on: cut.musicVolume > 0, toggle: () => props.onCut({ musicVolume: cut.musicVolume > 0 ? 0 : 1 }), what: "the music" } : undefined)}</div>
          <div className="mt-1.5">{header("words", "Text", "h-9")}</div>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            ref={scroller}
            className="overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onPointerDown={startScrub}
            onPointerUp={endScrubSoon}
            onPointerCancel={endScrubSoon}
            onTouchStart={startScrub}
            onTouchEnd={endScrubSoon}
            onWheel={() => {
              startScrub();
              endScrubSoon();
            }}
            onScroll={(e) => {
              if (!scrubbing.current) return;
              props.onSeek(Math.max(0, Math.min(total, e.currentTarget.scrollLeft / pps)));
              endScrubSoon();
            }}
          >
            <div className="relative select-none" style={{ width: length + half * 2, paddingLeft: half, paddingRight: half }}>
              <div className="relative" style={{ width: length }}>
                {/* Ruler: times, with a dot between them */}
                <div className="relative h-7 cursor-pointer" onClick={seekFrom}>
                  {Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).map((t) => (
                    <span key={t}>
                      <span className="absolute top-1.5 -translate-x-1/2 text-[10.5px] tabular-nums text-muted" style={{ left: t * pps }}>{mmss(t)}</span>
                      {t + step / 2 <= total && <span className="absolute top-[13px] h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-muted/60" style={{ left: (t + step / 2) * pps }} />}
                    </span>
                  ))}
                </div>

                {/* Video track: each clip a filmstrip of its own frames */}
                <div
                  className={`relative h-16 ${dropAt !== null ? "rounded-[6px] bg-accent/[0.06]" : ""}`}
                  onClick={(e) => e.target === e.currentTarget && seekFrom(e)}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(ASSET_DRAG) || isLocked("video")) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setDropAt(indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
                  }}
                  onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}
                  onDrop={(e) => {
                    const assetId = e.dataTransfer.getData(ASSET_DRAG);
                    setDropAt(null);
                    if (!assetId || isLocked("video")) return;
                    e.preventDefault();
                    props.onDropAsset(assetId, indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
                  }}
                >
                  {segments.map((s, index) => {
                    const scene = sceneOf(s.n);
                    const picture = s.posterUrl ?? (s.kind === "image" ? s.mediaUrl : null);
                    /* The clip's own frames, along the part of it on screen, made on the server (filmstrip.ts). */
                    const frames = s.kind === "video" && s.mediaUrl ? stripUrl(props.videoId, s.mediaUrl, { from: s.from, seconds: s.seconds * (s.speed || 1) }) : undefined;
                    const w = Math.max(14, lengthOf(s) * pps - 1);
                    const tiles = Math.max(1, Math.ceil(w / TILE));
                    const filter = COLOR_CSS[s.color ?? color] || undefined;
                    return (
                      <div
                        key={s.n}
                        draggable={!isLocked("video")}
                        onDragStart={(e) => {
                          dragging.current = s.n;
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (dragging.current !== null) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          const from = dragging.current;
                          dragging.current = null;
                          if (from === null) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (from === s.n) return;
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
                        className={`group absolute top-0 flex h-16 overflow-hidden ${isLocked("video") ? "cursor-default" : "cursor-grab"} ${isSel(s.n) ? "z-[5] rounded-[4px] outline outline-2 outline-white" : ""} bg-layer/[0.08]`}
                        style={{ left: leftOf(s) * pps, width: w, ...(frames || picture ? {} : placeholderStyle(`${scene?.shot ?? ""}${scene?.visual ?? s.label}`)) }}
                        title={`${s.label} · ${s.seconds.toFixed(1)}s${s.fallback ? (s.failed ? " · the latest re-film failed (nothing charged) — showing the last clip that worked; Export tries the new one again" : " · showing the last clip that worked until the new one is made") : s.kind === "pending" ? (s.failed ? " · not made last time (nothing charged) — Export tries it again" : " · not filmed yet — Export films it") : ""}`}
                      >
                        {/* The strip: one tile per 56px, each showing the frame from its part of the clip */}
                        {(frames || picture) &&
                          Array.from({ length: tiles }, (_, i) => {
                            const width = i === tiles - 1 ? w - TILE * (tiles - 1) : TILE;
                            /* The frame from this tile's part of the clip; the still underneath until the strip arrives. */
                            const frame = frames ? spriteFrame(frames, Math.floor(((i + 0.5) / tiles) * STRIP_FRAMES), STRIP_FRAMES) : null;
                            return (
                              <span key={i} aria-hidden className="relative h-full shrink-0 overflow-hidden border-r border-black/40 last:border-r-0" style={{ width, filter }}>
                                {picture && <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${picture}")` }} />}
                                {frame && <span className="absolute inset-0" style={frame} />}
                              </span>
                            );
                          })}
                        <span className="pointer-events-none absolute left-0 right-0 top-0 truncate bg-gradient-to-b from-black/60 to-transparent px-1.5 pb-1 pt-0.5 text-[10px] font-medium text-white/90">
                          {index + 1}. {scene?.source ? s.label : scene?.shot || "Generated"}
                        </span>
                        {!picture && !frames && !s.fallback && (
                          <span className="pointer-events-none absolute bottom-0.5 left-1.5 flex items-center gap-1 rounded bg-black/45 px-1 text-[9.5px] text-white/85">
                            {s.kind === "pending" ? (s.failed ? <span className="flex items-center gap-1 text-amber-300"><RotateCcw className="h-2.5 w-2.5" /> Not made · retry on export</span> : <><Sparkles className="h-2.5 w-2.5" /> Not filmed yet</>) : <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          </span>
                        )}
                        <span className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-black/60 px-1 text-[9.5px] tabular-nums text-white">{lengthOf(s).toFixed(1)}s</span>
                        {!isLocked("video") && (["start", "end"] as const).map((edge) => (
                          <span
                            key={edge}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              (e.target as HTMLElement).setPointerCapture(e.pointerId);
                              setDrag({ n: s.n, edge, x0: e.clientX, delta: 0 });
                            }}
                            onPointerMove={(e) => drag && drag.n === s.n && drag.edge === edge && setDrag({ ...drag, delta: snapped(s, edge, (e.clientX - drag.x0) / pps) })}
                            onPointerUp={() => {
                              if (drag && drag.n === s.n && Math.abs(drag.delta) > 0.02) props.onTrim(s.n, edge, drag.delta);
                              setDrag(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute top-0 flex h-full w-3 cursor-ew-resize items-center justify-center ${edge === "start" ? "left-0" : "right-0"} ${isSel(s.n) ? "bg-white" : "bg-transparent hover:bg-white/40"}`}
                            aria-label={edge === "start" ? "Trim the start" : "Trim the end"}
                          >
                            {isSel(s.n) && <span className="h-5 w-0.5 rounded-full bg-black/70" />}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                  {/* Between clips: a small white marker — the transition */}
                  {segments.slice(1).map((s) => (
                    <button
                      key={`t-${s.n}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onOpenTab("transitions");
                      }}
                      title={cut ? `${LABELS.transition[cut.transition]}${cut.transition !== "cut" ? ` · ${cut.transitionSeconds.toFixed(1)}s` : ""} — change` : "Transition"}
                      aria-label="Transition"
                      className="absolute top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] bg-white shadow-md ring-1 ring-black/20"
                      style={{ left: s.start * pps }}
                    >
                      {cut && cut.transition !== "cut" ? <Diamond className="h-3 w-3 text-black" /> : <span className="h-3 w-[2px] rounded-full bg-black" />}
                    </button>
                  ))}
                  {/* Add more, at the end of the clips */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenTab("media");
                    }}
                    aria-label="Add media"
                    title="Add clips, pictures or music"
                    className="absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] bg-white text-black shadow-md"
                    style={{ left: length + 10 }}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  {/* Where a dragged upload will land */}
                  {dropAt !== null && (
                    <span className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-accent" style={{ left: (segments[dropAt]?.start ?? total) * pps }} />
                  )}
                </div>

                {/* Filter track: only when there is a look on the video or a clip */}
                {anyFilter && (
                  <div className="relative mt-1.5 h-7">
                    <button
                      type="button"
                      onClick={() => props.onOpenTab("filters")}
                      className="absolute top-0 h-7 truncate rounded-[6px] bg-indigo-500/25 px-2 text-left text-[11px] text-indigo-100"
                      style={{ left: 0, width: length }}
                      title="The whole video's filter — click to change"
                    >
                      ◐ {LABELS.color[color]}
                    </button>
                    {segments.map((s) =>
                      s.color && s.color !== color ? (
                        <button
                          key={`f-${s.n}`}
                          type="button"
                          onClick={() => {
                            props.onSelect({ type: "scene", n: s.n });
                            props.onOpenTab("filters");
                          }}
                          className="absolute top-0 h-7 truncate rounded-[6px] bg-fuchsia-500/40 px-2 text-left text-[11px] text-white ring-1 ring-fuchsia-300/40"
                          style={{ left: s.start * pps, width: Math.max(14, s.seconds * pps - 2) }}
                          title="This clip's own filter"
                        >
                          ◐ {LABELS.color[s.color]}
                        </button>
                      ) : null,
                    )}
                  </div>
                )}

                {/* Voice track: only when something is spoken */}
                {anyVoice && (
                  <div className={`relative mt-1.5 h-8 ${cut && cut.voiceVolume === 0 ? "opacity-40" : ""}`}>
                    {segments.map((s) =>
                      s.caption || sceneOf(s.n)?.voiceAsset ? (
                        /* A studio voice clip: a dark, lit card with its waveform
                           behind the words, a glowing mic badge, and a dot that
                           says whether the line is recorded yet (globals.css
                           .qs-voice-clip). */
                        <button
                          key={s.n}
                          disabled={isLocked("voice")}
                          onClick={() => props.onSelect({ type: "scene", n: s.n })}
                          className={`qs-voice-clip group/voice absolute top-0 flex h-8 items-center gap-1.5 overflow-hidden rounded-[8px] pl-1 pr-2 text-left ${s.voiceUrl ? "" : "qs-voice-clip--pending"} ${isSel(s.n) ? "qs-voice-clip--selected" : ""}`}
                          style={{ left: s.start * pps, width: Math.max(14, s.seconds * pps - 2) }}
                          title={s.voiceUrl ? "Voice line ready" : "Voice line made on export"}
                        >
                          <span aria-hidden className="qs-voice-badge relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                            <Mic className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
                          </span>
                          <span className="relative min-w-0 flex-1 truncate text-[11.5px] font-medium tracking-[0.01em] text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{s.caption || "Recording"}</span>
                          <span aria-hidden className={`relative h-1.5 w-1.5 shrink-0 rounded-full ${s.voiceUrl ? "bg-[#7CF2B8] shadow-[0_0_6px_#7CF2B8]" : "bg-white/35"}`} />
                        </button>
                      ) : null,
                    )}
                  </div>
                )}

                {/* Audio track: the music, or a place to add it */}
                <div className={`relative mt-1.5 h-9 ${cut && cut.musicVolume === 0 ? "opacity-40" : ""}`}>
                  <button
                    disabled={isLocked("music")}
                    onClick={() => props.onSelect({ type: "music" })}
                    className={`absolute top-0 flex h-9 items-center gap-1.5 truncate rounded-[6px] px-3 text-left text-[12px] ${props.hasMusic ? "bg-emerald-500/25 text-emerald-100" : "bg-layer/[0.07] text-soft hover:bg-layer/[0.1]"} ${props.selection?.type === "music" ? "ring-2 ring-white/70" : ""}`}
                    style={{ left: 0, width: props.hasMusic ? length : Math.min(length, 240) }}
                  >
                    {props.hasMusic ? <>♪ {props.musicLabel}</> : <><Plus className="h-3.5 w-3.5" /> Add audio</>}
                  </button>
                </div>

                {/* Text track: the words on screen, or a place to add them */}
                <div className="relative mt-1.5 h-9">
                  {anyText ? (
                    segments.map((s) =>
                      s.text ? (
                        <span key={s.n} className="group/text absolute top-0 flex h-9 items-center rounded-[6px] bg-pink-500/35" style={{ left: s.start * pps, width: Math.max(14, s.seconds * pps - 2) }}>
                          <button disabled={isLocked("words")} onClick={() => { props.onSelect({ type: "scene", n: s.n }); props.onOpenTab("text"); }} className="h-9 min-w-0 flex-1 truncate px-2 text-left text-[11px] text-pink-50" title="Edit these words">
                            T · {s.text}
                          </button>
                          {!isLocked("words") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                props.onClearText(s.n);
                              }}
                              aria-label={`Remove the words on clip ${s.n}`}
                              title="Remove these words from the video"
                              className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-pink-50/80 hover:bg-black/30 hover:text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ) : null,
                    )
                  ) : (
                    <button
                      type="button"
                      disabled={isLocked("words")}
                      onClick={() => props.onOpenTab("text")}
                      className="absolute top-0 flex h-9 items-center gap-1.5 rounded-[6px] bg-layer/[0.07] px-3 text-[12px] text-soft hover:bg-layer/[0.1]"
                      style={{ left: 0, width: Math.min(length, 240) }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add text
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* The playhead: still, in the middle — the tracks move under it */}
          <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1 px-3 text-[10.5px] text-muted"><Eye className="h-3 w-3" /> Drag the timeline to scrub; the white line is the frame on screen. Tap a clip to edit it, drag its edges to trim.</p>
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
