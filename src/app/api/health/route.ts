import { NextResponse } from "next/server";

import { providerStatus } from "@/lib/builder/assets/providers/registry";

import { btcPayReachable, isBtcPayConfigured, isBtcPayWebhookConfigured } from "@/lib/btcpay";
import { RECONCILE_SERVICE, readHeartbeat } from "@/lib/heartbeat";
import {
  isCryptoCheckoutConfigured,
  isSettlementCallbackConfigured,
} from "@/lib/crypto-payments-server";
import { isBuilderConfigured } from "@/lib/n8n";
import { canCompile } from "@/lib/standalone-page";
import { createSupabaseServiceClient, isServiceRoleConfigured } from "@/lib/supabase-service";
import { getMissingSupabaseEnvVars, isSupabaseConfigured } from "@/lib/supabaseClient";

/* Whether this deployment is wired up, without having to try it.
 *
 * `builderConfigured` is the one in the screenshot: N8N_WEBHOOK_URL is a
 * server-side variable, so a deployment missing it looks identical to a working
 * one until someone sends a message and the chat answers "Building is not
 * connected yet". This says so from the outside, before a user finds out.
 *
 * `storageConfigured` is the same question for the key a finished page is
 * stored under. A boolean about presence, which is exactly what catches the
 * failure it exists for: a variable whose name is a character out is not
 * missing in any way a hosting dashboard shows you — it is simply never read,
 * and the first sign is a build that fails for no visible reason.
 *
 * `downloadsCompile` is not about a variable at all — it runs the thing. A
 * downloaded page has its stylesheet compiled into it, and when that compile
 * fails the route falls back to the stored HTML: the file still downloads, and
 * still opens unstyled. Nothing on any screen says the compile failed, which is
 * how it survived a deploy. This asks the running deployment to do it.
 *
 * `editingConfigured` is the same question for the key the app needs again.
 * Generating a whole page still happens in the orchestrator under n8n's own
 * credential — but editing one, answering a question about it and routing an
 * ambiguous message all run here, and all three need a key of this app's own. */

/* Never prerendered. This answers about the running deployment's environment,
   and a statically rendered copy would freeze whatever was set at build time. */
export const dynamic = "force-dynamic";

export async function GET() {
  const includeDetails =
    process.env.NODE_ENV !== "production" ||
    process.env.SUPABASE_HEALTH_INCLUDE_DETAILS === "true";

  const missingSupabaseEnvVars = includeDetails ? getMissingSupabaseEnvVars() : undefined;

  /* Run rather than inspected. It is a few milliseconds and it is the only
     honest answer to "will a download come out styled". */
  const compile = await canCompile();

  /* Which image sources this deployment can use, and why not where it cannot.
   *
   * Names and states only — never a key, never a URL template. And detail is
   * held back in production like everything else here, because "Unsplash is
   * misconfigured" is an administrator's business and nobody else's: a person
   * building a website must never learn that an optional API exists, let alone
   * be asked to configure one. */
  const imageProviders = await providerStatus({ assets: [] });

  /* Asked, not inspected — for the same reason downloadsCompile runs the
     compile. See btcPayReachable. */
  const btcpay = await btcPayReachable();

  /* Whether the sweep that settles payments is still running at all. A job that
     has stopped and a job with nothing to do are silent in exactly the same
     way, and this deployment has now been caught out by that twice. */
  const service = createSupabaseServiceClient();
  const reconcile = service ? await readHeartbeat(service, RECONCILE_SERVICE) : null;

  return NextResponse.json({
    status: "ok",
    supabaseConfigured: isSupabaseConfigured,
    /* A boolean either way: the webhook URL is a secret, and in production
       even the fact that a token is set is more than a health check owes an
       anonymous caller. */
    builderConfigured: isBuilderConfigured,
    /* What a finished page needs to be kept, and what an edit needs to happen.
       Both read by name, so a false here means the name in the environment is
       not the name the code looks for — which is invisible in a hosting
       dashboard and otherwise shows up only as a feature that quietly refuses. */
    storageConfigured: isServiceRoleConfigured,
    editingConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    /* False means downloads are going out unstyled. See canCompile. The reason
       rides alongside it when there is one: this failed once in production
       while passing every test, and a bare false said nothing about why. */
    /* True when at least one source can supply a picture. False is not a
       failure: every slot becomes a toned panel and the build still ships. */
    imagesConfigured: imageProviders.some((provider) => provider.usable && provider.id !== "project"),
    ...(includeDetails
      ? {
          imageProviders: imageProviders.map(({ id, health, cost }) => ({ id, health, cost })),
        }
      : {}),
    downloadsCompile: compile.ok,
    ...(compile.error ? { downloadsCompileError: compile.error } : {}),
    /* Whether this deployment can take money, in the two halves that fail
       separately. A checkout with no wallet configured offers no currencies at
       all — visible immediately. A checkout with wallets but no callback secret
       looks perfect right up until somebody pays and is never credited, which
       is the failure worth being able to see from outside. */
    cryptoCheckoutConfigured: isCryptoCheckoutConfigured(),
    cryptoSettlementConfigured: isSettlementCallbackConfigured(),
    /* Whether anything is WATCHING. The two above can both be true while
       settlement is still a person reading their own wallet — which was the
       state this deployment shipped in. False here means payments arrive and
       wait for `npm run settle`; true means BTCPay notices and credits within
       a confirmation. */
    btcpayInvoicing: isBtcPayConfigured(),
    btcpaySettlement: isBtcPayWebhookConfigured(),
    /* And whether the instance those variables name is alive. Configured but
       unreachable is the dangerous shape: checkout refuses BTC rather than
       taking money nothing is watching, so it is visible to a customer long
       before it is visible here — which is backwards, and this is the fix. */
    btcpayReachable: btcpay === "ok",
    /* The dead-man's switch. True means no sweep has completed in hours — so
       payments may be arriving and going uncredited right now, which is the one
       failure on this page that costs a customer rather than a feature.
       `reconcileScheduled` separates "never wired up" from "wired up and
       stopped": without CRON_SECRET nothing can call the sweep at all. */
    reconcileScheduled: Boolean(process.env.CRON_SECRET?.trim()),
    reconcileStale: reconcile?.stale ?? true,
    reconcileLastRunAt: reconcile?.lastRunAt ?? null,
    ...(includeDetails && reconcile?.detail ? { reconcileLastRun: reconcile.detail } : {}),
    ...(includeDetails ? { builderTokenSet: Boolean(process.env.N8N_WEBHOOK_TOKEN) } : {}),
    ...(missingSupabaseEnvVars ? { missingSupabaseEnvVars } : {}),
  });
}
