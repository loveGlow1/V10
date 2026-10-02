import type { BrandKit, FlyerSpec, Provider } from './types';

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
        ].filter(Boolean).join('\n')
      : `Do NOT render any text, letters, numbers or logos. Leave clean, uncluttered negative space in the top third and a bottom band for text to be added later.`;

  const refNote =
    provider === 'ideogram-v3'
      ? ''
      : brand.logoUrl
        ? `Use the provided logo image exactly as given, unaltered, placed small in a corner. Match the visual style of the provided website screenshot.`
        : brand.referenceImageUrls?.length
          ? `Match the visual style of the provided website screenshot.`
          : '';

  return [
    `Professional promotional flyer for "${brand.name}".`,
    brand.vibe && `Brand style: ${brand.vibe}.`,
    `Strict color palette: ${palette}. No off-brand colors.`,
    fonts,
    spec.imagery && `Imagery: ${spec.imagery}.`,
    refNote,
    text,
    `Print-quality graphic design, balanced layout, generous margins.`,
  ].filter(Boolean).join('\n');
}

export const NEGATIVE = 'misspelled text, garbled letters, extra text, watermark, distorted logo, clutter, low resolution';
