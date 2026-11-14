"use client";

/* The editor's left panel — everything that goes INTO the video, one tab
 * each, the way a desktop editor lays it out:
 *
 *   Media        the person's clips, pictures and sound (and sound made
 *                here), by kind; drag a tile onto the timeline
 *   Scenes       the scenes in order: jump, reorder, take out, put back
 *   Text         the words on the selected clip, the end card, captions
 *   Transitions  how every scene joins the next, and fades in and out
 *   Filters      a colour look for the selected clip or the whole video
 *   Cast         the characters who must look the same in every scene
 *   Settings     every other setting of the cut
 *
 * Nothing here films anything: each choice edits the draft like any other
 * change, and Save makes the cut. */

import { useState } from "react";
import { Film, ListOrdered, Palette, Shuffle, SlidersHorizontal, Type, Users, type LucideIcon } from "lucide-react";

import { CAPTION_POSITIONS, CAPTION_SIZES, CAPTION_STYLES, COLORS, COLOR_CSS, LABELS, TRANSITIONS, resolveCut, type ColorGrade, type Transition } from "@/lib/video/cut-settings";
import type { Cut, ProductionPlan, Scene } from "@/lib/video/plan";

export type LibraryTab = "media" | "scenes" | "text" | "transitions" | "filters" | "cast" | "settings";

export const LIBRARY_TABS: { id: LibraryTab; label: string; icon: LucideIcon }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "scenes", label: "Scenes", icon: ListOrdered },
  { id: "text", label: "Text", icon: Type },
  { id: "transitions", label: "Transitions", icon: Shuffle },
  { id: "filters", label: "Filters", icon: Palette },
  { id: "cast", label: "Cast", icon: Users },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
];

const field = "w-full rounded-lg border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]";
const heading = "text-[11px] font-medium uppercase tracking-wider text-muted";

/* A tiny picture of each transition: two frames and how one becomes the other. */
/* Each card shows the move between two scenes in the site's own colours:
   the outgoing scene in mint (the accent), the incoming one in gold to
   coral — the same palette as the buttons and chips, light theme included. */
const SCENE_A = "linear-gradient(135deg, rgb(var(--accent)) 0%, #0f9f8f 100%)";
const SCENE_B = "linear-gradient(135deg, #F4D96B 0%, #E8915F 100%)";
const half = (side: "left" | "right" | "top" | "bottom", size: string) => `${side} / ${side === "top" || side === "bottom" ? `100% ${size}` : `${size} 100%`} no-repeat`;
const TRANSITION_LOOK: Record<Transition, string> = {
  cut: `${SCENE_A} ${half("left", "50%")}, ${SCENE_B} ${half("right", "50%")}`,
  dip: `linear-gradient(90deg, transparent 28%, rgb(12 12 14 / 0.85) 50%, transparent 72%), ${SCENE_A} ${half("left", "50%")}, ${SCENE_B} ${half("right", "50%")}`,
  crossfade: `linear-gradient(90deg, rgb(var(--accent)) 10%, #9fd88f 42%, #F4D96B 60%, #E8915F 92%)`,
  fadeblack: `linear-gradient(90deg, transparent 15%, #050506 50%, transparent 85%), ${SCENE_A} ${half("left", "50%")}, ${SCENE_B} ${half("right", "50%")}`,
  fadewhite: `linear-gradient(90deg, transparent 15%, #ffffff 50%, transparent 85%), ${SCENE_A} ${half("left", "50%")}, ${SCENE_B} ${half("right", "50%")}`,
  wipeleft: `linear-gradient(105deg, transparent 47%, rgb(255 255 255 / 0.9) 48.5%, transparent 50%), linear-gradient(105deg, rgb(var(--accent)) 0%, #0f9f8f 48.5%, #F4D96B 48.5%, #E8915F 100%)`,
  slideleft: `linear-gradient(90deg, transparent 38%, rgb(0 0 0 / 0.35) 40%, transparent 43%), ${SCENE_A} ${half("left", "40%")}, ${SCENE_B} ${half("right", "60%")}`,
  slideup: `linear-gradient(180deg, transparent 43%, rgb(0 0 0 / 0.35) 45%, transparent 49%), ${SCENE_A} ${half("top", "45%")}, ${SCENE_B} ${half("bottom", "55%")}`,
  zoomin: `radial-gradient(circle at 50% 50%, #F4D96B 0%, #E8915F 30%, transparent 31%), ${SCENE_A}`,
  circleopen: `radial-gradient(circle at 50% 50%, #F4D96B 0%, #E8915F 38%, rgb(255 255 255 / 0.85) 39%, transparent 41%), ${SCENE_A}`,
  dissolve: `radial-gradient(circle, #E8915F 1.2px, transparent 1.6px) 0 0 / 6px 6px, radial-gradient(circle, #F4D96B 1.2px, transparent 1.6px) 3px 3px / 6px 6px, ${SCENE_A}`,
};

