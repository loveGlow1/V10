import { NextResponse, after } from "next/server";

import {
  composeNotification,
  isEmailConfigured,
  nextWindow,
  sendEmail,
  validEmail,
} from "@/lib/builder/backend/form-notify";
import {
  PER_PROJECT,
  PER_SENDER,
  parseSubmission,
  senderToken,
  withinLimits,
} from "@/lib/forms/inbox";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Where the forms on a page with no database of its own send what people type.
 * See src/lib/forms/inbox.ts.
 *
 * Public by design: it is called from published sites on other origins and
 * from the preview's opaque one, so it answers any origin and takes the body as
 * text/plain — a "simple" request a browser sends without asking first. What
 * keeps it from being abused is not the origin: it only writes to a project
 * that exists, never more than the limits in inbox.ts, never anything bigger
 * than a form, and a bot that fills the hidden field is told "thanks" and kept.
 * Nothing it returns says whether a project id exists. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function senderAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

function salt(): string {
  return process.env.FORMS_SENDER_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "quickstark-forms";
}

export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }

  const parsed = parseSubmission(raw, text.length);
  if (!parsed.ok) {
    /* A bot gets the same answer a person does. */
    if (parsed.spam) return reply({ ok: true });
    return reply({ ok: false, error: parsed.reason }, 400);
  }
  const submission = parsed.value;

  const service = createSupabaseServiceClient();
  if (!service) return reply({ ok: false, error: "Messages can't be received right now. Try again soon." }, 503);

  const { data: project } = await service
    .from("projects")
    .select("id, user_id, name, deleted_at")
    .eq("id", submission.project)
    .maybeSingle<{ id: string; user_id: string; name: string | null; deleted_at: string | null }>();
  if (!project || project.deleted_at) return reply({ ok: false, error: "This form isn't connected to a site." }, 404);

  const sender = senderToken(senderAddress(request), salt());
  const now = Date.now();
  const [fromSender, toProject] = await Promise.all([
    service
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("sender", sender)
      .gte("created_at", new Date(now - PER_SENDER.windowMs).toISOString()),
    service
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .gte("created_at", new Date(now - PER_PROJECT.windowMs).toISOString()),
  ]);
  if (!withinLimits({ sender: fromSender.count ?? 0, project: toProject.count ?? 0 })) {
    return reply({ ok: false, error: "Too many messages — please wait a few minutes and try again." }, 429);
  }

  const { error } = await service.from("form_submissions").insert({
    project_id: project.id,
    user_id: project.user_id,
    form: submission.form,
    name: submission.name,
    email: submission.email,
    message: submission.message,
    data: submission.data,
    sender,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("forms/submit: a message could not be saved:", error.message);
    return reply({ ok: false, error: "Your message couldn't be sent. Please try again." }, 500);
  }

  /* The owner's email, after the visitor has their answer. Same settings and
     hourly cap as the own-Supabase forms (form_notifications); a project with
     no row yet gets one, on, sent to the owner's account email. */
  if (isEmailConfigured()) {
    after(async () => {
      try {
        let { data: row } = await service
          .from("form_notifications")
          .select("enabled, email, window_start, window_count")
          .eq("project_id", project.id)
          .maybeSingle<{ enabled: boolean; email: string | null; window_start: string | null; window_count: number }>();
        if (!row) {
          await service
            .from("form_notifications")
            .upsert({ project_id: project.id, user_id: project.user_id, enabled: true }, { onConflict: "project_id" });
          row = { enabled: true, email: null, window_start: null, window_count: 0 };
        }
        if (!row.enabled) return;

        const window = nextWindow(row, new Date());
        await service
          .from("form_notifications")
          .update({ window_start: window.window_start, window_count: window.window_count })
          .eq("project_id", project.id);
        if (!window.send) return;

        let to = validEmail(row.email);
        if (!to) {
          const { data: owner } = await service.auth.admin.getUserById(project.user_id);
          to = validEmail(owner?.user?.email);
        }
        if (!to) return;

        const inboxUrl = `${SITE_URL}/dashboard/project/${encodeURIComponent(project.id)}?view=database`;
        const email = composeNotification({
          projectName: project.name ?? "your site",
          record: submission,
          dashboardUrl: null,
          savedIn: `Every message is saved in your QuickStark inbox: ${inboxUrl}`,
        });
        const sent = await sendEmail({
          to,
          subject: email.subject,
          text: window.last
            ? `${email.text}\n\nThat's ${window.window_count} messages this hour, so further emails are paused until the hour is up. Every message is still being saved in your inbox.`
            : email.text,
          replyTo: email.replyTo,
        });
        if (sent.ok) {
          await service.from("form_notifications").update({ last_sent_at: new Date().toISOString() }).eq("project_id", project.id);
        } else {
          // eslint-disable-next-line no-console
          console.error(`forms/submit: ${project.id} could not be emailed: ${sent.reason}`);
        }
      } catch (problem) {
        // eslint-disable-next-line no-console
        console.error("forms/submit: the notification failed:", problem);
      }
    });
  }

  return reply({ ok: true });
}
