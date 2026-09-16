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
 * ceiling will be killed again at sixty seconds, and again after that. "Try it
 * again" sent a customer round that loop four times in nine minutes, paying
 * attention each time, while the thing they needed to know — that the change
 * was too big to finish in the time, and to ask for one section instead — was
 * never said by anything.
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

  /* ── The one that was being reported as "try it again" ────────────────
   *
   * The work started, ran for most of a minute, and the connection ended with
   * no answer. That is the platform's ceiling, and it is deterministic: the
   * same message will do the same thing. Saying "try again" here is the single
   * most expensive sentence in the product. */
  if (!facts.answered && facts.elapsedMs >= NEAR_CEILING_MS) {
    const seconds = Math.round(facts.elapsedMs / 1000);
    return {
      cause:
        `That ran for ${seconds} seconds and was cut off — a change has one minute to finish in, ` +
        `and this one did not fit. Your page has not been touched.`,
      remedy:
        "Ask for one part at a time and name it in the words that are on the page — " +
        '"the header", "the pricing table", "the footer". A smaller change finishes ' +
        "well inside the minute, and three small ones land where one large one cannot. " +
        "Choosing the Prototype agent also helps: it is the fastest of the three.",
      /* The important field. Sending the same thing again reproduces this. */
      retryable: false,
    };
  }

  /* Gateway failures from the platform itself, which look like a timeout and
     are not the customer's doing either. */
  if (facts.status === 504 || facts.status === 502) {
    return {
      cause: "The server took too long to answer and the connection was closed. Nothing was changed.",
      remedy:
        "Ask for a smaller part of the change — one section, named in the words on the page — " +
        "which finishes inside the time this has to answer in.",
      retryable: false,
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
      "Send it again — if it stops the same way a second time, ask for a smaller part of " +
      "the change and it will usually go through.",
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
