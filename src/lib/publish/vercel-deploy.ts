/* Making a generated project a running site.
 *
 * A build that produces a Next.js project produces `.tsx`, and `.tsx` is not
 * something a browser can be shown. Until this file there was nowhere in the
 * system that could turn it into HTML: the preview fell back to a written
 * summary (see builder/project-summary.ts, which argues correctly that a
 * mock-up would be worse), and publishing could only ever serve the single
 * `html` column. So a customer who asked for an app got a receipt for one.
 *
 * The missing step is a build, and the cheapest correct place to do a Next.js
 * build is Vercel, which already does exactly this and is already a dependency
 * of this deployment for custom domains. The files go up, Vercel installs,
 * builds and hosts them, and the deployment URL is the preview — not a picture
 * of the app, the app.
 *
 * ── The environment goes in the FILES, not in the API call ────────────────
 *
 * A generated project needs three values to reach its database:
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * NEXT_PUBLIC_SUPABASE_SCHEMA. All three are NEXT_PUBLIC_, which means Next
 * inlines them at BUILD time and ships them to every visitor — they are public
 * by construction, and the generated README says so.
 *
 * They are therefore written into the uploaded tree as `.env.production`
 * rather than passed as deployment environment variables. Partly because the
 * build needs them at build time and a file is unambiguous about that; mostly
 * because `files` is the mechanism this was written against and verified, and
 * an integration that depends on a field nobody checked is an integration that
 * fails in production for a reason nobody can see.
 *
 * NOTHING SECRET MAY BE ADDED TO THAT FILE. It is compiled into the site. A
 * service-role key or a Postgres URL written here would be handed to every
 * visitor of every generated app, which is why writeEnvFile below takes a
 * fixed set of three keys rather than a record.
 *
 * ── Failure is ordinary ───────────────────────────────────────────────────
 *
 * Every path returns a reason rather than throwing. No token configured, a
 * refused request, a build that fails to compile: all of them leave the caller
 * free to fall back to the summary, which is a worse preview but an honest one.
 * A deployment that could not happen must never take the build down with it —
 * the files are still worth having and the customer still paid for them.
 */

import type { FileTree } from "@/lib/builder/tree";
import { splitClientRoutes } from "@/lib/builder/client-routes";
import { NEXT_VERSION } from "@/lib/builder/scaffold";

const API = "https://api.vercel.com";

/* One request. Generous next to the domain client's ten seconds because this
   one carries the whole project in its body. */
const REQUEST_TIMEOUT_MS = 30_000;

/* How long to wait for Vercel to install and compile. A small Next.js project
   is usually well inside a minute; past three the answer the customer needs is
   "it is still building", not a spinner that never resolves. */
const BUILD_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

/* Vercel derives the deployment's hostname from this, so it has to survive
   being put in one: lowercase, alphanumeric and dashes, no leading or trailing
   dash, and short enough to leave room for the suffixes Vercel appends. */
const MAX_NAME_LENGTH = 52;

export type DeployTarget = {
  /** Names the Vercel project. One per generated project, stable across builds. */
  name: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The generated app's own Postgres schema. */
  supabaseSchema: string;
};

export type DeployOutcome =
  | { ok: true; url: string; deploymentId: string }
  /* `reason` is written to be shown to the person who asked for the build, so
     it says what failed and what it means for them rather than echoing a
     status code. */
  | { ok: false; reason: string };

function credentials(): { token: string; teamQuery: string } | null {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return null;

  /* VERCEL_PROJECT_ID is deliberately NOT read here. That variable names the
     Vercel project this platform is deployed as; a generated app is its own
     project, created by name on first deploy. Reusing the platform's id would
     deploy a customer's app over this one. */
  const teamId = process.env.VERCEL_TEAM_ID;
  return { token, teamQuery: teamId ? `?teamId=${encodeURIComponent(teamId)}` : "" };
}

/** Whether generated projects can be deployed at all in this deployment. */
export function deploymentsConfigured(): boolean {
  return credentials() !== null;
}

/**
 * A Vercel project name derived from whatever the customer called their
 * project. Never throws and never returns empty: a name that cannot be
 * salvaged becomes its fallback, because refusing to deploy over a project
 * title is not a trade anybody would choose.
 */
