/* A flier brief, read into what the image models need.
 *
 * "Design a flier for a summer sale, 30% off" is a sentence; an image model
 * wants a headline to set exactly, the lines under it, a call to action, a
 * palette and a picture to make. Claude Haiku reads one into the other, as
 * JSON, once per flier — and a heuristic stands in when it cannot, so a flier
 * is never refused for want of a parse.
 *
 * The size comes from the Fliers tab's sub-type and the brief together:
 * a promo banner is landscape, an event flier portrait, a social post square
 * — or a story when the brief says story, reel or 9:16.
 *
 * Server-only (the model call); the rest is pure. */

import Anthropic from "@anthropic-ai/sdk";

import type { FlyerFormat, FlyerRequest, StyleIntent } from "./types";

export function formatFor(subtype: string | null | undefined, brief: string): FlyerFormat {
  if (/\b(story|stories|reel|reels|tiktok|9:16|vertical|status)\b/i.test(brief)) return "story";
  if (/\b(banner|landscape|16:9|3:2|linkedin|twitter|x post|facebook cover|website header|leaderboard)\b/i.test(brief)) return "landscape";
  if (/\b(square|1:1|instagram post|feed post)\b/i.test(brief)) return "square";
  if (subtype === "marketing_banner") return "landscape";
  if (subtype === "social_post") return "square";
  return "portrait";
}

const HEX = /^#[0-9a-f]{6}$/i;
const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A spec read from the sentence alone, with no model. Pure. */
export function heuristicRequest(brief: string, format: FlyerFormat): FlyerRequest {
  const text = brief.replace(/\s+/g, " ").trim();
  const offer = text.match(/\b\d{1,2}\s?%\s?off\b/i)?.[0]?.toUpperCase().replace(/\s+/g, " ");
  const forWhat = text.match(/\bfor (?:an? |the |our |my )?(.{3,60}?)(?:[,.;:]|$)/i)?.[1];
  const headline = (offer ?? forWhat ?? text.split(/[.!?]/)[0] ?? "Special offer").slice(0, 60);
  return {
    brand: { name: "", colors: { primary: "#111827", accent: "#f97316", background: "#ffffff", text: "#111827" }, vibe: "bold, modern, high contrast" },
    spec: {
      headline: headline.replace(/^./, (c) => c.toUpperCase()),
      subhead: offer && forWhat ? forWhat.replace(/^./, (c) => c.toUpperCase()) : undefined,
      imagery: text.slice(0, 300),
      format,
      textMode: "ai",
      styleIntent: "brand",
    },
    stage: "preview",
  };
}

const SYSTEM = `You turn a short request for a flier, poster, banner or social graphic into the brief a designer works from. Reply with JSON only, no prose:
{"brand":"the business or event name, or \\"\\" if none is given","headline":"the one line that dominates, under 7 words — the offer or event name, exactly as the person would want it spelled","subhead":"one supporting line or \\"\\"","details":["date, time, venue, price, website — only facts the request gives, at most 4"],"cta":"a short call to action or \\"\\"","imagery":"the picture to make behind or around the type: subject, setting, mood, lighting — concrete, one or two sentences","colors":{"primary":"#hex","accent":"#hex","background":"#hex","text":"#hex"},"vibe":"three or four words of style","style":"brand | typography | photo"}
Never invent facts — no dates, prices, addresses, phone numbers or URLs the request does not give. Pick colours that suit the subject and keep the text readable.`;

/** The brief, read by Haiku into a flyer request; the heuristic when it cannot be. */
export async function requestFromBrief(brief: string, subtype: string | null | undefined): Promise<FlyerRequest> {
  const format = formatFor(subtype, brief);
  const fallback = heuristicRequest(brief, format);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: brief.slice(0, 3000) }],
    });
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const colors = (parsed.colors ?? {}) as Record<string, unknown>;
    const color = (key: string, otherwise: string) => (typeof colors[key] === "string" && HEX.test(colors[key] as string) ? (colors[key] as string) : otherwise);
    const style = parsed.style === "typography" || parsed.style === "photo" ? (parsed.style as StyleIntent) : "brand";
    const headline = clip(parsed.headline, 80);
    return {
      brand: {
        name: clip(parsed.brand, 60),
        colors: {
          primary: color("primary", fallback.brand.colors.primary),
          accent: color("accent", fallback.brand.colors.accent ?? "#f97316"),
          background: color("background", fallback.brand.colors.background ?? "#ffffff"),
          text: color("text", fallback.brand.colors.text ?? "#111827"),
        },
        vibe: clip(parsed.vibe, 80) || fallback.brand.vibe,
      },
      spec: {
        headline: headline || fallback.spec.headline,
        subhead: clip(parsed.subhead, 120) || undefined,
        details: Array.isArray(parsed.details) ? parsed.details.map((d) => clip(d, 80)).filter(Boolean).slice(0, 4) : undefined,
        cta: clip(parsed.cta, 40) || undefined,
        imagery: clip(parsed.imagery, 400) || fallback.spec.imagery,
        format,
        textMode: "ai",
        styleIntent: style,
      },
      stage: "preview",
    };
  } catch {
    return fallback;
  }
}

