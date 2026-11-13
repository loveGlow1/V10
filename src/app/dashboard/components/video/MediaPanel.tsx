"use client";

/* The studio's uploads: the person's own clips, sound and pictures.
 *
 * Drop files or pick them; each goes straight to storage with its own
 * progress bar (lib/video/upload-client.ts), then shows as a chip — its
 * kind, length, size and whether it is still being prepared — with a remove
 * button. A clip or picture can be added to the video's timeline, marked as
 * the look every generated scene matches, or continued — a new scene that
 * starts where it ends; a sound file can be the music. */

import { useRef, useState } from "react";
import { Check, FastForward, FileText, Film, Image as ImageIcon, Loader2, Music, Palette, Plus, Upload, X } from "lucide-react";

import { ACCEPT_ATTRIBUTE, formatSeconds, handles, type StudioAsset } from "@/lib/video/assets";
import { uploadStudioFile } from "@/lib/video/upload-client";

export type PanelAsset = StudioAsset & { error?: string | null; url?: string | null; posterUrl?: string | null; source?: string };

type Sending = { key: string; name: string; progress: number };

/** What a library tile carries when it is dragged onto the timeline. */
export const ASSET_DRAG = "application/x-quickstark-asset";

type Category = "all" | "video" | "audio" | "images" | "docs" | "made";
const CATEGORIES: [Category, string][] = [
  ["all", "All"],
  ["video", "Video"],
  ["audio", "Audio"],
  ["images", "Pictures"],
  ["docs", "Docs"],
  ["made", "Made here"],
];
/* Sound made in the editor (voice lines, music) is "made here"; the rest is
   sorted by kind. */
const categoryOf = (asset: PanelAsset): Exclude<Category, "all"> =>
  asset.source === "generated" ? "made" : asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : asset.kind === "document" ? "docs" : "images";

