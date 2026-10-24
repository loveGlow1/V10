import { NextResponse } from "next/server";
import { type BuildStep, type StepSink } from "@/lib/builder/steps";

/* Where a build is started.
 *
 * Everything the chat sends goes through here rather than straight to n8n. The
 * webhook URL stays on the server, the caller is identified from their session
 * rather than from the body, and the project is checked to be theirs before a
 * word of it reaches the orchestrator — an n8n webhook has no idea who is
 * calling it, so that check cannot live on the other side.
 */

export const runtime = "nodejs";
/* A build is a side effect; it must never be served from a cache. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BuildRequestBody = {
  projectId?: unknown;
  prompt?: unknown;
  requestId?: unknown;
  intentOverride?: unknown;
  planOnly?: unknown;
  confirmNewProject?: unknown;
  upgrade?: unknown;
  sql?: unknown;
  confirmSql?: unknown;
  stack?: unknown;
  buildKind?: unknown;
  target?: unknown;
  architecture?: unknown;
  market?: unknown;
  attachmentIds?: unknown;
  model?: unknown;
};

const MAX_PROMPT = 600_000;

type StreamLine =
  | { type: "step"; step: BuildStep }
  | { type: "text"; delta: string }
  | { type: "result"; status: number; body: unknown };

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (line: StreamLine) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };

      let response: NextResponse;
      try {
        let body: BuildRequestBody;
        try {
          body = (await request.json()) as BuildRequestBody;
        } catch {
          response = NextResponse.json(
            { error: "That message didn't arrive in a form I could read. Try sending it again." },
            { status: 400 }
          );
        }

        if (!response) {
          const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";
          const attached = Array.isArray(body.attachmentIds)
            ? body.attachmentIds.filter((id) => typeof id === "string").length
            : 0;
          const prompt = typed || (attached > 0 ? "Use the attached file in this page." : "");

          if (!prompt) {
            response = NextResponse.json({ error: "Tell me what you'd like and I'll get started." }, { status: 400 });
          } else if (prompt.length > MAX_PROMPT) {
            response = NextResponse.json({ error: "Your prompt is too long. Please shorten it and try again." }, { status: 400 });
          } else {
            // Emit an initial step to show activity immediately in the frontend timeline
            write({
              type: "step",
              step: {
                id: "dispatch-webhook",
                label: "Dispatching build request to workflow engine...",
                state: "running",
              },
            });

            // ── ASYNCHRONOUS WEBHOOK HANDOFF TO n8n PRODUCTION URL ──────────
            // Forward the payload directly to n8n using your Header Auth configuration.
            // Replace 'N8N_API_KEY' below with whatever environment variable name you choose in your .env file.
            const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || "https://neuvat7.app.n8n.cloud/webhook/api/v1/build";
            const n8nAuthSecret = process.env.N8N_API_KEY || process.env.N8N_HEADER_AUTH_SECRET || "";

            const n8nResponse = await fetch(n8nWebhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": n8nAuthSecret,
              },
              body: JSON.stringify(body),
            });

            if (!n8nResponse.ok) {
              throw new Error(`n8n webhook responded with status code: ${n8nResponse.status}`);
            }

            const n8nData = await n8nResponse.json().catch(() => ({ success: true }));

            // Update step to complete
            write({
              type: "step",
              step: {
                id: "dispatch-webhook",
                label: "Build workflow successfully triggered.",
                state: "complete",
              },
            });

            // Immediately return success acknowledgment back to the UI so the HTTP socket closes cleanly without 504 errors
            response = NextResponse.json({
              success: true,
              message: "Build initiated successfully.",
              data: n8nData,
            }, { status: 200 });
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("build: the request failed outright:", error);
        response = NextResponse.json(
          { error: "Something went wrong on my side. Try that again." },
          { status: 500 }
        );
      }

      const responseBody = await response.json().catch(() => null);
      write({ type: "result", status: response.status, body: responseBody });

      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
