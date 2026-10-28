import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { PLANS } from "@/app/dashboard/credits";
import { isPaidPlanId } from "@/lib/crypto-payments";

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
 * session, and the welcome is granted once.
 *
 * A new account's card is saved differently: through a subscription-mode
 * Checkout that starts a free month of a paid plan (lib/stripe-plan.ts).
 * The card is the subscription's, kept here the same way. A card that cannot
 * have the welcome (it claimed one elsewhere, or is not a card) ends that
 * trial at once — the free month is for the free credit's new account. */

export const CARD_SESSION_KIND = "card";

export type WelcomeOutcome = "granted" | "already" | "card_used" | "invalid";

export type SavedCard = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

/** A welcome trial that is running: the plan and the day it first bills. */
export type StartedTrial = { plan: string; priceUsd: number; startsOn: string };

export type CardSetupResult =
  | { ok: true; card: SavedCard; welcome: WelcomeOutcome; trial?: StartedTrial | null }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Checkout Session this app opened to save a card, and whose. */
export function cardSessionUser(session: Stripe.Checkout.Session): string | null {
  if ((session.mode !== "setup" && session.mode !== "subscription") || session.metadata?.kind !== CARD_SESSION_KIND) return null;
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

  if (session.mode === "subscription") return recordTrialCard(stripe, service, userId, session);

  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return { ok: false, reason: "Stripe did not return the card." };
  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  if (intent.status !== "succeeded") {
    return { ok: false, reason: "Your bank did not verify the card. Try another card." };
  }
  const method = intent.payment_method;
  if (!method || typeof method === "string") return { ok: false, reason: "Stripe did not return the card." };
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? (typeof intent.customer === "string" ? intent.customer : intent.customer?.id));
  if (!customerId) return { ok: false, reason: "Stripe did not return the customer." };
  return rememberCard(stripe, service, userId, customerId, method);
}

/* The card behind a welcome trial: the subscription's own. Checkout
   confirms it with a SetupIntent (the bank's check, nothing charged today). */
async function recordTrialCard(
  stripe: Stripe,
  service: SupabaseClient,
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<CardSetupResult> {
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return { ok: false, reason: "Stripe did not return the plan." };
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method", "pending_setup_intent.payment_method"],
  });
  const pending = subscription.pending_setup_intent;
  const method =
    subscription.default_payment_method && typeof subscription.default_payment_method !== "string"
      ? subscription.default_payment_method
      : pending && typeof pending !== "string" && pending.payment_method && typeof pending.payment_method !== "string"
        ? pending.payment_method
        : null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const end = async () => {
    if (subscription.status === "canceled") return;
    await stripe.subscriptions.cancel(subscriptionId).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("card trial: could not end a trial without a welcome:", error instanceof Error ? error.message : error);
    });
  };
  if (!method) {
    await end();
    return { ok: false, reason: "Stripe did not return the card." };
  }

  const result = await rememberCard(stripe, service, userId, customerId, method);
  /* No free credit for this card, so no free month either. A second trial
     (two tabs, both finished) goes too. */
  const others = result.ok && result.welcome === "already" ? await hasLiveSubscription(stripe, customerId, subscriptionId) : false;
  if (!result.ok || result.welcome === "card_used" || result.welcome === "invalid" || others) {
    await end();
    return result.ok ? { ...result, trial: null } : result;
  }
  if (subscription.status === "canceled" || !subscription.trial_end) return { ...result, trial: null };
  const planId = subscription.metadata?.plan_id;
  const plan = isPaidPlanId(planId) ? PLANS[planId] : null;
  return {
    ...result,
    trial: plan ? { plan: plan.name, priceUsd: plan.monthlyPriceUsd, startsOn: new Date(subscription.trial_end * 1000).toISOString() } : null,
  };
}

/** Whether the account is due a welcome trial: it has not had its welcome
 *  and is on Free. */
export async function offersWelcomeTrial(service: SupabaseClient, userId: string, welcomed: boolean): Promise<boolean> {
  if (welcomed) return false;
  const { data } = await service.from("credit_balances").select("plan_id").eq("user_id", userId).maybeSingle();
  return ((data as { plan_id?: string } | null)?.plan_id ?? "free") === "free";
}

/** Whether the customer already has a plan running or on trial — other than
 *  `except`. A failed read answers yes: no second trial on a guess. */
export async function hasLiveSubscription(stripe: Stripe, customerId: string, except?: string): Promise<boolean> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 }).catch(() => null);
  if (!list) return true;
  return list.data.some((sub) => sub.id !== except && ["trialing", "active", "past_due", "incomplete", "unpaid"].includes(sub.status));
}

/**
 * Keeps a card the account has used with Stripe — saved on its own, or paid
 * with for a plan or credits — as its card on file, and grants the welcome
 * credit when this card and this account have not had one. Throws only on a
 * database error, which a retry could fix.
 */
