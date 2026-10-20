import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { BOT_NUMBER, CODE_TTL_MS, hashCode, maskPhone, newLinkCode, whatsappLinkUrl } from "@/lib/whatsapp/link";

/* Connect WhatsApp, from Settings: whether a number is linked, a fresh code to
 * link one, and Disconnect. The code is shown here once and stored only as a
 * hash; the WhatsApp assistant redeems it through /api/whatsapp/bot. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  return supabase ? (await supabase.auth.getUser()).data.user : null;
}

type LinkRow = { phone: string | null; linked_at: string | null; code_expires_at: string | null };

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ configured: false, linked: false });

  const { data } = await service
    .from("whatsapp_links")
    .select("phone, linked_at, code_expires_at")
    .eq("user_id", user.id)
    .maybeSingle<LinkRow>();
  return NextResponse.json({
    configured: true,
    linked: Boolean(data?.phone),
    phone: data?.phone ? maskPhone(data.phone) : null,
    linkedAt: data?.linked_at ?? null,
    botNumber: BOT_NUMBER,
  });
}

export async function POST() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "This deployment cannot link WhatsApp." }, { status: 503 });

  /* A new code replaces any earlier one; a number already linked stays linked
     until the new code is sent from a number. */
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await service
    .from("whatsapp_links")
    .upsert({ user_id: user.id, code_hash: hashCode(code), code_expires_at: expiresAt }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "A code couldn't be made just now. Try again." }, { status: 500 });

  return NextResponse.json({ code, expiresAt, openUrl: whatsappLinkUrl(code), botNumber: BOT_NUMBER });
}

export async function DELETE() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "This deployment cannot link WhatsApp." }, { status: 503 });

  await service.from("whatsapp_links").delete().eq("user_id", user.id);
  return NextResponse.json({ linked: false });
}
