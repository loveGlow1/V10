/* The Stripe key this deployment may use, or null.
 *
 * A test key on the live site is no Stripe at all: Stripe's test cards
 * (4242 4242 4242 4242) are accepted by anybody, so a test key in production
 * would let anyone "verify" a card for free credit and "buy" plans and credits
 * for nothing. So in production only a live key counts; a test key there reads
 * as not configured — the card rule and the paid checkout stand down rather
 * than run on make-believe money. Preview and local deployments may use test
 * keys, which is what they are for.
 *
 * "Production" is Vercel's own say-so (VERCEL_ENV), falling back to NODE_ENV
 * off Vercel. */

const TEST_KEY = /^(sk|rk)_test_/;

export function isProductionDeployment(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === "production";
  return process.env.NODE_ENV === "production";
}

export function stripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (TEST_KEY.test(key) && isProductionDeployment()) return null;
  return key;
}

/** Whether a test key is being refused here, for an operator-facing message. */
export function stripeTestKeyRefused(): boolean {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  return TEST_KEY.test(key) && isProductionDeployment();
}
