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
