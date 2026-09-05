"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ExternalLink } from "lucide-react";

import ProviderSpinner from "./ProviderSpinner";
import { TerminalMark } from "./panelMarks";
import type { Provider } from "../../models";

/* One line in the tracker below. A step is something that actually happened, so
   a label is not enough on its own — `state` is what separates a step that has
   finished from the one running now from one that has not been reached. */
export type ActivityStep = {
  id: string;
  label: string;
  /** A second line, shown while this step is the one running. */
  detail?: string;
  state: "done" | "running" | "pending";
  /** How long this step really took, in milliseconds. Absent on the step
      currently running — its duration is not known until it ends. */
  ms?: number;
};

/* How long a step has to have been running before its live counter appears.
   Under this it is a flicker of digits on a row that is about to be replaced. */
const LIVE_AFTER_MS = 700;

/* Seconds as a person reads them: "38s" under a minute, "1m 4s" over it. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/* A single step, which is usually milliseconds and occasionally a minute. The
   sub-second ones are the honest majority — a session check is 12ms — and
   flooring those to "0s" would read as untimed rather than as fast. */
export function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDuration(ms / 1000);
}

/* What a build is doing, while it does it.

   Everything on it is measured rather than performed. The clock is the real one
   — it starts when the request is sent and stops when the answer arrives — and
   the steps are the ones the build actually reports. That is a deliberate
   limit: /api/build is a single call to the orchestrator (src/lib/n8n.ts), so
   while a build is in flight the only honest thing to say is that it is
   running and how long it has been running for. The step list fills in from the
   orchestrator's own answer once it returns.

   The shape is built for more than that. `steps` is a list rather than a fixed
   set of phases, so the day the orchestrator streams its progress this panel
   renders it without changing — the seam is the prop, not the markup. What it
   will not do is invent the stream in the meantime: a checklist ticking itself
   off on a timer would say a build was doing things nobody can see it doing. */
