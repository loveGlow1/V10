"use client";

/* Which theme the app is drawn in.

   Three settings, not two: "system" is a real answer rather than a default, and
   it keeps following the OS after it is chosen — a phone that darkens at sunset
   darkens this with it. "dark" and "light" pin it.

   The choice is stored per browser, since it is a property of the screen you are
   looking at rather than of the account: the same person wants dark on a laptop
   at night and light on a phone outdoors. */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "quickstark.theme";

/* What someone gets before they have said anything.
 *
 * Dark, flatly — not "system". This app is a dark product: the marketing page,
 * the 3D canvas, the workspace and every screenshot of it are drawn on the dark
 * ground, and that is the thing being shipped. Defaulting to "system" handed a
 * light-mode laptop the light palette on first load, which meant most people's
 * first impression was the theme nobody designed against and nobody had asked
 * for. An OS-wide preference is a preference about operating systems, not a
 * request for this app to look different from itself.
 *
 * Light is one press away and it sticks, and "Match system" is still there for
 * anyone who genuinely wants the OS to drive it. Both are choices someone makes;
 * neither is imposed on them before they arrive. */
export const DEFAULT_THEME: ThemeChoice = "dark";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** What "system" resolves to right now. */
export function systemTheme(): "light" | "dark" {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? systemTheme() : choice;
}

/* Written on <html> rather than <body>: the palette has to be in scope for
   anything portalled to the body, and for the space beyond the page that
   `color-scheme` paints. Dark is the default, so it carries no attribute — the
   :root palette is already the dark one and an attribute for it would only be
   a second way to say the same thing. */
export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  if (resolved === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  applyBrowserChrome(resolved);
}

/* Runs before the first paint, inlined into <head>. Without it someone who has
   chosen light paints the dark palette for one frame and then corrects itself,
   which is the white flash every themed site used to have — here it would be a
   black one.

   Only a STORED choice can turn the light palette on. An unset key means this
   browser has never been told, and an untold browser gets dark: the OS
   preference is consulted only for someone who explicitly picked "Match
   system". This is the line that makes dark the default rather than a
   coin-flip on the visitor's laptop settings.

   Kept as a string because it has to be a synchronous <script>, before React
   exists at all. It is deliberately tiny and total: any failure leaves the dark
   default, which is what the page already is. */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var l=c==="light"||(c==="system"&&window.matchMedia("(prefers-color-scheme: light)").matches);if(l){var r=document.documentElement;r.setAttribute("data-theme","light");r.style.colorScheme="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f6f6f8")}}catch(e){}})();`;

/* Kept in step with THEME_BOOT_SCRIPT above, for the runtime toggle.
 *
 * The boot script and this do the same two extra things the palette alone does
 * not cover: `color-scheme` on the element, which decides the colour of the
 * space beyond the page and of the scrollbars, and the theme-color meta, which
 * decides the colour of the mobile browser's own bar. layout.tsx declares both
 * as dark up front so the reload gap is painted dark rather than white; a
 * visitor on the light theme has to have them moved back, at boot and again
 * whenever they press the switch. */
const LIGHT_BAR = "#f6f6f8";
const DARK_BAR = "#050505";

export function applyBrowserChrome(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? LIGHT_BAR : DARK_BAR);
}
