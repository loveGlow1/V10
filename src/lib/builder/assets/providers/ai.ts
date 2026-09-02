import { promptFor } from "@/lib/builder/assets/asset-generator";
import type { AssetProvider, ProviderHealth, Supply } from "@/lib/builder/assets/providers/types";

/* Generated imagery: the source for pictures no library holds.
 *
 * A curated library and a stock API both find a photograph that already exists,
 * which is enough for a landing page and not enough for a storefront: a generic
 * fabric photograph is not this shop's fabric. That is what this is for, and it
 * is why it sits behind the free sources rather than in front of them — it is
 * the only one that costs real money per picture.
 *
 * Disabled by default, and honestly unimplemented. The interface is here, the
 * prompt construction is here, and the request shape is here; what is not here
 * is a specific vendor, because choosing one is a pricing and quality decision
 * rather than a coding one, and a stub that pretends to work would be worse
 * than one that says it does not.
 *
 * Wiring a vendor in is: read the endpoint and key from configuration, POST the
 * prompt below, and return the bytes as a Supply. Nothing else in the pipeline
 * changes — which is the point of the abstraction. */
export function aiImageProvider(): AssetProvider {
  const endpoint = process.env.AI_IMAGE_ENDPOINT;
  const key = process.env.AI_IMAGE_API_KEY;

  return {
    id: "ai",
    label: "AI image generation",
    cost: "high",
    capabilities: { bespoke: true, edit: true, upscale: true },

    health(): ProviderHealth {
      if (process.env.AI_IMAGE_ENABLED !== "true") return "disabled";
      if (!endpoint || !key) return "misconfigured";
      return "available";
    },

    async supply(request): Promise<Supply | null> {
      if (process.env.AI_IMAGE_ENABLED !== "true" || !endpoint || !key || !request.spec) return null;

      /* The structured spec becomes one sentence here and nowhere else, so
         every vendor gets the same brief and two projects asking for the same
         picture ask for it identically. */
      const prompt = promptFor(request.spec);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ prompt, aspect_ratio: request.aspectRatio, quality: request.quality }),
          cache: "no-store",
        });
        if (!response.ok) return null;

        const body = (await response.json()) as { url?: string; b64?: string; content_type?: string };
        if (body.url) {
          return { url: body.url, provider: "ai", license: "generated", query: prompt, retrievedAt: new Date().toISOString() };
        }
        if (body.b64) {
          return {
            bytes: Buffer.from(body.b64, "base64"),
            contentType: body.content_type ?? "image/png",
            provider: "ai",
            license: "generated",
            query: prompt,
            retrievedAt: new Date().toISOString(),
          };
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}
