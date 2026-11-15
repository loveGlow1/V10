/* The words on a flier, set in real type over the picture.
 *
 * An image model draws letters as shapes. A big short headline usually comes
 * out right; the smaller lines often do not — "Detaliy coustanisure", "Same
 * day mapes/ana agiist" — and a garbled line on a flier somebody paid for is
 * the first thing anyone notices. So, as the design tools do, the model makes
 * the picture only (prompt.ts asks it for no text, with calm space where the
 * words will go), and every word is set here: the headline, the subhead, the
 * detail lines, the button and the brand name, exactly as the brief spells
 * them, in a real typeface, in the brand's colours, sharp at any size.
 *
 * Layout: the words sit in the lower part of the picture over a scrim that
 * keeps them readable whatever the picture is; on a landscape flier, in the
 * left part. The brand's logo, when there is one, is stamped top-left
 * afterwards (logo.ts), so the brand name is only set when there is no logo.
 *
 * Server-only. */

import { ImageResponse } from "next/og";
import sharp from "sharp";

import type { BrandKit, FlyerSpec } from "./types";
import { fontUrl, layoutFor, typeStyleFor, type FlyerLayout } from "./type-styles";

/* Inter, and Playfair Display for an elegant brief — fetched once per
   instance (Satori needs the font files; TTF, not WOFF2). */
const FONT_BASE = "https://cdn.jsdelivr.net/fontsource/fonts";
const FONTS = {
  sans400: `${FONT_BASE}/inter@5.2.5/latin-400-normal.ttf`,
  sans600: `${FONT_BASE}/inter@5.2.5/latin-600-normal.ttf`,
  sans800: `${FONT_BASE}/inter@5.2.5/latin-800-normal.ttf`,
  serif700: `${FONT_BASE}/playfair-display@5.2.5/latin-700-normal.ttf`,
};
const loaded = new Map<string, Promise<ArrayBuffer | null>>();
function font(url: string): Promise<ArrayBuffer | null> {
  if (!loaded.has(url)) {
    loaded.set(
      url,
      fetch(url, { signal: AbortSignal.timeout(15_000) })
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null),
    );
  }
  return loaded.get(url) as Promise<ArrayBuffer | null>;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value: string | undefined, otherwise: string) => (value && HEX.test(value) ? value : otherwise);

