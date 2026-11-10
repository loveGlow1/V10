"use client";

/* One of the person's own clips (or pictures) in the timeline: a small
 * player to find the moment, then trim it ("start here" / "end here", or the
 * exact seconds), its speed, its own sound's level, and mute. */

import { useRef } from "react";
import { Film, Volume2, VolumeX } from "lucide-react";

import { formatSeconds } from "@/lib/video/assets";
import { sourceSeconds, type SceneSource } from "@/lib/video/plan";

import type { PanelAsset } from "./MediaPanel";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export default function TimelineClip({
  source,
  asset,
  muted,
  duration,
  onSource,
  onMute,
  onDuration,
}: {
  source: SceneSource;
  asset: PanelAsset | undefined;
  muted: boolean;
  /** A picture's time on screen. */
  duration: number;
  onSource: (next: SceneSource) => void;
  onMute: (muted: boolean) => void;
  onDuration: (seconds: number) => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  if (!asset) {
    return <p className="mt-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-2 py-1.5 text-[12px] text-danger">This scene&apos;s upload was removed. Upload it again and add it, or remove this scene.</p>;
  }
  const still = asset.kind !== "video";
  const length = asset.durationS ?? null;
  const start = source.trimStart ?? 0;
  const end = source.trimEnd ?? length ?? 0;
  const plays = sourceSeconds(source, length);
  const clamp = (value: number) => Math.max(0, Math.min(length ?? value, Math.round(value * 10) / 10));
  const set = (patch: Partial<SceneSource>) => {
    const next: SceneSource = { ...source, ...patch };
    if (next.trimStart !== undefined && next.trimStart <= 0) delete next.trimStart;
    if (next.trimEnd !== undefined && length !== null && next.trimEnd >= length - 0.05) delete next.trimEnd;
    if (next.speed === 1) delete next.speed;
    if (next.volume === 1) delete next.volume;
    onSource(next);
  };
  const input = "w-full rounded-lg border border-line/[0.1] bg-transparent px-2 py-1 text-[13px] text-ink outline-none focus:border-line/[0.25]";

  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[10px] bg-black">
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          asset.url ? <img src={asset.url} alt="" className="max-h-[200px] w-full object-contain" /> : <div className="flex h-24 items-center justify-center text-muted"><Film className="h-5 w-5" /></div>
        ) : asset.url ? (
          <video ref={player} src={asset.url} poster={asset.posterUrl ?? undefined} controls playsInline preload="metadata" className="max-h-[200px] w-full" />
        ) : (
          <div className="flex h-24 items-center justify-center text-muted"><Film className="h-5 w-5" /></div>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-[12px] text-muted">
          {still ? "Your picture" : "Your clip"} · <span className="text-soft">{asset.name}</span>
          {!still && length !== null && <> · {formatSeconds(length)} long{plays !== null && <> · plays <span className="text-soft">{plays.toFixed(1)}s</span></>}</>}
        </p>
        {still ? (
          <label className="block max-w-[200px] text-[11.5px] text-muted">
            Seconds on screen
            <input type="number" min={1} max={60} step={0.5} value={duration} onChange={(e) => onDuration(Math.max(1, Math.min(60, Number(e.target.value) || 4)))} className={input} />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11.5px] text-muted">
                Start (s)
                <input type="number" min={0} max={length ?? undefined} step={0.1} value={start} onChange={(e) => set({ trimStart: clamp(Number(e.target.value) || 0) })} className={input} />
              </label>
              <label className="text-[11.5px] text-muted">
                End (s)
                <input type="number" min={0} max={length ?? undefined} step={0.1} value={end} onChange={(e) => set({ trimEnd: clamp(Number(e.target.value) || 0) })} className={input} />
              </label>
            </div>
            {asset.url && (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => player.current && set({ trimStart: clamp(player.current.currentTime) })} className="h-7 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-ink hover:bg-layer/[0.08]">Start here</button>
                <button type="button" onClick={() => player.current && set({ trimEnd: clamp(player.current.currentTime) })} className="h-7 rounded-full border border-line/[0.1] px-2.5 text-[11.5px] text-ink hover:bg-layer/[0.08]">End here</button>
                {(source.trimStart || source.trimEnd) && (
                  <button type="button" onClick={() => onSource({ ...source, trimStart: undefined, trimEnd: undefined })} className="h-7 rounded-full px-2.5 text-[11.5px] text-muted hover:text-ink">Whole clip</button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[11.5px] text-muted">
                Speed
                <select value={source.speed ?? 1} onChange={(e) => set({ speed: Number(e.target.value) })} className="mt-0.5 block rounded-lg border border-line/[0.1] bg-panel px-2 py-1 text-[13px] text-ink">
                  {SPEEDS.map((speed) => (
                    <option key={speed} value={speed}>{speed === 1 ? "Normal" : `${speed}×`}</option>
                  ))}
                </select>
              </label>
              <label className="min-w-[140px] flex-1 text-[11.5px] text-muted">
                Its own sound · {muted ? "muted" : `${Math.round((source.volume ?? 1) * 100)}%`}
                <input type="range" min={0} max={2} step={0.05} disabled={muted} value={source.volume ?? 1} onChange={(e) => set({ volume: Number(e.target.value) })} className="mt-1 block w-full accent-accent disabled:opacity-40" />
              </label>
              <button type="button" onClick={() => onMute(!muted)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12px] text-ink hover:bg-layer/[0.08]">
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />} {muted ? "Unmute" : "Mute"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
