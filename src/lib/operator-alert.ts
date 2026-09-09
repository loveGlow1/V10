import type { SupabaseClient } from "@supabase/supabase-js";

/* Telling a person something needs a person.
 *
 * There is exactly one thing in this system that cannot be automated away: a
 * payment that arrived and does not match any order it could settle. Somebody
 * has to look. This is how they find out without being the one who checks.
 *
 * Optional, and it degrades in the right direction: with no key configured the
 * message goes to the log and the caller still reports what it found in its own
 * response. Detection never depends on delivery — an alert that cannot be sent
 * must not stop a sweep from finding the next problem.
 */

/** Whether a stranded payment can actually reach a human. */
export const isOperatorAlertConfigured = () =>
  Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ALERT_EMAIL?.trim());

/**
 * Sends one alert. Returns whether it was delivered, never throws.
 *
 * Resend over its REST API rather than its SDK: one fetch against a documented
 * endpoint is not worth a dependency, and a dependency in the path of "tell me
 * my payments are broken" is a dependency that can break it.
 */
export async function sendOperatorAlert(subject: string, body: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ALERT_EMAIL?.trim();

  if (!key || !to) {
    // eslint-disable-next-line no-console
    console.warn(`operator alert (undelivered — no RESEND_API_KEY/ALERT_EMAIL): ${subject}\n${body}`);
    return false;
  }

  /* Resend will only send from a domain the account has verified. onboarding@
   * is theirs and always works, which makes it the right default for an alert
   * that must not fail because of DNS. */
  const from = process.env.ALERT_FROM?.trim() || "onboarding@resend.dev";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("operator alert: Resend refused it:", response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("operator alert: could not be sent:", error);
    return false;
  }
}

/* How long the same problem waits before it is reported again. It is the same
   problem on every sweep until somebody deals with it, and an alert arriving
   forty-eight times a day is an alert nobody reads. */
const REALERT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Sends an alert at most once a day for a given kind of problem.
 *
 * The last-sent time is kept in service_heartbeats under an `alert:` name,
 * which is not a hack so much as the same question: that table exists to answer
 * "when did this last happen", and this is a thing that happens.
 *
 * Records the attempt whether or not delivery succeeded. A failed send is
 * already in the log and in the sweep's own response; retrying it every fifteen
 * minutes would bury the next real one.
 */
export async function alertOncePerDay(
  service: SupabaseClient,
  key: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const name = `alert:${key}`;
  const now = Date.now();

  const { data } = await service
    .from("service_heartbeats")
    .select("ran_at")
    .eq("service", name)
    .maybeSingle();

  const lastSent = (data as { ran_at: string } | null)?.ran_at;

  if (lastSent && now - new Date(lastSent).getTime() < REALERT_AFTER_MS) return false;

  await sendOperatorAlert(subject, body);

  await service
    .from("service_heartbeats")
    .upsert(
      { service: name, ran_at: new Date(now).toISOString(), detail: { subject } },
      { onConflict: "service" },
    );

  return true;
}
