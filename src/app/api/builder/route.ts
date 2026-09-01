import { NextResponse } from "next/server";

import { classifyIntent, type Intent } from "@/lib/builder/intent";
import { applyPatches, parseFullBuild } from "@/lib/builder/patch";
import { buildPrompt, editPrompt, questionPrompt } from "@/lib/builder/prompts";
import {
  addMessage,
  loadFiles,
  recentMessages,
  restoreLatest,
  saveFiles,
  snapshot,
} from "@/lib/builder/store";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* The editing builder.
 *
 * The problem it solves: with no stored copy of what was generated, every
 * message is a fresh build from the prompt, so "make the hero darker" produces
 * a different site instead of a darker hero. Here the previous output is loaded
 * first, the message is classified, and an edit is applied as a patch against
 * that output.
 *
 * This is NOT /api/build. That route starts an n8n build of a real project and
 * charges credits for it; this one edits generated files held in Supabase. They
 * are separate pipelines and neither calls the other. */

export const runtime = "nodejs";
/* A build or an edit is a side effect; it must never be served from a cache. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Long enough for a real instruction, short enough that the message cannot be
   used to push a large payload into a model call. */
const MAX_MESSAGE = 4000;

async function callModel(prompt: string, maxTokens = 8000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("unconfigured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "model call failed");
  return (data.content ?? [])
    .filter((block: { type?: string }) => block.type === "text")
    .map((block: { text?: string }) => block.text ?? "")
    .join("");
}

/* Which project this is, and whether the caller owns it. Both handlers need
   the same two answers before they touch anything, and the store below runs on
   the service-role key, which bypasses RLS entirely. */
async function authorize(projectId: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "The builder is unavailable because Supabase is not configured." },
        { status: 503 },
      ),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Sign in to build." }, { status: 401 }) };
  }
  if (!projectId) {
    return {
      error: NextResponse.json({ error: "projectId is required" }, { status: 400 }),
    };
  }

  /* Read under the caller's own session, so RLS answers the ownership
     question: a project id belonging to someone else comes back empty. */
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (lookupError) {
    // eslint-disable-next-line no-console
    console.error("builder: could not read the project:", lookupError);
    return {
      error: NextResponse.json({ error: "Could not read that project." }, { status: 500 }),
    };
  }
  if (!project) {
    return {
      error: NextResponse.json({ error: "That app is not in your account." }, { status: 404 }),
    };
  }

  return { error: null as null };
}

/* Just the paths, so the workspace can tell whether this project has anything
   to edit yet without pulling every file across the wire to count them. A
   project with none has never been through this builder, and the chat sends
   its messages down the orchestrator path instead. */
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";

  const gate = await authorize(projectId);
  if (gate.error) return gate.error;

  try {
    const files = await loadFiles(projectId);
    return NextResponse.json({ paths: files.map((file) => file.path) });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("builder:", error instanceof Error ? error.message : error);
    return NextResponse.json({ paths: [] });
  }
}

export async function POST(request: Request) {
  let body: {
    projectId?: unknown;
    message?: unknown;
    intentOverride?: unknown;
    confirmNewProject?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const override = (body.intentOverride ?? null) as Intent | null;
  const confirmedNew = body.confirmNewProject === true;

  if (!message) {
    return NextResponse.json(
      { error: "projectId and message are required" },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `Keep the message under ${MAX_MESSAGE} characters.` },
      { status: 400 },
    );
  }

  /* Everything past this line runs on the service-role key, which bypasses RLS
     — without this check, a known project UUID would be enough to read and
     overwrite anyone's files. */
  const gate = await authorize(projectId);
  if (gate.error) return gate.error;

  try {
    const files = await loadFiles(projectId);
    const history = await recentMessages(projectId, 6);

    const decision = await classifyIntent({
      message,
      filePaths: files.map((file) => file.path),
      history,
      override,
    });

    await addMessage(projectId, "user", message, decision.intent);

    // ---- REVERT ----------------------------------------------------------
    if (decision.intent === "revert") {
      const restored = await restoreLatest(projectId);
      return NextResponse.json({
        intent: "revert",
        files: restored ?? files,
        message: restored
          ? "Reverted to the previous version."
          : "No previous version to revert to.",
      });
    }

    // ---- QUESTION --------------------------------------------------------
    if (decision.intent === "question") {
      const answer = await callModel(questionPrompt(message, files), 1500);
      await addMessage(projectId, "assistant", answer, "question");
      return NextResponse.json({ intent: "question", message: answer, files });
    }

    // ---- NEW PROJECT (destructive — asks first) ---------------------------
    if (decision.intent === "new_project") {
      if (files.length > 0 && !confirmedNew) {
        return NextResponse.json({
          intent: "new_project",
          needsConfirmation: true,
          message:
            "This looks like a request for a brand-new build. That will replace your current project. Continue?",
          files,
        });
      }
      await snapshot(projectId, "before new build");
      const raw = await callModel(buildPrompt(message));
      const built = parseFullBuild(raw);
      if (!built.length) {
        return NextResponse.json(
          { error: "The model returned no parseable files." },
          { status: 502 },
        );
      }
      await saveFiles(projectId, built);
      await addMessage(projectId, "assistant", "Built project.", "new_project");
      return NextResponse.json({ intent: "new_project", files: built });
    }

    // ---- EDIT (the default) ----------------------------------------------
    await snapshot(projectId, `before: ${message.slice(0, 60)}`);

    let raw = await callModel(editPrompt(message, files, history));
    let result = applyPatches(files, raw);

    /* One retry, naming the blocks that failed. A SEARCH that did not match is
       usually the model paraphrasing the file rather than copying it, and being
       shown that is enough to fix it. Only worth doing when nothing landed —
       a partial application is a real edit, and re-running it would double it. */
    if (result.failures.length && !result.applied.length) {
      const note = `Your previous patch failed:\n${result.failures
        .map((failure) => `- ${failure.path}: ${failure.reason}`)
        .join("\n")}\n\nThe SEARCH text must be copied character-for-character from the file above. Try again.`;
      raw = await callModel(`${editPrompt(message, files, history)}\n\n${note}`);
      result = applyPatches(files, raw);
    }

    if (!result.applied.length) {
      return NextResponse.json(
        {
          intent: "edit",
          error: "Could not apply the change cleanly. Nothing was modified.",
          failures: result.failures,
          files,
        },
        { status: 422 },
      );
    }

    await saveFiles(projectId, result.files);
    await addMessage(
      projectId,
      "assistant",
      `Edited: ${result.applied.join(", ")}`,
      "edit",
    );

    return NextResponse.json({
      intent: "edit",
      files: result.files,
      applied: result.applied,
      failures: result.failures,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unexpected error";
    if (reason === "unconfigured") {
      return NextResponse.json(
        { error: "Building is not connected yet." },
        { status: 503 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("builder:", reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
