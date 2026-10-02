/* The five tabs above the composer, and what each one does to a build.
 *
 * A tab is a CATEGORY: Web App, Website, Fliers, Video, Mobile App. Inside it
 * sits a SUB-TYPE — a CRM under Web App, a blog under Website, a story graphic
 * under Fliers — read from the sentence unless somebody picked one. Neither is
 * a new blueprint. Each sub-type is built on one of the five build kinds
 * (kinds.ts), which own the schema, the auth and the deploy; the target adds
 * the rules that kind cannot know on its own — a poster's aspect ratio, a
 * reel's 9:16, a phone's 44px touch targets. Those rules go into the build
 * prompt, never into the person's own message.
 *
 * Fliers, Video and native Mobile are built as what a browser can run and
 * show, and say so where they are chosen: a poster page at its exact size, an
 * animated storyboard that plays in the preview, an installable mobile web
 * app. An MP4 or an App Store binary is not something this builder produces,
 * and a tab that implied otherwise would be the worst kind of promise.
 *
 * Pure, like kinds.ts: read by the browser bundle (the tabs and their chips)
 * and by the build route, and compiled on its own by tools/check-targets.mjs. */

import { heuristicKind, type BuildKind } from "./kinds";

export const CATEGORIES = ["web_app", "website", "fliers", "video", "mobile_app"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  web_app: "Web App",
  website: "Website",
  fliers: "Fliers",
  video: "Video",
  mobile_app: "Mobile App",
};

export type SubType = {
  id: string;
  label: string;
  /** Which blueprint it is built on. */
  kind: BuildKind;
  /** What it is, in a line — the chip's tooltip and the chat's narration. */
  blurb: string;
  /** Read from the brief when nobody picked a sub-type. Absent on the default. */
  match?: RegExp;
  /** The under-the-hood rules this sub-type adds to its category's. */
  focus: string[];
};

/* Order matters twice: it is the chip order, and the FIRST entry is the
   category's default when nothing in the sentence points elsewhere. Matching
   also goes in this order, which is why a social post comes before a promo
   banner: "an instagram story for our sale" names its format and its content,
   and the format is what decides the canvas. */
