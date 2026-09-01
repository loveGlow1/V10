"use client";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { safeHttpUrl } from "@/lib/safe-url";

/* The conversation in a workspace, kept between visits.
 *
 * The thread used to live only in React state, so a reload — or switching to
 * another app and back — showed an empty panel for an app that had been built
 * and discussed at length. What someone asked for is the record of why their
 * app looks the way it does; it belongs in a row.
 *
 * Written from the browser, under the owner's own session, because every
 * message is rendered there first: the ones someone types, and the ones a build
 * comes back with. RLS is what scopes a thread to its owner. */

export type ThreadMessage = {
  from: "you" | "system";
  text: string;
  links?: { label: string; href: string }[];
  tone?: "normal" | "error";
};

/* What a message is, beyond what it says. The routes write it now — a build
   that finishes announces itself from the server — so a thread read back can
   tell the sentence that means "your page is ready" from one that happens to
   be worded like it. See lib/thread-server.ts. */
export type MessageKind = "chat" | "build_started" | "build_ready" | "build_failed";

/* A message as it comes back out of the table: what was said, plus the two
   things only the row knows — when, and what kind of thing it was. Both are
   read rather than inferred, which is what lets a reopened workspace put the
   finished build's card back under the message that announced it. */
export type StoredMessage = ThreadMessage & {
  kind: MessageKind;
  at: number;
};

type Row = {
  role: "you" | "system";
  body: string;
  links: unknown;
  tone: "normal" | "error";
  kind: string | null;
  created_at: string;
};

const KINDS: MessageKind[] = ["chat", "build_started", "build_ready", "build_failed"];

/* An unknown kind is an ordinary message. The column is written by this app,
   but a thread outlives any one version of it, and a row from before the column
   existed reads as null. */
function readKind(value: unknown): MessageKind {
  return KINDS.includes(value as MessageKind) ? (value as MessageKind) : "chat";
}

/* Addresses are filtered on the way out as well as on the way in. They were
   written by a build, which is to say by a workflow anyone with n8n access can
   edit, and they are about to become an href — so a stored address is not a
   trusted one just because it is stored. */
function readLinks(value: unknown): { label: string; href: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const links = value.flatMap((entry) => {
    const link = entry as { label?: unknown; href?: unknown };
    const href = safeHttpUrl(link.href);
    return href && typeof link.label === "string" ? [{ label: link.label, href }] : [];
  });

  return links.length > 0 ? links : undefined;
}

/** The thread for a project, oldest first. Empty when there is nothing stored. */
export async function loadThread(projectId: string): Promise<StoredMessage[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await createSupabaseBrowserClient()
    .from("project_messages")
    .select("role, body, links, tone, kind, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  /* A thread that cannot be read is an empty panel, not a broken one: the app
     still works, and the next message still saves. */
  if (error || !data) return [];

  return (data as unknown as Row[]).map((row) => ({
    from: row.role,
    text: row.body,
    links: readLinks(row.links),
    tone: row.tone,
    kind: readKind(row.kind),
    /* The row's own clock, so a reopened thread shows when things were said
       rather than nothing at all. It is also what a finished build's card
       counts its few minutes from — measured from when the page actually
       landed, not from when someone happened to scroll back to it. */
    at: Date.parse(row.created_at),
  }));
}

/**
 * Appends one message to a thread.
 *
 * Deliberately not awaited by the panel and deliberately silent on failure: a
 * message that is on screen should stay on screen, and losing one row from the
 * history is not worth interrupting a build to report.
 */
export async function appendToThread(
  projectId: string,
  userId: string,
  message: ThreadMessage,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { error } = await createSupabaseBrowserClient().from("project_messages").insert({
    project_id: projectId,
    user_id: userId,
    role: message.from,
    body: message.text,
    links: message.links ?? [],
    tone: message.tone ?? "normal",
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("chat: a message could not be saved to the thread:", error);
  }
}
