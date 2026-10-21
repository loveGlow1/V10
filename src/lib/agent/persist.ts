import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

/* Saving and loading an agent session's messages.
 *
 * A message is stored as its PARTS, never as a string: the text, the
 * reasoning, every tool call with its input and output, the screenshots. That
 * is what lets a reload put back the whole transcript — the code cards, the
 * grouped steps, the thumbnails — rather than the words alone.
 *
 * Two shapes meet here. The browser and the model speak the AI SDK's
 * UIMessage (`tool-write_file`, `data-subagent`, `step-start` …); the table
 * holds the Part union below, which is the product's own vocabulary and does
 * not move when the SDK renames something. toStored and toUI are the only
 * places that know both. */

export type ToolState = "input-streaming" | "running" | "done" | "error";

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; ms?: number }
  | {
      type: "tool";
      id: string;
      name: string;
      state: ToolState;
      input?: unknown;
      output?: unknown;
      error?: string;
    }
  /* `path` and `beforePath` are where the picture is kept; `url` and `before`
     are signed and lapse after an hour, so they are re-signed on every load. */
  | {
      type: "snapshot";
      url: string;
      label?: string;
      before?: string;
      path?: string;
      beforePath?: string;
      toolId?: string;
      input?: unknown;
    }
  | { type: "subagent"; name: string; summary: string; childSessionId: string }
  | { type: "preview"; url: string }
  /* A step boundary. Not drawn; kept so a reloaded conversation goes back to
     the model in the same steps it was made in. */
  | { type: "step" };

export type SessionRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string | null;
  preview_url: string | null;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const SNAPSHOT_BUCKET = "snapshots";
const SIGNED_SECONDS = 60 * 60;

/* ── UI → stored ──────────────────────────────────────────────────────── */

type AnyPart = { type: string; [key: string]: unknown };

const toolState = (state: unknown): ToolState =>
  state === "output-available" ? "done" : state === "output-error" ? "error" : state === "input-streaming" ? "input-streaming" : "running";

export function toStored(message: UIMessage): Part[] {
  const out: Part[] = [];
  for (const raw of message.parts as AnyPart[]) {
    const part = raw;
    if (part.type === "text" && typeof part.text === "string") out.push({ type: "text", text: part.text });
    else if (part.type === "reasoning" && typeof part.text === "string") {
      const ms = typeof (part.providerMetadata as { qs?: { ms?: unknown } } | undefined)?.qs?.ms === "number"
        ? ((part.providerMetadata as { qs: { ms: number } }).qs.ms)
        : undefined;
      out.push({ type: "reasoning", text: part.text, ...(ms ? { ms } : {}) });
    } else if (part.type === "step-start") out.push({ type: "step" });
    else if (part.type.startsWith("tool-")) {
      const name = part.type.slice(5);
      const id = String(part.toolCallId ?? "");
      const state = toolState(part.state);
      const output = part.output as { url?: unknown; path?: unknown; label?: unknown; before?: unknown; beforePath?: unknown } | undefined;
      if (name === "take_snapshot" && state === "done" && output && typeof output.url === "string") {
        out.push({
          type: "snapshot",
          url: output.url,
          label: typeof output.label === "string" ? output.label : undefined,
          before: typeof output.before === "string" ? output.before : undefined,
          path: typeof output.path === "string" ? output.path : undefined,
          beforePath: typeof output.beforePath === "string" ? output.beforePath : undefined,
          toolId: id,
          input: part.input,
        });
      } else {
        out.push({
          type: "tool",
          id,
          name,
          /* A part still streaming when the stream ended (Stop) was never
             run: stored as stopped, not as forever-running. */
          state: state === "input-streaming" || state === "running" ? "error" : state,
          input: part.input,
          output: part.output,
          error:
            typeof part.errorText === "string"
              ? part.errorText
              : state === "input-streaming" || state === "running"
                ? "Stopped before it finished."
                : undefined,
        });
      }
    } else if (part.type === "data-subagent" && part.data && typeof part.data === "object") {
      const data = part.data as { name?: unknown; summary?: unknown; childSessionId?: unknown };
      out.push({
        type: "subagent",
        name: String(data.name ?? "Agent"),
        summary: String(data.summary ?? ""),
        childSessionId: String(data.childSessionId ?? ""),
      });
    } else if (part.type === "data-preview" && part.data && typeof part.data === "object") {
      const url = (part.data as { url?: unknown }).url;
      if (typeof url === "string") out.push({ type: "preview", url });
    }
  }
  return out;
}

/* ── stored → UI ──────────────────────────────────────────────────────── */