export const SUBTYPES: Record<Category, SubType[]> = {
  web_app: [
    {
      id: "saas_dashboard",
      label: "Dashboard",
      kind: "webapp",
      blurb: "CRM, analytics, admin panels, billing portals",
      focus: [
        "A signed-in product: a dashboard home with real figures read from the database, list and detail views, create/edit/delete forms that write to the database.",
        "Navigation is a persistent sidebar or top bar; tables are sortable and searchable; empty states say what to do first.",
      ],
    },
    {
      id: "ecommerce_platform",
      label: "Store platform",
      kind: "ecommerce",
      blurb: "Store logic, inventory, checkout",
      match: /\b(e[- ]?comm?erce|online (?:store|shop)|storefront|marketplace|inventory|checkout|cart|sell(?:ing)? (?:products|online))\b/i,
      focus: [
        "Full store logic: products and stock in the database, a cart that survives a reload, a checkout that adds up, orders recorded against the buyer.",
        "An admin side to manage products, stock levels and orders.",
      ],
    },
    {
      id: "custom_tool",
      label: "Custom tool",
      kind: "webapp",
      blurb: "Utilities, API wrappers, internal tools",
      match: /\b(tool|utility|converter|calculator|generator|tracker|planner|api wrapper|wrapper|internal|automation|scheduler|timer|checker)\b/i,
      focus: [
        "One job done well: the tool's main action is on the first screen, its result is shown immediately, and its inputs are validated with clear errors.",
        "Keep sign-in only if the brief needs saved data or more than one user; a single-purpose tool should not demand an account.",
      ],
    },
  ],
  website: [
    {
      id: "landing_page",
      label: "Landing page",
      kind: "landing",
      blurb: "Hero, features, call to action, lead capture",
      focus: [
        "One page, one offer: a hero that states it, a feature list, social proof, and one call to action repeated, ending in a lead capture form.",
      ],
    },
    {
      id: "blog",
      label: "Blog",
      kind: "blog",
      blurb: "Articles, authors, reading time",
      match: /\b(blog|articles?|posts?|writing|journal|essays?|newsletter)\b/i,
      focus: [
        "An article listing, article pages rendered from Markdown-style rich text, author name and avatar, publish date and an estimated reading time on every article.",
      ],
    },
    {
      id: "storefront",
      label: "Storefront",
      kind: "ecommerce",
      blurb: "Product showcase, grids, cart",
      match: /\b(e[- ]?comm?erce|online (?:store|shop)|storefront|web ?shop|products?|catalog(?:ue)?|merch|boutique)\b/i,
      focus: [
        "A showcase first: product grids with real photographs, product pages, a cart drawer. Fast and browsable before it is transactional.",
      ],
    },
    {
      id: "news_magazine",
      label: "News / magazine",
      kind: "news",
      blurb: "Categorised feed, trending, sections",
      match: /\b(news|magazine|headlines?|newsroom|journalism|press|gazette|times|tribune|daily|editorial)\b/i,
      focus: [
        "A front page that ranks stories: a lead story, a categorised grid, a feed, and a trending section; every section has its own page.",
      ],
    },
  ],
  fliers: [
    {
      id: "event_flyer",
      label: "Event flyer",
      kind: "landing",
      blurb: "Party, concert, webinar or conference poster",
      focus: [
        "A poster for one event: the event name as the dominant headline, then date, time, venue (or link), the act or speakers, price or RSVP, in that order of size.",
        "Default to A4 portrait (1:√2, 794×1123px) unless the brief names another size.",
      ],
    },
    {
      id: "social_post",
      label: "Social post",
      kind: "landing",
      blurb: "Square 1:1 or Story 9:16 graphics",
      match: /\b(instagram|insta|social|facebook|linkedin|tiktok|story|stories|post|carousel|1:1|9:16|4:5|square|whatsapp status)\b/i,
      focus: [
        "Square 1080×1080 for a post, 1080×1350 (4:5) for a portrait feed post, 1080×1920 (9:16) for a story — pick the one the brief names, square if it names none.",
        "Keep text inside the central safe area (no text in the top and bottom 14% of a story).",
      ],
    },
    {
      id: "marketing_banner",
      label: "Promo banner",
      kind: "landing",
      blurb: "Ad banners and sales promo cards",
      match: /\b(banner|ad|advert|promo|sale|discount|offer|% ?off|black friday|deal|leaderboard|billboard)\b/i,
      focus: [
        "A promotion read in two seconds: the offer (number first, e.g. \"40% OFF\"), one line of support, one call to action, the brand mark.",
        "Default to a 1200×628 landscape banner unless the brief names another size.",
      ],
    },
  ],
  video: [
    {
      id: "product_launch",
      label: "Product launch",
      kind: "landing",
      blurb: "Commercials and announcements",
      focus: [
        "A 30–45 second commercial in 6–8 scenes: hook, problem, reveal, three benefits, offer, end card with the call to action.",
        "16:9 landscape unless the brief says vertical.",
      ],
    },
    {
      id: "social_reel",
      label: "Social reel",
      kind: "landing",
      blurb: "TikTok, Reels and Shorts, vertical 9:16",
      match: /\b(reel|reels|tiktok|shorts?|vertical|9:16|instagram|snap(chat)?|story)\b/i,
      focus: [
        "Vertical 9:16, 15–30 seconds, 5–7 fast scenes; the hook lands in the first 2 seconds; on-screen captions for every line because most people watch muted.",
      ],
    },
    {
      id: "explainer_video",
      label: "Explainer",
      kind: "landing",
      blurb: "Tutorials and step-by-step walkthroughs",
      match: /\b(explain(er)?|tutorial|how[- ]to|walkthrough|walk[- ]through|step[- ]by[- ]step|guide|onboarding|demo|presentation|lesson|course)\b/i,
      focus: [
        "60–90 seconds, one scene per step, each step numbered on screen, a recap scene at the end. 16:9 landscape.",
      ],
    },
  ],
  mobile_app: [
    {
      id: "pwa",
      label: "Mobile web app",
      kind: "webapp",
      blurb: "Installable, mobile-first, works in any phone browser",
      focus: [
        "An installable Progressive Web App: a web app manifest (name, icons, theme colour, display: standalone) and the meta tags that let it be added to a home screen.",
      ],
    },
    {
      id: "native_mobile",
      label: "Native-style app",
      kind: "webapp",
      blurb: "Native look and feel, delivered as an installable app",
      match: /\b(react native|flutter|native|ios|iphone|android|app store|play store|swift|kotlin)\b/i,
      focus: [
        "The person asked for a native app. Build it as an installable PWA that looks and behaves like one — native-style headers, sheets that slide up, list rows with chevrons, haptic-feeling press states — and say once, in the app's README, that a React Native or Flutter export is not part of this build.",
      ],
    },
  ],
};

