/* Every key this deployment reads, what it switches on, and whether it is set.
 *
 * The promise: a feature works the moment its key is in Vercel's environment
 * (and the deployment has rebuilt, which is when Vercel hands new variables
 * over). No second switch to find, no address to also set when one can be
 * worked out. Where a feature honestly needs more than one value — a pair
 * that only works together, a sender on a verified domain, a webhook a
 * service must be told about — this says so, so the Keys page can too.
 *
 * Names only. Nothing here ever reads, returns or logs a value.
 *
 * Pure: read by the owner's Keys page (api/keys) and by the code paths that
 * accept more than one name for the same key (googleKey). */

type Env = Record<string, string | undefined>;

export type KeyFeature = {
  id: string;
  /** The area of the product it belongs to. */
  area: "Core" | "AI building" | "Images & fliers" | "Video" | "Email & alerts" | "Payments" | "Sign-in & integrations" | "Publishing" | "Databases";
  label: string;
  /** What works once it is set, in a sentence. */
  unlocks: string;
  /** Each group must have at least one name set; every group is needed. */
  needs: string[][];
  /** Read when set, never needed. */
  optional?: string[];
  /** Where to get it. */
  where?: string;
  /** Anything beyond pasting the key. */
  also?: string;
  /** Has to be on for the site to run at all. */
  required?: boolean;
};

export const FEATURES: KeyFeature[] = [
  { id: "supabase", area: "Core", required: true, label: "Database & accounts (Supabase)", unlocks: "Sign-in, projects, credits — the site itself.", needs: [["NEXT_PUBLIC_SUPABASE_URL"], ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]], where: "Supabase → Project Settings → API" },
  { id: "service", area: "Core", required: true, label: "Server access to the database", unlocks: "Background work: builds finishing, renders landing, credits, payments.", needs: [["SUPABASE_SERVICE_ROLE_KEY"]], where: "Supabase → Project Settings → API → service_role" },
  { id: "site", area: "Core", label: "Site address", unlocks: "Links in emails, OAuth returns and callbacks use your domain.", needs: [["NEXT_PUBLIC_SITE_URL"]], also: "Worked out from the request when not set." },
  { id: "cron", area: "Core", label: "Scheduled jobs", unlocks: "The sweeps that settle payments, refresh trials and clean up.", needs: [["CRON_SECRET"]], where: "Any long random string" },

  { id: "anthropic", area: "AI building", required: true, label: "Claude (the builder's brain)", unlocks: "Editing pages, planning videos, the video editor, flier briefs, text checks.", needs: [["ANTHROPIC_API_KEY"]], where: "console.anthropic.com → API keys" },
  { id: "n8n", area: "AI building", label: "n8n workflows", unlocks: "Building whole pages, MiniMax video and voice on the usage credit, flier images.", needs: [["N8N_WEBHOOK_URL"], ["N8N_WEBHOOK_TOKEN"]], optional: ["N8N_VIDEO_WEBHOOK_URL", "N8N_FLIER_WEBHOOK_URL"], also: "The video and flier addresses are worked out from N8N_WEBHOOK_URL." },
  { id: "openai-chat", area: "AI building", label: "OpenAI models in the model picker", unlocks: "GPT models offered to people building.", needs: [["OPENAI_API_KEY"]], where: "platform.openai.com → API keys" },
  { id: "google-chat", area: "AI building", label: "Gemini models in the model picker", unlocks: "Gemini models offered to people building, and Gemini images.", needs: [["GEMINI_API_KEY", "GOOGLE_API_KEY"]], where: "aistudio.google.com → Get API key", also: "Either name works." },
  { id: "e2b", area: "AI building", label: "Code sandbox", unlocks: "The code editor's terminal: running an app's own commands.", needs: [["E2B_API_KEY"]], optional: ["E2B_TEMPLATE"], where: "e2b.dev → Dashboard" },

  { id: "minimax", area: "Images & fliers", label: "MiniMax (direct)", unlocks: "Video clips, voice-overs and flier images on your MiniMax account — works without n8n.", needs: [["MINIMAX_API_KEY"]], optional: ["MINIMAX_SPEECH_MODEL"], where: "platform.minimax.io → API keys" },
  { id: "openai-image", area: "Images & fliers", label: "OpenAI images", unlocks: "Flier pictures, creator keyframes and page art with gpt-image.", needs: [["OPENAI_API_KEY"]], optional: ["OPENAI_IMAGE_MODEL"] },
  { id: "ideogram", area: "Images & fliers", label: "Ideogram", unlocks: "Graphic-style flier art and creator keyframes.", needs: [["IDEOGRAM_API_KEY"]], where: "ideogram.ai → API" },
  { id: "unsplash", area: "Images & fliers", label: "Unsplash photos", unlocks: "Free stock photos in built pages.", needs: [["UNSPLASH_ACCESS_KEY"]], where: "unsplash.com/developers" },
  { id: "pexels", area: "Images & fliers", label: "Pexels photos", unlocks: "More free stock photos in built pages.", needs: [["PEXELS_API_KEY"]], where: "pexels.com/api" },
  { id: "ai-image", area: "Images & fliers", label: "Custom image endpoint", unlocks: "Your own image-generation service for page pictures.", needs: [["AI_IMAGE_ENDPOINT"], ["AI_IMAGE_API_KEY"]], optional: ["AI_IMAGE_ENABLED"], also: "On once both are set; AI_IMAGE_ENABLED=false turns it off." },

  { id: "fal", area: "Video", label: "fal.ai", unlocks: "Lip-sync, avatars, music and Seedance clips.", needs: [["FAL_KEY"]], where: "fal.ai → Keys" },
  { id: "hf", area: "Video", label: "Hugging Face inference", unlocks: "Seedance and Kling video clips.", needs: [["HF_API_KEY_ID"], ["HF_API_KEY_SECRET"]] },
  { id: "browserless", area: "AI building", label: "Browserless", unlocks: "The agent's screenshots and page checks in a real browser.", needs: [["BROWSERLESS_TOKEN"]], optional: ["BROWSERLESS_URL"] },

  { id: "resend", area: "Email & alerts", label: "Email (Resend)", unlocks: "Receipts, trial emails, form notifications and alerts.", needs: [["RESEND_API_KEY"]], optional: ["RECEIPT_FROM", "ALERT_FROM", "FORM_NOTIFY_FROM", "ALERT_EMAIL"], where: "resend.com → API Keys", also: "Verify your domain in Resend; senders default to addresses on your site's domain." },

  { id: "stripe", area: "Payments", label: "Card payments (Stripe)", unlocks: "Plans and top-ups by card.", needs: [["STRIPE_SECRET_KEY"], ["STRIPE_WEBHOOK_SECRET"]], where: "dashboard.stripe.com → Developers", also: "Add a webhook in Stripe to /api/payments/stripe/webhook and paste its signing secret as STRIPE_WEBHOOK_SECRET." },
  { id: "btcpay", area: "Payments", label: "Crypto payments (BTCPay)", unlocks: "Paying in Bitcoin.", needs: [["BTCPAY_URL"], ["BTCPAY_API_KEY"], ["BTCPAY_STORE_ID"]], optional: ["BTCPAY_WEBHOOK_SECRET", "CRYPTO_PAYMENTS_WEBHOOK_SECRET"] },

  { id: "github", area: "Sign-in & integrations", label: "GitHub", unlocks: "Import from and push to people's repositories.", needs: [["GITHUB_OAUTH_CLIENT_ID"], ["GITHUB_OAUTH_CLIENT_SECRET"]], optional: ["GITHUB_OAUTH_REDIRECT_URL"], where: "github.com/settings/developers → OAuth Apps", also: "Set the app's callback URL to <your site>/api/integrations/github/callback." },
  { id: "supabase-oauth", area: "Sign-in & integrations", label: "Connect Supabase (people's own)", unlocks: "People link their own Supabase project to an app.", needs: [["SUPABASE_OAUTH_CLIENT_ID"], ["SUPABASE_OAUTH_CLIENT_SECRET"]], optional: ["SUPABASE_OAUTH_REDIRECT_URL"], where: "Supabase → Organization → OAuth Apps" },
  { id: "whatsapp", area: "Sign-in & integrations", label: "WhatsApp bot", unlocks: "Building from WhatsApp.", needs: [["WHATSAPP_BOT_SECRET"]], optional: ["WHATSAPP_BOT_NUMBER"] },

  { id: "vercel", area: "Publishing", label: "Publishing apps (Vercel)", unlocks: "People publish apps to live addresses, and their server keys are stored.", needs: [["VERCEL_API_TOKEN"]], optional: ["VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"], where: "vercel.com/account/tokens" },

  { id: "managed-db", area: "Databases", label: "Managed databases", unlocks: "A database made for people who don't bring their own.", needs: [["SUPABASE_MANAGEMENT_TOKEN"], ["SUPABASE_ORG_ID"], ["MANAGED_DATABASES_ENABLED"]], optional: ["SUPABASE_MANAGED_REGION"], also: "Off until MANAGED_DATABASES_ENABLED=true on purpose: each one is a monthly Supabase bill." },
];