export default function EditorLibrary(props: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  plan: ProductionPlan;
  /** The clip the timeline has selected, if any. */
  selected: Scene | null;
  /** A picture to show the filters on: the selected or playing clip. */
  sample: string | null;
  onChange: (next: ProductionPlan) => void;
  media: React.ReactNode;
  scenes: React.ReactNode;
  cast: React.ReactNode;
  settings: React.ReactNode;
}) {
  const { plan, selected } = props;
  const cut = resolveCut(plan);
  const setCut = (patch: Partial<Cut>) => props.onChange({ ...plan, cut: { ...(plan.cut ?? {}), ...patch } });
  const setScene = (n: number, patch: Partial<Scene>) =>
    props.onChange({ ...plan, scenes: plan.scenes.map((s) => (s.n === n ? Object.fromEntries(Object.entries({ ...s, ...patch }).filter(([, v]) => v !== undefined)) as Scene : s)) });
  const [filterScope, setFilterScope] = useState<"clip" | "video">("clip");
  const scope = selected && filterScope === "clip" ? "clip" : "video";
  const activeColor: ColorGrade = scope === "clip" && selected ? selected.color ?? cut.color : cut.color;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex gap-0.5 overflow-x-auto border-b border-line/[0.08] pb-1.5" role="tablist" aria-label="Library">
        {LIBRARY_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={props.tab === id}
            onClick={() => props.onTab(id)}
            className={`flex min-w-[44px] flex-1 shrink-0 flex-col items-center gap-0.5 rounded-[8px] px-0.5 py-1 text-[10px] ${props.tab === id ? "bg-layer/[0.12] text-ink" : "text-muted hover:text-ink"}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto pr-0.5">
        {props.tab === "media" && props.media}
        {props.tab === "scenes" && props.scenes}
        {props.tab === "cast" && props.cast}
        {props.tab === "settings" && props.settings}

        {props.tab === "text" && (
          <div className="space-y-4">
            <div>
              <p className={heading}>Words on this clip</p>
              {selected ? (
                <>
                  <textarea
                    rows={2}
                    value={selected.onScreenText}
                    placeholder="e.g. Chapter One — Lagos"
                    onChange={(e) => setScene(selected.n, { onScreenText: e.target.value.slice(0, 200) })}
                    className={`${field} mt-1 resize-y`}
                  />
                  <p className="mt-0.5 text-[11px] text-muted">Shown over clip {plan.scenes.findIndex((s) => s.n === selected.n) + 1} in clean type. Leave empty for none.</p>
                </>
              ) : (
                <p className="mt-1 text-[12px] text-muted">Select a clip on the timeline to put words on it.</p>
              )}
            </div>
            <div>
              <p className={heading}>End card</p>
              <input value={plan.cut?.endCard ?? ""} placeholder="e.g. Follow for more" onChange={(e) => setCut({ endCard: e.target.value.slice(0, 80) || undefined })} className={`${field} mt-1`} />
            </div>
            <div>
              <p className={heading}>Captions of the spoken lines</p>
              <label className="mt-1 flex items-center gap-2 text-[12.5px] text-soft">
                <input type="checkbox" checked={cut.captions} onChange={(e) => setCut({ captions: e.target.checked })} /> Show captions
              </label>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {CAPTION_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setCut({ captionStyle: style, captions: true })}
                    className={`flex h-12 items-center justify-center rounded-[8px] bg-gradient-to-br from-zinc-700 to-zinc-900 text-[11px] font-semibold ${cut.captionStyle === style && cut.captions ? "ring-2 ring-accent" : ""}`}
                  >
                    <span className={style === "box" ? "bg-black/80 px-1 text-white" : style === "highlight" ? "text-[#FFE14D] [text-shadow:0_0_3px_#000]" : "text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]"}>{LABELS.captionStyle[style]}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11.5px] text-muted">
                  Position
                  <select value={cut.captionPosition} onChange={(e) => setCut({ captionPosition: e.target.value as Cut["captionPosition"] })} className={`${field} mt-0.5`}>
                    {CAPTION_POSITIONS.map((p) => <option key={p} value={p}>{LABELS.captionPosition[p]}</option>)}
                  </select>
                </label>
                <label className="text-[11.5px] text-muted">
                  Size
                  <select value={cut.captionSize} onChange={(e) => setCut({ captionSize: e.target.value as Cut["captionSize"] })} className={`${field} mt-0.5`}>
                    {CAPTION_SIZES.map((p) => <option key={p} value={p}>{LABELS.captionSize[p]}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </div>
        )}

        {props.tab === "transitions" && (
          <div>
            <p className={heading}>Between every scene</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {TRANSITIONS.map((t) => (
                <button key={t} type="button" onClick={() => setCut({ transition: t })} aria-pressed={cut.transition === t} className={`group rounded-[10px] p-1 text-left transition-colors ${cut.transition === t ? "bg-accent/[0.1] ring-2 ring-accent" : "hover:bg-layer/[0.06]"}`}>
                  <span className="block h-10 overflow-hidden rounded-[7px] border border-line/[0.1] shadow-sm shadow-black/20 transition-transform group-hover:scale-[1.03]" style={{ background: TRANSITION_LOOK[t] }} />
                  <span className={`mt-1 block truncate text-[10.5px] ${cut.transition === t ? "font-medium text-ink" : "text-soft"}`}>{LABELS.transition[t]}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 block text-[11.5px] text-muted">
              Length · {cut.transitionSeconds.toFixed(1)}s
              <input type="range" min={0.1} max={2} step={0.1} value={cut.transitionSeconds} disabled={cut.transition === "cut"} onChange={(e) => setCut({ transitionSeconds: Number(e.target.value) })} className="w-full accent-accent disabled:opacity-40" />
            </label>
            <div className="mt-2 space-y-1.5 text-[12.5px] text-soft">
              <label className="flex items-center gap-2"><input type="checkbox" checked={cut.fadeIn} onChange={(e) => setCut({ fadeIn: e.target.checked })} /> Fade in at the start</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cut.fadeOut} onChange={(e) => setCut({ fadeOut: e.target.checked })} /> Fade out at the end</label>
            </div>
            <p className="mt-2 text-[11px] text-muted">The preview cuts straight; transitions are in the exported video. The markers between clips on the timeline open this tab.</p>
          </div>
        )}

        {props.tab === "filters" && (
          <div>
            <div className="flex gap-1 rounded-full bg-layer/[0.06] p-0.5 text-[11.5px]">
              <button type="button" disabled={!selected} onClick={() => setFilterScope("clip")} className={`h-7 flex-1 rounded-full disabled:opacity-40 ${scope === "clip" ? "bg-layer/[0.16] text-ink" : "text-muted"}`}>
                {selected ? `Clip ${plan.scenes.findIndex((s) => s.n === selected.n) + 1}` : "Select a clip"}
              </button>
              <button type="button" onClick={() => setFilterScope("video")} className={`h-7 flex-1 rounded-full ${scope === "video" ? "bg-layer/[0.16] text-ink" : "text-muted"}`}>Whole video</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => (scope === "clip" && selected ? setScene(selected.n, { color: color === cut.color ? undefined : color }) : setCut({ color }))}
                  className={`rounded-[8px] p-1 text-left ${activeColor === color ? "bg-layer/[0.12] ring-2 ring-accent" : "hover:bg-layer/[0.06]"}`}
                >
                  <span className="block h-12 overflow-hidden rounded-[6px]">
                    {props.sample ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={props.sample} alt="" className="h-full w-full object-cover" style={{ filter: COLOR_CSS[color] }} />
                    ) : (
                      <span className="block h-full w-full bg-gradient-to-br from-amber-300 via-rose-400 to-sky-500" style={{ filter: COLOR_CSS[color] }} />
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-soft">{LABELS.color[color]}</span>
                </button>
              ))}
            </div>
            {scope === "clip" && selected?.color && (
              <button type="button" onClick={() => setScene(selected.n, { color: undefined })} className="mt-2 text-[11.5px] text-accent">Use the whole video&apos;s filter on this clip</button>
            )}
            <p className="mt-2 text-[11px] text-muted">The preview shows the filter; the export applies it properly.</p>
          </div>
        )}
      </div>
    </div>
  );
}