export function toUI(id: string, role: "user" | "assistant", parts: Part[]): UIMessage {
  const ui: AnyPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        ui.push({ type: "text", text: part.text, state: "done" });
        break;
      case "reasoning":
        ui.push({ type: "reasoning", text: part.text, state: "done", ...(part.ms ? { providerMetadata: { qs: { ms: part.ms } } } : {}) });
        break;
      case "step":
        ui.push({ type: "step-start" });
        break;
      case "tool":
        ui.push(
          part.state === "done"
            ? { type: `tool-${part.name}`, toolCallId: part.id, state: "output-available", input: part.input ?? {}, output: part.output ?? null }
            : { type: `tool-${part.name}`, toolCallId: part.id, state: "output-error", input: part.input ?? {}, errorText: part.error ?? "Failed." },
        );
        break;
      case "snapshot":
        ui.push({
          type: "tool-take_snapshot",
          toolCallId: part.toolId ?? `snapshot-${ui.length}`,
          state: "output-available",
          input: part.input ?? {},
          output: { url: part.url, label: part.label, before: part.before, path: part.path, beforePath: part.beforePath },
        });
        break;
      case "subagent":
        ui.push({ type: "data-subagent", data: { name: part.name, summary: part.summary, childSessionId: part.childSessionId } });
        break;
      case "preview":
        ui.push({ type: "data-preview", data: { url: part.url } });
        break;
    }
  }
  return { id, role, parts: ui } as unknown as UIMessage;
}

/* ── Signed pictures ──────────────────────────────────────────────────── */

export async function signSnapshot(service: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await service.storage.from(SNAPSHOT_BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  return data?.signedUrl ?? null;
}

async function resign(service: SupabaseClient, parts: Part[]): Promise<Part[]> {
  return Promise.all(
    parts.map(async (part) => {
      if (part.type !== "snapshot" || !part.path) return part;
      const url = (await signSnapshot(service, part.path)) ?? part.url;
      const before = part.beforePath ? ((await signSnapshot(service, part.beforePath)) ?? part.before) : part.before;
      return { ...part, url, before };
    }),
  );
}

/* ── Sessions and messages ────────────────────────────────────────────── */

export async function createSession(
  client: SupabaseClient,
  row: { userId: string; projectId: string | null; title: string | null; previewUrl: string | null },
): Promise<SessionRow | null> {
  const { data, error } = await client
    .from("agent_sessions")
    .insert({ user_id: row.userId, project_id: row.projectId, title: row.title, preview_url: row.previewUrl })
    .select("id, user_id, project_id, title, preview_url, created_at")
    .single();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("agent: a session could not be created:", error.message);
    return null;
  }
  return data as SessionRow;
}

/** The session, read under the caller's own session — so only its owner finds it. */
export async function loadSession(client: SupabaseClient, id: string): Promise<SessionRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await client
    .from("agent_sessions")
    .select("id, user_id, project_id, title, preview_url, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

/** Every message, oldest first, as UI messages with their pictures re-signed. */
export async function loadMessages(
  client: SupabaseClient,
  service: SupabaseClient | null,
  sessionId: string,
): Promise<UIMessage[]> {
  const { data } = await client
    .from("agent_messages")
    .select("id, role, parts")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as { id: string; role: "user" | "assistant"; parts: Part[] }[];
  return Promise.all(
    rows.map(async (row) => {
      const parts = Array.isArray(row.parts) ? row.parts : [];
      return toUI(row.id, row.role, service ? await resign(service, parts) : parts);
    }),
  );
}

/**
 * Stores one message, whole. Upserted on its id, so the same assistant message
 * saved again (a retried request) replaces itself rather than doubling.
 */
export async function saveMessage(
  service: SupabaseClient,
  sessionId: string,
  message: UIMessage,
): Promise<boolean> {
  if (!isUuid(message.id) || (message.role !== "user" && message.role !== "assistant")) return false;
  const { error } = await service.from("agent_messages").upsert(
    { id: message.id, session_id: sessionId, role: message.role, parts: toStored(message) },
    { onConflict: "id" },
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.error("agent: a message could not be saved:", error.message);
    return false;
  }
  return true;
}

/** The newest stored screenshot in a session — the "before" for the next one. */
export function lastSnapshotPath(messages: UIMessage[]): string | null {
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const parts = messages[m].parts as AnyPart[];
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p];
      const output = part.output as { path?: unknown } | undefined;
      if (part.type === "tool-take_snapshot" && typeof output?.path === "string") return output.path;
    }
  }
  return null;
}