export function deploymentName(projectName: string, projectId: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH);

  /* The project id's first segment, so two projects with the same title are
     still two sites. */
  const suffix = projectId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const base = slug || "app";
  return `${base}-${suffix}`.slice(0, MAX_NAME_LENGTH).replace(/-+$/g, "");
}

/**
 * The tree as Vercel wants it, plus the environment the build needs.
 *
 * Exported for its own sake: the payload is the part of this worth testing
 * without a network, and a caller that wants to see what would be uploaded
 * should not have to attempt a deployment to find out.
 */
/* The framework version the platform stands behind, forced on the way out.
 *
 * A tree carries whatever package.json it was generated with, and a build from
 * last month pins whatever was current last month. When that version is later
 * deprecated for a CVE, every one of those trees becomes undeployable —
 * Vercel refuses the deployment outright, AFTER a clean compile, with
 * "Vulnerable version of Next.js detected". That is what happened here: the
 * stored tree pinned 15.5.4, the scaffold had already been patched to 15.5.25,
 * and the only way out looked like regenerating the project and paying for it
 * again.
 *
 * It is not a fair thing to charge somebody for. The framework version is
 * infrastructure this platform chooses — the same argument that makes
 * lib/supabase.ts and next.config.mjs PLATFORM_OWNED in scaffold.ts — so the
 * deployment carries the current pin whatever the tree says.
 *
 * Only `next`, and only in dependencies. Everything else the model or the
 * scaffold put in that manifest is left exactly as it is, because a deploy
 * quietly rewriting somebody's dependency list is its own kind of bug.
 *
 * Unparseable JSON is left alone rather than repaired. A malformed
 * package.json fails the build loudly, which is the right failure; a deploy
 * step that silently rewrites one hides a real problem. */
function withCurrentFramework(file: { file: string; data: string; encoding: "utf-8" }) {
  if (file.file !== "package.json") return file;

  try {
    const manifest = JSON.parse(file.data) as { dependencies?: Record<string, string> };
    if (!manifest.dependencies?.next || manifest.dependencies.next === NEXT_VERSION) return file;

    manifest.dependencies.next = NEXT_VERSION;
    return { ...file, data: `${JSON.stringify(manifest, null, 2)}\n` };
  } catch {
    return file;
  }
}

export function deploymentFiles(tree: FileTree, target: DeployTarget) {
  /* Written rather than appended to whatever the generator emitted: a
     generated .env.production would be the model's guess at these values, and
     the platform's own are the correct ones. Last writer wins below. */
  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=${target.supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${target.supabaseAnonKey}`,
    `NEXT_PUBLIC_SUPABASE_SCHEMA=${target.supabaseSchema}`,
    "",
  ].join("\n");

  /* Repaired on the way out, for the same reason the framework pin is: every
     project ever generated is still sitting in the database, and a tree stored
     before completeTree learned to split these would otherwise need generating
     a second time — and charging for a second time — to become deployable.
     Applied at BOTH ends deliberately: completeTree fixes what gets stored, so
     the download compiles too, and this fixes what already was. It finds
     nothing to do on a tree that has been through the other one. */
  const files = splitClientRoutes(tree)
    .filter((file) => file.path !== ".env.production" && file.path !== ".env.local")
    .map((file) => ({ file: file.path, data: file.content, encoding: "utf-8" as const }));

  files.push({ file: ".env.production", data: env, encoding: "utf-8" as const });
  return files.map(withCurrentFramework);
}

type Called = { ok: true; status: number; body: unknown } | { ok: false; reason: string };

async function call(path: string, init: RequestInit, token: string): Promise<Called> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { ok: true, status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "Vercel did not answer in time" : "could not reach Vercel" };
  } finally {
    clearTimeout(timer);
  }
}

/* Vercel puts the reason a request was refused in the body. A status on its
   own tells the customer nothing they can act on. */
function refusal(body: unknown, status: number): string {
  const message =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string } }).error?.message
      : undefined;
  return message ? `Vercel refused the deployment: ${message}` : `Vercel answered ${status}`;
}

function readDeployment(
  body: unknown,
): { id: string; url: string; state: string; inspect: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    id?: unknown;
    url?: unknown;
    readyState?: unknown;
    status?: unknown;
    inspectorUrl?: unknown;
  };
  if (typeof record.id !== "string" || typeof record.url !== "string") return null;
  /* readyState is the documented field; status appears alongside it on some
     responses. Either is enough to know whether to keep waiting. */
  const state =
    typeof record.readyState === "string"
      ? record.readyState
      : typeof record.status === "string"
        ? record.status
        : "QUEUED";
  /* Vercel's own page for this deployment, with the full build log on it.
     Carried through so a failure can point at it: whatever this module puts in
     a card is a tail, and the tail is not always where the reason is. */
  return {
    id: record.id,
    url: record.url,
    state,
    inspect: typeof record.inspectorUrl === "string" ? record.inspectorUrl : null,
  };
}

/**
 * Uploads a generated project and waits for Vercel to build it.
 *
 * Resolves with the deployment's URL once it is READY, or with a reason. Never
 * throws: see the note at the top of the file about why a failed deployment
 * must not be able to fail the build it came from.
 */
export async function deployProject(tree: FileTree, target: DeployTarget): Promise<DeployOutcome> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, reason: "this deployment has no VERCEL_API_TOKEN, so it cannot build projects" };
  }
  if (tree.length === 0) {
    return { ok: false, reason: "there are no files to deploy" };
  }

  const created = await call(
    `/v13/deployments${creds.teamQuery}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: target.name,
        files: deploymentFiles(tree, target),
        /* framework: "nextjs" is what tells Vercel to run `next build` and to
           host the result rather than serving the source as static files.
           The nulls are Vercel's own defaults for the framework and are sent
           explicitly so a project setting left over from an earlier deploy of
           the same name cannot override them. */
        projectSettings: {
          framework: "nextjs",
          buildCommand: null,
          installCommand: null,
          outputDirectory: null,
          devCommand: null,
        },
        target: "production",
      }),
    },
    creds.token,
  );

  if (!created.ok) return { ok: false, reason: created.reason };
  if (created.status >= 400) return { ok: false, reason: refusal(created.body, created.status) };

  const deployment = readDeployment(created.body);
  if (!deployment) return { ok: false, reason: "Vercel accepted the upload but did not say where it went" };

  const ready = await waitForBuild(deployment.id, deployment.url, creds);
  return ready;
}


