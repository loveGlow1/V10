import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/* A card on file, for the welcome credit — see grant_card_welcome in
 * supabase/schema.sql.
 *
 * Free credit is only for an account with a real card behind it, the way
 * emergent.sh asks for one. The card is saved through Stripe Checkout in setup
 * mode: Stripe confirms a SetupIntent, the bank verifies the card with a
 * zero-amount authorisation (and 3-D Secure when the bank asks for it), and
 * nothing is charged. A setup that did not succeed saves nothing.
 *
 * Who the card belongs to comes from the session's own metadata and
 * client_reference_id, written on the server by /api/payments/stripe/card, so a
 * browser cannot claim a card for somebody else. Recording is idempotent: the
 * browser's return and the webhook both call recordCardSetup for the same
 * session, and the welcome is granted once. */

export const CARD_SESSION_KIND = "card";

export type WelcomeOutcome = "granted" | "already" | "card_used" | "invalid";

export type SavedCard = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

export type CardSetupResult =
  | { ok: true; card: SavedCard; welcome: WelcomeOutcome }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Checkout Session this app opened to save a card, and whose. */
export function cardSessionUser(session: Stripe.Checkout.Session): string | null {
  if (session.mode !== "setup" || session.metadata?.kind !== CARD_SESSION_KIND) return null;
  const userId = session.client_reference_id ?? session.metadata?.user_id ?? "";
  return UUID.test(userId) ? userId : null;
}

/**
 * Saves the card a completed setup session verified, and grants the welcome
 * credit when this card and this account have not had one. Throws only on a
 * database error, which a retry could fix.
 */
export async function recordCardSetup(
  stripe: Stripe,
  service: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<CardSetupResult> {
  const userId = cardSessionUser(session);
  if (!userId) return { ok: false, reason: "That was not a card being saved for this account." };
  if (session.status !== "complete") return { ok: false, reason: "The card was not saved — the page was closed before it finished." };

  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return { ok: false, reason: "Stripe did not return the card." };
  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  if (intent.status !== "succeeded") {
    return { ok: false, reason: "Your bank did not verify the card. Try another card." };
  }
  const method = intent.payment_method;
  if (!method || typeof method === "string" || method.type !== "card" || !method.card?.fingerprint) {
    return { ok: false, reason: "Only a card can unlock the free credit." };
  }
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? (typeof intent.customer === "string" ? intent.customer : intent.customer?.id));
  if (!customerId) return { ok: false, reason: "Stripe did not return the customer." };

  const card: SavedCard = {
    brand: method.card.brand ?? null,
    last4: method.card.last4 ?? null,
    expMonth: method.card.exp_month ?? null,
    expYear: method.card.exp_year ?? null,
  };

  const { error: saveError } = await service.from("payment_cards").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      payment_method_id: method.id,
      brand: card.brand,
      last4: card.last4,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      fingerprint: method.card.fingerprint,
      verified_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (saveError) throw saveError;

  /* The card the customer now pays with by default, so a later top-up can
     offer it. Best effort: the card is saved either way. */
  await stripe.customers
    .update(customerId, { invoice_settings: { default_payment_method: method.id } })
    .catch(() => undefined);

  const { data, error } = await service.rpc("grant_card_welcome", {
    p_user_id: userId,
    p_fingerprint: method.card.fingerprint,
  });
  if (error) throw error;
  const welcome = (["granted", "already", "card_used", "invalid"] as const).find((value) => value === data) ?? "invalid";
  return { ok: true, card, welcome };
}

/** What the account has: its card, if any, and whether the welcome is had. */
export async function cardStatus(
  service: SupabaseClient,
  userId: string,
): Promise<{ card: SavedCard | null; customerId: string | null; welcomed: boolean }> {
  const [{ data: row }, { data: welcome }] = await Promise.all([
    service
      .from("payment_cards")
      .select("stripe_customer_id, brand, last4, exp_month, exp_year")
      .eq("user_id", userId)
      .maybeSingle(),
    service.from("credit_ledger").select("id").eq("user_id", userId).eq("dedupe_key", "signup-bonus").maybeSingle(),
  ]);
  const saved = row as { stripe_customer_id: string; brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null } | null;
  return {
    card: saved ? { brand: saved.brand, last4: saved.last4, expMonth: saved.exp_month, expYear: saved.exp_year } : null,
    customerId: saved?.stripe_customer_id ?? null,
    welcomed: Boolean(welcome),
  };
}