const REVISE = `You revise the design brief of a flier the person has already seen. You are given the current brief as JSON and the change they asked for. Apply exactly that change and keep everything else the same, word for word. Reply with the whole revised brief as JSON only, in the same shape:
{"brand":"","headline":"","subhead":"","details":[""],"cta":"","imagery":"","colors":{"primary":"#hex","accent":"#hex","background":"#hex","text":"#hex"},"vibe":"","style":"brand | typography | photo"}
Never invent facts the person did not give — no dates, prices, addresses, phone numbers or URLs.`;

/** The current flier's request with one change applied, read by Haiku; the change added to the picture brief when it cannot be. */
export async function reviseRequest(previous: FlyerRequest, change: string): Promise<FlyerRequest> {
  const text = change.replace(/\s+/g, " ").trim().slice(0, 1500);
  const fallback: FlyerRequest = {
    ...previous,
    spec: { ...previous.spec, imagery: `${previous.spec.imagery ?? ""} Change: ${text}`.trim().slice(0, 600) },
    stage: "preview",
    parentJobId: undefined,
    selectedPreviewPath: undefined,
  };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  const current = {
    brand: previous.brand.name,
    headline: previous.spec.headline,
    subhead: previous.spec.subhead ?? "",
    details: previous.spec.details ?? [],
    cta: previous.spec.cta ?? "",
    imagery: previous.spec.imagery ?? "",
    colors: previous.brand.colors,
    vibe: previous.brand.vibe ?? "",
    style: previous.spec.styleIntent ?? "brand",
  };
  try {
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: REVISE,
      messages: [{ role: "user", content: `CURRENT BRIEF:\n${JSON.stringify(current)}\n\nCHANGE:\n${text}` }],
    });
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const colors = (parsed.colors ?? {}) as Record<string, unknown>;
    const color = (key: "primary" | "accent" | "background" | "text", otherwise: string | undefined) =>
      typeof colors[key] === "string" && HEX.test(colors[key] as string) ? (colors[key] as string) : otherwise;
    const style = parsed.style === "typography" || parsed.style === "photo" || parsed.style === "brand" ? (parsed.style as StyleIntent) : previous.spec.styleIntent;
    return {
      ...previous,
      brand: {
        ...previous.brand,
        name: typeof parsed.brand === "string" ? clip(parsed.brand, 60) : previous.brand.name,
        colors: {
          ...previous.brand.colors,
          primary: color("primary", previous.brand.colors.primary) ?? previous.brand.colors.primary,
          accent: color("accent", previous.brand.colors.accent),
          background: color("background", previous.brand.colors.background),
          text: color("text", previous.brand.colors.text),
        },
        vibe: clip(parsed.vibe, 80) || previous.brand.vibe,
      },
      spec: {
        ...previous.spec,
        headline: clip(parsed.headline, 80) || previous.spec.headline,
        subhead: typeof parsed.subhead === "string" ? clip(parsed.subhead, 120) || undefined : previous.spec.subhead,
        details: Array.isArray(parsed.details) ? parsed.details.map((d) => clip(d, 80)).filter(Boolean).slice(0, 4) : previous.spec.details,
        cta: typeof parsed.cta === "string" ? clip(parsed.cta, 40) || undefined : previous.spec.cta,
        imagery: clip(parsed.imagery, 400) || previous.spec.imagery,
        styleIntent: style,
      },
      stage: "preview",
      parentJobId: undefined,
      selectedPreviewPath: undefined,
    };
  } catch {
    return fallback;
  }
}
