/* Whether two colours can be read against each other.
 *
 * One implementation, and that is the whole point of the file existing. There
 * were two: a proper WCAG calculation in tools/check-design.mjs, and a naive
 * channel average in design.ts deciding whether a ground counted as dark. They
 * disagree — the naive one weights an unlinearised byte, which reads mid greens
 * as far brighter than they are — so a palette could satisfy one and not the
 * other, and nobody would know which had been consulted.
 *
 * ── The linearisation is not a detail ─────────────────────────────────────
 *
 * The version everybody writes from memory is `0.2126R + 0.7152G + 0.0722B`
 * over raw 0–255 bytes. That is not the WCAG formula and it is not close: sRGB
 * is gamma-encoded, so each channel has to be linearised before it is weighted.
 * Skipping it inflates the luminance of mid-tones, which inflates the contrast
 * of exactly the colours people get wrong — a mid grey caption on white, a
 * white label on a mid accent. The palette that fails in the real world is the
 * one the shortcut passes.
 *
 * Pure, and no imports at all: read by the design checker, by the QA gates, and
 * by design.ts itself.
 */

/** The floors. AAA for body text, AA for everything else that has to be read. */
export const AAA_TEXT = 7;
export const AA_TEXT = 4.5;
/** Large text — 24px, or 18.66px bold — is legible at a lower ratio. */
export const AA_LARGE = 3;

/** A hex colour as its three bytes, or null if it is not one. */
export function rgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean.length === 8 ? clean.slice(0, 6) : clean;

  if (!/^[0-9a-f]{6}$/i.test(full)) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/* One channel, linearised. The 0.04045 knee and the 2.4 exponent are sRGB's,
   not a fit — changing either makes this a different measurement. */
function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance, 0 (black) to 1 (white).
 *
 * Returns null for anything that is not a hex colour rather than guessing at
 * zero: a caller that cannot parse a colour has a different problem from one
 * looking at black, and collapsing the two produces a contrast report full of
 * confident nonsense about colours nobody wrote.
 */
export function luminance(hex: string): number | null {
  const parsed = rgb(hex);
  if (!parsed) return null;

  return 0.2126 * channel(parsed[0]) + 0.7152 * channel(parsed[1]) + 0.0722 * channel(parsed[2]);
}

/**
 * The contrast ratio between two colours, 1 to 21, or null if either is
 * unreadable as a colour.
 *
 * Rounded to two places because that is the precision anybody acts on, and an
 * unrounded 4.4999999 reported against a floor of 4.5 is a bug report nobody
 * can reproduce.
 */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;

  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * Whether a colour is dark enough that a page on it wants the dark theme.
 *
 * The threshold is on LUMINANCE rather than on a byte average, so it agrees
 * with the contrast numbers above by construction. 0.2 rather than a midpoint
 * of 0.5: perceived brightness climbs steeply out of black, and a ground at 0.3
 * already reads as a light surface that wants dark text on it.
 */
export function isDarkColor(hex: string): boolean {
  const value = luminance(hex);
  return value !== null && value < 0.2;
}

export type ContrastCheck = {
  what: string;
  foreground: string;
  background: string;
  ratio: number | null;
  floor: number;
  passed: boolean;
};

/** One pairing, measured against a floor. */
export function check(
  what: string,
  foreground: string,
  background: string,
  floor: number,
): ContrastCheck {
  const ratio = contrast(foreground, background);
  return {
    what,
    foreground,
    background,
    ratio,
    floor,
    /* An unparseable colour FAILS rather than passes. A check that cannot be
       performed is not a check that was passed, and treating it as one is how a
       palette with a typo'd hex sails through. */
    passed: ratio !== null && ratio >= floor,
  };
}
