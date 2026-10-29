import type { BrandKit, FlyerSpec, Provider } from './types';

const NO_MARKS = `No logo, emblem, monogram, brand mark, icon with letters, signature or watermark anywhere in the image.`;

export function buildPrompt(brand: BrandKit, spec: FlyerSpec, provider: Provider) {
  const palette = Object.entries(brand.colors)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

  const fonts = brand.fonts
    ? `Typography feel: headings like ${brand.fonts.heading ?? 'a bold sans-serif'}, body like ${brand.fonts.body ?? 'a clean sans-serif'}.`
    : '';

  const text =
    spec.textMode === 'ai'
      ? [
          `Render this text exactly, spelled correctly, nothing else:`,
          `Headline: "${spec.headline}"`,
          spec.subhead && `Subheadline: "${spec.subhead}"`,
          ...(spec.details ?? []).map((d) => `Detail line: "${d}"`),
          spec.cta && `Call to action button: "${spec.cta}"`,
          `Clear hierarchy: headline dominant, details small and legible.`,
          `Only the text above, character for character, in the language and alphabet it is written in. No other words, letters or numbers anywhere: no Chinese, Japanese or Korean characters, no other script, no placeholder or filler text, no captions, labels or signage in the picture.`,
          NO_MARKS,
        ].filter(Boolean).join('\n')
      : `Do NOT render any text, letters, numbers or logos in any language or script. Leave clean, uncluttered negative space in the top third and a bottom band for text to be added later.`;

  /* The logo is never the model's to draw — it would draw a different one
     every time. A clear corner is left for the real one, stamped on after
     (logo.ts), so every image carries the same mark in the same place. */
  const logoNote = brand.logoPath
    ? `Keep the top-left corner — about a fifth of the width — plain background with nothing in it: the brand's logo is placed there afterwards.`
    : '';
  const refNote =
    provider !== 'ideogram-v3' && brand.referenceImageUrls?.length ? `Match the visual style of the provided reference image.` : '';

  return [
    brand.name ? `Professional promotional flyer for "${brand.name}".` : `Professional promotional flyer.`,
    brand.vibe && `Brand style: ${brand.vibe}.`,
    `Strict color palette: ${palette}. No off-brand colors.`,
    fonts,
    spec.imagery && `Imagery: ${spec.imagery}.`,
    refNote,
    logoNote,
    text,
    `Print-quality graphic design, balanced layout, generous margins.`,
  ].filter(Boolean).join('\n');
}

export const NEGATIVE = 'misspelled text, garbled letters, extra text, chinese characters, foreign script, placeholder text, logo, brand mark, watermark, clutter, low resolution';
