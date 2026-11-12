"use client";

/* Video settings — every choice about how the final cut is put together
 * (lib/video/cut-settings.ts), in one panel. Changing a setting edits the
 * draft like any scene edit; saving makes the cut again from what was
 * already made, free — nothing is filmed again. */

import { RotateCcw, SlidersHorizontal } from "lucide-react";

import {
  ASPECTS,
  AUDIO_MODES,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  CAPTION_STYLES,
  COLORS,
  FITS,
  FRAME_RATES,
  LABELS,
  QUALITIES,
  RESOLUTIONS,
  STILL_MOTIONS,
  TRANSITIONS,
  resolveCut,
} from "@/lib/video/cut-settings";
import type { Cut, ProductionPlan } from "@/lib/video/plan";
import { longestRun } from "@/lib/video/continuity";
import type { StudioAsset } from "@/lib/video/assets";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0 text-[11.5px] text-muted">
      {label}
      <div className="mt-0.5">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted/80">{hint}</span>}
    </label>
  );
}

const selectClass = "w-full rounded-lg border border-line/[0.1] bg-panel px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]";

function Select<T extends string | number>({ value, options, labels, onChange }: { value: T; options: readonly T[]; labels: Record<string, string>; onChange: (value: T) => void }) {
  return (
    <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o) === e.target.value) ?? value)} className={selectClass}>
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>{labels[String(option)] ?? String(option)}</option>
      ))}
    </select>
  );
}

