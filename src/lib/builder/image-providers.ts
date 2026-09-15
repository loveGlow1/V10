import type { GenerationJob, ImageProvider as GeneratingProvider } from "@/lib/builder/assets/asset-generator";
import { promptFor, widthFor } from "@/lib/builder/assets/asset-generator";
import type { Quality, VisualSpec } from "@/lib/builder/assets/asset-types";
import type { ChoiceOptions, ImageProvider, ImageSlot, Shot } from "@/lib/builder/images";

/* Where the real pixels come from.
 *
 * Two sources, one shape. Both are keyed search APIs that take a query and a
 * width and answer with a photograph, which is the whole of what a slot needs —
 * so the adapters are small and swapping one for the other is an environment
 * variable rather than a change here.
 *
 * Unsplash is the better library and has terms attached: attribution is
 * required, and their guidelines ask that a download be registered when an
 * image is actually used. Both are honoured below. Pexels asks for attribution
 * where practical and does not require the ping.
 *
 * A third kind of source — an image MODEL rather than a library — fits the same
 * interface and is the right answer when a page needs a picture no stock
 * library has (a specific product, a named person, a bespoke composition). It
 * is not wired up here because it costs money per image and is slow enough to
 * change how a build is paced, which is a decision rather than a default. The
 * interface is what makes it a small change when it is wanted. */

const UA = "QuickStark.Ai build orchestrator";

/* Enough for a search and a download on a slow day, and short enough that a
   provider having a bad one cannot hold a build open — fillImages bounds each
   slot again on its own. */
const TIMEOUT_MS = 10_000;

