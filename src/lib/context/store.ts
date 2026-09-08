/* Where the engine's state actually lives.
 *
 * Every other file in lib/context is arithmetic over things it was handed. This
 * one is the only one that reaches a database, which is deliberate: the rules
 * stay testable without a connection, and the four tables have exactly one
 * module that knows their columns.
 *
 * ── Best effort, always ───────────────────────────────────────────────────
 *
 * Nothing here may take a build down. An index that fails to write means the
 * next edit retrieves nothing and falls back to what it did before this
 * existed; a checkpoint that fails to write means one fewer place to continue
 * from. Both are worse than the alternative and neither is worth failing a
 * build somebody paid for — so every function swallows its error, logs it, and
 * answers with the honest empty value.
 *
 * ── Service key only ──────────────────────────────────────────────────────
 *
 * All four tables are readable by their owner and writable by nobody through
 * the API (see supabase/schema.sql). A browser that could write project_index
 * could point the next edit at a file of its choosing; one that could write
 * project_requirements could add a requirement the person never asked for. So
 * these take the service client, and ownership is settled by the caller before
 * anything gets here. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Requirement } from "./compress";
import type { IndexEntry } from "./project-index";
import { digest, type ContextCache, type ContextState } from "./state";
import type { ToolResult } from "./tool-output";

/* A project's index is replaced wholesale on each build, and this is the cap on
   how much of it is kept. Past this the entries are the long tail — a file that
   defines nothing and is imported by nothing — and retrieval over ten thousand
   rows is slower than the guess it replaces. */
const MAX_INDEX_ROWS = 2_000;

function warn(what: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`context: ${what}:`, error instanceof Error ? error.message : error);
}

/* ── The index ─────────────────────────────────────────────────────────────*/

/**
 * Replaces this project's index with what the build just made.
 *
 * Wholesale rather than merged: an entry pointing at a file that no longer
 * exists is worse than no entry, because retrieval will confidently return it
 * and the edit will be made against something that is not there.
 */
export async function writeProjectIndex(
  service: SupabaseClient,
  input: { projectId: string; userId: string; entries: IndexEntry[] },
): Promise<number> {
  const rows = input.entries.slice(0, MAX_INDEX_ROWS).map((entry) => ({
    project_id: input.projectId,
    user_id: input.userId,
    kind: entry.kind,
    name: entry.name,
    path: entry.path ?? null,
    symbols: entry.symbols,
    summary: entry.summary ?? null,
    tokens: entry.tokens,
  }));

  const { error: cleared } = await service
    .from("project_index")
    .delete()
    .eq("project_id", input.projectId);
  if (cleared) {
    warn("the old index could not be cleared", cleared);
    return 0;
  }

  if (rows.length === 0) return 0;

  const { error } = await service.from("project_index").insert(rows);
  if (error) {
    warn("the index could not be written", error);
    return 0;
  }

  return rows.length;
}

/** This project's index, or an empty one when there is nothing to read. */
export async function readProjectIndex(
  service: SupabaseClient,
  projectId: string,
): Promise<IndexEntry[]> {
  const { data, error } = await service
    .from("project_index")
    .select("kind, name, path, symbols, summary, tokens")
    .eq("project_id", projectId)
    .limit(MAX_INDEX_ROWS);

  if (error) {
    warn("the index could not be read", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    kind: row.kind as IndexEntry["kind"],
    name: String(row.name ?? ""),
    path: (row.path as string | null) ?? undefined,
    symbols: Array.isArray(row.symbols) ? (row.symbols as string[]) : [],
    summary: (row.summary as string | null) ?? undefined,
    tokens: Number(row.tokens ?? 0),
  }));
}

/* ── State, version and cache ──────────────────────────────────────────────*/

export type StoredContext = { version: number; state: ContextState; cache: ContextCache };

/** What is known about this project, or a fresh v1 when nothing is. */
export async function readContext(
  service: SupabaseClient,
  projectId: string,
): Promise<StoredContext> {
  const { data, error } = await service
    .from("project_context")
    .select("version, state, cache")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) warn("the context row could not be read", error);

  const row = (data ?? null) as { version?: number; state?: ContextState; cache?: ContextCache } | null;

  return {
    version: Number(row?.version ?? 1),
    state: (row?.state ?? {}) as ContextState,
    cache: (row?.cache ?? {}) as ContextCache,
  };
}

/** Writes the state, its version and whatever is cached against it. */
export async function saveContext(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    version: number;
    state: ContextState;
    cache?: ContextCache;
  },
): Promise<void> {
  const { error } = await service.from("project_context").upsert(
    {
      project_id: input.projectId,
      user_id: input.userId,
      version: input.version,
      state: input.state,
      cache: input.cache ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );

  if (error) warn("the context row could not be written", error);
}

/**
 * Records a point worth continuing from.
 *
 * Append-only and never updated: the value of a checkpoint is that it is what
 * was true then, and a checkpoint that moves is a checkpoint that cannot be
 * continued from.
 */
export async function recordCheckpoint(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    version: number;
    label: string;
    state: ContextState;
  },
): Promise<void> {
  const { error } = await service.from("project_checkpoints").insert({
    project_id: input.projectId,
    user_id: input.userId,
    version: input.version,
    label: input.label,
    state: input.state,
  });

  if (error) warn("the checkpoint could not be recorded", error);
}

