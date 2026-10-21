import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import ChatThread from "@/components/agent/ChatThread";
import { createSession, isUuid, loadMessages, loadSession } from "@/lib/agent/persist";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* An agent session: /session/<id>.
 *
 * /session/new starts one — on a project with ?project=<id> (yours only), or
 * on nothing — and moves to its own address, so a reload or a shared tab
 * comes back to the same conversation. Everything said in it, every part of
 * every message, is read back from Supabase here: a reload restores the whole
 * transcript, code cards and screenshots included. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent session", robots: { index: false, follow: false } };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) redirect("/");

  if (id === "new") {
    const asked = (await searchParams).project;
    const projectId = typeof asked === "string" && isUuid(asked) ? asked : null;
    let title = "New session";
    if (projectId) {
      /* Under the person's own sign-in: a project that is not theirs is not found. */
      const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle();
      if (!project) notFound();
      title = (project.name as string | null) || title;
    }
    const session = await createSession(supabase, { userId: user.id, projectId, title, previewUrl: null });
    if (!session) throw new Error("The session could not be started. Try again.");
    redirect(`/session/${session.id}`);
  }

  const session = await loadSession(supabase, id);
  if (!session) notFound();

  const messages = await loadMessages(supabase, createSupabaseServiceClient(), session.id);

  return (
    <ChatThread
      sessionId={session.id}
      title={session.title || "Agent session"}
      previewUrl={session.preview_url}
      initialMessages={messages}
      backHref={session.project_id ? `/dashboard/project/${session.project_id}` : "/dashboard"}
    />
  );
}
