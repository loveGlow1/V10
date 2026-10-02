"use client";

/* Step 1 and Step 2 of the Video Studio, on Home under the Video tab.
 *
 * Step 1 is the grid: nine pipelines, then Photo → Video on its own row.
 * Step 2 is only the questions the chosen pipeline asks — never every
 * setting at once — plus the consent a clone needs. */

import Link from "next/link";
import { Box, Clapperboard, Film, Image as ImageIcon, Lightbulb, Megaphone, Play, Smartphone, Sparkles, UserRound, type LucideIcon } from "lucide-react";

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

  const card = (id: PipelineId, wide = false) => {
    const entry = PIPELINES[id];
    const Icon = PIPELINE_ICON[entry.icon] ?? Sparkles;
    const active = selected === id;
    return (
      <button
        key={id}
        type="button"
        aria-pressed={active}
        title={entry.blurb}
        onClick={() => onSelect(active ? null : id)}
        className={`group flex rounded-[14px] border text-left transition-colors ${
          wide ? "col-span-full items-center justify-center gap-2.5 px-4 py-3" : "min-h-[84px] flex-col justify-between gap-3 p-3 sm:p-3.5"
        } ${
          active
            ? "border-accent/50 bg-accent/[0.10] text-ink"
            : "border-line/[0.08] bg-layer/[0.03] text-soft hover:border-line/[0.16] hover:bg-layer/[0.06] hover:text-ink"
        }`}
      >
        <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : "text-muted group-hover:text-ink"}`} strokeWidth={1.75} />
        <span className="text-[13px] font-medium leading-tight sm:text-[13.5px]">{entry.label}</span>
      </button>
    );
  };

  return (
    <div className="relative z-10 mt-4 w-full">
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <p className="text-[13px] text-muted">What do you want to create?</p>
        <Link href="/dashboard/video" className="text-[12.5px] text-muted hover:text-ink">Your videos →</Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {GRID.map((id) => card(id))}
        {card("photo_to_video", true)}
      </div>

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
