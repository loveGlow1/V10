import {
  Bot,
  CreditCard,
  Github,
  HardDrive,
  KeyRound,
  Mail,
  MessageSquare,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

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
  icon: LucideIcon;
  /* The service's own colour, used on the tile behind its icon so the row is
     scannable by colour the way the reference is. */
  tint: string;
};

/* GitHub leads: it is the one people reach for first, and the only one that
   touches the app's code rather than its behaviour. */
export const INTEGRATIONS: Integration[] = [
  {
    id: "github",
    name: "GitHub",
    blurb: "Push your app's code to a repository you own",
    category: "Source",
    icon: Github,
    tint: "#8F939A",
  },
  {
    id: "google-signin",
    name: "Google sign-in",
    blurb: "Let people sign in with Google",
    category: "Login",
    icon: KeyRound,
    tint: "#4285F4",
  },
  {
    id: "email-login",
    name: "Email and password login",
    blurb: "Let people log in with an email and password",
    category: "Login",
    icon: Mail,
    tint: "#34F5A0",
  },
  {
    id: "claude",
    name: "Claude AI models",
    blurb: "Enable AI in your application using Claude",
    category: "AI",
    icon: Sparkles,
    tint: "#D97757",
  },
  {
    id: "chatgpt",
    name: "ChatGPT AI models",
    blurb: "Enable AI in your application using ChatGPT",
    category: "AI",
    icon: Bot,
    tint: "#10A37F",
  },
  {
    id: "gemini",
    name: "Gemini AI models",
    blurb: "Enable AI in your application using Gemini",
    category: "AI",
    icon: Sparkles,
    tint: "#6C8BFF",
  },
  {
    id: "stripe",
    name: "Stripe payments",
    blurb: "Take card payments inside your app",
    category: "Payments",
    icon: CreditCard,
    tint: "#B06CFF",
  },
  {
    id: "storage",
    name: "File storage",
    blurb: "Let people upload and download files",
    category: "Storage",
    icon: HardDrive,
    tint: "#2FD3D3",
  },
  {
    id: "email",
    name: "Transactional email",
    blurb: "Send sign-up, password reset and receipt emails",
    category: "Communications",
    icon: Send,
    tint: "#F4D96B",
  },
  {
    id: "sms",
    name: "SMS",
    blurb: "Send codes and alerts by text message",
    category: "Communications",
    icon: MessageSquare,
    tint: "#F06FC0",
  },
];
