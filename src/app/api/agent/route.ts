import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { creditCostOf } from "@/app/dashboard/credits";
import { AUTO_MODEL, modelById } from "@/app/dashboard/models";
import { isUuid, lastSnapshotPath, loadMessages, loadSession, saveMessage } from "@/lib/agent/persist";
import { VISUAL_FILE, Workspace, createTools } from "@/lib/agent/tools";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The agent: one turn of a session, streamed.
 *
 * The browser sends only its newest message; everything before it is read
 * back from the session, so a tampered history cannot be smuggled in. The
 * reply streams as a UI message — text, reasoning, and every tool call with
 * its input arriving as it is written, which is what lets the code card fill
 * live — and is saved whole, parts and all, when the turn ends.
 *
 * AUTO-SNAPSHOT. After any step that wrote or edited a .tsx/.jsx/.html/.css
 * file, the next step is a screenshot and nothing else (toolChoice forced in
 * prepareStep): at most one per step, the working copy saved first, and the
 * picture handed back to the model as an image so it can check its own work.
 *
 * BILLED like every other model call here: refused up front on an empty
 * balance, charged after the turn by the same pricing as a build or a chat
 * (credits.ts), keyed to the reply's id so a retried request costs once. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = modelById(AUTO_MODEL);

const INSTRUCTIONS = `You are QuickStark's coding agent, working inside the user's project.

Work in small, verifiable steps. Read before you change: list the files with read_file "." and read what you will edit. Prefer edit_file for small changes and write_file for new files or rewrites. Run commands with run_command when you need to build or test.

After you change anything visual, a screenshot is taken automatically and shown to you. Look at it properly and fix what is wrong before you say you are done.

Never invent data, testimonials, metrics or API responses. Never put secrets or API keys in code that reaches the browser. When something cannot be done here, say so plainly.

Reply in short, plain prose with Markdown where it helps. Do not paste whole files into your reply — the files are already shown to the user as you write them.`;

type Body = { id?: unknown; message?: unknown };

