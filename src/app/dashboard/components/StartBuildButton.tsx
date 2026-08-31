"use client";

import React, { useImperativeHandle, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";

import { useProjects } from "../ProjectsContext";
import { SendArrow } from "./marks";

/* Home's send button.
 *
 * Home is above ProjectsProvider — the provider is rendered inside the page —
 * so the hook cannot be called there. This is the button, moved down one level
 * to where the projects are, carrying the same markup it had on the bar.
 *
 * Sending from Home does two things a workspace message does not: it names an
 * app and it opens one. The build itself is not run here — the workspace runs
 * it, so the first thing you see after the jump is your own message and the
 * build working on it, rather than a wait on Home followed by a jump to a
 * result that already happened.
 *
 * The same reason the button lives down here is why sending is also exposed on
 * a ref: the composer's textarea is rendered by Home, above the provider, so it
 * cannot call the hook itself. Enter on that box reaches this through the
 * handle, and both ways in share one guard — no double-send, no second app
 * opened by a key pressed while the first is still being created. */

/* A name from the first thing someone typed. Cut at a word so a project is not
   called "Build me an online sto", and short enough for a tab. */
export function nameFromPrompt(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 40) return cleaned || "Untitled app";

  const cut = cleaned.slice(0, 40);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim();
}

/** What Home can do to this button from the outside: send, as if it were pressed. */
export type StartBuildHandle = { start: () => void };

export default function StartBuildButton({
  prompt,
  onError,
  ref,
}: {
  prompt: string;
  onError: (message: string | null) => void;
  /* React 19 passes ref as an ordinary prop, so there is no forwardRef here. */
  ref?: React.Ref<StartBuildHandle>;
}) {
  const router = useRouter();
  const { create } = useProjects();
  const [starting, setStarting] = useState(false);

  const ready = Boolean(prompt.trim()) && !starting;

  /* Deliberately not the whole state: Home needs a way to send, not a way to
     reach inside this. `start` already refuses an empty prompt and a send that
     is in flight, so the handle cannot do anything pressing the button could
     not. */
  useImperativeHandle(ref, () => ({ start: () => void start() }));

  async function start() {
    const text = prompt.trim();
    if (!text || starting) return;

    setStarting(true);
    onError(null);

    const project = await create(nameFromPrompt(text));
    setStarting(false);

    if (!project) {
      /* create() puts its own reason on the projects error — usually a session
         still loading or a table that was never created. Saying "could not"
         here as well would be the second half of a sentence the list already
         finished. */
      onError("Could not open a new app. Check the message on your projects list.");
      return;
    }

    /* The prompt travels in the URL rather than in a store: a reload of the
       workspace then re-runs the same build instead of opening an empty
       conversation for an app that has never been built. */
    router.push(`/dashboard/project/${project.id}?prompt=${encodeURIComponent(text)}`);
  }

  return (
    <button
      onClick={() => void start()}
      disabled={!ready}
      aria-label="Send"
      className={`flex h-[34px] w-[38px] shrink-0 items-center justify-center rounded-[15px] border transition-all active:scale-[0.98] disabled:cursor-not-allowed sm:h-10 sm:w-10 sm:rounded-full ${
        ready
          ? "border-transparent bg-layer/[0.16] text-ink hover:bg-layer/[0.22]"
          : "border-transparent bg-layer/[0.07] text-ink/30 md:bg-layer/[0.1] md:text-ink"
      }`}
    >
      <SendArrow className="h-4 w-4 md:hidden" />
      <ArrowUp className="hidden h-4 w-4 stroke-[2.5] md:block" />
    </button>
  );
}
