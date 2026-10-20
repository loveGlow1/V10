import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { botSecretMatches, codeIn, hashCode, phoneDigits } from "@/lib/whatsapp/link";
import { workspaceSummary } from "@/lib/whatsapp/workspace";

/* Called only by the WhatsApp assistant's n8n workflow, with the shared secret
 * WHATSAPP_BOT_SECRET in the x-bot-secret header. Two things, nothing more:
 *
 *   claim      { phone, code }  — link the number that SENT a valid code to
 *                                 the account that made it.
 *   workspace  { phone }        — that account's read-only summary, or
 *                                 { linked: false }.
 *
 * The phone always comes from the workflow (the WhatsApp sender), never from
 * the AI, so the assistant can only ever see the account of the person it is
 * talking to. Nothing here can change credits, plans or projects. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.WHATSAPP_BOT_SECRET) {
    return NextResponse.json({ error: "WhatsApp linking is not configured." }, { status: 503 });
  }
  if (!botSecretMatches(request.headers.get("x-bot-secret"), process.env.WHATSAPP_BOT_SECRET)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "This deployment cannot read accounts." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { action?: unknown; phone?: unknown; code?: unknown } | null;
  const phone = phoneDigits(body?.phone);
  if (!phone) return NextResponse.json({ error: "A WhatsApp number is needed." }, { status: 400 });

  if (body?.action === "claim") {
    const code = codeIn(body.code);
    if (!code) return NextResponse.json({ ok: false, reason: "invalid" });

    const { data: row } = await service
      .from("whatsapp_links")
      .select("user_id, code_expires_at")
      .eq("code_hash", hashCode(code))
      .maybeSingle<{ user_id: string; code_expires_at: string | null }>();
    if (!row) return NextResponse.json({ ok: false, reason: "invalid" });
    if (!row.code_expires_at || Date.parse(row.code_expires_at) < Date.now()) {
      return NextResponse.json({ ok: false, reason: "expired" });
    }

    /* One number, one account: linking here unlinks it anywhere else. */
    await service.from("whatsapp_links").update({ phone: null, linked_at: null }).eq("phone", phone).neq("user_id", row.user_id);
    const { error } = await service
      .from("whatsapp_links")
      .update({ phone, linked_at: new Date().toISOString(), code_hash: null, code_expires_at: null })
      .eq("user_id", row.user_id);
    if (error) return NextResponse.json({ ok: false, reason: "failed" });

    const { data: profile } = await service
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", row.user_id)
      .maybeSingle<{ full_name: string | null }>();
    return NextResponse.json({ ok: true, name: profile?.full_name?.trim() || null });
  }

  if (body?.action === "workspace") {
    const { data: link } = await service
      .from("whatsapp_links")
      .select("user_id")
      .eq("phone", phone)
      .maybeSingle<{ user_id: string }>();
    if (!link) return NextResponse.json({ linked: false });
    return NextResponse.json({ linked: true, workspace: await workspaceSummary(service, link.user_id) });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