const set = (env: Env, name: string) => Boolean(env[name]?.trim());

export type KeyStatus = KeyFeature & { ready: boolean; missing: string[]; present: string[] };

/** Every feature, with which of its key names are set. Names only. Pure. */
export function keyStatus(env: Env = process.env): KeyStatus[] {
  return FEATURES.map((feature) => {
    const missing = feature.needs.filter((group) => !group.some((name) => set(env, name))).map((group) => group.join(" or "));
    const present = [...feature.needs.flat(), ...(feature.optional ?? [])].filter((name) => set(env, name));
    const ready = missing.length === 0 && (feature.id !== "managed-db" || env.MANAGED_DATABASES_ENABLED === "true");
    return { ...feature, ready, missing, present };
  });
}

/** Google's key, under either name people paste it as. Pure. */
export const googleKey = (env: Env = process.env) => env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || undefined;

/** A sender on the site's own domain, for email that has no sender set. Pure. */
export function defaultSender(local: string, env: Env = process.env): string | undefined {
  try {
    const host = new URL(env.NEXT_PUBLIC_SITE_URL || "https://www.quickstark.tech").hostname.replace(/^www\./, "");
    return host && host.includes(".") && host !== "localhost" ? `QuickStark.ai <${local}@${host}>` : undefined;
  } catch {
    return undefined;
  }
}

/** The accounts that may see the Keys page: OWNER_EMAILS, else ALERT_EMAIL. Pure. */
export function ownerEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.OWNER_EMAILS || env.ALERT_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
