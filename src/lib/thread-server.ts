import type { SupabaseClient } from "@supabase/supabase-js";

/* The thread, written from the server.
 *
 * It used to be written only from the browser: the panel rendered a message and
 * then, without awaiting it, inserted a row. That was fine while the browser was
 * the only thing that knew anything — and wrong the moment it was not.
 *
 * Two things went wrong because of it. A tab closed mid-build never wrote the
 * reply, so reopening the app showed a conversation that stopped at "your build
 * is underway" and stayed there forever, with no way to carry on. And because
 * the next message is read against the ones before it, a thread missing its
 * replies is a thread that has forgotten what is being built — which is how
 * "rebuild" came to mean "build the word rebuild".
 *
 * So the routes write what they answer. The rule they follow is: the row goes
 * in before the charge is taken. Something charged for is something that
 * happened, and something that happened is in the record whether or not anyone
 * was still looking at the screen.
 *
 * Written with the service key, because credit_ledger and project_builds are
 * already: the browser is not the authority on what was said any more than it
 * is on what was spent. Ownership is settled by the route before it calls this. */

/** What a stored message is. 'chat' is a sentence; the rest are announcements a
    resumed session can recognise without re-reading the words. */
export type MessageKind = "chat" | "build_started" | "build_ready" | "build_failed";

export type ThreadWrite = {
  projectId: string;
  userId: string;
  role: "you" | "system";
  body: string;
  links?: { label: string; href: string }[];
  tone?: "normal" | "error";
  kind?: MessageKind;
  /* What makes a write safe to repeat. A retried request, two open tabs, and a
     save step delivered twice all try to write the same message — and a build
     that announces itself three times in a thread is worse than one that does
     not announce itself at all. Rows carrying one are unique per project. */
  dedupeKey?: string;
};

/**
 * Appends one message to a thread, at most once per dedupe key.
 *
 * Returns whether a row was written — false for a duplicate, and false for a
 * failure. Callers that are about to charge should treat false-from-failure as
 * "do not charge": see {@link recordAndConfirm}.
 */
export async function recordMessage(
  supabase: SupabaseClient,
  write: ThreadWrite,
): Promise<{ stored: boolean; duplicate: boolean }> {
  const row = {
    project_id: write.projectId,
    user_id: write.userId,
    role: write.role,
    body: write.body,
    links: write.links ?? [],
    tone: write.tone ?? "normal",
    kind: write.kind ?? "chat",
    dedupe_key: write.dedupeKey ?? null,
  };

  const { error } = await supabase.from("project_messages").insert(row);

  if (!error) return { stored: true, duplicate: false };

  /* 23505 is the unique index doing its job, which is not a failure: the
     message is in the thread, which is all the caller wanted. */
  if (error.code === "23505") return { stored: false, duplicate: true };

  // eslint-disable-next-line no-console
  console.error("thread: a message could not be stored:", error);
  return { stored: false, duplicate: false };
}

/**
 * Stores a reply and reports whether it is safe to charge for it.
 *
 * True when the reply is in the thread — either this call put it there, or a
 * duplicate means an earlier one did. False only when the write genuinely
 * failed, and then nothing should be billed: an answer nobody can read is not
 * an answer that was delivered.
 */
export async function recordAndConfirm(
  supabase: SupabaseClient,
  write: ThreadWrite,
): Promise<boolean> {
  const { stored, duplicate } = await recordMessage(supabase, write);
  return stored || duplicate;
}