export default function MediaPanel({
  videoId,
  assets,
  title,
  description,
  role,
  inTimeline,
  musicAssetId,
  onAdd,
  onUseMusic,
  references,
  onReference,
  onContinue,
  onChanged,
  variant = "panel",
  children,
}: {
  videoId: string;
  assets: PanelAsset[];
  title: string;
  description: string;
  /** Pictures uploaded here stand for this (a product, the person, the photo). */
  role?: "product" | "person" | "photo";
  /** Upload ids already in the timeline. */
  inTimeline: Set<string>;
  musicAssetId?: string | null;
  /** Adds a clip or picture to the end of the timeline; absent before there is one. */
  onAdd?: (asset: PanelAsset) => void;
  onUseMusic?: (asset: PanelAsset | null) => void;
  /** Uploads marked as the look every generated scene matches. */
  references?: Set<string>;
  onReference?: (asset: PanelAsset) => void;
  /** Adds a generated scene that starts where this clip ends. */
  onContinue?: (asset: PanelAsset) => void;
  onChanged: () => Promise<unknown> | void;
  /** "library": the editor's left panel — a grid by category, each tile dragged onto the timeline. */
  variant?: "panel" | "library";
  children?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<Sending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("all");

  const shown = assets.filter((asset) => asset.kind !== "render");
  /* How a prompt names each upload: "@lagos-street". */
  const refs = handles(shown);

  async function send(files: File[]) {
    if (!files.length) return;
    setErrors([]);
    const queue = files.map((file, index) => ({ file, key: `${Date.now()}-${index}-${file.name}` }));
    setSending((current) => [...current, ...queue.map(({ key, file }) => ({ key, name: file.name, progress: 0 }))]);
    const failed: string[] = [];
    /* One at a time, in the order chosen: that is the timeline's order. */
    for (const { file, key } of queue) {
      const result = await uploadStudioFile(videoId, file, {
        role: role && file.type.startsWith("image/") ? role : undefined,
        onProgress: (progress) => setSending((current) => current.map((entry) => (entry.key === key ? { ...entry, progress } : entry))),
      });
      setSending((current) => current.filter((entry) => entry.key !== key));
      if (!result.ok) failed.push(result.error);
      else await onChanged();
    }
    setErrors(failed);
  }

  async function remove(asset: PanelAsset) {
    setRemoving(asset.id);
    const response = await fetch(`/api/video/${videoId}/assets?asset=${asset.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setErrors([`${asset.name || "That upload"} could not be removed. Try again.`]);
    await onChanged();
    setRemoving(null);
  }

  if (variant === "library") {
    const counts: Record<Category, number> = {
      all: shown.length,
      video: shown.filter((a) => categoryOf(a) === "video").length,
      audio: shown.filter((a) => categoryOf(a) === "audio").length,
      images: shown.filter((a) => categoryOf(a) === "images").length,
      docs: shown.filter((a) => categoryOf(a) === "docs").length,
      made: shown.filter((a) => categoryOf(a) === "made").length,
    };
    const visible = shown.filter((a) => category === "all" || categoryOf(a) === category);
    const iconButton = "flex h-6 w-6 items-center justify-center rounded-full text-soft hover:bg-layer/[0.12] hover:text-ink";
    return (
      <div
        className={`flex h-full min-h-0 flex-col rounded-[12px] ${over ? "ring-2 ring-accent/60" : ""}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setOver(false);
          void send(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line/[0.2] text-[12.5px] text-ink hover:bg-layer/[0.06]"
          >
            {sending.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void send(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {children}
        </div>
        <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Media by kind">
          {CATEGORIES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              onClick={() => setCategory(id)}
              className={`h-6 rounded-full px-2 text-[11px] ${category === id ? "bg-layer/[0.14] text-ink" : "text-muted hover:text-ink"}`}
            >
              {label} <span className="tabular-nums text-muted">{counts[id]}</span>
            </button>
          ))}
        </div>
        {sending.map((entry) => (
          <div key={entry.key} className="mt-2">
            <div className="flex justify-between text-[11px] text-soft">
              <span className="truncate">{entry.name}</span>
              <span className="tabular-nums text-muted">{Math.round(entry.progress * 100)}%</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-layer/[0.1]">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(3, entry.progress * 100)}%` }} />
            </div>
          </div>
        ))}
        {errors.map((text) => (
          <p key={text} role="alert" className="mt-2 rounded-[8px] border border-danger/30 bg-danger/[0.08] px-2 py-1 text-[11.5px] text-danger">{text}</p>
        ))}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">{shown.length ? "Nothing of this kind yet." : "Import clips, pictures or sound — or drop files here."}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {visible.map((asset) => {
                const Icon = asset.kind === "video" ? Film : asset.kind === "audio" ? Music : asset.kind === "document" ? FileText : ImageIcon;
                const visual = asset.kind !== "audio" && asset.kind !== "document";
                const used = inTimeline.has(asset.id);
                const isMusic = musicAssetId === asset.id;
                const ready = asset.status !== "failed";
                return (
                  <li key={asset.id} className="group min-w-0">
                    <div
                      draggable={visual && ready && Boolean(onAdd)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(ASSET_DRAG, asset.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={() => visual && ready && onAdd?.(asset)}
                      title={visual && onAdd ? "Drag onto the timeline, or double-click to add it at the end" : asset.name}
                      className={`relative aspect-video overflow-hidden rounded-[8px] bg-layer/[0.08] ${visual && onAdd ? "cursor-grab" : ""} ${used || isMusic ? "ring-1 ring-emerald-400/50" : ""}`}
                    >
                      {asset.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.posterUrl} alt="" className="pointer-events-none h-full w-full object-cover" />
                      ) : (
                        <Icon className="absolute inset-0 m-auto h-5 w-5 text-muted" />
                      )}
                      {asset.status === "processing" && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10.5px] text-white"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Preparing</span>
                      )}
                      {asset.status === "failed" && <span className="absolute inset-0 flex items-center justify-center bg-danger/40 px-1 text-center text-[10px] text-white" title={asset.error ?? undefined}>Could not be read</span>}
                      {asset.durationS ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">{formatSeconds(asset.durationS)}</span> : null}
                      {references?.has(asset.id) && <span className="absolute left-1 top-1 rounded bg-emerald-500/80 px-1 text-[9.5px] font-medium text-white">Look</span>}
                      {isMusic && <span className="absolute left-1 top-1 rounded bg-emerald-500/80 px-1 text-[9.5px] font-medium text-white">Music</span>}
                      <span className="absolute right-1 top-1 hidden gap-0.5 rounded-full bg-black/60 p-0.5 group-hover:flex group-focus-within:flex">
                        {visual && onAdd && ready && (
                          <button type="button" onClick={() => onAdd(asset)} title={used ? "In the video — add it again at the end" : "Add to the end"} aria-label="Add to the end" className={iconButton}><Plus className="h-3 w-3 text-white" /></button>
                        )}
                        {visual && onReference && ready && (
                          <button type="button" onClick={() => onReference(asset)} title={references?.has(asset.id) ? "Stop matching this look" : "Use as look: generated scenes match it"} aria-label="Use as look" className={iconButton}><Palette className="h-3 w-3 text-white" /></button>
                        )}
                        {visual && onContinue && ready && (
                          <button type="button" onClick={() => onContinue(asset)} title="Continue it: a new scene that starts where this ends" aria-label="Continue it" className={iconButton}><FastForward className="h-3 w-3 text-white" /></button>
                        )}
                        {asset.kind === "audio" && onUseMusic && ready && (
                          <button type="button" onClick={() => onUseMusic(isMusic ? null : asset)} title={isMusic ? "Stop using as music" : "Use as music"} aria-label="Use as music" className={iconButton}><Music className="h-3 w-3 text-white" /></button>
                        )}
                        <button type="button" onClick={() => void remove(asset)} disabled={removing === asset.id} title="Remove" aria-label={`Remove ${asset.name || "upload"}`} className={iconButton}>
                          {removing === asset.id ? <Loader2 className="h-3 w-3 animate-spin text-white" /> : <X className="h-3 w-3 text-white" />}
                        </button>
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-soft" title={asset.name}>{asset.name || (asset.kind === "video" ? "Clip" : asset.kind === "audio" ? "Sound" : "Picture")}</p>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(refs.get(asset.id) ?? "").catch(() => {})}
                      title="Use this name in your idea — click to copy"
                      className="block max-w-full truncate font-mono text-[10px] text-accent hover:underline"
                    >
                      {refs.get(asset.id)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <section
      className={`mt-5 rounded-[16px] border bg-panel p-4 ${over ? "border-accent/60" : "border-line/[0.08]"}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void send(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium text-ink">{title}</h2>
          <p className="text-[12.5px] text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-9 items-center gap-2 rounded-full border border-line/[0.1] bg-layer/[0.04] px-3.5 text-[13px] text-ink hover:bg-layer/[0.08]"
          >
            {sending.length ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void send(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {children}
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">Videos (MP4, MOV, WebM) up to 400 MB and an hour · sound (MP3, WAV, M4A) up to 50 MB · pictures (PNG, JPG, WebP) · documents the director reads (PDF, TXT, MD) up to 10 MB. Drop files here.</p>

      {sending.map((entry) => (
        <div key={entry.key} className="mt-2.5">
          <div className="flex justify-between text-[12px] text-soft">
            <span className="truncate">{entry.name}</span>
            <span className="tabular-nums text-muted">{Math.round(entry.progress * 100)}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-layer/[0.1]">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(3, entry.progress * 100)}%` }} />
          </div>
        </div>
      ))}
      {errors.map((text) => (
        <p key={text} role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger/[0.08] px-3 py-1.5 text-[12.5px] text-danger">{text}</p>
      ))}

      {shown.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {shown.map((asset) => {
            const Icon = asset.kind === "video" ? Film : asset.kind === "audio" ? Music : asset.kind === "document" ? FileText : ImageIcon;
            const used = inTimeline.has(asset.id);
            const isMusic = musicAssetId === asset.id;
            const visual = asset.kind === "video" || (asset.kind !== "audio" && asset.kind !== "document");
            return (
              <li key={asset.id} className="flex max-w-full items-center gap-2 rounded-[12px] border border-line/[0.1] bg-layer/[0.03] py-1.5 pl-1.5 pr-2">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-layer/[0.08] text-soft">
                  {asset.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.posterUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  {asset.posterUrl && <Icon className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded bg-black/60 p-[1px] text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[160px] truncate text-[12.5px] text-ink" title={asset.name}>{asset.name || (asset.kind === "video" ? "Clip" : asset.kind === "audio" ? "Sound" : "Picture")}</span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(refs.get(asset.id) ?? "").catch(() => {})}
                    title="Use this name in your idea to say how this file is used — click to copy"
                    className="block max-w-[160px] truncate text-left font-mono text-[10.5px] text-accent hover:underline"
                  >
                    {refs.get(asset.id)}
                  </button>
                  <span className="block text-[11px] text-muted">
                    {asset.status === "processing" ? (
                      <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Preparing…</span>
                    ) : asset.status === "failed" ? (
                      <span className="text-danger" title={asset.error ?? undefined}>{asset.error ? asset.error.slice(0, 60) : "Could not be read"}</span>
                    ) : (
                      [asset.durationS ? formatSeconds(asset.durationS) : "", asset.width && asset.height ? `${asset.width}×${asset.height}` : "", asset.kind === "video" && asset.hasAudio === false ? "no sound" : "", asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "image" ? asset.kind : ""].filter(Boolean).join(" · ") || asset.kind
                    )}
                  </span>
                </span>
                {visual && onAdd && asset.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => onAdd(asset)}
                    title={used ? "In the video — add it again" : "Add to the end of the video"}
                    className="flex h-7 items-center gap-1 rounded-full border border-line/[0.1] px-2 text-[11.5px] text-ink hover:bg-layer/[0.08]"
                  >
                    {used ? <Check className="h-3 w-3 text-emerald-400" /> : <Plus className="h-3 w-3" />} {used ? "In video" : "Add"}
                  </button>
                )}
                {visual && onReference && asset.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => onReference(asset)}
                    title="Every generated scene matches this clip's setting, light, colour and people"
                    className={`flex h-7 items-center gap-1 rounded-full border px-2 text-[11.5px] ${references?.has(asset.id) ? "border-emerald-400/40 text-emerald-400" : "border-line/[0.1] text-ink hover:bg-layer/[0.08]"}`}
                  >
                    {references?.has(asset.id) ? <Check className="h-3 w-3" /> : <Palette className="h-3 w-3" />} {references?.has(asset.id) ? "The look" : "Use as look"}
                  </button>
                )}
                {visual && onContinue && asset.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => onContinue(asset)}
                    title="Add a new scene that starts exactly where this ends"
                    className="flex h-7 items-center gap-1 rounded-full border border-line/[0.1] px-2 text-[11.5px] text-ink hover:bg-layer/[0.08]"
                  >
                    <FastForward className="h-3 w-3" /> Continue it
                  </button>
                )}
                {asset.kind === "audio" && onUseMusic && asset.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => onUseMusic(isMusic ? null : asset)}
                    className={`flex h-7 items-center gap-1 rounded-full border px-2 text-[11.5px] ${isMusic ? "border-emerald-400/40 text-emerald-400" : "border-line/[0.1] text-ink hover:bg-layer/[0.08]"}`}
                  >
                    {isMusic ? <Check className="h-3 w-3" /> : <Music className="h-3 w-3" />} {isMusic ? "Music" : "Use as music"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(asset)}
                  disabled={removing === asset.id}
                  aria-label={`Remove ${asset.name || "upload"}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-layer/[0.08] hover:text-ink disabled:opacity-40"
                >
                  {removing === asset.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