function readMessage(value: unknown): UIMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as { id?: unknown; role?: unknown; parts?: unknown };
  if (typeof message.id !== "string" || message.role !== "user" || !Array.isArray(message.parts)) return null;
  /* Only what a person can type: text. Tool results and data parts are the
     server's to write. */
  const parts = message.parts
    .filter((part): part is { type: "text"; text: string } => !!part && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => ({ type: "text" as const, text: part.text.slice(0, 20_000) }));
  if (parts.length === 0 || !parts.some((part) => part.text.trim())) return null;
  return { id: message.id, role: "user", parts };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) return NextResponse.json({ error: "Sign in to use the agent." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "The agent is unavailable right now." }, { status: 503 });
  if (!process.env.ANTHROPIC_API_KEY || !MODEL?.apiId) {
    return NextResponse.json({ error: "The agent is not connected to a model on this deployment." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const sessionId = typeof body?.id === "string" ? body.id : "";
  const message = readMessage(body?.message);
  if (!message) return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  /* Read under the caller's own session: RLS returns it only to its owner. */
  const session = await loadSession(supabase, sessionId);
  if (!session) return NextResponse.json({ error: "That session does not exist." }, { status: 404 });

  const balance = await currentBalance(service, user.id);
  const available = balance ? balance.daily + balance.rollover + balance.monthly + balance.topUp : 0;
  if (available <= 0) {
    return NextResponse.json({ error: "You are out of credits. Top up or wait for tomorrow's refill.", code: "no_credits" }, { status: 402 });
  }

  const history = await loadMessages(supabase, service, session.id);
  /* The new message is saved before the model is called: what was asked
     survives even if the answer does not. Its id is the browser's, and must be
     a uuid to be stored. */
  if (!(await saveMessage(service, session.id, message))) {
    return NextResponse.json({ error: "Your message could not be saved. Try again." }, { status: 500 });
  }
  const messages = [...history.filter((one) => one.id !== message.id), message];

  let projectName: string | null = null;
  if (session.project_id) {
    const { data } = await service.from("projects").select("name").eq("id", session.project_id).eq("user_id", user.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "This session's project is not yours." }, { status: 403 });
    projectName = (data.name as string | null) ?? null;
  }

  const workspace = new Workspace(service, { userId: user.id, projectId: session.project_id, projectName, sessionId: session.id });
  const shots = { lastPath: lastSnapshotPath(history), previewUrl: session.preview_url };
  const tools = createTools(service, workspace, shots);

  /* Usage across every step, and when each piece of reasoning started and
     ended — "Thought for 4s" is read back from these after a reload. */
  let outputTokens = 0;
  const thinking: number[] = [];
  let thinkingSince = 0;

  const stream = createUIMessageStream({
    originalMessages: messages,
    generateId: () => crypto.randomUUID(),
    execute: async ({ writer }) => {
      const result = streamText({
        model: anthropic(MODEL.apiId as string),
        instructions: INSTRUCTIONS + (session.project_id ? "" : "\n\nThis session is not linked to a project: you can talk, but not write files or run commands."),
        messages: await convertToModelMessages(messages, { tools }),
        tools,
        stopWhen: isStepCount(20),
        abortSignal: request.signal,
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
        prepareStep: async ({ steps }) => {
          const last = steps.at(-1);
          if (!last) return {};
          const calls = (last.toolCalls ?? []) as { toolName: string; input: unknown }[];
          const results = (last.toolResults ?? []) as { toolName: string }[];
          const visual = calls.some(
            (call) =>
              (call.toolName === "write_file" || call.toolName === "edit_file") &&
              VISUAL_FILE.test(String((call.input as { path?: unknown } | null)?.path ?? "")),
          );
          const wrote = results.some((one) => one.toolName === "write_file" || one.toolName === "edit_file");
          const alreadyShot = calls.some((call) => call.toolName === "take_snapshot");
          /* One screenshot after a step that changed how it looks — and only
             when a change actually landed. */
          if (visual && wrote && !alreadyShot) return { toolChoice: { type: "tool", toolName: "take_snapshot" } };
          return {};
        },
        onChunk: ({ chunk }) => {
          if (chunk.type === "reasoning-start") thinkingSince = Date.now();
          else if (chunk.type === "reasoning-end" && thinkingSince) {
            thinking.push(Date.now() - thinkingSince);
            thinkingSince = 0;
          }
        },
        onStepEnd: ({ usage }) => {
          outputTokens += usage?.outputTokens ?? 0;
        },
      });
      writer.merge(
        toUIMessageStream({ stream: result.stream, sendReasoning: true, generateMessageId: () => crypto.randomUUID() }),
      );
    },
    onError: (error) => {
      // eslint-disable-next-line no-console
      console.error("agent: the turn failed:", error);
      return "The agent stopped because of an error. Your files are as it left them.";
    },
    onEnd: async ({ responseMessage, isAborted }) => {
      /* What it wrote is kept whether it finished or was stopped. */
      const summary = [...workspace.touched].slice(0, 6).join(", ");
      if (workspace.isDirty) await workspace.flush(summary || "changes");

      let reasoning = 0;
      for (const part of responseMessage.parts as { type: string; providerMetadata?: Record<string, unknown> }[]) {
        if (part.type !== "reasoning") continue;
        const ms = thinking[reasoning++];
        if (ms) part.providerMetadata = { ...(part.providerMetadata ?? {}), qs: { ms } };
      }
      /* Stored under a uuid; one that is not (an id minted elsewhere) is given one. */
      const toSave = isUuid(responseMessage.id) ? responseMessage : { ...responseMessage, id: crypto.randomUUID() };
      await saveMessage(service, session.id, toSave);

      const filesTouched = workspace.touched.size;
      const action = filesTouched > 0 ? "generate" : "chat";
      const cost = creditCostOf(action, { outputTokens, filesTouched, modelId: AUTO_MODEL });
      if (cost > 0) {
        await chargeCredits(service, {
          userId: user.id,
          action,
          cost,
          description: `Agent session${isAborted ? " (stopped)" : ""}: ${summary || "conversation"}`,
          projectId: session.project_id,
          outputTokens,
          filesTouched,
          dedupeKey: `agent:${toSave.id}`,
        });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