/* What the build actually said.
 *
 * "The project did not compile" is true and nearly useless. The thing that
 * would fix the project is the compiler's own line — the file, the line
 * number, the type that did not match — and Vercel has it, on the deployment's
 * event stream, for the asking.
 *
 * So a failed build is asked. The alternative was a person opening the Vercel
 * dashboard, finding a project named after their app among the others, opening
 * the failed deployment and scrolling its log; that is a reasonable thing to
 * ask of the engineer who built this platform and not of somebody who typed a
 * sentence into it.
 *
 * Best effort. This runs after a failure and must not become a second one, so
 * anything unexpected leaves the plain reason standing.
 *
 * Capped, because the destination is a column in a table and a card in a
 * preview rather than a log viewer — but raised from 12 lines and 1200
 * characters, which was tuned for a filtered log and is too tight for an
 * unfiltered one. A `next build` that fails prints the failing file, the line,
 * the code around it and then a summary, and twelve lines lands in the middle
 * of that. Thirty reaches the start of it. */
const LOG_LINES = 30;
const LOG_CHARS = 3000;

async function buildLog(
  id: string,
  creds: { token: string; teamQuery: string },
): Promise<string | null> {
  const joiner = creds.teamQuery ? "&" : "?";
  const events = await call(
    `/v2/deployments/${encodeURIComponent(id)}/events${creds.teamQuery}${joiner}builds=1&limit=200`,
    {},
    creds.token,
  );

  if (!events.ok || events.status >= 400 || !Array.isArray(events.body)) return null;

  /* ── The tail of the log, not a search through it ────────────────────────
   *
   * This used to keep only lines that were stderr or matched
   * /error|failed|cannot|expected|Type '/ — the theory being that a failed
   * `next build` puts its diagnosis in one of those and the rest is install
   * chatter.
   *
   * What that actually produced, on a real failed deployment, was this, in
   * full, as the entire explanation given to the customer:
   *
   *     Vercel could not finish the deployment:
   *     Vercel CLI 59.11.7
   *
   * Fifty-eight characters. The CLI banner goes to stderr, so it matched; the
   * build output that said what went wrong went to stdout and did not contain
   * any of those five words, so every line of it was discarded. The deployment
   * failed for a reason that was sitting right there and got filtered out on
   * the way to the one person who needed it.
   *
   * A filter that decides in advance which words a failure will use is a
   * filter that hides the failures nobody predicted — and those are exactly
   * the ones worth reading. The last lines of a build that stopped are what
   * anybody would look at, so that is what this returns: all of them, in
   * order, tail-first-out. Noisier by design. Noise can be read; a discarded
   * diagnosis cannot. */
  const lines: string[] = [];
  for (const entry of events.body as { type?: unknown; payload?: unknown }[]) {
    const payload = entry?.payload as { text?: unknown } | undefined;
    const text = typeof payload?.text === "string" ? payload.text.trimEnd() : "";
    /* Blank lines are dropped, and nothing else is. A build log is mostly
       vertical whitespace and it is the one thing that costs a line of the
       tail without ever carrying a reason. */
    if (text.trim()) lines.push(text);
  }

  if (lines.length === 0) return null;
  return lines.slice(-LOG_LINES).join("\n").slice(-LOG_CHARS);
}

