"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Provider } from "@supabase/supabase-js";
import LoginModal, { FacebookIcon, GoogleIcon, PROVIDER_ICON_CLASS, ProviderButton } from "./LoginModal";
import Q3DCanvas from "./Q3DCanvas";
import {
  createSupabaseBrowserClient,
  describeMissingSupabaseEnvVars,
  getMissingSupabaseEnvVars,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { useMediaQuery } from "@/hooks/use-media-query";
/* Prices come from the credit economy, so the page and the billing modal cannot
   quote different figures for the same plan. */
import { PLANS } from "./dashboard/credits";
import {
  Gift,
  Layout,
  Server,
  Cpu,
  Check,
  ChevronDown,
  X,
  Apple,
  Github as GitHubIcon,
  Mail,
  Phone,
  Twitter,
  Slack,
} from "lucide-react";

function useReveal() {
  const ref = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, active] as const;
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [ref, active] = useReveal();
  return <div ref={ref} className={`reveal-element ${active ? "active" : ""} ${className}`}>{children}</div>;
}

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas = canvasEl;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;
    let animationId = 0;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    class Particle {
      x = 0;
      y = 0;
      size = 0;
      speedY = 0;
      speedX = 0;
      opacity = 0;
      constructor() {
        this.reset();
      }
      reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 1.5 + 0.5;
        this.speedY = -(Math.random() * 0.2 + 0.05);
        this.speedX = Math.random() * 0.2 - 0.1;
        this.opacity = Math.random() * 0.5 + 0.1;
      }
      update() {
        this.y += this.speedY;
        this.x += this.speedX;
        if (this.y < 0) this.reset();
      }
      draw() {
        ctx.fillStyle = `rgba(142, 240, 138, ${this.opacity})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const particles = Array.from({ length: 40 }, () => new Particle());

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.update();
        p.draw();
      });
      animationId = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} id="particle-canvas" className="fixed inset-0 pointer-events-none z-[2] opacity-40" />;
}

/* Three pillars, each with its own panel on the right. The list consolidates what used
   to be six rows: six titles beside one static image made the section long and gave the
   visual nothing to say, since it never changed. */
const FEATURES = [
  {
    icon: Layout,
    title: "Build web and mobile apps",
    desc: "Turn a single prompt into production interfaces — Next.js 15, React 19 and Tailwind components that fit every screen and deploy the moment they compile.",
    image: "/feature-apps.jpg",
    alt: "A generated reading app running in a desktop browser beside its mobile layout",
  },
  {
    icon: Server,
    title: "Build secure backends",
    desc: "Everything behind the scenes, handled for you: somewhere safe to keep your data, checks that stop bad data getting in, and sign-ins that work from day one — on Supabase, Postgres or Firebase.",
    image: "/feature-backend.jpg",
    alt: "A phone toggling connections to an MCP server, a knowledge base and GitHub",
  },
  {
    icon: Cpu,
    title: "Build AI agents and workflows",
    desc: "Put agents inside your product that keep working when you're not — they remember what matters, react to events, and can even take payments.",
    image: "/feature-agents.jpg",
    alt: "A grid of AI agents covering research, writing, everyday tasks and custom roles",
  },
];

const SHOW_SUPABASE_CONFIG_WARNING =
  !isSupabaseConfigured &&
  (process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_SHOW_SUPABASE_CONFIG_WARNING === "true");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getSupabaseUnavailableMessage(missingVars: string[]) {
  if (!IS_PRODUCTION) {
    const missingVarsSegment = missingVars.length ? ` Missing: ${missingVars.join(", ")}.` : "";
    return `Authentication is currently unavailable because Supabase environment configuration is incomplete.${missingVarsSegment} Update .env.local (or deployment env vars) and restart/redeploy.`;
  }

  return "Authentication is currently unavailable because deployment environment configuration is incomplete. Please ask support to verify Supabase environment variables and redeploy.";
}

function getSupabaseClientCreationFailureMessage(error: unknown) {
  const message =
    "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.";

  if (IS_PRODUCTION || !(error instanceof Error) || !error.message) {
    return message;
  }

  return `${message} Technical details: ${error.message}`;
}

/* Annual billing is priced as the monthly rate less this share, charged twelve months at a
   time, so the card can show both the discounted per-month figure and the yearly total from
   one number per tier. */
const ANNUAL_DISCOUNT = 0.2;

function formatPrice(value: number) {
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

const PRICING_TIERS = [
  {
    name: "Free",
    description: "A simple starting point to explore QuickStart.Ai and validate your first product ideas.",
    monthlyPrice: PLANS.free.monthlyPriceUsd,
    ctaLabel: "Get Started",
    icon: Gift,
    highlight: false,
    features: [
      "Core product building workflows",
      "Foundational generation and preview tools",
      "A starter path to explore the platform",
    ],
  },
  {
    name: "Standard",
    description: "The most balanced plan for serious builders shipping polished web and mobile experiences.",
    monthlyPrice: PLANS.standard.monthlyPriceUsd,
    ctaLabel: "Try QuickStart.Ai",
    icon: Layout,
    highlight: true,
    features: [
      "Everything in Free, plus:",
      "Expanded workflows for production-ready app building",
      "Additional collaboration and automation capabilities",
    ],
  },
  {
    name: "Pro",
    description: "A high-touch tier for advanced teams orchestrating larger systems and more complex launches.",
    monthlyPrice: PLANS.pro.monthlyPriceUsd,
    ctaLabel: "Get Started",
    icon: Cpu,
    highlight: false,
    features: [
      "Everything in Standard, plus:",
      "Advanced platform access for larger delivery needs",
      "Priority-ready infrastructure and workflow coverage",
    ],
  },
] as const;

/* The header has linked to #faq since before the section existed. Answers stay inside
   what the rest of the page already promises — the three pillars above and the tiers
   below — so the FAQ never becomes the only place a claim is made. */
const FAQS = [
  {
    // Opens the section, and is the row that starts expanded. It answers what a visitor is
    // left holding rather than what the platform is — that subject has its own entry below,
    // so the two do not restate each other.
    question: "What do I actually end up with?",
    answer:
      "A product that runs, not a mockup or a pile of screens to hand off. You get the pages people use, the database behind them, sign-in already wired up and real code underneath — live on a URL you can share the same day, and still yours to keep changing.",
  },
  {
    question: "What is QuickStart.Ai and how does it work?",
    answer:
      "Describe the product you want in plain language and QuickStart.Ai builds it — the screens people see, the backend behind them, the database underneath and the sign-in flow, ready to go live. Web and mobile come out of the same description.",
  },
  {
    question: "What can I build with it?",
    answer:
      "Anything with a front end and something running behind it: customer-facing web and mobile apps, dashboards, marketplaces, booking and subscription products, internal tools. If it needs pages, accounts, data and payments, it is in range.",
  },
  {
    question: "Do I need coding experience to use QuickStart.Ai?",
    answer:
      "No. You describe what you want in ordinary words and QuickStart.Ai does the building. What it writes underneath is real Next.js and React code, so if you bring in a developer later there is something familiar for them to pick up.",
  },
  {
    question: "Where does my data live, and what does it connect to?",
    answer:
      "Your data sits on Supabase, Postgres or Firebase — whichever you prefer — with sign-ins wired up from the start. Beyond that, your app can reach the rest of your stack through webhooks and take payments through Stripe.",
  },
  {
    question: "What are AI agents and workflows?",
    answer:
      "Agents are the parts of your product that keep working when you are not. They watch for events, run jobs in the background, remember what matters between sessions, and can take payments. You describe the job once and they handle it from then on.",
  },
  {
    question: "How does pricing work?",
    answer:
      "Free lets you start building at no cost. Standard is $15 a month for people shipping real products, and Pro is $150 a month for teams running larger systems. Billing is monthly for now, with annual plans on the way.",
  },
] as const;

const FOOTER_LINK_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Get Started", href: "#signup" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Contact", href: "#" },
      { label: "Careers", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "#" },
      { label: "Privacy Policy", href: "#" },
    ],
  },
] as const;

/* Six applications float around the hero — a restaurant landing page, two storefronts, a
   product page, a banking app and a food-ordering app — so the first thing a visitor sees
   is the range of things QuickStart.Ai builds. Each entry is a screenshot of a real UI,
   rendered from the mockups in tools/hero-mockups (re-run
   `node tools/hero-mockups/render.mjs` after editing one).

   WHERE each one sits comes from one ellipse: an app declares the angle it occupies and
   the position falls out of that, so the set reads as a circle around the hero rather
   than a scatter. The ring is broken in two places on purpose — nothing near 270deg where
   the mark is, nothing near 90deg where the auth stack is. Angles run clockwise from
   three o'clock.

   On a phone the ring cannot survive: the column is the full width of the screen, so the
   only clear bands are above the mark, either side of it, and below the auth stack. Four
   of the six move there instead — the two phones flanking the mark, the two food pages
   entering from the bottom corners — and the remaining two wait for a wider screen. The
   mobile point is a second pair of custom properties; globals.css picks which pair
   applies at each breakpoint, since an inline style cannot carry a media query.

   HOW each one is turned is written out per app instead of derived, because a formula
   gives a symmetry that reads as decoration. Every surface carries its own
   perspective() + rotateZ + rotateY + rotateX + scale: the perspective is what makes it a
   panel in space rather than a sticker rotated on the page, and the rotateY is what puts
   one edge nearer the viewer than the other. Left-hand surfaces lean left, right-hand
   ones lean right, but never by mirrored amounts, and not every right-hand one turns the
   same way. Scale and opacity carry depth — foreground panels are near full size and
   brightest, background ones smaller and faintest — and the two light-ground pages carry
   their own filter, since the shared one is tuned for dark UIs. */
const HERO_RING = { cx: 50, cy: 45, rx: 46, ry: 54 };

/* Position only. The attitude of each panel lives with the panel. */
function heroRingPosition(angle: number, radius = 1) {
  const rad = (angle * Math.PI) / 180;

  return {
    left: `calc(${HERO_RING.cx}% + ${(HERO_RING.rx * radius * Math.cos(rad)).toFixed(2)}%)`,
    top: `calc(${HERO_RING.cy}% + ${(HERO_RING.ry * radius * Math.sin(rad)).toFixed(2)}%)`,
  };
}

const HERO_APPS = [
  {
    // Upper left, furthest back: flatter and smaller, so it reads as distant.
    src: "/hero-apps/trattoria.png",
    width: 2480,
    height: 1580,
    alt: "Restaurant landing page with a plated spaghetti and a reservation form",
    angle: 232,
    radius: 1,
    size: "w-[46vw] max-w-[230px] lg:w-[26vw] lg:max-w-[480px]",
    mobile: { left: "20%", top: "calc(100% + 26px)" },
    show: "hidden [@media(min-width:375px)_and_(min-height:720px)]:block lg:block",
    transform: "perspective(1400px) rotateZ(-12deg) rotateY(12deg) rotateX(3deg) scale(0.82)",
    opacity: 0.38,
    layer: "z-0",
    float: { duration: "7.5s", delay: "-2s" },
  },
  {
    // Far left, mid depth — the strongest rotateY of the set, which is what makes its
    // outer edge fall away into the screen.
    src: "/hero-apps/store.png",
    width: 2480,
    height: 1580,
    alt: "Fashion storefront with a product grid and promotional banner",
    angle: 185,
    radius: 1.04,
    size: "w-[26vw] max-w-[470px]",
    mobile: null,
    show: "hidden lg:block",
    transform: "perspective(1200px) rotateZ(-6deg) rotateY(15deg) rotateX(-2deg) scale(0.9)",
    opacity: 0.5,
    filter: "brightness(0.5) saturate(0.8) contrast(1.03)",
    layer: "z-0",
    float: { duration: "7s", delay: "-6s" },
  },
  {
    // Lower left, nearest the viewer: full scale, brightest, least dimmed.
    src: "/hero-apps/banking.png",
    width: 780,
    height: 1688,
    alt: "Mobile banking app showing balance, spending and recent transactions",
    angle: 131,
    radius: 1.22,
    size: "w-[22vw] max-w-[112px] lg:w-[12vw] lg:min-w-[132px] lg:max-w-[196px]",
    mobile: { left: "12%", top: "40px" },
    show: "hidden min-[375px]:block",
    transform: "perspective(1200px) rotateZ(-9deg) rotateY(13deg) rotateX(2deg) scale(1)",
    opacity: 0.74,
    layer: "z-10",
    float: { duration: "5.6s", delay: "-1s" },
  },
  {
    // Lower right, also foreground — but rolled the other way, so the two front panels
    // are not a mirrored pair.
    src: "/hero-apps/food.png",
    width: 860,
    height: 1792,
    alt: "Food ordering app with featured restaurant and nearby listings",
    angle: 49,
    radius: 1.22,
    size: "w-[22vw] max-w-[112px] lg:w-[12vw] lg:min-w-[132px] lg:max-w-[196px]",
    mobile: { left: "88%", top: "32px" },
    show: "hidden min-[375px]:block",
    transform: "perspective(1200px) rotateZ(-7deg) rotateY(-10deg) rotateX(-2deg) scale(0.97)",
    opacity: 0.68,
    filter: "brightness(0.66) saturate(0.88) contrast(1.02)",
    layer: "z-10",
    float: { duration: "6.3s", delay: "-4s" },
  },
  {
    // Right, mid depth.
    src: "/hero-apps/pantry.png",
    width: 2480,
    height: 1600,
    alt: "Gourmet food store with a pasta subscription banner and product grid",
    angle: 355,
    radius: 0.99,
    size: "w-[46vw] max-w-[230px] lg:w-[26vw] lg:max-w-[470px]",
    mobile: { left: "82%", top: "calc(100% + 30px)" },
    show: "hidden [@media(min-width:375px)_and_(min-height:720px)]:block lg:block",
    transform: "perspective(1200px) rotateZ(9deg) rotateY(-12deg) rotateX(2deg) scale(0.92)",
    opacity: 0.52,
    filter: "brightness(0.52) saturate(0.84) contrast(1.03)",
    layer: "z-[5]",
    float: { duration: "6.6s", delay: "-7s" },
  },
  {
    // Upper right, furthest back on this side.
    src: "/hero-apps/product.png",
    width: 2480,
    height: 1560,
    alt: "Product page for a leather tote with colours, sizes and reviews",
    angle: 308,
    radius: 1.05,
    size: "w-[26vw] max-w-[480px]",
    mobile: null,
    show: "hidden lg:block",
    transform: "perspective(1400px) rotateZ(11deg) rotateY(-13deg) rotateX(3deg) scale(0.84)",
    opacity: 0.34,
    filter: "brightness(0.48) saturate(0.8) contrast(1.03)",
    layer: "z-[5]",
    float: { duration: "7.3s", delay: "-9s" },
  },
] as const;

const HERO_SECONDARY_ACTION_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 sm:whitespace-nowrap py-4 px-4 sm:px-5 bg-brandSurface hover:bg-brandSurfaceAccent border border-brandBorder rounded-pill text-sm font-semibold transition-all duration-300 hover:scale-[1.01] hover:border-brandGreen/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-brandGreen/40";

export default function LandingPage() {
  const router = useRouter();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalInitialStep, setAuthModalInitialStep] = useState<"options" | "email" | "phone" | "signin">("options");
  const [showGetStartedButton, setShowGetStartedButton] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  /* The floating surfaces are a desktop composition: on a handset they crowd
     the mark and the auth stack, so the ring is not drawn there at all. Not
     mounting rather than hiding keeps the six screenshots off a phone's
     connection entirely — a hidden <img> is still downloaded. */
  const wideEnoughForHeroApps = useMediaQuery("(min-width: 1024px)");
  /* Billing period is tracked per tier rather than for the section as a whole: each paid
     card carries its own Annual switch, so a visitor can price one plan yearly while
     leaving the others on the monthly rate they are comparing against. */
  const [annualTiers, setAnnualTiers] = useState<Record<string, boolean>>({});

  const toggleAnnualTier = (name: string) =>
    setAnnualTiers((current) => ({ ...current, [name]: !current[name] }));
  const heroAuthButtonsRowRef = useRef<HTMLDivElement | null>(null);

  // Redirect already-authenticated users straight to the dashboard.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/dashboard");
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/dashboard");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // The auth callback cannot render anything itself, so it hands failures back
  // on the URL. Show them once, then clear the parameter so a refresh is clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (!authError) return;

    alert(authError);
    params.delete("auth_error");
    const query = params.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [router]);

  useEffect(() => {
    const heroAuthButtonsRow = heroAuthButtonsRowRef.current;
    if (!heroAuthButtonsRow) return;

    const updateGetStartedVisibility = () => {
      setShowGetStartedButton(heroAuthButtonsRow.getBoundingClientRect().bottom <= 0);
    };

    updateGetStartedVisibility();
    window.addEventListener("scroll", updateGetStartedVisibility, { passive: true });
    window.addEventListener("resize", updateGetStartedVisibility);

    return () => {
      window.removeEventListener("scroll", updateGetStartedVisibility);
      window.removeEventListener("resize", updateGetStartedVisibility);
    };
  }, []);

  function openAuthModal(step: "options" | "email" | "phone" | "signin" = "options") {
    setAuthModalInitialStep(step);
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    setAuthModalOpen(false);
  }

  /** Returns a configured Supabase client, or null with an alert if env vars are missing. */
  function getSupabaseOrWarn() {
    if (!isSupabaseConfigured) {
      const missingVars = getMissingSupabaseEnvVars();
      // eslint-disable-next-line no-console
      console.error(describeMissingSupabaseEnvVars());
      alert(getSupabaseUnavailableMessage(missingVars));
      return null;
    }
    try {
      return createSupabaseBrowserClient();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to create Supabase browser client:", error);
      alert(getSupabaseClientCreationFailureMessage(error));
      return null;
    }
  }

  async function handleProviderAuth(provider: string) {
    const supabase = getSupabaseOrWarn();
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider.toLowerCase() as Provider,
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase OAuth sign-in error:", error);
        alert(error.message);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unexpected error during OAuth sign-in:", error);
      alert(
        "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.",
      );
    }
  }

  async function handleEmailSignUp(payload: { name: string; email: string; password: string }) {
    const supabase = getSupabaseOrWarn();
    if (!supabase) return;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          data: { full_name: payload.name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase sign-up error:", error);
        alert(error.message);
      } else if (!data.session) {
        // No session means the project requires email confirmation. Sending
        // them to the dashboard here would only bounce them back.
        alert(`Almost there — confirm your email. We sent a link to ${payload.email}; opening it signs you in.`);
        closeAuthModal();
      } else {
        router.push("/dashboard");
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unexpected error during sign-up:", error);
      alert(
        "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.",
      );
    }
  }

  async function handleEmailSignIn(payload: { email: string; password: string }) {
    const supabase = getSupabaseOrWarn();
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: payload.email,
        password: payload.password,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase sign-in error:", error);
        alert(error.message);
      } else {
        router.push("/dashboard");
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unexpected error during sign-in:", error);
      alert(
        "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.",
      );
    }
  }

  /** Normalises a dial code and local number into the E.164 form Supabase expects. */
  function toE164(dialCode: string, localNumber: string) {
    const code = dialCode.trim();
    const digits = localNumber.replace(/\D/g, "");
    if (!code || !digits) return null;
    return `${code}${digits}`;
  }

  /** Resolves true when the code was sent, which is what advances the modal. */
  async function handlePhoneContinue(payload: { name: string; dialCode: string; phone: string }) {
    const supabase = getSupabaseOrWarn();
    if (!supabase) return false;
    const phone = toE164(payload.dialCode, payload.phone);
    if (!phone) {
      alert("Please enter a valid dial code and phone number.");
      return false;
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { data: { full_name: payload.name } },
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase phone sign-in error:", error);
        alert(error.message);
        return false;
      }
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unexpected error during phone sign-in:", error);
      alert(
        "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.",
      );
      return false;
    }
  }

  /** Exchanges the SMS code for a session. Without this the code sent above goes nowhere. */
  async function handlePhoneVerify(payload: { dialCode: string; phone: string; token: string }) {
    const supabase = getSupabaseOrWarn();
    if (!supabase) return false;
    const phone = toE164(payload.dialCode, payload.phone);
    if (!phone) {
      alert("Please enter a valid dial code and phone number.");
      return false;
    }
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: payload.token,
        type: "sms",
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase phone verification error:", error);
        alert(error.message);
        return false;
      }
      router.push("/dashboard");
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unexpected error during phone verification:", error);
      alert(
        "Authentication is currently unavailable. Please verify Supabase environment configuration and try again later or contact support.",
      );
      return false;
    }
  }

  return (
    <div className="bg-brandBg text-white antialiased font-sans overflow-x-hidden selection:bg-brandGreen selection:text-black min-h-[100dvh] relative">
      <div className="noise-bg" />
      <div className="radial-vignette" />
      <div className="ambient-glow-1" />
      <div className="ambient-glow-2" />
      <ParticleCanvas />

      <header className="fixed top-0 left-0 w-full z-50 border-b border-brandBorder bg-brandBg/[0.72] backdrop-blur-xl">
        {/* px-6 wraps max-w-7xl here (rather than sitting inside it) so the header content
            column is identical to every <section> below — otherwise the wordmark renders
            24px further in than the feature/pricing cards it should line up with. */}
        <div className="px-6">
          {/* [1fr_auto_1fr] keeps the nav optically centred no matter how wide the logo or
              the CTA are, and the always-present third column reserves the CTA's space so
              the nav does not jump sideways when the button mounts on scroll. */}
          <div className="page-shell h-20 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <a href="#" className="justify-self-start -ml-2 flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40 rounded-full px-2" aria-label="QuickStart.Ai Homepage">
              <div className="w-10 h-10 relative overflow-hidden flex items-center justify-center"><Q3DCanvas scale={0.85} className="w-10 h-10 absolute pointer-events-none" /></div>
              <span className="text-xl font-bold tracking-tight"><span className="wordmark-quickstart metal-shimmer">QuickStart</span><span className="wordmark-ai">.Ai</span></span>
            </a>
            <nav className="hidden md:flex justify-self-center items-center gap-8 text-sm font-medium text-brandTextSec">
              <a href="#features" className="hover:text-white transition-colors duration-200">Features</a>
              <a href="#workflow" className="hover:text-white transition-colors duration-200">Workflow</a>
              <a href="#pricing" className="hover:text-white transition-colors duration-200">Pricing</a>
              <a href="#faq" className="hover:text-white transition-colors duration-200">FAQ</a>
            </nav>
            <div className="justify-self-end">
              {showGetStartedButton && (
                <button onClick={() => openAuthModal()} className="inline-flex items-center justify-center whitespace-nowrap bg-white text-black px-6 py-2.5 rounded-pill text-sm font-semibold hover:bg-brandGreen transition-all duration-300 hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40 shadow-sm">Get Started</button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 pt-20">
        {SHOW_SUPABASE_CONFIG_WARNING && (
          <section className="mx-auto mt-6 max-w-5xl px-6">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Authentication is disabled because Supabase environment variables are not configured for this deployment.
              Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.
            </div>
          </section>
        )}
        {/* min-h is the viewport minus the 5rem fixed header that <main> already offsets with
            pt-20. Using a bare min-h-screen made the hero 100vh *below* the header, which both
            pushed the block optically low and overflowed the fold on 900px/800px-tall laptops.
            svh (where supported) measures the viewport with mobile browser chrome *expanded*,
            so the auth block is not left under Safari's toolbars on a phone; vh stays as the
            fallback for browsers without svh. */}
        {/* .hero-shell carries the centring and the horizontal-only clip (see globals.css):
            the mark's halo reaches well above the mark itself, and the previous overflow-hidden
            sliced it off flat against the header, so only the inline axis may be clipped. */}
        <section className="hero-shell min-h-[calc(100dvh-5rem)] flex flex-col items-center px-6 relative pb-12 sm:pb-16">
          {/* The floating application surfaces sit behind everything else in the hero and
              take no pointer events, so they never intercept a click meant for the auth
              buttons. See HERO_APPS for what each one is and where it sits. */}
          {/* The floating application surfaces sit behind everything else in the hero and
              take no pointer events, so they never intercept a click meant for the auth
              buttons. Three elements each: the anchor pins the app to its point on the
              ring, the middle one drifts, and the image carries the ring's perspective —
              one element cannot hold both the drift and the rotation, since animating a
              transform would wipe the other out. See HERO_APPS for the ring itself. */}
          {wideEnoughForHeroApps && (
          <div className="hero-apps pointer-events-none absolute inset-0" aria-hidden="true">
            {HERO_APPS.map((app) => {
              const place = heroRingPosition(app.angle, app.radius);

              return (
                <div
                  key={app.src}
                  className={`hero-app-anchor absolute -translate-x-1/2 -translate-y-1/2 ${app.show} ${app.layer} ${app.size}`}
                  style={{
                    ["--m-left" as string]: app.mobile?.left ?? place.left,
                    ["--m-top" as string]: app.mobile?.top ?? place.top,
                    ["--d-left" as string]: place.left,
                    ["--d-top" as string]: place.top,
                  }}
                >
                  <div
                    className="hero-app"
                    style={{ animationDuration: app.float.duration, animationDelay: app.float.delay }}
                  >
                    <Image
                      src={app.src}
                      alt=""
                      width={app.width}
                      height={app.height}
                      sizes="(min-width: 1536px) 27vw, 25vw"
                      className="hero-app-surface h-auto w-full"
                      style={{
                        transform: app.transform,
                        opacity: app.opacity,
                        ...("filter" in app ? { filter: app.filter } : {}),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* 3D logo with oval spotlight backdrop */}
          <div className="q-logo-block relative flex items-center justify-center overflow-visible">
            <div
              className="absolute q-logo-backdrop pointer-events-none"
              style={{ inset: "-42%", zIndex: 0 }}
            />
            <div className="relative z-10 flex h-full w-full items-center justify-center overflow-visible">
              <Q3DCanvas scale={1.5} className="w-full h-full" withBackdrop />
            </div>
          </div>

          {/* Headline */}
          <div className="max-w-4xl lg:max-w-6xl 3xl:max-w-[96rem] text-center mx-auto hero-lede z-20 reveal-element active">
            {/* Each line is its own block so `text-balance` can even out its wrap on its own.
                With the previous <br /> the browser treated both lines as one inline flow and
                balancing was skipped, which left "Minutes" orphaned on a third line. The size
                ramp is graded so the green line lands on one row from 1024px up. */}
            <h1 className="text-balance text-3xl md:text-4xl 2xl:text-5xl 3xl:text-6xl font-bold tracking-tighter leading-[1.15] text-white">
              <span className="block metal-shimmer">Build Full-Stack</span>
              <span className="block" style={{ color: "#70F39B" }}>Web &amp; Mobile Apps in Minutes</span>
            </h1>
          </div>

          {/* Auth area — ref on this div so sticky header CTA appears once it scrolls out of view */}
          <div id="signup" ref={heroAuthButtonsRowRef} className="w-full max-w-md sm:max-w-lg 3xl:max-w-2xl mx-auto z-20 reveal-element active">
            <div className="hero-auth-stack">
              <ProviderButton loadingLabel="Authorization Pending..." onProviderAuth={handleProviderAuth} provider="Google" className="w-full inline-flex items-center justify-center gap-2 bg-white text-black py-4 px-6 rounded-pill text-base font-semibold transition-all duration-300 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 shadow-lg group">
                <GoogleIcon className={PROVIDER_ICON_CLASS} />
                <span>Continue with Google</span>
              </ProviderButton>
              <div className="grid grid-cols-3 gap-3">
                <ProviderButton loadingLabel="Authorization Pending..." onProviderAuth={handleProviderAuth} provider="GitHub" className="inline-flex items-center justify-center gap-2 py-3.5 px-3 bg-brandSurface hover:bg-brandSurfaceAccent border border-brandBorder rounded-pill text-sm font-medium transition-all duration-300 hover:scale-[1.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"><GitHubIcon className={`${PROVIDER_ICON_CLASS} text-brandGreen`} /><span>GitHub</span></ProviderButton>
                <ProviderButton loadingLabel="Authorization Pending..." onProviderAuth={handleProviderAuth} provider="Apple" className="inline-flex items-center justify-center gap-2 py-3.5 px-3 bg-brandSurface hover:bg-brandSurfaceAccent border border-brandBorder rounded-pill text-sm font-medium transition-all duration-300 hover:scale-[1.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"><Apple className={`${PROVIDER_ICON_CLASS} text-white`} /><span>Apple</span></ProviderButton>
                <ProviderButton loadingLabel="Authorization Pending..." onProviderAuth={handleProviderAuth} provider="Facebook" className="inline-flex items-center justify-center gap-2 py-3.5 px-3 bg-brandSurface hover:bg-brandSurfaceAccent border border-brandBorder rounded-pill text-sm font-medium transition-all duration-300 hover:scale-[1.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"><FacebookIcon className={PROVIDER_ICON_CLASS} /><span>Facebook</span></ProviderButton>
              </div>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-white/15" />
                <span className="text-white/45 text-xs sm:text-sm font-medium tracking-widest">OR</span>
                <div className="flex-1 h-px bg-white/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => openAuthModal("email")} className={HERO_SECONDARY_ACTION_BUTTON_CLASS}><Mail className={`${PROVIDER_ICON_CLASS} text-white/80`} /><span>Continue with Email</span></button>
                <button type="button" onClick={() => openAuthModal("phone")} className={HERO_SECONDARY_ACTION_BUTTON_CLASS}><Phone className={`${PROVIDER_ICON_CLASS} text-white/80`} /><span>Continue with Phone</span></button>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="px-6 py-24">
          <div className="page-shell space-y-12">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-brandGreen">What is QuickStart.Ai</p>
              <h2 className="mt-4 text-2xl md:text-3xl 2xl:text-4xl 3xl:text-5xl font-bold tracking-tight text-white">
                What can QuickStart.Ai do for you?
              </h2>
              <p className="mt-5 text-base sm:text-lg leading-relaxed text-brandTextSec">
                Instantly generate native mobile applications, progressive web apps, production APIs, schema-perfect databases, authentication architectures, AI agents, secure cloud storage, and fully automated deployment configurations using simple natural language.
              </p>
            </Reveal>

            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
              {/* Capability list: the selected row opens to reveal its description, the rest
                  stay as single title rows separated by a hairline. */}
              <Reveal>
                <ul className="flex flex-col">
                  {FEATURES.map((feature, index) => {
                    const Icon = feature.icon;
                    const isActive = index === activeFeature;
                    const panelId = `feature-panel-${index}`;

                    return (
                      // The hairline separates rows, so the last one never carries it.
                      <li
                        key={feature.title}
                        className={!isActive && index < FEATURES.length - 1 ? "border-b border-brandBorder" : ""}
                      >
                        <div className={isActive ? "rounded-premium border border-brandGreen/40 bg-brandSurface p-5 sm:p-6" : ""}>
                          <button
                            type="button"
                            onClick={() => setActiveFeature(index)}
                            aria-expanded={isActive}
                            aria-controls={panelId}
                            className={`flex w-full items-center gap-3 text-left transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen ${isActive ? "" : "py-5 hover:text-white"}`}
                          >
                            <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-brandGreen" : "text-white/60"}`} />
                            <span className={`text-lg font-semibold tracking-tight sm:text-xl ${isActive ? "text-brandGreen" : "text-white/85"}`}>
                              {feature.title}
                            </span>
                          </button>

                          {isActive && (
                            <div id={panelId}>
                              <p className="mt-3 text-sm leading-relaxed text-brandTextSec sm:text-base">{feature.desc}</p>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Reveal>

              {/* All three panels are rendered and cross-faded rather than swapped, so
                  selecting a row never shows an empty frame while its image decodes. A plain
                  <img> keeps all three in the markup at once, which the optimiser's one-image
                  -per-render model does not express. */}
              <Reveal>
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-premium border border-brandBorder bg-brandSurface">
                  {FEATURES.map((feature, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={feature.title}
                      src={feature.image}
                      alt={feature.alt}
                      aria-hidden={index !== activeFeature}
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${index === activeFeature ? "opacity-100" : "opacity-0"}`}
                    />
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="pricing" className="px-6 py-24">
          <div className="page-shell space-y-10">
            <Reveal className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-brandGreen">Pricing</p>
                <h2 className="mt-4 text-2xl md:text-3xl 2xl:text-4xl 3xl:text-5xl font-bold tracking-tight text-white">
                  Choose the plan that fits your build velocity.
                </h2>
                <p className="mt-5 text-base sm:text-lg leading-relaxed text-brandTextSec">
                  Dark, cinematic, and built to scale with the same QuickStart.Ai product experience you see above.
                </p>
              </div>

              {/* Replaces the old section-wide "Annual Soon" placeholder: the switch now lives on
                  each paid card, so this line only has to say what those switches do. */}
              <p className="inline-flex shrink-0 items-center gap-2 self-start rounded-pill border border-brandBorder bg-brandSurface px-4 py-2 text-sm font-semibold text-brandTextSec lg:self-auto">
                <span className="text-brandGreen">Save 20%</span>
                <span className="whitespace-nowrap">with annual billing</span>
              </p>
            </Reveal>

            <div className="grid gap-6 lg:grid-cols-3">
              {PRICING_TIERS.map((tier) => {
                const Icon = tier.icon;
                // Only paid tiers can be billed annually — $0 has no yearly equivalent to offer.
                const canBillAnnually = tier.monthlyPrice > 0;
                const isAnnual = canBillAnnually && Boolean(annualTiers[tier.name]);
                const perMonthPrice = isAnnual ? tier.monthlyPrice * (1 - ANNUAL_DISCOUNT) : tier.monthlyPrice;
                const yearlyTotal = perMonthPrice * 12;

                return (
                  <Reveal key={tier.name} className="h-full min-w-0">
                    <article
                      className={`glass-card rounded-premium relative flex h-full flex-col p-6 sm:p-8 ${tier.highlight ? "pro-glow-border border border-brandGreen/40 shadow-[0_25px_80px_-40px_rgba(142,240,138,0.55)] lg:-translate-y-3" : ""}`}
                    >
                      {/* The badge row is rendered for every tier (hidden, not omitted, on the
                          non-highlighted ones) so plan names, prices, feature lists and CTAs
                          share a baseline across the row. */}
                      <span
                        aria-hidden={!tier.highlight}
                        className={`mb-6 inline-flex w-fit rounded-pill border px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${tier.highlight ? "border-brandGreen/30 bg-brandGreen/10 text-brandGreen" : "invisible border-transparent"}`}
                      >
                        Most Popular
                      </span>

                      {/* Plan name, its glyph and the billing switch share one row. The glyph sits
                          inline rather than in its own top-right block so the switch has room to
                          sit beside it. In the 1024-1279px band the cards are too narrow even for
                          that, so there the switch drops onto its own line — on every card, the
                          hidden one on Free included, so the rows stay the same height. */}
                      <div className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:flex-col lg:items-start lg:gap-3 xl:flex-row xl:items-center">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <h3 className="text-2xl font-semibold text-white">{tier.name}</h3>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brandBorder bg-brandSurface text-brandGreen">
                            <Icon className="h-4 w-4" />
                          </span>
                        </div>

                        {/* Rendered on every card and only hidden on Free, so the name rows keep a
                            shared baseline across the row. */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isAnnual}
                          aria-hidden={!canBillAnnually}
                          tabIndex={canBillAnnually ? undefined : -1}
                          disabled={!canBillAnnually}
                          aria-label={`Bill the ${tier.name} plan annually`}
                          onClick={() => toggleAnnualTier(tier.name)}
                          /* -my-2.5/py-2.5 grows the touch target to ~40px tall while the row
                             keeps measuring the switch at its drawn height. */
                          className={`group -my-2.5 inline-flex shrink-0 items-center gap-2 rounded-pill py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40 ${canBillAnnually ? "" : "invisible"}`}
                        >
                          <span
                            className={`text-sm font-semibold transition-colors duration-200 ${isAnnual ? "text-brandGreen" : "text-brandTextSec group-hover:text-white/80"}`}
                          >
                            Annual
                          </span>
                          <span
                            className={`relative h-5 w-9 shrink-0 rounded-pill transition-colors duration-200 ${isAnnual ? "bg-brandGreen" : "bg-white/15"}`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200 ${isAnnual ? "left-[1.125rem]" : "left-0.5"}`}
                            />
                          </span>
                        </button>
                      </div>

                      {/* The three descriptions wrap to different line counts, which pushes each
                          card's price row to a different height. Reserving the tallest at each
                          band — 5 lines where the cards are narrowest, 3 from xl up — keeps the
                          prices, feature lists and CTAs on a shared baseline across the row. */}
                      <p className="mt-3 text-sm leading-relaxed text-brandTextSec lg:min-h-[8.125em] xl:min-h-[4.875em]">{tier.description}</p>

                      <div className="mt-8">
                        <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
                          <span className="text-5xl font-bold tracking-tight text-white">{formatPrice(perMonthPrice)}</span>
                          <span className="pb-1 text-sm font-medium text-brandGreen">/ month</span>
                          {isAnnual ? (
                            <span className="pb-1 text-sm font-medium text-white/40 line-through">{formatPrice(tier.monthlyPrice)}</span>
                          ) : null}
                        </div>
                        {/* Reserved on every card so the feature lists below stay on a shared
                            baseline whichever billing period each card is showing. */}
                        <p className="mt-2 min-h-[1.25rem] text-xs font-medium text-brandTextSec">
                          {!canBillAnnually
                            ? "Free forever — no card required"
                            : isAnnual
                              ? `Billed annually at ${formatPrice(yearlyTotal)} — save 20%`
                              : "Billed monthly"}
                        </p>
                      </div>

                      <div className="mt-8 flex-1">
                        <ul className="space-y-4 text-sm text-brandTextSec">
                          {/* Placeholder pricing features only — replace these with final tier details once confirmed. */}
                          {tier.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-3">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brandGreen/10 text-brandGreen">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                              <span className="leading-relaxed">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={() => openAuthModal()}
                        className={`mt-8 inline-flex w-full items-center justify-center rounded-pill px-5 py-3.5 text-sm font-semibold transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40 ${tier.highlight ? "bg-brandGreen text-black hover:bg-white" : "border border-brandBorder bg-brandSurface text-white hover:border-brandGreen/40 hover:bg-brandSurfaceAccent"}`}
                      >
                        {tier.ctaLabel}
                      </button>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section id="faq" className="font-display px-6 py-24">
          <div className="page-shell space-y-12">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-brandGreen">FAQ</p>
              <h2 className="mt-4 text-2xl md:text-3xl 2xl:text-4xl 3xl:text-5xl font-bold tracking-tight text-white">
                Questions people ask before they build.
              </h2>
              <p className="mt-5 text-base sm:text-lg leading-relaxed text-brandTextSec">
                What QuickStart.Ai builds for you, what it connects to, and what it costs — answered in plain words.
              </p>
            </Reveal>

            {/* Open list rather than a panel: the questions sit straight on the section
                background, separated only by hairlines, so the row a visitor opens reads as
                part of the page instead of a card stacked on top of it. */}
            <Reveal className="mx-auto w-full max-w-4xl">
              <ul className="flex flex-col">
                {FAQS.map((faq, index) => {
                  const isOpen = index === openFaq;
                  const panelId = `faq-panel-${index}`;

                  return (
                    // The hairline separates rows, so the last one never carries it.
                    <li key={faq.question} className={index < FAQS.length - 1 ? "border-b border-brandBorder" : ""}>
                      <h3>
                        <button
                          type="button"
                          onClick={() => setOpenFaq(isOpen ? null : index)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          className="flex w-full items-center justify-between gap-8 py-7 text-left transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen sm:py-8"
                        >
                          <span className={`text-lg font-medium tracking-normal sm:text-xl ${isOpen ? "text-brandGreen" : "text-white"}`}>
                            {faq.question}
                          </span>
                          <ChevronDown
                            className={`h-5 w-5 shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180 text-brandGreen" : "text-white/60"}`}
                          />
                        </button>
                      </h3>

                      {isOpen && (
                        <div id={panelId} className="pb-7 sm:pb-8 sm:pr-12">
                          <p className="text-[15px] font-normal leading-[1.75] tracking-normal text-brandTextSec sm:text-base">{faq.answer}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* Closing call to action, built on the composed artwork at /page.png — wordmark,
            headline, promise and a painted button are all in the image, so nothing is drawn
            over it. Narrow screens crop in rather than swap to different markup: the frame
            turns square, the artwork keeps its own 16:9 inside it, and the sides are clipped
            evenly. 56% of the width stays visible, which clears the headline's 50% reach, and
            the type lands close to twice the size it would if the whole width were squeezed
            into a phone. The corner marks are the only thing the crop loses. Every figure
            here — including the hotspot, a percentage of the artwork rather than of the
            frame, so cropping moves it with the painted button — is measured off the file
            and has to be re-measured whenever the artwork is replaced. */}
        <section id="get-started" className="relative overflow-hidden">
          <div className="relative w-full overflow-hidden aspect-square sm:aspect-[1672/941]">
            <div className="absolute left-1/2 top-1/2 h-full aspect-[1672/941] -translate-x-1/2 -translate-y-1/2">
              <Image
                src="/page.png"
                alt="Start building on QuickStart.Ai today — turn your ideas into fully functional apps, faster than ever."
                width={1672}
                height={941}
                sizes="(min-width: 640px) 100vw, 178vw"
                className="h-full w-full"
                priority
              />
              <button
                type="button"
                onClick={() => openAuthModal("email")}
                style={{ left: "41.27%", top: "43.25%", width: "17.40%", height: "7.12%" }}
                className="absolute rounded-pill transition-shadow duration-300 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.65)] focus:outline-none focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.9)]"
              >
                <span className="sr-only">Get Started</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-brandBorder px-6 py-14">
        <div className="page-shell flex flex-col gap-x-8 gap-y-12 xl:flex-row xl:items-start xl:justify-between">
          <Reveal className="max-w-sm xl:max-w-xs">
            <a href="#" className="inline-flex items-center gap-3 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40" aria-label="QuickStart.Ai Homepage">
              <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden">
                <Q3DCanvas scale={0.8} className="absolute h-10 w-10 pointer-events-none" />
              </div>
              <span className="text-xl font-bold tracking-tight">
                <span className="wordmark-quickstart">QuickStart</span><span className="wordmark-ai">.Ai</span>
              </span>
            </a>
            <p className="mt-5 text-sm leading-relaxed text-brandTextSec">
              Build Full-Stack <span className="text-brandGreen">Web &amp; Mobile Apps in Minutes</span> with one cohesive platform for product generation, infrastructure, and launch-ready workflows.
            </p>
          </Reveal>

          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {FOOTER_LINK_COLUMNS.map((column) => (
              <Reveal key={column.title}>
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">{column.title}</h3>
                  <ul className="mt-4 space-y-3">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a href={link.href} className="text-sm text-brandTextSec transition-colors duration-200 hover:text-brandGreen">
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}

            <Reveal>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">Social</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { label: "GitHub", icon: GitHubIcon },
                    { label: "X", icon: X },
                    { label: "Twitter", icon: Twitter },
                    { label: "Slack", icon: Slack },
                  ].map((social) => {
                    const Icon = social.icon;

                    return (
                      <a
                        key={social.label}
                        href="#"
                        aria-label={social.label}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brandBorder bg-brandSurface text-white/70 transition-all duration-300 hover:border-brandGreen/40 hover:text-brandGreen"
                      >
                        <Icon className="h-4 w-4" />
                      </a>
                    );
                  })}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </footer>

      <LoginModal
        isOpen={authModalOpen}
        onClose={closeAuthModal}
        onProviderAuth={handleProviderAuth}
        onEmailSignUp={handleEmailSignUp}
        onEmailSignIn={handleEmailSignIn}
        onPhoneContinue={handlePhoneContinue}
        onPhoneVerify={handlePhoneVerify}
        initialStep={authModalInitialStep}
      />

      <style>{`
        .noise-bg { position: fixed; top: -50%; left: -50%; right: -50%; bottom: -50%; width: 200%; height: 200%; opacity: 0.8; pointer-events: none; z-index: 999; animation: noise-anim 0.2s infinite; }
        @keyframes noise-anim { 0% { transform: translate(0,0) } 10% { transform: translate(-1%,-1%) } 20% { transform: translate(-2%,1%) } 30% { transform: translate(1%,-2%) } 40% { transform: translate(-1%,3%) } 50% { transform: translate(-1%,1%) } 60% { transform: translate(3%,-1%) } 70% { transform: translate(2%,1%) } 80% { transform: translate(-2%,-1%) } 90% { transform: translate(1%,3%) } 100% { transform: translate(1%,-2%) } }
        .radial-vignette { position: fixed; inset: 0; background: radial-gradient(circle at center, transparent 30%, rgba(9, 9, 9, 0.9) 100%); pointer-events: none; z-index: 10; }
        .ambient-glow-1 { position: absolute; top: 15%; left: 20%; width: 45vw; height: 45vw; background: radial-gradient(circle, rgba(142, 240, 138, 0.03) 0%, transparent 70%); pointer-events: none; filter: blur(80px); z-index: 1; animation: slow-drift-1 25s infinite alternate ease-in-out; }
        .ambient-glow-2 { position: absolute; bottom: 20%; right: 15%; width: 50vw; height: 50vw; background: radial-gradient(circle, rgba(255, 255, 255, 0.02) 0%, transparent 75%); pointer-events: none; filter: blur(100px); z-index: 1; animation: slow-drift-2 30s infinite alternate ease-in-out; }
        @keyframes slow-drift-1 { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(50px, -40px) scale(1.1); } }
        @keyframes slow-drift-2 { 0% { transform: translate(0, 0) scale(1.1); } 100% { transform: translate(-60px, 50px) scale(0.9); } }
        .reveal-element { opacity: 0; transform: translateY(30px) scale(0.97); filter: blur(8px); transition: opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1), transform 1.2s cubic-bezier(0.16, 1, 0.3, 1), filter 1.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .reveal-element.active { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
      `}</style>
    </div>
  );
}
