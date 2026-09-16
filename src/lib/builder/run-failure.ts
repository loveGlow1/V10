/* What actually went wrong, and what to do about it.
 *
 * ── The message this file exists to delete ────────────────────────────────
 *
 *     "I couldn't send that one. Your message is still in the box — try it
 *      again."
 *
 * It was the catch-all for every way a run could end without an answer, and it
 * is wrong in the only way that matters: it names no cause, and its advice is
 * actively harmful for the commonest case. A request killed by the sixty-second
 * ceiling used to be killed again at sixty seconds, and again after that. "Try it
 * again" sent a customer round that loop four times in nine minutes, paying
 * attention each time.
 *
 * The first fix here told them instead to ask for one section at a time, which
 * was accurate about the ceiling and wrong about whose problem it was: it made
 * a limit of ours read as a fault in their request. The real fix was to stop
 * tying an edit's life to a connection at all — see lib/builder/edit-task.ts —
 * and this file now reports what that makes true, which is that the change is
 * saved and sending it again continues it.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Every failure names a CAUSE and a REMEDY, and the remedy is only "send it
 * again" when sending it again would genuinely do something different. Where it
 * would not, saying so is the useful part: it is what stops somebody spending
 * their afternoon on a loop that cannot close.
 *
 * Nothing here guesses. Each answer is derived from facts the caller actually
 * has — how long it ran, whether the work started, what the server said — and
 * where those do not identify the failure, the honest answer says that rather
 * than inventing a likely-sounding one.
 */

/** The ceiling the platform enforces on a request, whatever a route declares. */
export const FUNCTION_CEILING_MS = 60_000;

/* Close enough to the ceiling that the ceiling is the explanation. A run that
   died at 57 seconds was not unlucky with the network. */
const NEAR_CEILING_MS = 45_000;

export type RunFailure = {
  /** What happened, in one sentence, with no jargon and no blame. */
  cause: string;
  /** What to do, specifically. Never a generic retry unless retrying helps. */
  remedy: string;
  /** Whether sending the same message again could plausibly succeed. */
  retryable: boolean;
};

export type RunFacts = {
  /** The status the run reported, or the HTTP status when it never got that far. */
  status: number;
  /** Whether a final result arrived at all. */
  answered: boolean;
  /** Whether any step reached the browser — that is, whether the work began. */
  started: boolean;
  /** How long the request was open. */
  elapsedMs: number;
  /** What the server said, when it managed to say anything. */
  said?: string | null;
  /** Whether the customer stopped it themselves. */
  aborted?: boolean;
  /** The browser's own error, when the fetch threw rather than answering. */
  thrown?: string | null;
};

/** One sentence, for a chat bubble: the cause, then what to do about it. */
export function sayFailure(failure: RunFailure): string {
  return `${failure.cause}\n\n${failure.remedy}`;
}

/**
 * The failure, named.
 *
 * Never throws and always answers. The order below is deliberate: the specific
 * causes are tested before the general ones, so a timeout is reported as a
 * timeout rather than as "something went wrong".
 */
