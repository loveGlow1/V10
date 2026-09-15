/* What a failed deployment means, as opposed to what it printed.
 *
 * `deployment_error` holds the last thirty lines of a `next build` that
 * stopped. vercel-deploy.ts is right to capture all of them — a filtered log
 * once reduced an entire explanation to "Vercel CLI 59.11.7", and the comment
 * there is worth reading — but a log tail is EVIDENCE, and it was being shown
 * as the ANSWER:
 *
 *     Vercel could not finish the deployment:
 *     Running build in Washington, D.C., USA (East) – iad1
 *     Installing dependencies...
 *     ▲ Next.js 15.5.25
 *     Linting and checking validity of types ...
 *     Failed to compile.
 *     ./app/admin/page.tsx:3:18
 *     Type error: Page "app/admin/page.tsx" does not match the required types…
 *
 * That is addressed to whoever built this platform. The person reading it typed
 * a sentence about a bakery. They cannot act on it, they cannot tell whether
 * their project is broken or the platform is, and — because the log had taken
 * the place of the preview — they could no longer see the thing they had paid
 * to have built.
 *
 * So the log becomes a diagnosis: a sentence saying what happened, a sentence
 * saying what to do, and a flag saying whether this platform can simply fix it.
 * The log itself is kept, verbatim and uncut, behind that. Nothing is thrown
 * away — it is filed where it belongs.
 *
 * ── The rule about not knowing ────────────────────────────────────────────
 *
 * An unrecognised failure gets an honest unrecognised-failure diagnosis, never
 * a confident guess. "Something went wrong preparing the production version"
 * plus the log is the correct answer when this file does not recognise the
 * shape; inventing a cause from a log it cannot read would be worse than the
 * raw text, because the raw text at least does not mislead.
 *
 * Pure: a string in, a diagnosis out, no network and no SDK.
 * See tools/check-deploy-diagnosis.mjs.
 */

export type Diagnosis = {
  /** The state, as a heading. Always the same words for the same kind of thing. */
  headline: string;
  /** What happened, for somebody who did not write the code. One sentence. */
  summary: string;
  /** What happens next. Null when there is nothing useful to say. */
  next: string | null;
  /* Whether this platform can repair it without being asked anything. Drives
     the [ Fix automatically ] control: shown only where pressing it would
     actually do something, because a button that fails is worse than none. */
  automatic: boolean;
  /** The file it is about, when the log named one. */
  file: string | null;
  /** The log, verbatim, for the technical panel behind all of the above. */
  detail: string;
};

/* Every entry is a real `next build`, npm or Vercel failure. The order is the
   order they are tested in, so the specific ones come before the general: a
   type error caused by an invalid page export is an invalid page export, not a
   type error.

   `summary` never quotes the framework and never names a file — the file goes
   in its own field, and the log is one click away. What it says is what a
   person can do something about. */