/** The most recent checkpoints, newest first — what a resumed session reads. */
export async function readCheckpoints(
  service: SupabaseClient,
  projectId: string,
  limit = 10,
): Promise<{ label: string; version: number; createdAt: string; state: ContextState }[]> {
  const { data, error } = await service
    .from("project_checkpoints")
    .select("label, version, created_at, state")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    warn("the checkpoints could not be read", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    label: String(row.label ?? ""),
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at ?? ""),
    state: (row.state ?? {}) as ContextState,
  }));
}

/* ── The requirement ledger ────────────────────────────────────────────────*/

export type StoredRequirement = Requirement & {
  ref: string;
  status: "pending" | "complete" | "dropped";
  area: string | null;
};

/**
 * Adds what this brief asked for to the project's ledger, keeping refs stable.
 *
 * The digest is what makes it idempotent: the same sentence, sent again in a
 * follow-up message, is the same requirement and keeps the ref it already had.
 * A person who reads "REQ-004 is still pending" in one message and again a week
 * later has to be reading about the same thing.
 *
 * Returns the whole ledger afterwards, which is what a caller wants: the new
 * ones are rarely interesting on their own.
 */
export async function syncRequirements(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    requirements: Requirement[];
    source?: "user" | "derived";
  },
): Promise<StoredRequirement[]> {
  const existing = await readRequirements(service, input.projectId);
  const known = new Set(existing.map((requirement) => digest(requirement.text)));

  /* Numbering continues from whatever the project already has, so refs are
     never reused — REQ-004 means one thing for the life of the project. */
  let next = existing.length + 1;

  const rows = input.requirements
    .filter((requirement) => !known.has(digest(requirement.text)))
    .map((requirement) => ({
      project_id: input.projectId,
      user_id: input.userId,
      ref: `REQ-${String(next++).padStart(3, "0")}`,
      body: requirement.text,
      digest: digest(requirement.text),
      priority: requirement.priority,
      source: input.source ?? "user",
      status: "pending",
    }));

  if (rows.length > 0) {
    /* Ignoring a duplicate rather than failing on it: two messages arriving at
       once can both carry the same new requirement, and the unique index on
       (project_id, digest) is what settles it. */
    const { error } = await service
      .from("project_requirements")
      .upsert(rows, { onConflict: "project_id,digest", ignoreDuplicates: true });
    if (error) warn("requirements could not be recorded", error);
  }

  return readRequirements(service, input.projectId);
}

/** The ledger, oldest first — which is the order the refs run in. */
export async function readRequirements(
  service: SupabaseClient,
  projectId: string,
): Promise<StoredRequirement[]> {
  const { data, error } = await service
    .from("project_requirements")
    .select("ref, body, priority, status, area")
    .eq("project_id", projectId)
    .order("ref", { ascending: true });

  if (error) {
    warn("requirements could not be read", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.ref ?? ""),
    ref: String(row.ref ?? ""),
    text: String(row.body ?? ""),
    priority: (row.priority as "high" | "normal") ?? "normal",
    status: (row.status as StoredRequirement["status"]) ?? "pending",
    area: (row.area as string | null) ?? null,
  }));
}

/** Marks requirements done — or dropped, when the person changed their mind. */
export async function markRequirements(
  service: SupabaseClient,
  projectId: string,
  refs: string[],
  status: "complete" | "dropped" | "pending",
): Promise<void> {
  if (refs.length === 0) return;

  const { error } = await service
    .from("project_requirements")
    .update({ status })
    .eq("project_id", projectId)
    .in("ref", refs);

  if (error) warn("requirements could not be updated", error);
}

/* ── Tool results ──────────────────────────────────────────────────────────*/

/**
 * Stores what a tool returned and hands back its id.
 *
 * The summary goes into the prompt; this is where the rest of it goes, so
 * "why did QA say that" has an answer that does not involve having kept the
 * whole result in a conversation nobody can afford.
 */
export async function storeToolResult(
  service: SupabaseClient,
  input: { projectId: string; userId: string; result: ToolResult },
): Promise<string | null> {
  const { data, error } = await service
    .from("tool_results")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      tool: input.result.tool,
      summary: input.result.summary,
      identifiers: input.result.identifiers,
      /* Serialised through JSON so a raw result carrying something jsonb cannot
         hold — a function, an undefined — does not fail the insert and take the
         build's last step with it. */
      raw: JSON.parse(JSON.stringify(input.result.raw ?? null)),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    warn("a tool result could not be stored", error);
    return null;
  }

  return (data as { id?: string } | null)?.id ?? null;
}

/** One stored result, in full, by id. */
export async function readToolResult(
  service: SupabaseClient,
  id: string,
): Promise<{ tool: string; summary: string; identifiers: string[]; raw: unknown } | null> {
  const { data, error } = await service
    .from("tool_results")
    .select("tool, summary, identifiers, raw")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    warn("a tool result could not be read", error);
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    tool: String(row.tool ?? ""),
    summary: String(row.summary ?? ""),
    identifiers: Array.isArray(row.identifiers) ? (row.identifiers as string[]) : [],
    raw: row.raw ?? null,
  };
}