export function describeRunFailure(facts: RunFacts): RunFailure {
  /* Stopped by hand is not a failure and must never read as one. */
  if (facts.aborted) {
    return {
      cause: "Stopped.",
      remedy: "Anything already sent carries on — if it lands, it appears here.",
      retryable: true,
    };
  }

  /* ── The connection ended before the change did ───────────────────────
   *
   * The work started, ran for most of a minute, and the connection closed with
   * no answer. That is the platform's ceiling on a request — and it is a
   * ceiling on the CONNECTION, not on what was asked for.
   *
   * This branch used to say so in the worst available way. It reported the
   * seconds ("that ran for 58 seconds and was cut off"), which describes our
   * plumbing and nothing the customer did, and then it told them to ask for
   * one part at a time — making a limit of ours read as a fault in their
   * request. Somebody asking for a mobile layout fix was told that four times
   * in nine minutes. Their request was never too large.
   *
   * What makes a different answer honest is that an edit is now a durable task
   * rather than something a socket is doing (lib/builder/edit-task.ts). The
   * row, its checkpoint and its timeline are written as the work happens and
   * outlive the request, and the same message sent again rejoins that task by
   * its request id instead of starting a second edit into the same files.
   *
   * So the remedy is genuinely to send it again, and retryable is genuinely
   * true — which is the opposite of what it was, for the opposite reason.
   *
   * Two things this must not say, because neither is true: that it was the
   * customer's request that was too big, and that the work is still running
   * somewhere. Nothing is running. It is SAVED, which is a different promise
   * and the one that can be kept. */
  if (!facts.answered && facts.elapsedMs >= NEAR_CEILING_MS) {
    return {
      cause:
        "This change takes longer than one connection is allowed to stay open for, so the " +
        "connection closed. Your page is exactly as it was, nothing has been charged, and " +
        "what was worked out is saved against this project.",
      remedy:
        "Send the same message again and it picks the saved change back up rather than " +
        "starting a second one. If you'd rather it went faster, the Prototype agent is the " +
        "quickest of the three — but you don't have to change anything you asked for.",
      retryable: true,
    };
  }

  /* The same ceiling, reported by the platform's own gateway rather than by a
     connection going quiet, and it gets the same answer for the same reason:
     the change is saved as a task, so sending it again continues it. */
  if (facts.status === 504 || facts.status === 502) {
    return {
      cause:
        "The server didn't answer inside the time it's given, so the connection was closed. " +
        "Nothing on your page was changed and nothing has been charged.",
      remedy: "Send it again — it picks up the saved change rather than starting over.",
      retryable: true,
    };
  }

  if (facts.status === 429) {
    return {
      cause: "That went out faster than this account is allowed to send.",
      remedy: "Wait a few seconds and send it again. Nothing was changed.",
      retryable: true,
    };
  }

  if (facts.status === 402) {
    return {
      cause: facts.said ?? "There aren't enough credits on this account for that.",
      remedy: "Top up and send it again — nothing has been charged for this attempt.",
      retryable: true,
    };
  }

  if (facts.status === 401 || facts.status === 403) {
    return {
      cause: facts.said ?? "This account is not signed in any more.",
      remedy: "Sign in again and your message is still here to send.",
      retryable: true,
    };
  }

  /* ── The server said something ────────────────────────────────────────
   *
   * Then it is the cause, verbatim, because it was written by whichever gate
   * actually refused and knows more than this function does. A remedy is added
   * only when the sentence does not already carry one — see hasRemedy. Two
   * instructions in one bubble is how a clear refusal becomes noise. */
  if (facts.said && facts.said.trim().length > 0) {
    const said = facts.said.trim();
    return {
      cause: said,
      remedy: hasRemedy(said)
        ? ""
        : "Your message is still in the box. Changing what you asked for, rather than sending the same thing again, is what moves this.",
      retryable: false,
    };
  }

  /* Never started, ended quickly: the request did not get out. */
  if (!facts.started && facts.elapsedMs < NEAR_CEILING_MS) {
    return {
      cause:
        facts.thrown && /load failed|network|fetch/i.test(facts.thrown)
          ? "That didn't reach the server — the connection dropped on the way out. Nothing was changed."
          : "That didn't reach the server. Nothing was changed.",
      remedy: "Check your connection and send it again; your message is still in the box.",
      retryable: true,
    };
  }

  /* Started, ended early, said nothing. Genuinely unidentified — and the
     honest answer says so rather than inventing a likely-sounding cause, which
     is the failure mode this whole file is a reaction to. */
  return {
    cause: "That stopped before it finished, and nothing came back to say why. Your page has not been touched.",
    remedy:
      "Send it again — it rejoins the saved change rather than starting a second one. " +
      "If it stops the same way twice, say so and we'll look at it from this end.",
    retryable: true,
  };
}

/* Whether a sentence already tells somebody what to do.
 *
 * The gates in edit.ts and the routes mostly write "…, so I've left the page
 * exactly as it was. Ask for it a section at a time" — cause and remedy in one
 * breath. Adding a second instruction under that reads as though the first was
 * not meant. */
function hasRemedy(said: string): boolean {
  return /\b(ask|try|send|rename|top up|sign in|tell me|say which|naming|name the|rebuild|choose|pick|wait)\b/i.test(
    said,
  );
}