/* What every sub-type in a category gets — the spec's "under the hood". */
const CATEGORY_FOCUS: Record<Category, string[]> = {
  web_app: [
    "Full-stack: authentication, a real database schema with row-level security, server-side actions for anything that writes, and client state that reflects what the database holds after every write.",
    "Every screen reads live data; nothing that looks saved is only kept in memory.",
  ],
  website: [
    "Responsive at every width with Tailwind, phone first.",
    "SEO: a unique <title> and meta description per page, Open Graph tags, one <h1> per page, descriptive alt text.",
    "Semantic HTML: <header>, <nav>, <main>, <article>, <section>, <footer> where they belong.",
    "Fast: no heavy libraries for what CSS can do, images sized and lazy-loaded below the fold, clean readable typography with a clear type scale.",
  ],
  fliers: [
    "THIS IS A FLIER, NOT A WEBSITE. The page is the artwork: one fixed-size canvas, centred on a neutral backdrop, at the exact pixel size and aspect ratio named below — no navigation, no footer, no sections to scroll, no lead form.",
    "The canvas keeps its aspect ratio at any window width (scale it down with CSS, never reflow it), so what is on screen is what will be exported.",
    "Poster layout: a strong grid, one dominant headline, high-contrast typography (contrast ratio of at least 7:1 for the key line), at most two typefaces, generous margins.",
    "A background visual: use a resolved photograph or a rich CSS gradient/shape composition; in a code comment at the top, write a one-paragraph image-generation prompt for the background asset so it can be regenerated.",
    "Under the canvas, outside the artwork, a small \"Download PNG\" button that renders the canvas to an image in the browser (html-to-image from a CDN, or an equivalent), and the canvas size printed beside it.",
  ],
  video: [
    "THIS IS A VIDEO, BUILT AS AN ANIMATED STORYBOARD THAT PLAYS IN THE BROWSER. The page is a player: a fixed-aspect stage that plays the scenes in order with motion (CSS/JS animations — entrances, pans, text reveals, transitions), with play/pause, a progress bar and a scene list to jump between.",
    "Scene-by-scene script: every scene has a number, a duration in seconds, what is on screen, the on-screen text, the camera/shot note (wide, close-up, pan, zoom) and the voiceover line. The stage shows the visuals and captions; a panel beside or below it shows the full script and shot list.",
    "For every scene, a motion-generation prompt (for a text-to-video model) written out in the shot list, so each scene can be rendered as real footage later.",
    "Total running time is the sum of the scene durations and is shown on the player.",
    "No navigation, no marketing sections, no forms — the player and its script are the whole page.",
  ],
  mobile_app: [
    "Mobile first: designed at 390px wide and centred in a phone-width column on larger screens.",
    "Touch: every tap target at least 44×44px, bottom tab navigation for the main sections (3–5 tabs, icon and label), primary actions within thumb reach at the bottom.",
    "Gestures where a phone user expects them: swipe to dismiss sheets, pull to refresh lists, horizontal swipe on carousels.",
    "Respect the viewport: viewport meta with viewport-fit=cover, safe-area insets (env(safe-area-inset-*)) on the top bar and tab bar, no horizontal scroll, no hover-only controls.",
  ],
};

