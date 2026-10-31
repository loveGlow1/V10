import type { BrandId } from "./components/brandMarks";

/** The services an app can be wired to, and the drawer they sit in. */
export const INTEGRATION_CATEGORIES = [
  "All",
  "Source",
  "Login",
  "AI",
  "Payments",
  "Storage",
  "Communications",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export type Integration = {
  id: string;
  name: string;
  blurb: string;
  category: Exclude<IntegrationCategory, "All">;
  /* Each row carries the service's own mark. A row named for a capability
     rather than a company — storage, email, messages — names the provider that
     would actually serve it, because a capability has no logo and a tile with a
     letter in it tells nobody anything. Swapping a provider is this one line. */
  brand: BrandId;
  /* What Add asks the builder for, when the builder can wire this itself on
     the app's own Supabase — no key of the person's needed. Sent through the
     chat like any message, so it is a build with its steps, credits and undo,
     and an app with no database yet is taken through connecting one first. */
  request?: string;
  /* The person's own keys the service needs, saved to the app's server
     environment (Server keys — never stored or shown by QuickStark) before
     the request is sent. The builder sees the key NAMES and wires the
     service on the server (lib/builder/integrations.ts). */
  keys?: { name: string; label: string; placeholder: string }[];
  /** Where to get the key, one line. */
  where?: string;
  /** What the person still has to do on the service's side after Add. */
  after?: string;
};

/* GitHub leads: it is the one people reach for first, and the only one that
   touches the app's code rather than its behaviour. */
export const INTEGRATIONS: Integration[] = [
  {
    id: "github",
    name: "GitHub",
    blurb: "Push your app's code to a repository you own",
    category: "Source",
    brand: "github",
  },
  {
    id: "google-signin",
    name: "Google sign-in",
    blurb: "Let people sign in with Google",
    category: "Login",
    brand: "google",
    request:
      "Add Sign in with Google using Supabase Auth (signInWithOAuth with the google provider), next to any existing sign-in, with a callback that returns people to where they were.",
    after: "Then turn on Google in your Supabase dashboard → Authentication → Sign In / Providers, with your Google OAuth client ID and secret.",
  },
  {
    id: "email-login",
    name: "Email and password login",
    blurb: "Let people log in with an email and password",
    category: "Login",
    brand: "supabase",
    request:
      "Add email and password login: sign up, log in, log out and password reset, and each person sees only their own data.",
  },
  {
    id: "claude",
    name: "Claude AI models",
    blurb: "Enable AI in your application using Claude",
    category: "AI",
    brand: "claude",
    keys: [{ name: "ANTHROPIC_API_KEY", label: "Anthropic API key", placeholder: "sk-ant-…" }],
    where: "console.anthropic.com → API keys",
    request: "Add an AI feature powered by Claude, called from a server route handler with ANTHROPIC_API_KEY — never from the browser. Pick the feature that fits this app best and wire it into the interface.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT AI models",
    blurb: "Enable AI in your application using ChatGPT",
    category: "AI",
    brand: "openai",
    keys: [{ name: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-…" }],
    where: "platform.openai.com → API keys",
    request: "Add an AI feature powered by OpenAI, called from a server route handler with OPENAI_API_KEY — never from the browser. Pick the feature that fits this app best and wire it into the interface.",
  },
  {
    id: "gemini",
    name: "Gemini AI models",
    blurb: "Enable AI in your application using Gemini",
    category: "AI",
    brand: "gemini",
    keys: [{ name: "GEMINI_API_KEY", label: "Gemini API key", placeholder: "AIza…" }],
    where: "aistudio.google.com → Get API key",
    request: "Add an AI feature powered by Gemini, called from a server route handler with GEMINI_API_KEY — never from the browser. Pick the feature that fits this app best and wire it into the interface.",
  },
  {
    id: "stripe",
    name: "Stripe payments",
    blurb: "Take card payments inside your app",
    category: "Payments",
    brand: "stripe",
    keys: [{ name: "STRIPE_SECRET_KEY", label: "Stripe secret key", placeholder: "sk_live_… or sk_test_…" }],
    where: "dashboard.stripe.com → Developers → API keys",
    request: "Add real card payments with Stripe Checkout: create the checkout session in a server route handler with STRIPE_SECRET_KEY, record the order before redirecting, and mark it paid only when Stripe confirms.",
  },
  {
    id: "storage",
    name: "Supabase Storage",
    blurb: "Let people upload and download files",
    category: "Storage",
    brand: "supabase",
    request:
      "Add file uploads and downloads with Supabase Storage: people can upload files, see the files they uploaded, and download or delete them.",
  },
  {
    id: "email",
    name: "Resend",
    blurb: "Send sign-up, password reset and receipt emails",
    category: "Communications",
    brand: "resend",
    keys: [{ name: "RESEND_API_KEY", label: "Resend API key", placeholder: "re_…" }],
    where: "resend.com → API Keys",
    request: "Send emails with Resend from a server route handler using RESEND_API_KEY: a welcome email on sign-up and a receipt or confirmation where the app completes an action.",
  },
  {
    id: "sms",
    name: "Twilio",
    blurb: "Send codes and alerts by text message",
    category: "Communications",
    brand: "twilio",
    keys: [
      { name: "TWILIO_ACCOUNT_SID", label: "Account SID", placeholder: "AC…" },
      { name: "TWILIO_AUTH_TOKEN", label: "Auth token", placeholder: "Your auth token" },
      { name: "TWILIO_PHONE_NUMBER", label: "Twilio phone number", placeholder: "+1…" },
    ],
    where: "console.twilio.com → Account info",
    request: "Send text messages with Twilio from a server route handler using TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER: verification codes or alerts where this app needs them.",
  },
];
