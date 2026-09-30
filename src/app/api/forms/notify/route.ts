import { NextResponse } from "next/server";

import {
  composeNotification,
  nextWindow,
  secretMatches,
  sendEmail,
  validEmail,
} from "@/lib/builder/backend/form-notify";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Called by the trigger in an app owner's Supabase when somebody sends a form
 * on their page. See src/lib/builder/backend/form-notify.ts.
 *
 * Trusts nothing in the body until the secret checks out, and answers every
 * caller the same quiet 200 either way — this is a doorbell, not an API, and
 * telling a stranger which project ids exist would be telling them something.
 * The message itself is already saved in their database; nothing here stores it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  user_id: string;
  enabled: boolean;
  email: string | null;
  secret_hash: string | null;
  window_start: string | null;
  window_count: number;
};

const quiet = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const secret = request.headers.get("x-quickstark-secret") ?? "";
  const body = (await request.json().catch(() => null)) as
    | { project?: unknown; record?: unknown }
    | null;

  const projectId = typeof body?.project === "string" ? body.project : "";
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !secret) return quiet();

  const record =
    body?.record && typeof body.record === "object" && !Array.isArray(body.record)
      ? (body.record as Record<string, unknown>)
      : null;
  if (!record) return quiet();

  const service = createSupabaseServiceClient();
  if (!service) return quiet();

  const { data: row } = await service
    .from("form_notifications")
    .select("user_id, enabled, email, secret_hash, window_start, window_count")
    .eq("project_id", projectId)
    .maybeSingle<Row>();

  if (!row || !secretMatches(secret, row.secret_hash) || !row.enabled) return quiet();

  const window = nextWindow(row, new Date());
  await service
    .from("form_notifications")
    .update({ window_start: window.window_start, window_count: window.window_count })
    .eq("project_id", projectId);
  if (!window.send) return quiet();

  let to = validEmail(row.email);
  if (!to) {
    const { data: owner } = await service.auth.admin.getUserById(row.user_id);
    to = validEmail(owner?.user?.email);
  }
  if (!to) return quiet();

  const [{ data: project }, { data: backend }] = await Promise.all([
    service.from("projects").select("name").eq("id", projectId).maybeSingle<{ name: string | null }>(),
    service
      .from("project_backends")
      .select("supabase_ref")
      .eq("project_id", projectId)
      .maybeSingle<{ supabase_ref: string | null }>(),
  ]);

  const email = composeNotification({
    projectName: project?.name ?? "your site",
    record,
    dashboardUrl: backend?.supabase_ref
      ? `https://supabase.com/dashboard/project/${encodeURIComponent(backend.supabase_ref)}/editor`
      : null,
  });

  const sent = await sendEmail({
    to,
    subject: email.subject,
    text: window.last
      ? `${email.text}\n\nThat's ${window.window_count} messages this hour, so further emails are paused until the hour is up. Every message is still being saved in your Supabase.`
      : email.text,
    replyTo: email.replyTo,
  });

  if (sent.ok) {
    await service
      .from("form_notifications")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("project_id", projectId);
  } else {
    // eslint-disable-next-line no-console
    console.error(`forms/notify: ${projectId} could not be emailed: ${sent.reason}`);
  }

  return quiet();
}