const KNOWN: {
  when: RegExp;
  summary: string;
  next: string | null;
  automatic: boolean;
}[] = [
  {
    /* The structural defect next-structure.ts repairs. Reaching here means a
       project built before that existed, so the fix is to re-run it. */
    when: /is not a valid (?:Page|Layout) export field|does not match the required types of a Next\.js/i,
    summary: "A reusable piece of one page is written inside the page itself, which the framework does not allow.",
    next: "QuickStark can move it into its own file and try again.",
    automatic: true,
  },
  {
    when: /cannot use both "use client" and export function "generateStaticParams/i,
    summary: "One page is trying to be interactive and pre-built at the same time, which the framework does not allow in a single file.",
    next: "QuickStark can split it into the two files this needs and try again.",
    automatic: true,
  },
  {
    when: /You're importing a component that needs (?:useState|useEffect|useRef|useReducer|createContext)|only works in a Client Component|Event handlers cannot be passed to Client Component/i,
    summary: "A page uses something interactive without being marked as interactive.",
    next: "QuickStark can mark it and try again.",
    automatic: true,
  },
  {
    when: /Module not found: Can't resolve ['"]([^'"]+)['"]/i,
    summary: "One file imports another that is not in the project.",
    next: "QuickStark can look at the import and put it right.",
    automatic: false,
  },
  {
    when: /missing param|generateStaticParams\(\) is missing|Page is missing "generateStaticParams/i,
    summary: "A page with an address that changes — a blog post, a product — does not say which ones to build.",
    next: "QuickStark can work out the list and add it.",
    automatic: false,
  },
  {
    when: /Type error:/i,
    summary: "The project does not quite typecheck, so the production build stopped.",
    next: "QuickStark can read the error and fix the file it names.",
    automatic: false,
  },
  {
    when: /JavaScript heap out of memory|FATAL ERROR:.*heap/i,
    summary: "The project is too large to compile in one go on the current plan.",
    next: "This usually needs the project split up, or a larger build machine.",
    automatic: false,
  },
  {
    when: /ERESOLVE|npm error|Conflicting peer dependency|ETARGET|404 Not Found - GET https:\/\/registry\.npmjs\.org/i,
    summary: "The project's packages could not be installed.",
    next: "This is usually a version that no longer exists. QuickStark can pin a working set.",
    automatic: false,
  },
  {
    /* Not a build failure at all: the build worked and the site is behind
       Vercel's own auth. The distinction matters because nothing about the
       project needs fixing. */
    when: /Deployment Protection|401|Authentication Required|password protection/i,
    summary: "The site built and is running, but Vercel is asking visitors to sign in before they can see it.",
    next: "Turn Deployment Protection off for this project in the Vercel dashboard.",
    automatic: false,
  },
  {
    when: /no VERCEL_API_TOKEN|has no VERCEL_API_TOKEN/i,
    summary: "Publishing is not switched on for this installation of QuickStark yet.",
    next: "An administrator needs to add a Vercel API token to the platform's environment.",
    automatic: false,
  },
  {
    when: /did not answer in time|could not reach Vercel|ECONNRESET|ETIMEDOUT|socket hang up/i,
    summary: "The hosting service could not be reached while publishing.",
    next: "Nothing is wrong with the project. Try publishing again in a moment.",
    automatic: false,
  },
  {
    when: /taking longer than expected and is still running/i,
    summary: "The production build is still going.",
    next: "It will come online on its own. This page will say so when it does.",
    automatic: false,
  },
  {
    when: /there are no files to deploy/i,
    summary: "There is nothing built to publish yet.",
    next: "Send a message describing what you want and QuickStark will build it.",
    automatic: false,
  },
];

/* The file a build log blamed. Next.js prints it on its own line, as a path
   relative to the project, immediately before the error. */
const FILE = /(?:^|\s)\.?\/?((?:app|components|lib|src)\/[\w[\]().-]+(?:\/[\w[\]().-]+)*\.[jt]sx?)/m;

/** The heading. One of two, and which one is the whole point. */
const NEEDS_ATTENTION = "Deployment needs attention";
const STILL_WORKING = "Still publishing";

/**
 * What this failure means.
 *
 * `raw` is whatever was stored: a build log tail, a refusal from Vercel, or one
 * of this codebase's own sentences. All three arrive at the same place.
 */
export function diagnose(raw: string | null | undefined): Diagnosis | null {
  const detail = typeof raw === "string" ? raw.trim() : "";
  if (detail.length === 0) return null;

  const named = detail.match(FILE);
  const file = named ? named[1] : null;

  for (const entry of KNOWN) {
    if (!entry.when.test(detail)) continue;
    return {
      headline: /still running|taking longer/i.test(detail) ? STILL_WORKING : NEEDS_ATTENTION,
      summary: entry.summary,
      next: entry.next,
      automatic: entry.automatic,
      file,
      detail,
    };
  }

  /* Not recognised. Says so, rather than guessing — see the header. */
  return {
    headline: NEEDS_ATTENTION,
    summary: "QuickStark found a problem while preparing the production version of this project.",
    next: "Your project is still here and still works in the preview. The technical details below say what the build server reported.",
    automatic: false,
    file,
    detail,
  };
}

/**
 * The same thing for the structural findings caught BEFORE a deployment.
 *
 * inspectStructure already produces human sentences, so this does not
 * re-describe them — it assembles them into the one shape the workspace knows
 * how to render, so a problem found in fifty milliseconds and a problem found
 * by Vercel two minutes later look the same to the person reading them. They
 * are the same problem; only the speed differs.
 */
export function diagnoseFindings(
  findings: readonly { file: string; problem: string; detail: string; repairable: boolean }[],
): Diagnosis | null {
  if (findings.length === 0) return null;

  const first = findings[0];
  const rest = findings.length - 1;

  return {
    headline: NEEDS_ATTENTION,
    summary:
      rest > 0
        ? `${first.problem} There ${rest === 1 ? "is 1 other thing" : `are ${rest} other things`} to put right as well.`
        : first.problem,
    next: findings.every((finding) => finding.repairable)
      ? "QuickStark can fix this and try again."
      : "QuickStark can look at this and put it right.",
    automatic: findings.every((finding) => finding.repairable),
    file: first.file,
    detail: findings.map((finding) => `${finding.file}\n${finding.detail}`).join("\n\n"),
  };
}
