/* Which outside services a project is actually wired to.
 *
 * The plumbing for this was already right and nothing read it. A customer
 * pastes their Stripe secret key into Server keys; the key goes to Vercel and
 * is set on the generated project's environment, where the build and the
 * running function can read it. That part works — see
 * /api/projects/[id]/secrets, which deliberately stores nothing here and reads
 * the list back from Vercel so it is true rather than remembered.
 *
 * What never happened is anybody telling the GENERATOR. `projectSecretNames`
 * had one caller, the panel that draws the list, so the build prompt was
 * written as though every project had no services at all. The blueprint's rule
 * for that case then fired exactly as designed — "at the point of charging
 * show a plainly worded state saying payment connects to a back end that is
 * not attached yet" — and the customer got an app saying payments were not
 * connected, with their key sitting on the project the whole time.
 *
 * That is the failure this closes, and the shape of it is the one that keeps
 * recurring here: correct machinery with no caller.
 *
 * ── Read from the key names, and only the key names ───────────────────────
 *
 * Nothing here sees a VALUE, and it must stay that way. Vercel will not return
 * one and this would not ask — a secret readable by the thing that set it is a
 * secret with an extra way to leak. A NAME is enough to know a service is
 * there, which is the only question being asked.
 *
 * ── Never in the browser ──────────────────────────────────────────────────
 *
 * Every key below is server-only by construction: secretKeyProblem refuses a
 * NEXT_PUBLIC_ name outright, because Next inlines that prefix into the bundle
 * and serves it to every visitor. So a service being connected is permission
 * to write a route handler or a server action that uses it — never permission
 * to reach for it in a component. The brief says so in as many words, because
 * a model that knows a Stripe key exists will otherwise use it where the code
 * it is writing happens to be.
 */

/* One service, and what its presence licenses.
 *
 * `keys` is matched against the names really set on the project. Written as
 * the conventional name each SDK documents, because that is what somebody
 * pastes — a name nobody uses is a service that never gets detected. */
type Service = {
  id: string;
  label: string;
  /* Any one of these being set means the service is there. */
  keys: RegExp[];
  /** What the generated app may now actually do, said as an instruction. */
  licenses: string;
};

const SERVICES: Service[] = [
  {
    id: "stripe",
    label: "Stripe",
    keys: [/^STRIPE_SECRET_KEY$/i, /^STRIPE_API_KEY$/i, /^STRIPE_RESTRICTED_KEY$/i],
    licenses:
      "Take real payments. The charge is created in a route handler under `app/api/` using the secret key from `process.env` — never in a component, never in anything the browser runs. Write the order and its items to the database BEFORE redirecting to Stripe, mark it paid only when Stripe confirms, and treat the webhook as the truth rather than the redirect back.",
  },
  {
    id: "resend",
    label: "Resend",
    keys: [/^RESEND_API_KEY$/i],
    licenses:
      "Send real email from a route handler — a confirmation, a receipt, a contact-form notification. Never from the browser: the key is server-only and the address list is not something a visitor may choose.",
  },
  {
    id: "twilio",
    label: "Twilio",
    keys: [/^TWILIO_AUTH_TOKEN$/i, /^TWILIO_ACCOUNT_SID$/i],
    licenses: "Send SMS from a route handler, server-side only.",
  },
  {
    id: "anthropic",
    label: "Claude",
    keys: [/^ANTHROPIC_API_KEY$/i],
    licenses:
      "Call Claude from a route handler under `app/api/`. The key never reaches the browser, so the page posts to that route and the route calls the model.",
  },
  {
    id: "openai",
    label: "OpenAI",
    keys: [/^OPENAI_API_KEY$/i],
    licenses: "Call OpenAI from a route handler under `app/api/`, server-side only.",
  },
  {
    id: "gemini",
    label: "Gemini",
    keys: [/^GEMINI_API_KEY$/i, /^GOOGLE_GENERATIVE_AI_API_KEY$/i],
    licenses: "Call Gemini from a route handler under `app/api/`, server-side only.",
  },
];

export type ConnectedService = { id: string; label: string; licenses: string };

/**
 * The services these key names amount to.
 *
 * Unknown names are ignored rather than guessed at. Somebody's own
 * `INTERNAL_WEBHOOK_TOKEN` is a key this platform has no business having an
 * opinion about, and inventing a capability from a name would be telling the
 * model to build against a service nobody described.
 */
export function connectedServices(keyNames: readonly string[]): ConnectedService[] {
  const names = keyNames.map((name) => name.trim()).filter((name) => name.length > 0);

  return SERVICES.filter((service) =>
    service.keys.some((pattern) => names.some((name) => pattern.test(name))),
  ).map(({ id, label, licenses }) => ({ id, label, licenses }));
}

/**
 * What the generator is told about them.
 *
 * Empty when nothing is connected, which is the ordinary case and the one the
 * blueprints already handle: their "not connected yet" state is correct, and
 * stays correct, for a project with no keys. This exists for the other case,
 * where that state is a lie about a service the customer has already paid for
 * and set up.
 */
export function integrationBrief(services: readonly ConnectedService[]): string {
  if (services.length === 0) return "";

  return [
    `CONNECTED SERVICES — ${services.map((service) => service.label).join(", ")}.`,
    "",
    "These are really set on this project's environment. They are NOT pending, and a 'not connected yet' state for any of them would be wrong — the customer has already connected it.",
    "",
    ...services.map((service) => `${service.label}: ${service.licenses}`),
    "",
    "EVERY ONE OF THESE KEYS IS SERVER-ONLY. They are read with `process.env` inside a route handler under `app/api/` or a server action, and nowhere else. A key in a client component is a key published to every visitor of the site — none of them carry the NEXT_PUBLIC_ prefix, and none may be given it.",
    "Anything NOT listed above is still not connected, and still gets the plainly worded pending state rather than a pretend success.",
  ].join("\n");
}
