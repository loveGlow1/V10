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
}

/* Runs before the first paint, inlined into <head>. Without it a browser set to
   light paints the dark palette for one frame and then corrects itself, which is
   the white flash every themed site used to have — here it would be a black one.

   Kept as a string because it has to be a synchronous <script>, before React
   exists at all. It is deliberately tiny and total: any failure leaves the dark
   default, which is what the page already is. */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var l=c==="light"||((!c||c==="system")&&window.matchMedia("(prefers-color-scheme: light)").matches);if(l)document.documentElement.setAttribute("data-theme","light")}catch(e){}})();`;