export type Target = { category: Category; subtype: string | null };

export type ResolvedTarget = {
  category: Category;
  subtype: SubType;
  /** Whether the sub-type was picked rather than read from the brief. */
  picked: boolean;
  kind: BuildKind;
};

/** "web_app" or "web_app:saas_dashboard", from a URL or a request body. */
export function parseTarget(value: unknown): Target | null {
  if (typeof value !== "string") return null;
  const [category, subtype] = value.split(":");
  if (!isCategory(category)) return null;
  const known = subtype && SUBTYPES[category].some((entry) => entry.id === subtype) ? subtype : null;
  return { category, subtype: known };
}

export function formatTarget(target: Target): string {
  return target.subtype ? `${target.category}:${target.subtype}` : target.category;
}

/* The sub-type the sentence points at. Website leans on the kind classifier,
   which already weighs "a landing page for my shop" correctly; the other
   categories are read by their own patterns, first match wins in list order. */
export function inferSubtype(category: Category, brief: string): SubType {
  const options = SUBTYPES[category];
  if (category === "website") {
    const read = heuristicKind(brief);
    const byKind = read ? options.find((entry) => entry.kind === read.kind) : null;
    if (byKind) return byKind;
  }
  return options.find((entry) => entry.match?.test(brief)) ?? options[0];
}

export function resolveTarget(target: Target, brief: string): ResolvedTarget {
  const picked = target.subtype ? SUBTYPES[target.category].find((entry) => entry.id === target.subtype) : null;
  const subtype = picked ?? inferSubtype(target.category, brief);
  return { category: target.category, subtype, picked: Boolean(picked), kind: subtype.kind };
}

/* The category a tab-less brief belongs to — so the tab can follow what is
   typed until somebody clicks one. Null when nothing is confident enough to
   move a tab. */
export function categoryFor(brief: string): Category | null {
  if (/\b(flyer|flier|poster|banner|instagram post|social (media )?post|story graphic|thumbnail|invitation card)\b/i.test(brief)) return "fliers";
  if (/\b(video|reel|tiktok|youtube short|commercial|animation|animated explainer|trailer)\b/i.test(brief)) return "video";
  if (/\b(mobile app|phone app|ios app|android app|react native|flutter|app store|play store|pwa)\b/i.test(brief)) return "mobile_app";
  const read = heuristicKind(brief);
  if (!read || read.confidence < 0.8) return null;
  return read.kind === "webapp" ? "web_app" : "website";
}

/** The block the build prompt carries. Overrules the blueprint where they disagree. */
export function targetBrief(resolved: ResolvedTarget): string {
  const rules = [...CATEGORY_FOCUS[resolved.category], ...resolved.subtype.focus];
  return `TARGET — ${CATEGORY_LABEL[resolved.category]} › ${resolved.subtype.label} (${resolved.subtype.blurb}).
Where these rules disagree with the blueprint above, these win:
${rules.map((rule) => `- ${rule}`).join("\n")}`;
}

/* Said where the tab is chosen, so nobody expects what is not made. Only the
   categories whose output is a stand-in carry one. */
export const CATEGORY_NOTE: Partial<Record<Category, string>> = {
  fliers: "Built at its exact print or post size, with a Download PNG button.",
  video: "Plays as an animated storyboard with script, shot list and voiceover. MP4 export is not available yet.",
  mobile_app: "Built as an installable mobile app that runs in any phone browser.",
};
