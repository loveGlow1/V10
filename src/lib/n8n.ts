/* The contract between this app and the build orchestrator.
 *
 * The orchestrator is an n8n workflow — see n8n/README.md and
 * n8n/build-orchestrator.workflow.ts. It takes a description of an app,
 * classifies what kind of build it is, runs the matching branch, and answers
 * with somewhere to look at the result.
 *
 * The webhook URL is deliberately not NEXT_PUBLIC_. Every call goes through
 * /api/build, which knows who is asking and which projects they own; putting
 * the URL in the browser bundle would let anyone POST builds directly. */

import { signBuildClaim } from "@/lib/build-signature";
import { safeHttpUrl } from "@/lib/safe-url";

/* The orchestrator only builds web apps and landing pages now — its WordPress
   and e-commerce branches were removed. Both stay in the union because
   `projects.intent` is where this is read back from, and rows written before
   that change still hold them. */
export type BuildIntent = "webapp" | "wordpress" | "ecommerce" | "unclassified";

/** Mirrors the status strings the orchestrator writes to projects.status. */
export type BuildStatus = "Building" | "Built" | "Failed" | "Needs Clarification";

export type BuildRequest = {
  /** What the person asked for, in their words. Drives the classifier. */
  prompt: string;
  projectName: string;
  /** auth.users.id — the orchestrator writes rows against it. */
  userId: string;
  /** The row this build belongs to. Created before the build starts. */
  projectId: string;
  /** Ties a reply to the message that asked for it. */
  requestId: string;
  /* Signed addresses for any images attached to the message. URLs rather than
     bytes: the orchestrator hands these straight to the model, and pushing
     megabytes of base64 through a webhook to do the same job is the version
     that falls over. */
  attachmentUrls?: string[];
  /** The text of any non-image attachments, already read. */
  attachmentText?: string;
};

export type BuildResult = {
  ok: boolean;
  requestId: string;
  projectId: string;
  intent: BuildIntent;
  status: BuildStatus;
  links: { preview: string; repo: string; admin: string };
  /** Environment variables the built app needs, e.g. NEXT_PUBLIC_SUPABASE_URL. */
  configKeys: Record<string, string>;
  /** Whatever the branch produced: stack, plugins, tables, webhooks. */
  artifacts: Record<string, unknown>;
  /** One line for the chat, written by the orchestrator. */
  message: string;
};

export const isBuilderConfigured = Boolean(process.env.N8N_WEBHOOK_URL);

/** The header carrying N8N_WEBHOOK_TOKEN. Must match the Header Auth credential
 *  on the workflow's Webhook node, name for name. */
export const WEBHOOK_TOKEN_HEADER = "X-QuickStark-Token";

/* How long to wait before giving up.
   Deliberately under the 60s the hosting platform allows a function to run: at
   exactly 60s the platform wins, kills this function mid-flight, and the browser
   gets a gateway error page instead of the sentence below — which is a spinner
   that never resolves rather than a build that says what went wrong. Five
   seconds of headroom is what buys the app the last word. */
const TIMEOUT_MS = 55_000;

export class BuilderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BuilderError";
  }
}

/* Trusts the shape no further than it has to: the orchestrator is a workflow
   someone can edit in a browser, so a branch that stops setting `links` should
   surface as a build with no preview rather than a crash in the chat panel. */
function readResult(value: unknown, fallbackRequestId: string): BuildResult {
  const body = (value ?? {}) as Partial<BuildResult> & { links?: Partial<BuildResult["links"]> };
  const status = body.status;

  return {
    ok: body.ok !== false,
    requestId: typeof body.requestId === "string" ? body.requestId : fallbackRequestId,
    projectId: typeof body.projectId === "string" ? body.projectId : "",
    intent: (body.intent ?? "unclassified") as BuildIntent,
    status:
      status === "Building" ||
      status === "Built" ||
      status === "Failed" ||
      status === "Needs Clarification"
        ? status
        : "Building",
    /* Filtered here rather than at the point of rendering as well as there:
       these become href and iframe src, and the orchestrator is a workflow
       anyone with n8n access can edit. Anything that is not an absolute
       http(s) URL becomes "" and is simply not offered as a link. */
    links: {
      preview: safeHttpUrl(body.links?.preview) ?? "",
      repo: safeHttpUrl(body.links?.repo) ?? "",
      admin: safeHttpUrl(body.links?.admin) ?? "",
    },
    configKeys: (body.configKeys ?? {}) as Record<string, string>,
    artifacts: (body.artifacts ?? {}) as Record<string, unknown>,
    message: typeof body.message === "string" ? body.message : "The build has started.",
  };
}

/** Runs one build. Throws {@link BuilderError} with a status the route can pass on. */
export async function startBuild(request: BuildRequest): Promise<BuildResult> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new BuilderError(
      "Building is not connected yet — set N8N_WEBHOOK_URL to the orchestrator's webhook.",
      503,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /* The shared secret the webhook's Header Auth credential checks.
           A dedicated header rather than Authorization: n8n's Header Auth
           compares the whole value, so "Bearer " would have to be typed into
           the credential exactly, and a missing prefix fails as a 403 that
           looks like a wrong token. One field, one value, nothing to get
           subtly wrong. */
        ...(process.env.N8N_WEBHOOK_TOKEN
          ? { [WEBHOOK_TOKEN_HEADER]: process.env.N8N_WEBHOOK_TOKEN }
          : {}),
      },
      /* The signature travels with the request and is carried by the workflow
         into the build step, which is called with no session behind it and has
         to be told which project it may write to. n8n never interprets it; it
         is an opaque field passed through. See src/lib/build-signature.ts. */
      body: JSON.stringify({ ...request, signature: signBuildClaim(request) ?? "" }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new BuilderError(
      (error as Error)?.name === "AbortError"
        ? "The build is taking longer than expected. It may still finish — reopen the app in a moment."
        : "Could not reach the builder.",
      504,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    /* These two are the mistakes that actually get made, so they are named
       rather than reported as a bare status: 404 is an unpublished workflow,
       403 is a token that does not match the Header Auth credential. */
    if (response.status === 404) {
      throw new BuilderError(
        "The builder answered 404 — the workflow is probably not published yet.",
        502,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new BuilderError(
        `The builder rejected the request (${response.status}) — check that the webhook's Header Auth credential uses the header ${WEBHOOK_TOKEN_HEADER} with the same value as N8N_WEBHOOK_TOKEN.`,
        502,
      );
    }
    throw new BuilderError(`The builder answered ${response.status}.`, 502);
  }

  try {
    return readResult(await response.json(), request.requestId);
  } catch {
    throw new BuilderError("The builder answered with something that was not JSON.", 502);
  }
}