export default function BuildActivity({
  steps,
  running,
  startedAt,
  finishedAt,
  failed = false,
  note,
  previewHref,
  onOpenPreview,
  provider,
}: {
  steps: ActivityStep[];
  running: boolean;
  /** When the request went out, in ms. The clock counts from here. */
  startedAt: number;
  /** When the answer came back. Null while it has not. */
  finishedAt?: number | null;
  /** A build that came back Failed. Keeps the panel open so the reason shows. */
  failed?: boolean;
  /** A real number worth reporting beside the clock — files touched, say. */
  note?: string;
  /** Where the finished build can be looked at, if it returned anywhere. */
  previewHref?: string | null;
  /** Brings the preview onto the screen, for the half that is not on it. */
  onOpenPreview?: () => void;
  /* Whose mark turns while this runs. Absent — a stored timeline, a build from
     before the picker existed — falls back to the terminal mark, which is the
     honest answer when nobody recorded which model was asked. */
  provider?: Provider | null;
}) {
  /* Open while it runs, folded to a summary when it finishes.
   *
   * The earlier reading was that a finished list is the part worth reading, so
   * it stayed open. That was true of the list and wrong about the thread: the
   * answer is what the person asked for, and leaving eight rows of plumbing
   * expanded under every reply pushes it up the screen and makes a
   * conversation read like a build log.
   *
   * So it collapses to one line saying what ran, which is enough to know
   * nothing strange happened and one click away from the whole thing. A run
   * that is still going always reopens — a tracker folded over live work would
   * be the panel going quiet while it works — and a failure stays open,
   * because there the detail IS the answer.
   *
   * Held as null until it settles, so "never opened" and "opened, then folded
   * by the reader" stay distinguishable: an explicit choice survives the run
   * ending rather than being overwritten by it. */
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (running || failed);

  useEffect(() => {
    /* A new run clears the previous one's choice: the panel is about this run
       now, and inheriting a fold from the last one would hide it. */
    if (running) setChoice(null);
  }, [running]);

  /* Which operations have been opened. A step's detail is the concrete result
     — the model that answered, what it cost, whether the classifier needed one
     — and it is worth a click rather than always being on screen: five rows
     each carrying two lines is a wall, and the labels are what someone reads
     first. Open one and it reads back like the command it was. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  /* A second hand, not an animation: it reads the clock rather than counting
     its own ticks, so a tab left in the background comes back with the right
     number instead of however many intervals the browser chose to run.

     Twice a second rather than once, because it now also drives the counter on
     the running row, and a step that finishes in 1.4s should not have spent all
     of it reading "1s". */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  /* When each step was first seen here. The server measures a finished step and
     sends the duration with it; this is the other half — how long the one that
     has not finished has been going. Without it a forty-second generation is a
     pulsing dot and nothing else, which reads the same whether it is working or
     stuck.

     Held in a ref rather than state because writing it must not itself cause a
     render, and read only while `running`: a stored timeline on an old message
     is a record, and a clock ticking inside it would be counting from the
     moment someone scrolled past. */
  const firstSeen = useRef<Record<string, number>>({});
  for (const step of steps) {
    if (firstSeen.current[step.id] === undefined) firstSeen.current[step.id] = Date.now();
  }

  const elapsed = ((finishedAt ?? (running ? now : startedAt)) - startedAt) / 1000;

  /* What the folded row says. A count rather than "Done", because "Done" tells
     a reader nothing they did not already know from the answer sitting above
     it — where a number says how much happened, and is the difference between
     folding something away and hiding it.
   *
   * Counted from the steps that actually ran. A list that arrived empty says
     so plainly rather than claiming zero operations, which would read as a
     measurement of nothing rather than as nothing measured. */
  const ran = steps.filter((step) => step.state === "done").length;
  const summary =
    ran === 0 ? "Done" : `Ran ${ran} ${ran === 1 ? "operation" : "operations"}`;

  return (
    <div className="overflow-hidden rounded-xl border border-line/[0.07] bg-layer/[0.02]">
      <button
        onClick={() => setChoice(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-layer/[0.03]"
      >
        {/* While it runs, the maker's own mark, turning. Afterwards the
            terminal mark: the panel stops being a live thing and becomes a
            record of operations, and the shorthand a shell has used for forty
            years says that before the labels are read.

            The switch is the point. A person who chose Fable over Haiku made a
            decision about cost and quality, and an anonymous spinner tells them
            nothing about whether it took effect. */}
        {running && provider ? (
          <ProviderSpinner provider={provider} className="h-[17px] w-[17px]" />
        ) : (
          <TerminalMark className="h-[15px] w-[15px] shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-soft">
          {running ? "Working on it…" : failed ? "This build failed" : summary}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <ol className="space-y-2">
                {steps.map((step) => {
                  const isOpen = opened[step.id] === true;
                  /* The running step always shows its detail: it is the line
                     saying what is happening right now, and hiding that behind
                     a click would be hiding the only live thing on the panel. */
                  const showDetail = step.detail !== undefined && (isOpen || step.state === "running");

                  /* How long this one has been going, for the row that has not
                     finished. Null everywhere else: a finished step carries the
                     server's own measurement, which is the better number, and a
                     step in a stored timeline is not going anywhere. */
                  const since =
                    running && step.state === "running" && firstSeen.current[step.id] !== undefined
                      ? now - firstSeen.current[step.id]
                      : null;
                  /* Held back until there is something to report. A row that
                     appears carrying "0ms" reads as a measurement rather than
                     as a counter starting, and most steps are gone again before
                     this threshold — which is the right answer for them: they
                     were quick, and the finished row says exactly how quick. */
                  const live = since !== null && since >= LIVE_AFTER_MS ? since : null;

                  return (
                    <li key={step.id}>
                      <div className="flex items-start gap-2.5">
                        {/* The marker carries the state on its own, so the list
                            can be read down the left edge without reading the
                            labels. */}
                        <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          {step.state === "done" ? (
                            <Check className="h-3.5 w-3.5 stroke-[3] text-accent" />
                          ) : step.state === "running" ? (
                            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-layer/[0.18]" />
                          )}
                        </span>

                        {/* A row with nothing more to say is not a button. An
                            affordance that opens an empty panel is worse than
                            no affordance. */}
                        {step.detail !== undefined && step.state !== "running" ? (
                          <button
                            onClick={() =>
                              setOpened((current) => ({ ...current, [step.id]: !current[step.id] }))
                            }
                            aria-expanded={isOpen}
                            className="group flex min-w-0 flex-1 items-baseline gap-2 text-left"
                          >
                            <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink underline decoration-line/[0.18] decoration-dotted underline-offset-[3px] transition-colors group-hover:decoration-line/[0.4]">
                              {step.label}
                            </span>
                            {typeof step.ms === "number" && (
                              <span className="shrink-0 text-[12px] tabular-nums text-muted">
                                {formatStepDuration(step.ms)}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-baseline gap-2">
                            <span
                              className={`min-w-0 flex-1 text-[13px] leading-snug ${
                                step.state === "pending" ? "text-muted" : "text-ink"
                              }`}
                            >
                              {step.label}
                            </span>
                            {typeof step.ms === "number" ? (
                              <span className="shrink-0 text-[12px] tabular-nums text-muted">
                                {formatStepDuration(step.ms)}
                              </span>
                            ) : (
                              live !== null && (
                                <span className="shrink-0 text-[12px] tabular-nums text-muted/70">
                                  {formatStepDuration(live)}
                                </span>
                              )
                            )}
                          </span>
                        )}
                      </div>

                      {/* Opened, it reads back as the operation it was: a prompt
                          mark and the result, in the mono face, on its own
                          ground. The indent lines it up under the label rather
                          than under the state marker. */}
                      {showDetail && (
                        <div className="ml-6 mt-1 flex items-start gap-1.5 rounded-md border border-line/[0.06] bg-layer/[0.03] px-2 py-1.5">
                          <span
                            aria-hidden
                            className={`shrink-0 font-mono text-[11px] leading-[1.45] ${
                              step.state === "running" ? "text-accent" : "text-muted"
                            }`}
                          >
                            ›
                          </span>
                          <span
                            className={`min-w-0 font-mono text-[11px] leading-[1.45] ${
                              step.state === "running" ? "text-accent" : "text-soft"
                            }`}
                          >
                            {step.detail}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {/* The clock, and whatever the build reported alongside it. Both
                  measured; nothing here is filled in to make the row look
                  busier than the build was. */}
              <p className="mt-3 flex items-center gap-2 text-[12px] text-muted">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    running ? "animate-pulse bg-warn" : failed ? "bg-danger" : "bg-accent"
                  }`}
                />
                <span className="tabular-nums">{formatDuration(elapsed)}</span>
                {note && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{note}</span>
                  </>
                )}
              </p>

              {/* Only once there is somewhere to go. During a build this is
                  absent rather than disabled: a button that cannot do anything
                  yet is a promise the panel has not earned. */}
              {!running && previewHref && (
                <button
                  onClick={onOpenPreview}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] bg-layer/[0.05] px-3 text-[12px] font-medium text-ink transition-colors hover:border-line/[0.18] hover:bg-layer/[0.08]"
                >
                  Open preview
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
