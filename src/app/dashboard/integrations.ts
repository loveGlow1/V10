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
  brand: BrandId | "openai";
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
  },
  {
    id: "email-login",
    name: "Email and password login",
    blurb: "Let people log in with an email and password",
    category: "Login",
    brand: "supabase",
  },
  {
    id: "claude",
    name: "Claude AI models",
    blurb: "Enable AI in your application using Claude",
    category: "AI",
    brand: "claude",
  },
  {
    id: "chatgpt",
    name: "ChatGPT AI models",
    blurb: "Enable AI in your application using ChatGPT",
    category: "AI",
    brand: "openai",
  },
  {
    id: "gemini",
    name: "Gemini AI models",
    blurb: "Enable AI in your application using Gemini",
    category: "AI",
    brand: "gemini",
  },
  {
    id: "stripe",
    name: "Stripe payments",
    blurb: "Take card payments inside your app",
    category: "Payments",
    brand: "stripe",
  },
  {
    id: "storage",
    name: "Supabase Storage",
    blurb: "Let people upload and download files",
    category: "Storage",
    brand: "supabase",
  },
  {
    id: "email",
    name: "Resend",
    blurb: "Send sign-up, password reset and receipt emails",
    category: "Communications",
    brand: "resend",
  },
  {
    id: "sms",
    name: "Vonage",
    blurb: "Send codes and alerts by text message",
    category: "Communications",
    brand: "vonage",
  },
];