export async function rememberCard(
  stripe: Stripe,
  service: SupabaseClient,
  userId: string,
  customerId: string,
  method: Stripe.PaymentMethod,
): Promise<CardSetupResult> {
  /* A card (Apple Pay and Google Pay arrive as cards) carries its own
     fingerprint. Link is a card the bank verified, kept in the person's Link
     account, and shows no card details: its claim is keyed on that account's
     email, so one Link account cannot unlock free credit twice either. */
  const linkEmail = method.type === "link" ? method.link?.email?.trim().toLowerCase() : null;
  const fingerprint = method.type === "card" ? method.card?.fingerprint : linkEmail ? `link:${linkEmail}` : null;
  if (!fingerprint) {
    return { ok: false, reason: "Only a card can unlock the free credit. Try again with a card." };
  }

  const card: SavedCard = method.card
    ? {
        brand: method.card.brand ?? null,
        last4: method.card.last4 ?? null,
        expMonth: method.card.exp_month ?? null,
        expYear: method.card.exp_year ?? null,
      }
    : { brand: "link", last4: null, expMonth: null, expYear: null };

  const { error: saveError } = await service.from("payment_cards").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      payment_method_id: method.id,
      brand: card.brand,
      last4: card.last4,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      fingerprint,
      verified_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (saveError) throw saveError;

  /* The card the customer now pays with by default — what a monthly plan
     renews on. Best effort: the card is saved either way. */
  await stripe.customers
    .update(customerId, { invoice_settings: { default_payment_method: method.id } })
    .catch(() => undefined);

  const { data, error } = await service.rpc("grant_card_welcome", {
    p_user_id: userId,
    p_fingerprint: fingerprint,
  });
  if (error) throw error;
  const welcome = (["granted", "already", "card_used", "invalid"] as const).find((value) => value === data) ?? "invalid";
  return { ok: true, card, welcome };
}

/**
 * The account's one Stripe customer: the one its card is on, else one made
 * for it on an earlier try, else a new one. Cards, plans and the billing
 * portal all use it, so a plan renews on the card that was saved and the
 * portal shows both.
 */
export async function customerFor(
  stripe: Stripe,
  service: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<string> {
  const { customerId: known } = await cardStatus(service, user.id);
  if (known) return known;
  if (user.email) {
    const earlier = await stripe.customers.list({ email: user.email, limit: 20 }).catch(() => null);
    const found = earlier?.data.find((customer) => customer.metadata?.user_id === user.id)?.id;
    if (found) return found;
  }
  const made = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } });
  return made.id;
}

/** A card taken off in Stripe (the billing portal's Remove) is off the
 *  account here too. If the customer still has another card — the usual way
 *  to replace one in the portal is to add the new card, then remove the old —
 *  that card becomes the card on file; otherwise there is none, and
 *  card_status asks for one again (free credit or not, unless the account
 *  has paid). The welcome claim on the old fingerprint stays: adding it back
 *  does not grant a second welcome. */
export async function forgetCard(stripe: Stripe, service: SupabaseClient, paymentMethodId: string): Promise<void> {
  const { data: row, error: readError } = await service
    .from("payment_cards")
    .select("user_id, stripe_customer_id")
    .eq("payment_method_id", paymentMethodId)
    .maybeSingle();
  if (readError) throw new Error(`could not read the detached card: ${readError.message}`);
  /* Not the card on file (an older one, or never ours): nothing to change. */
  if (!row) return;
  const { user_id: userId, stripe_customer_id: customerId } = row as { user_id: string; stripe_customer_id: string };

  const { error } = await service.from("payment_cards").delete().eq("payment_method_id", paymentMethodId);
  if (error) throw new Error(`could not remove the detached card: ${error.message}`);

  const [cards, customer] = await Promise.all([
    stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 }),
    stripe.customers.retrieve(customerId),
  ]);
  const preferred = !customer.deleted ? customer.invoice_settings?.default_payment_method : null;
  const preferredId = typeof preferred === "string" ? preferred : preferred?.id;
  const next = cards.data.find((card) => card.id === preferredId && card.id !== paymentMethodId) ?? cards.data.find((card) => card.id !== paymentMethodId);
  if (next) await rememberCard(stripe, service, userId, customerId, next);
}

/** A card Stripe changed in place — a new expiry from the bank's card
 *  updater, or details edited in the portal — kept current here, so a
 *  renewed card is not read as expired and the account locked. */
export async function refreshCard(service: SupabaseClient, method: Stripe.PaymentMethod): Promise<void> {
  if (!method.card) return;
  const { error } = await service
    .from("payment_cards")
    .update({
      brand: method.card.brand ?? null,
      last4: method.card.last4 ?? null,
      exp_month: method.card.exp_month ?? null,
      exp_year: method.card.exp_year ?? null,
    })
    .eq("payment_method_id", method.id);
  if (error) throw new Error(`could not refresh the card: ${error.message}`);
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
