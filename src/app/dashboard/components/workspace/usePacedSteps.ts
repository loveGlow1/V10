"use client";

import { useCallback, useRef, useState } from "react";

import type { ActivityStep } from "./BuildActivity";

/* The rhythm of the tracker.
 *
 * Streaming the steps from the server was only half of it. Opening the app is
 * five milliseconds, reading the page is forty, and the rules settle most
 * messages without a model call at all — so the first four or five rows arrive
 * inside a twentieth of a second and land as one flash. Everything the panel
 * knew was on screen before anyone could read a word of it, which looks exactly
 * like the fabricated single line it replaced.
 *
 * So rows are held to a minimum gap. What this does NOT do is invent time:
 * every row still carries the duration the server measured, the clock at the
 * bottom of the panel is still the real one, and a step that genuinely arrives
 * a second after the last is shown the moment it lands. The gap is a floor, not
 * a delay — it slows bursts and nothing else.
 *
 * A burst is exactly where that floor belongs, because the wall clock is not
 * idle during one. While four rows spread out, the classifier is running. The
 * panel spends the pause saying what it has already done instead of sitting on
 * a finished list waiting for the next slow thing to end. */

/* Long enough to read a short line, short enough that six of them are not a
   wait of their own. */
export const PACE_MS = 380;
/* Jittered because a metronome reads as a progress bar playing a script; an
   uneven rhythm reads as work arriving. */
export const PACE_JITTER_MS = 140;
/* Once the reply is in, the rest is a tail rather than a story. Still spaced —
   a list that snaps to its final state is the flash again — but briskly. */
export const SETTLE_MS = 150;

export type PacedSteps = {
  /** What to render. */
  steps: ActivityStep[];
  /** The same list read synchronously, for the message that keeps it. */
  current: () => ActivityStep[];
  /** Clears everything and opens a new run. */
  reset: () => void;
  /** Queues a step, shown no sooner than the pace allows. */
  show: (step: ActivityStep) => void;
  /** Shows a step at once, for one that is not part of a burst. */
  set: (step: ActivityStep) => void;
  /** Resolves once every queued row is on screen, settling the pace first. */
  flush: () => Promise<void>;
};

export function usePacedSteps(): PacedSteps {
  /* Kept in a ref as well as in state: the state is what the live tracker
     draws, the ref is what the finished message keeps, and reading state back
     inside the same async function would only ever see the value it closed
     over. */
  const run = useRef<ActivityStep[]>([]);
  const [steps, setSteps] = useState<ActivityStep[]>([]);

  const queue = useRef<ActivityStep[]>([]);
  const draining = useRef(false);
  const lastShownAt = useRef(0);
  const settling = useRef(false);
  const waiting = useRef<(() => void)[]>([]);

  /* Merges by id, so a step that was running becomes the same step finished
     rather than a second line saying the same thing. */
  const set = useCallback((step: ActivityStep) => {
    const at = run.current.findIndex((existing) => existing.id === step.id);
    if (at === -1) {
      run.current = [...run.current, step];
    } else {
      const next = [...run.current];
      next[at] = step;
      run.current = next;
    }
    setSteps(run.current);
  }, []);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;

    while (queue.current.length > 0) {
      const gap = settling.current ? SETTLE_MS : PACE_MS + Math.random() * PACE_JITTER_MS;
      const owed = gap - (Date.now() - lastShownAt.current);
      if (owed > 0) await new Promise((resolve) => setTimeout(resolve, owed));

      const step = queue.current.shift();
      if (!step) break;
      lastShownAt.current = Date.now();
      set(step);
    }

    draining.current = false;
    for (const resolve of waiting.current.splice(0)) resolve();
  }, [set]);

  const show = useCallback(
    (step: ActivityStep) => {
      /* A running step re-announcing itself is not a new row — it is the row on
         screen saying something newer about itself, which is what the model's
         own reasoning arrives as while a long call runs.
         
         Queueing those would be wrong twice over: the line would lag the work
         by however many updates were waiting, and the queue would grow all
         through the call only to flush a backlog of stale sentences at the end.
         So a refinement of the row already showing is applied at once, and a
         refinement of one still queued replaces it where it stands. */
      if (step.state === "running") {
        const showing = run.current[run.current.length - 1];
        if (showing?.id === step.id && showing.state === "running") {
          set(step);
          return;
        }

        const queued = queue.current.findIndex(
          (waiting) => waiting.id === step.id && waiting.state === "running",
        );
        if (queued !== -1) {
          queue.current[queued] = step;
          return;
        }
      }

      queue.current.push(step);
      void drain();
    },
    [drain, set],
  );

  const reset = useCallback(() => {
    run.current = [];
    queue.current = [];
    settling.current = false;
    lastShownAt.current = Date.now();
    setSteps([]);
  }, []);

  /* The reply waits on this, so an answer never arrives above rows that have
     not been shown yet — a message appearing before its own working is the
     flash from the other direction. */
  const flush = useCallback(() => {
    settling.current = true;
    if (queue.current.length === 0 && !draining.current) return Promise.resolve();
    return new Promise<void>((resolve) => waiting.current.push(resolve));
  }, []);

  return { steps, current: () => run.current, reset, show, set, flush };
}