function Level({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={0} max={2} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-accent" />
      <span className="w-10 text-right text-[12px] tabular-nums text-soft">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 border-t border-line/[0.08] pt-3">
      <legend className="pr-2 text-[11px] font-medium uppercase tracking-wider text-soft">{title}</legend>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export default function VideoSettings({
  plan,
  audioAssets,
  onChange,
}: {
  plan: ProductionPlan;
  audioAssets: StudioAsset[];
  onChange: (next: ProductionPlan) => void;
}) {
  const now = resolveCut(plan);
  const set = (patch: Partial<Cut>) => onChange({ ...plan, cut: { ...(plan.cut ?? {}), ...patch } });
  const narrated = plan.scenes.some((scene) => scene.voiceover.trim());
  const stills = plan.scenes.some((scene) => scene.source && scene.engine === "image");
  const readyAudio = audioAssets.filter((asset) => asset.kind === "audio" && asset.status !== "failed");
  const musicValue = now.music.source === "upload" && now.music.assetId ? `upload:${now.music.assetId}` : now.music.source;

  return (
    <details className="group rounded-[16px] border border-line/[0.08] bg-panel p-4" open>
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink"><SlidersHorizontal className="h-4 w-4" /> Video settings</span>
        <span className="text-[12px] text-muted">{LABELS.aspect[plan.aspect]} · {now.resolution} · {LABELS.transition[now.transition]}</span>
      </summary>
      <p className="mt-1 text-[12px] text-muted">Changing these never films anything again — save, and the video is cut again (1 credit per started minute of video).</p>

      <div className="mt-3 space-y-4">
        <Group title="Picture">
          <Field label="Shape">
            <Select value={plan.aspect} options={ASPECTS} labels={LABELS.aspect} onChange={(aspect) => onChange({ ...plan, aspect })} />
          </Field>
          <Field label="Fit" hint="How a clip of another shape fills the frame.">
            <Select value={now.fit} options={FITS} labels={LABELS.fit} onChange={(fit) => set({ fit })} />
          </Field>
          <Field label="Resolution">
            <Select value={now.resolution} options={RESOLUTIONS} labels={LABELS.resolution} onChange={(resolution) => set({ resolution })} />
          </Field>
          <Field label="Frame rate">
            <Select value={now.fps} options={FRAME_RATES} labels={LABELS.fps as Record<string, string>} onChange={(fps) => set({ fps })} />
          </Field>
          <Field label="Colour">
            <Select value={now.color} options={COLORS} labels={LABELS.color} onChange={(color) => set({ color })} />
          </Field>
          <Field label="Quality">
            <Select value={now.quality} options={QUALITIES} labels={LABELS.quality} onChange={(quality) => set({ quality })} />
          </Field>
        </Group>

        <Group title="Transitions">
          <Field label="Between scenes">
            <Select value={now.transition} options={TRANSITIONS} labels={LABELS.transition} onChange={(transition) => set({ transition })} />
          </Field>
          <Field label={`Length · ${now.transitionSeconds.toFixed(1)}s`}>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={now.transitionSeconds}
              disabled={now.transition === "cut"}
              onChange={(e) => set({ transitionSeconds: Number(e.target.value) })}
              className="w-full accent-accent disabled:opacity-40"
            />
          </Field>
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
            <Toggle checked={now.fadeIn} onChange={(fadeIn) => set({ fadeIn })} label="Fade in at the start" />
            <Toggle checked={now.fadeOut} onChange={(fadeOut) => set({ fadeOut })} label="Fade out at the end" />
            <Toggle
              checked={plan.cut?.continuity !== false}
              onChange={(continuity) => set({ continuity })}
              label={`Scenes that carry on start where the last ended${plan.cut?.continuity !== false && longestRun(plan) > 1 ? ` (up to ${longestRun(plan)} made one after another)` : ""}`}
            />
          </div>
        </Group>

        <Group title="Sound">
          <Field label="What is heard">
            <Select value={now.audio} options={AUDIO_MODES} labels={LABELS.audio} onChange={(audio) => set({ audio })} />
          </Field>
          <Field label="Clips' own sound">
            <Level value={now.originalVolume} onChange={(originalVolume) => set({ originalVolume })} />
          </Field>
          {narrated && (
            <Field label="Voice-over">
              <Level value={now.voiceVolume} onChange={(voiceVolume) => set({ voiceVolume })} />
            </Field>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
            <Toggle checked={now.loudness} onChange={(loudness) => set({ loudness })} label="Even loudness (-14 LUFS, like social apps)" />
          </div>
        </Group>

        <Group title="Music">
          <Field label="Music">
            <select
              value={musicValue}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith("upload:")) set({ music: { source: "upload", assetId: value.slice(7) } });
                else set({ music: { source: value as "generate" | "none" } });
              }}
              className={selectClass}
            >
              <option value="none">{LABELS.music.none}</option>
              <option value="generate">{LABELS.music.generate}</option>
              {readyAudio.map((asset) => (
                <option key={asset.id} value={`upload:${asset.id}`}>My file: {asset.name || "audio"}</option>
              ))}
            </select>
          </Field>
          <Field label="Music level">
            <Level value={now.musicVolume} onChange={(musicVolume) => set({ musicVolume })} />
          </Field>
          {now.music.source === "upload" && (
            <Field label="Start the song at (seconds)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={now.music.start}
                onChange={(e) => set({ music: { source: "upload", assetId: now.music.assetId, start: Math.max(0, Number(e.target.value) || 0) } })}
                className={selectClass}
              />
            </Field>
          )}
          {now.music.source === "generate" && (
            <Field label="Music style">
              <input value={plan.music} placeholder="e.g. upbeat afrobeat, warm guitar" onChange={(e) => onChange({ ...plan, music: e.target.value.slice(0, 300) })} className={selectClass} />
            </Field>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
            <Toggle checked={now.duck} onChange={(duck) => set({ duck })} label="Lower the music while someone speaks" />
          </div>
        </Group>

        <Group title="Captions and words">
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
            <Toggle checked={now.captions} onChange={(captions) => set({ captions })} label="Captions of the spoken lines" />
          </div>
          <Field label="Position">
            <Select value={now.captionPosition} options={CAPTION_POSITIONS} labels={LABELS.captionPosition} onChange={(captionPosition) => set({ captionPosition })} />
          </Field>
          <Field label="Size">
            <Select value={now.captionSize} options={CAPTION_SIZES} labels={LABELS.captionSize} onChange={(captionSize) => set({ captionSize })} />
          </Field>
          <Field label="Style">
            <Select value={now.captionStyle} options={CAPTION_STYLES} labels={LABELS.captionStyle} onChange={(captionStyle) => set({ captionStyle })} />
          </Field>
          <Field label="End card (words on the last scene)">
            <input value={plan.cut?.endCard ?? ""} placeholder="e.g. Follow for more" onChange={(e) => set({ endCard: e.target.value.slice(0, 80) || undefined })} className={selectClass} />
          </Field>
        </Group>

        {stills && (
          <Group title="Pictures">
            <Field label="While a picture is on screen">
              <Select value={now.stillMotion} options={STILL_MOTIONS} labels={LABELS.stillMotion} onChange={(stillMotion) => set({ stillMotion })} />
            </Field>
          </Group>
        )}

        <button
          type="button"
          onClick={() => {
            const keep = plan.cut ? { audio: plan.cut.audio, endCard: plan.cut.endCard, muted: plan.cut.muted, music: plan.cut.music } : {};
            onChange({ ...plan, cut: Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) as Cut });
          }}
          className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-muted hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Back to the defaults
        </button>
      </div>
    </details>
  );
}
