import type { FlyerFormat } from '../types';

/* Nano Banana (Google's Gemini image model) through fal.ai, on the same
   FAL_KEY the video production line uses — no Google key needed.

     fal-ai/nano-banana-pro   the Pro model, 2K: the sharpest lettering of
                              the fal image models, so it goes first
     fal-ai/nano-banana       the standard model, when Pro refuses

   fal's synchronous endpoint answers with the images' URLs; they are fetched
   here and handed back as bytes, like every other provider. Reference
   images (a logo, a product) go to the edit endpoints when there are any. */

const ASPECT: Record<FlyerFormat, string> = { portrait: '2:3', square: '1:1', landscape: '3:2', story: '9:16' };

async function run(model: string, input: Record<string, unknown>): Promise<string[]> {
  const response = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(170_000),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => null)) as { images?: { url?: string }[]; detail?: unknown } | null;
  if (!response.ok) throw new Error(`fal ${model} refused (${response.status})${body?.detail ? `: ${JSON.stringify(body.detail).slice(0, 200)}` : ''}`);
  return (body?.images ?? []).map((image) => image.url).filter((url): url is string => typeof url === 'string' && /^https:\/\//.test(url));
}

export async function generateFalNanoBanana(opts: { prompt: string; format: FlyerFormat; n: number; refs?: string[] }): Promise<Buffer[]> {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not set');
  const refs = (opts.refs ?? []).slice(0, 4);
  const base = {
    prompt: opts.prompt.slice(0, 3000),
    num_images: Math.min(Math.max(opts.n, 1), 4),
    aspect_ratio: ASPECT[opts.format],
    output_format: 'png',
    ...(refs.length ? { image_urls: refs } : {}),
  };
  let urls: string[] = [];
  try {
    urls = await run(refs.length ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro', { ...base, resolution: '2K' });
  } catch {
    urls = await run(refs.length ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana', base);
  }
  const images = await Promise.all(
    urls.map(async (url) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }),
  );
  return images.filter((image): image is Buffer => Boolean(image?.length));
}