/** Black or white, whichever reads on a colour. Pure. */
export function inkOn(background: string): string {
  const n = parseInt(background.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0b0b0f" : "#ffffff";
}

/** The headline's size, from the picture's width and the headline's length. Pure. */
export function headlineSize(width: number, text: string, landscape: boolean): number {
  const n = text.length;
  const share = n <= 14 ? 0.11 : n <= 24 ? 0.088 : n <= 36 ? 0.07 : n <= 52 ? 0.058 : 0.05;
  return Math.round(width * share * (landscape ? 0.62 : 1));
}

/* An elegant brief gets a serif headline; everything else, Inter. */
export const wantsSerif = (brand: Pick<BrandKit, "vibe">) => /\b(luxur|elegan|premium|classic|editorial|wedding|fine dining|boutique)/i.test(brand.vibe ?? "");

/** The flier: the picture, with its words set over it, in its type style and layout. A PNG. */
export async function typeset(art: Buffer, input: { spec: FlyerSpec; brand: BrandKit; logo: boolean }): Promise<Buffer> {
  const { spec, brand } = input;
  const meta = await sharp(art).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1536;
  const landscape = width > height * 1.15;
  const picture = `data:image/png;base64,${(await sharp(art).png().toBuffer()).toString("base64")}`;

  /* The style: asked for, read from the vibe, or an elegant brief's serif. */
  const style = typeStyleFor({ typeStyle: brand.typeStyle ?? (wantsSerif(brand) ? "elegant" : undefined), vibe: brand.vibe, headingFont: brand.fonts?.heading, imagery: spec.imagery, headline: spec.headline });
  const layout: FlyerLayout = landscape ? "bottom" : layoutFor(style, spec.layout);
  const [headFont, bodyFont, strongFont, fallback] = await Promise.all([font(fontUrl(style.heading)), font(fontUrl(style.body)), font(fontUrl(style.bodyStrong)), font(FONTS.sans800)]);
  const body400 = bodyFont ?? (await font(FONTS.sans400));
  if (!body400 || !(headFont ?? fallback)) throw new Error("The flyer's typeface could not be loaded.");
  const HEAD = headFont ? "Head" : "Inter";
  const BODY = bodyFont ? "Body" : "Inter";

  const accent = hex(brand.colors.accent, hex(brand.colors.primary, "#f97316"));
  const primary = hex(brand.colors.primary, accent);
  const scrim = "11,11,15";
  const unit = Math.min(width, height);
  const pad = Math.round(width * 0.07);
  const headline = style.upper ? spec.headline.trim().toUpperCase() : spec.headline.trim();
  const details = (spec.details ?? []).filter((d) => d.trim()).slice(0, 4);
  const h1 = Math.round(headlineSize(width, headline, landscape) * (style.upper ? 1.08 : 1) * (layout === "center" ? 0.86 : 1));
  const body = Math.round(unit * (landscape ? 0.034 : 0.036));
  const small = Math.round(unit * (landscape ? 0.027 : 0.029));

  /* The colours the words are set in: white over the picture's fade, the
     band's own ink on a solid band, dark ink on the light centre card. */
  const bandInk = inkOn(primary);
  const ink = layout === "band" ? bandInk : layout === "center" ? "#111114" : "#ffffff";
  const centred = layout === "center";
  const chipBg = layout === "band" && inkOn(accent) === inkOn(primary) && accent.toLowerCase() === primary.toLowerCase() ? bandInk : accent;

  const words = (
    <div style={{ display: "flex", flexDirection: "column", width: centred ? "auto" : "100%", alignItems: centred ? "center" : "flex-start", textAlign: centred ? "center" : "left", color: ink }}>
      <div style={{ display: "flex", justifyContent: centred ? "center" : "flex-start", fontFamily: HEAD, fontWeight: headFont ? style.heading.weight : 800, fontSize: h1, lineHeight: style.leading, letterSpacing: h1 * style.tracking }}>{headline}</div>
      {spec.subhead?.trim() ? (
        <div style={{ display: "flex", marginTop: Math.round(body * 0.7), fontFamily: BODY, fontWeight: 400, fontSize: body * 1.12, lineHeight: 1.3, opacity: 0.92 }}>{spec.subhead.trim()}</div>
      ) : null}
      {details.length ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: centred ? "center" : "flex-start", marginTop: Math.round(body * 1.1) }}>
          {details.map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i ? Math.round(small * 0.55) : 0, fontFamily: BODY, fontWeight: 400, fontSize: small, lineHeight: 1.35 }}>
              {centred ? null : <div style={{ width: Math.round(small * 0.38), height: Math.round(small * 0.38), borderRadius: 999, background: layout === "band" ? bandInk : accent, marginRight: Math.round(small * 0.6), flexShrink: 0 }} />}
              <div style={{ display: "flex" }}>{line.trim()}</div>
            </div>
          ))}
        </div>
      ) : null}
      {spec.cta?.trim() || (!input.logo && brand.name.trim()) ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: centred ? "center" : "space-between", width: centred ? "auto" : "100%", marginTop: Math.round(body * 1.4) }}>
          {spec.cta?.trim() ? (
            <div style={{ display: "flex", background: chipBg, color: inkOn(chipBg), fontFamily: strongFont ? "BodyStrong" : "Inter", fontWeight: strongFont ? style.bodyStrong.weight : 600, fontSize: Math.round(small * 1.08), padding: `${Math.round(small * 0.62)}px ${Math.round(small * 1.25)}px`, borderRadius: style.id === "raw" || style.id === "bold" ? 4 : 999, textTransform: style.upper ? "uppercase" : "none", letterSpacing: style.upper ? small * 0.04 : 0 }}>
              {spec.cta.trim()}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          {!input.logo && brand.name.trim() && !centred ? (
            <div style={{ display: "flex", fontFamily: HEAD, fontWeight: headFont ? style.heading.weight : 800, fontSize: Math.round(small * 1.05), letterSpacing: small * 0.02, opacity: 0.95 }}>{brand.name.trim()}</div>
          ) : null}
        </div>
      ) : null}
      {!input.logo && brand.name.trim() && centred ? (
        <div style={{ display: "flex", marginTop: Math.round(body * 0.9), fontFamily: BODY, fontWeight: 400, fontSize: small, letterSpacing: small * 0.12, textTransform: "uppercase", opacity: 0.7 }}>{brand.name.trim()}</div>
      ) : null}
    </div>
  );

  /* The four arrangements. */
  const fade =
    layout === "top"
      ? `linear-gradient(0deg, rgba(${scrim},0) 38%, rgba(${scrim},0.7) 70%, rgba(${scrim},0.92) 100%)`
      : landscape
        ? `linear-gradient(90deg, rgba(${scrim},0.9) 0%, rgba(${scrim},0.72) 45%, rgba(${scrim},0) 75%)`
        : `linear-gradient(180deg, rgba(${scrim},0) 30%, rgba(${scrim},0.7) 58%, rgba(${scrim},0.92) 100%)`;
  const arranged =
    layout === "band" ? (
      <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", display: "flex", flexDirection: "column", background: primary, padding: `${Math.round(pad * 0.9)}px ${pad}px ${pad}px` }}>
        <div style={{ position: "absolute", left: 0, top: -Math.round(unit * 0.012), width: "100%", height: Math.round(unit * 0.012), background: accent, display: "flex" }} />
        {words}
      </div>
    ) : layout === "center" ? (
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: pad }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "rgba(255,255,255,0.92)", borderRadius: Math.round(unit * 0.02), padding: `${Math.round(pad * 1.1)}px ${pad}px`, maxWidth: "86%", boxShadow: "0 30px 80px rgba(0,0,0,0.35)" }}>{words}</div>
      </div>
    ) : (
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: layout === "top" ? "flex-start" : "flex-end", alignItems: "stretch", background: fade }}>
        <div style={{ display: "flex", flexDirection: "column", width: landscape ? "62%" : "100%", height: landscape ? "100%" : "auto", justifyContent: layout === "top" ? "flex-start" : "flex-end", padding: `${layout === "top" ? Math.round(pad * (input.logo ? 2.2 : 1)) : pad}px ${pad}px ${pad}px` }}>{words}</div>
      </div>
    );

  const response = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: `rgb(${scrim})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={picture} width={width} height={height} style={{ position: "absolute", left: 0, top: 0, width, height }} />
        {arranged}
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "Inter", data: (await font(FONTS.sans400)) ?? body400, weight: 400, style: "normal" },
        ...(fallback ? [{ name: "Inter", data: fallback, weight: 800 as const, style: "normal" as const }] : []),
        ...(headFont ? [{ name: "Head", data: headFont, weight: style.heading.weight as 400, style: "normal" as const }] : []),
        ...(bodyFont ? [{ name: "Body", data: bodyFont, weight: 400 as const, style: "normal" as const }] : []),
        ...(strongFont ? [{ name: "BodyStrong", data: strongFont, weight: style.bodyStrong.weight as 600, style: "normal" as const }] : []),
      ],
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
