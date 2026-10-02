"use client";

/* Step 1 and Step 2 of the Video Studio, on Home under the Video tab.
 *
 * Step 1 is the grid: nine pipelines, then Photo → Video on its own row.
 * Step 2 is only the questions the chosen pipeline asks — never every
 * setting at once — plus the consent a clone needs. */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChevronLeft, ChevronRight, Clapperboard, Film, Image as ImageIcon, Lightbulb, Megaphone, Play, Smartphone, Sparkles, UserRound, type LucideIcon } from "lucide-react";

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
          <Image
            src={`/video-types/${id}.jpg`}
            alt=""
            fill
            sizes="176px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
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

      {pipeline && (
        <div className="mt-3 space-y-2.5 rounded-[14px] border border-line/[0.08] bg-layer/[0.02] p-3">
          <p className="text-[12.5px] text-muted">
            <span className="font-medium text-ink">{pipeline.label}</span> · {pipeline.blurb}
          </p>
          {pipeline.questions.map((question) => (
            <div key={question.id} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 w-full shrink-0 text-[12px] text-muted sm:w-[92px]">{question.label}</span>
              {question.options.map((option) => {
                const chosen = (answers[question.id] ?? question.initial) === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onAnswer(question.id, option)}
                    className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[12px] transition-colors ${
                      chosen ? "border-accent/40 bg-accent/[0.10] text-ink" : "border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          ))}
          {pipeline.needsReference && (
            <p className="text-[12px] text-muted">
              You can add {pipeline.needsReference === "product" ? "product images" : pipeline.needsReference === "person" ? "photos or video of yourself" : "the photo"} in the studio before the plan is made.
            </p>
          )}
          {pipeline.needsConsent && (
            <label className="flex cursor-pointer items-start gap-2 text-[12.5px] leading-snug text-soft">
              <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#2F6BFF]" />
              I am the person in the reference material, or I have their written permission to use their likeness and voice.
            </label>
          )}
        </div>
      )}
    </div>
  );
}