/* ── Asking again, because the last lines arrive last ──────────────────────
 *
 * The deployment's state flips to ERROR before its final log events are
 * readable, and reading them immediately gets the log as it was a moment
 * before it failed. On a real failure that produced this, ending mid-sentence
 * exactly where the reason was about to be:
 *
 *     ✓ Compiled successfully in 11.3s
 *     Linting and checking validity of types ...
 *
 * The compile had succeeded, the type check had not, and the line naming the
 * file and the error had not been written yet. Everything the customer needed
 * was in the two lines after the last one we fetched.
 *
 * So it is fetched again, twice, a second apart, and the longest answer wins.
 * Longer is the right test rather than newer: these events only ever accrue,
 * so the fullest log is the latest one, and a request that comes back short
 * because it raced is never mistaken for the truth.
 *
 * Two seconds in the worst case, spent only on builds that already failed.
 * That is a cheap price for the difference between a diagnosis and a
 * cliffhanger. */
const LOG_SETTLE_TRIES = 3;
const LOG_SETTLE_MS = 1_000;

async function settledLog(
  id: string,
  creds: { token: string; teamQuery: string },
): Promise<string | null> {
  let best: string | null = null;

  for (let attempt = 0; attempt < LOG_SETTLE_TRIES; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, LOG_SETTLE_MS));

    const log = await buildLog(id, creds);
    if (log && (!best || log.length > best.length)) best = log;
  }

  return best;
}

async function waitForBuild(
  id: string,
  url: string,
  creds: { token: string; teamQuery: string },
): Promise<DeployOutcome> {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;

  for (;;) {
    const polled = await call(`/v13/deployments/${encodeURIComponent(id)}${creds.teamQuery}`, {}, creds.token);

    if (polled.ok && polled.status < 400) {
      const state = readDeployment(polled.body)?.state ?? "QUEUED";

      if (state === "READY") return { ok: true, url: `https://${url}`, deploymentId: id };

      if (state === "ERROR" || state === "CANCELED") {
        /* NOT necessarily a compile failure, and this used to say it was.
         *
         * The first real deployment reported ERROR with a log that ended
         * "Build Completed in /vercel/output [39s]" — the compile had
         * succeeded and the message blamed the generated code anyway. A
         * deployment can be refused after a clean build: the last line before
         * that one was Vercel's own "Vulnerable version of Next.js detected".
         *
         * So the state is reported as what it is — Vercel would not finish the
         * deployment — and the log says why. Guessing at a cause and being
         * wrong sent an hour looking for a type error that was never there. */
        const log = await settledLog(id, creds);
        const what = state === "CANCELED" ? "the deployment was cancelled" : "Vercel could not finish the deployment";
        /* The whole log lives on Vercel's own page for this deployment. What
           is quoted below is the tail of it, and a tail is not always where
           the reason is — so the address goes with it rather than leaving
           somebody to find a failed deployment by its name. */
        const where = readDeployment(polled.body)?.inspect;
        const tail = log ? `${what}:\n${log}` : `${what} — its build reported ${state}`;
        return { ok: false, reason: where ? `${tail}\n\nFull build log: ${where}` : tail };
      }
    }

    if (Date.now() >= deadline) {
      /* Still building is not the same as broken, and the URL is real whether
         or not this call waited long enough to see it finish. */
      return { ok: false, reason: "the build is taking longer than expected and is still running" };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