async function get(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Words that describe any business and therefore none. A slot whose whole
   subject is one of these has said the category rather than the thing, and the
   search that follows returns whatever a warehouse looks like. */
const GENERIC =
  /^(a |an |the )?(photo(graph)?|image|picture|shot|product|products|item|items|goods|textiles?|food|meal|people|person|team|office|workspace|interior|background|hero|banner|abstract|business|service|technology|lifestyle)s?$/i;

/* What to search for.
 *
 * The art direction is written for a person and reads like a photographer's
 * brief — "folded ochre wax print fabric, raking light, neutral seamless" — and
 * a stock search does badly with the second half of that. So the query is the
 * first clause, which is the subject, and the rest is dropped.
 *
 * `context` is what makes the picture belong to THIS page rather than to the
 * category it is in. Two shops selling cloth produce the same "folded fabric"
 * slot and want entirely different photographs, and nothing in one <img> tag
 * can tell them apart — the page around it can. So a few words describing what
 * was actually built are carried in, and used in the one place they help:
 * where the slot's own subject is too generic to search for on its own.
 *
 * Appended rather than substituted, and only then. A stock search degrades
 * quickly as a query lengthens, so a slot that already names its subject
 * precisely is left exactly as it is — the model was specific, and this would
 * only dilute it. */
function query(slot: ImageSlot, context?: string): string {
  const subject = (slot.shot || slot.alt).split(/[,.;]/)[0].trim();
  const usable = subject.length >= 3 ? subject : slot.alt || "";

  if (!usable) return context?.trim() || "photograph";
  if (!context || !GENERIC.test(usable)) return usable;

  return `${usable} ${context}`.trim();
}

/* ── Which of the results, and why not simply the first ───────────────────
 *
 * This asked for `per_page=1` and took `results[0]`, which is the single most
 * consequential line in the image pipeline and reads like a sensible
 * simplification.
 *
 * Stock search is deterministic. Two bakeries whose slots both reduce to
 * "bakery counter morning light" were handed THE SAME PHOTOGRAPH — not
 * sometimes, always, across every project and every account, for as long as
 * that query ranked that photo first. And two slots on ONE page with the same
 * subject got the same picture as each other, which is the tell that makes a
 * generated catalogue look generated.
 *
 * So twenty candidates come back and this decides between them, against two
 * requirements that pull in opposite directions:
 *
 *   DIVERSE. A photograph already used on this page, or already used by this
 *   project, drops out entirely. That is what stops one picture doing a whole
 *   catalogue's work.
 *
 *   AND REPRODUCIBLE. Rebuilding a project should not reshuffle its
 *   photographs — somebody who liked the hero and asked for a copy change
 *   should get the same hero. So the starting point is a hash of the project
 *   id rather than anything random: stable for one project across rebuilds,
 *   and different between projects asking the same question.
 */
function rotation(seed: string | undefined, length: number): number {
  if (!seed || length <= 1) return 0;
  let hash = 0;
  for (let at = 0; at < seed.length; at += 1) {
    hash = (hash * 31 + seed.charCodeAt(at)) | 0;
  }
  return Math.abs(hash) % length;
}

/** The first candidate this page has not already used, starting from the rotation. */
function choose<T>(candidates: T[], idOf: (item: T) => string, options?: ChoiceOptions): T | null {
  if (candidates.length === 0) return null;

  const start = rotation(options?.seed, candidates.length);
  const used = options?.exclude;

  for (let step = 0; step < candidates.length; step += 1) {
    const candidate = candidates[(start + step) % candidates.length];
    if (!used || !used.has(idOf(candidate))) return candidate;
  }

  /* Every candidate is already on this page. Reusing one beats a hole, and the
     duplicate is at least the one the rotation would have picked. */
  return candidates[start];
}

const CANDIDATES = 20;

function orientation(ratio: string): "landscape" | "portrait" | "squarish" {
  const [a, b] = ratio.split("/").map(Number);
  if (!a || !b) return "landscape";
  if (a / b > 1.15) return "landscape";
  if (a / b < 0.87) return "portrait";
  return "squarish";
}

const unsplash = (key: string): ImageProvider => ({
  name: "unsplash",
  async shotFor(slot, width, context, choice) {
    const search = await get(
      `https://api.unsplash.com/search/photos?per_page=${CANDIDATES}&content_filter=high&orientation=${orientation(
        slot.ratio,
      )}&query=${encodeURIComponent(query(slot, context))}`,
      { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    );
    if (!search) return null;

    const body = (await search.json()) as {
      results?: {
        id?: string;
        urls?: { raw?: string };
        links?: { download_location?: string };
        user?: { name?: string; links?: { html?: string } };
      }[];
    };
    const usable = (body.results ?? []).filter((result) => result?.urls?.raw && result?.id);
    const photo = choose(usable, (result) => `unsplash:${result.id}`, choice);
    const raw = photo?.urls?.raw;
    if (!photo || !raw) return null;

    /* Their guidelines ask that using a photo registers a download. Fired and
       not awaited on the critical path, and a failure here must not cost the
       page its picture. */
    if (photo?.links?.download_location) {
      void get(photo.links.download_location, { Authorization: `Client-ID ${key}` });
    }

    const file = await get(`${raw}&w=${width}&q=75&fm=jpg&fit=crop`);
    if (!file) return null;

    return {
      id: `unsplash:${photo.id}`,
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: "image/jpeg",
      credit: {
        author: photo.user?.name ?? "Unsplash contributor",
        source: "Unsplash",
        url: photo.user?.links?.html ?? "https://unsplash.com",
      },
    } satisfies Shot;
  },
});

const pexels = (key: string): ImageProvider => ({
  name: "pexels",
  async shotFor(slot, width, context, choice) {
    const search = await get(
      `https://api.pexels.com/v1/search?per_page=${CANDIDATES}&orientation=${orientation(
        slot.ratio,
      )}&query=${encodeURIComponent(query(slot, context))}`,
      { Authorization: key },
    );
    if (!search) return null;

    const body = (await search.json()) as {
      photos?: { id?: number; src?: { original?: string }; photographer?: string; url?: string }[];
    };
    const usable = (body.photos ?? []).filter((photo) => photo?.src?.original && photo?.id);
    const photo = choose(usable, (result) => `pexels:${result.id}`, choice);
    const original = photo?.src?.original;
    if (!photo || !original) return null;

    const file = await get(`${original}?auto=compress&cs=tinysrgb&w=${width}`);
    if (!file) return null;

    return {
      id: `pexels:${photo.id}`,
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: "image/jpeg",
      credit: {
        author: photo.photographer ?? "Pexels contributor",
        source: "Pexels",
        url: photo.url ?? "https://pexels.com",
      },
    } satisfies Shot;
  },
});

/**
 * The provider this deployment is configured for, or null.
 *
 * Null is a supported state, not a broken one: every slot keeps its placeholder
 * and the page is built, stored and served exactly as it would have been. That
 * is what makes turning photographs on a deployment decision rather than a
 * dependency.
 */
export function providerFromEnv(): ImageProvider | null {
  if (process.env.UNSPLASH_ACCESS_KEY) return unsplash(process.env.UNSPLASH_ACCESS_KEY);
  if (process.env.PEXELS_API_KEY) return pexels(process.env.PEXELS_API_KEY);
  return null;
}

export const isImageProviderConfigured = Boolean(
  process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY,
);


/* ── The same two sources, behind the asset pipeline's interface ───────────
 *
 * Two shapes exist because two callers exist, and they want different things.
 * fillImages works on a finished document and asks "what goes in this tag";
 * the asset pipeline works before the document exists and asks "make me this
 * picture". Both end at the same HTTP call, so the adapters below are thin.
 *
 * kind: "library" is not a footnote. A stock library finds a photograph that
 * already exists, so it cannot edit or upscale, and it cannot show somebody's
 * actual product — which is exactly when a generative provider earns its cost.
 * The planner is allowed to know the difference. */

function asSlot(spec: VisualSpec): ImageSlot {
  return {
    tag: "",
    shot: promptFor(spec),
    alt: spec.subject,
    ratio: spec.aspectRatio.replace(":", "/"),
    weight: spec.type === "hero" ? "hero" : spec.type === "product" ? "thumb" : "feature",
    /* No framing decision, because there is no page yet. A spec describes the
       picture to make; where the subject sits inside whatever box eventually
       holds it is the document's question, and asSlot has no document. */
    focal: "",
    fit: "cover",
  };
}

function libraryProvider(inner: ImageProvider): GeneratingProvider {
  return {
    name: inner.name,
    kind: "library",
    async generate(spec: VisualSpec, quality: Quality): Promise<GenerationJob> {
      const shot = await inner.shotFor(asSlot(spec), widthFor(quality));
      if (!shot) {
        return { id: "", status: "failed", error: "no photograph matched that subject" };
      }
      return {
        id: `${inner.name}:${Date.now()}`,
        status: "ready",
        image: {
          bytes: shot.bytes,
          contentType: shot.contentType,
          width: widthFor(quality),
          height: 0,
          provider: inner.name,
          credit: shot.credit,
        },
      };
    },
    /* No edit, no upscale, and deliberately not stubs that pretend: a caller
       has to be able to tell what a provider can actually do. */
  };
}

/**
 * The providers this deployment can use, best first.
 *
 * A generative provider would be unshifted onto the front of this list when one
 * is configured — the resolver takes them in order and falls back down it.
 */
export function providersFromEnv(): GeneratingProvider[] {
  const stock = providerFromEnv();
  return stock ? [libraryProvider(stock)] : [];
}
