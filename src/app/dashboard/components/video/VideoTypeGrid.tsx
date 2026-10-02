"use client";

/* Step 1 and Step 2 of the Video Studio, on Home under the Video tab.
 *
 * Step 1 is the grid: nine pipelines, then Photo → Video on its own row.
 * Step 2 is only the questions the chosen pipeline asks — never every
 * setting at once — plus the consent a clone needs. */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Film, Image as ImageIcon, Lightbulb, Megaphone, Play, Smartphone, Sparkles, UserRound, type LucideIcon } from "lucide-react";

import { GRID, PIPELINES, type PipelineId } from "@/lib/video/pipelines";

export const PIPELINE_ICON: Record<string, LucideIcon> = {
  Sparkles,
  Megaphone,
  Box,
  UserRound,
  Clapperboard,
  Smartphone,
  Play,
  Lightbulb,
  Film,
  Image: ImageIcon,
};

export default function VideoTypeGrid({
  selected,
  onSelect,
  answers,
  onAnswer,
  consent,
  onConsent,
}: {
  selected: PipelineId | null;
  onSelect: (id: PipelineId | null) => void;
  answers: Record<string, string>;
  onAnswer: (question: string, value: string) => void;
  consent: boolean;
  onConsent: (value: boolean) => void;
}) {
  const pipeline = selected ? PIPELINES[selected] : null;
  /* Settings start folded: the defaults are good, and the summary line shows them. */
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  /* Emergent's row: a picture card per type, the name under it, one line
     that scrolls sideways when it runs past the screen. Wider than the
     composer on purpose — the cards read as a gallery, not a form. */
  const card = (id: PipelineId) => {
    const entry = PIPELINES[id];
    const active = selected === id;
    return (
      <button
        key={id}
        type="button"
        aria-pressed={active}
        title={entry.blurb}
        onClick={() => onSelect(active ? null : id)}
        className="group w-[152px] shrink-0 snap-start text-center sm:w-[176px]"
      >
        <span
          className={`relative block aspect-[16/10] overflow-hidden rounded-[12px] bg-layer/[0.06] ring-offset-2 ring-offset-canvas transition ${
            active ? "ring-2 ring-white/85" : "ring-0 group-hover:ring-1 group-hover:ring-white/25"
          }`}
        >
          <LoopingPreview id={id} />
        </span>
        <span className={`mt-2.5 block text-[13px] font-medium leading-tight sm:text-[13.5px] ${active ? "text-ink" : "text-soft group-hover:text-ink"}`}>
          {entry.label}
        </span>
      </button>
    );
  };

  return (
    <div className="relative z-10 mt-6 w-full">
      <div className="relative mb-3.5 flex items-center justify-center">
        <p className="text-[13.5px] text-soft">↓ What do you want to create? ↓</p>
        <Link href="/dashboard/video" className="absolute right-0 hidden text-[12.5px] text-muted hover:text-ink sm:block">Your videos →</Link>
      </div>
      {/* Breaks out of the composer's 750px column to the page's width. The
          edges fade, and arrows appear, only where there is more to see. */}
      <div className="relative left-1/2 w-[min(1180px,calc(100vw-32px))] -translate-x-1/2">
        <div
          ref={scroller}
          onScroll={measure}
          style={{
            maskImage: `linear-gradient(to right, ${edges.left ? "transparent, black 56px" : "black, black"}, ${edges.right ? "black calc(100% - 56px), transparent" : "black, black"})`,
            WebkitMaskImage: `linear-gradient(to right, ${edges.left ? "transparent, black 56px" : "black, black"}, ${edges.right ? "black calc(100% - 56px), transparent" : "black, black"})`,
          }}
          className="flex snap-x overflow-x-auto pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto flex w-max gap-4 px-1">{[...GRID, "photo_to_video" as const].map((id) => card(id))}</div>
        </div>
        {(["left", "right"] as const).map((side) =>
          edges[side] ? (
            <button
              key={side}
              type="button"
              aria-label={side === "left" ? "Earlier video types" : "More video types"}
              onClick={() => scroller.current?.scrollBy({ left: (side === "left" ? -1 : 1) * 576, behavior: "smooth" })}
              className={`absolute top-[calc(50%-24px)] hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line/[0.12] bg-panel/90 text-ink shadow-lg backdrop-blur transition hover:bg-panel md:flex ${
                side === "left" ? "-left-1" : "-right-1"
              }`}
            >
              {side === "left" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : null,
        )}
      </div>
      <Link href="/dashboard/video" className="mt-1 block text-center text-[12.5px] text-muted hover:text-ink sm:hidden">Your videos →</Link>

      {pipeline && selected && (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-line/[0.08] bg-gradient-to-b from-layer/[0.05] to-layer/[0.015] shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          {/* The header is the toggle. Closed, it still says what will be
              made — every setting in one line — so the defaults are never a
              secret; open, it is the place to change them. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-layer/[0.03]"
          >
            <span className="relative h-9 w-[58px] shrink-0 overflow-hidden rounded-[8px] bg-layer/[0.06]">
              <Image src={`/video-types/${selected}.jpg`} alt="" fill sizes="58px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{pipeline.label}</span>
              <span className="block truncate text-[12px] text-muted">
                {open ? pipeline.blurb : pipeline.questions.map((q) => answers[q.id] ?? q.initial ?? q.options[0]).join(" · ")}
              </span>
            </span>
            <span className="hidden shrink-0 text-[12px] text-muted sm:block">{open ? "Done" : "Customize"}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>

          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="min-h-0 overflow-hidden">
              <div className="space-y-3.5 border-t border-line/[0.06] px-3.5 pb-4 pt-3.5">
                {pipeline.questions.map((question) => {
                  const value = answers[question.id] ?? question.initial ?? question.options[0];
                  return (
                    <div key={question.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                      <span className="shrink-0 whitespace-nowrap text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted sm:w-[124px]">{question.label}</span>
                      {/* A segmented control: one track, the choice lifted out of it. */}
                      <div role="radiogroup" aria-label={question.label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-layer/[0.05] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {question.options.map((option) => {
                          const chosen = value === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={chosen}
                              onClick={() => onAnswer(question.id, option)}
                              className={`h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12.5px] transition-all ${
                                chosen ? "bg-white font-medium text-[#111113] shadow-sm" : "text-soft hover:bg-layer/[0.06] hover:text-ink"
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {pipeline.needsReference && (
                  <p className="flex items-center gap-2 text-[12px] text-muted">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    Add {pipeline.needsReference === "product" ? "product images" : pipeline.needsReference === "person" ? "photos or video of yourself" : "your photo"} in the studio, before the plan is made.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Never folded away: a clone cannot be sent without it. */}
          {pipeline.needsConsent && (
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-line/[0.06] px-3.5 py-3 text-[12.5px] leading-snug text-soft">
              <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#2F6BFF]" />
              I am the person in the reference material, or I have their written permission to use their likeness and voice.
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* A card's picture, moving: a short silent loop (forward then back, so it
   has no seam), its still frame as the poster. It plays only while on screen
   and never for someone who has asked their device for reduced motion — they
   keep the still. */
function LoopingPreview({ id }: { id: PipelineId }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => setStill(true));
        else video.pause();
      },
      { threshold: 0.25 },
    );
    seen.observe(video);
    return () => seen.disconnect();
  }, []);

  if (still) {
    return <Image src={`/video-types/${id}.jpg`} alt="" fill sizes="176px" className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />;
  }
  return (
    <video
      ref={ref}
      poster={`/video-types/${id}.jpg`}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
    >
      {/* H.264 first for Safari and iOS; VP9 for browsers built without it. */}
      <source src={`/video-types/${id}.mp4`} type="video/mp4" />
      <source src={`/video-types/${id}.webm`} type="video/webm" />
    </video>
  );
}
