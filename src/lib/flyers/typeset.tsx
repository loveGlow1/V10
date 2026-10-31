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

/** The flier: the picture, with its words set over it. A PNG. */
export async function typeset(art: Buffer, input: { spec: FlyerSpec; brand: BrandKit; logo: boolean }): Promise<Buffer> {
  const { spec, brand } = input;
  const meta = await sharp(art).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1536;
  const landscape = width > height * 1.15;
  const picture = `data:image/png;base64,${(await sharp(art).png().toBuffer()).toString("base64")}`;

  const serif = wantsSerif(brand);
  const [regular, semibold, bold, display] = await Promise.all([font(FONTS.sans400), font(FONTS.sans600), font(FONTS.sans800), serif ? font(FONTS.serif700) : Promise.resolve(null)]);
  if (!regular || !bold) throw new Error("The flier's typeface could not be loaded.");

  const accent = hex(brand.colors.accent, hex(brand.colors.primary, "#f97316"));
  const scrim = "11,11,15";
  const unit = Math.min(width, height);
  const pad = Math.round(width * 0.07);
  const headline = spec.headline.trim();
  const details = (spec.details ?? []).filter((d) => d.trim()).slice(0, 4);
  const h1 = headlineSize(width, headline, landscape);
  const body = Math.round(unit * (landscape ? 0.034 : 0.036));
  const small = Math.round(unit * (landscape ? 0.027 : 0.029));

  const words = (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: landscape ? "62%" : "100%",
        height: landscape ? "100%" : "auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: `${pad}px`,
        color: "#ffffff",
      }}
    >
      <div style={{ display: "flex", fontFamily: display ? "Display" : "Inter", fontWeight: 800, fontSize: h1, lineHeight: 1.04, letterSpacing: display ? 0 : -h1 * 0.02 }}>{headline}</div>
      {spec.subhead?.trim() ? (
        <div style={{ display: "flex", marginTop: Math.round(body * 0.7), fontFamily: "Inter", fontWeight: 400, fontSize: body * 1.12, lineHeight: 1.3, opacity: 0.92 }}>{spec.subhead.trim()}</div>
      ) : null}
      {details.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: Math.round(body * 1.1) }}>
          {details.map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i ? Math.round(small * 0.55) : 0, fontFamily: "Inter", fontWeight: 400, fontSize: small, lineHeight: 1.35 }}>
              <div style={{ width: Math.round(small * 0.38), height: Math.round(small * 0.38), borderRadius: 999, background: accent, marginRight: Math.round(small * 0.6), flexShrink: 0 }} />
              <div style={{ display: "flex" }}>{line.trim()}</div>
            </div>
          ))}
        </div>
      ) : null}
      {spec.cta?.trim() || (!input.logo && brand.name.trim()) ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: Math.round(body * 1.4) }}>
          {spec.cta?.trim() ? (
            <div style={{ display: "flex", background: accent, color: inkOn(accent), fontFamily: "Inter", fontWeight: 600, fontSize: Math.round(small * 1.08), padding: `${Math.round(small * 0.62)}px ${Math.round(small * 1.25)}px`, borderRadius: 999 }}>
              {spec.cta.trim()}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          {!input.logo && brand.name.trim() ? (
            <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: Math.round(small * 1.05), letterSpacing: small * 0.02, opacity: 0.95 }}>{brand.name.trim()}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const response = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: `rgb(${scrim})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={picture} width={width} height={height} style={{ position: "absolute", left: 0, top: 0, width, height }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            background: landscape
              ? `linear-gradient(90deg, rgba(${scrim},0.9) 0%, rgba(${scrim},0.72) 45%, rgba(${scrim},0) 75%)`
              : `linear-gradient(180deg, rgba(${scrim},0) 30%, rgba(${scrim},0.7) 58%, rgba(${scrim},0.92) 100%)`,
          }}
        />
        {words}
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        ...(semibold ? [{ name: "Inter", data: semibold, weight: 600 as const, style: "normal" as const }] : []),
        { name: "Inter", data: bold, weight: 800, style: "normal" },
        ...(display ? [{ name: "Display", data: display, weight: 800 as const, style: "normal" as const }] : []),
      ],
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
