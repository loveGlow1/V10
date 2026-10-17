import { WEBHOOK_TOKEN_HEADER } from '@/lib/n8n';
import type { FlyerFormat } from '../types';

/* Flier images on the n8n usage credit — the workflow "QuickStark.Ai — Flier
   Image" (n8n/flier-image.workflow.ts), whose MiniMax and OpenAI nodes run on
   n8n's gateway credits, so no key of our own is spent.

     engine "minimax"  MiniMax image-01, up to four drafts in one call, at the
                       flier's ratio
     engine "openai"   OpenAI gpt-image-1-mini (what the gateway allows) at high
                       quality — the final, where
                       exact lettering matters most

   The workflow answers the request itself with the images (URLs or base64),
   so one call is one result. Its address is N8N_FLIER_WEBHOOK_URL, or the
   instance's /webhook/api/v1/flier-image beside N8N_WEBHOOK_URL. */

const RATIO: Record<FlyerFormat, string> = { portrait: '2:3', square: '1:1', landscape: '3:2', story: '9:16' };

export function flierWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.N8N_FLIER_WEBHOOK_URL) return env.N8N_FLIER_WEBHOOK_URL;
  if (!env.N8N_WEBHOOK_URL) return null;
  try {
    return `${new URL(env.N8N_WEBHOOK_URL).origin}/webhook/api/v1/flier-image`;
  } catch {
    return null;
  }
}

export const n8nImagesConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(flierWebhookUrl(env) && env.N8N_WEBHOOK_TOKEN);

export async function generateN8nImage(opts: { engine: 'minimax' | 'openai'; prompt: string; format: FlyerFormat; n: number }): Promise<Buffer[]> {
  const url = flierWebhookUrl();
  if (!url || !process.env.N8N_WEBHOOK_TOKEN) throw new Error('n8n is not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [WEBHOOK_TOKEN_HEADER]: process.env.N8N_WEBHOOK_TOKEN },
    body: JSON.stringify({
      engine: opts.engine,
      prompt: opts.prompt.slice(0, 1500),
      aspect: RATIO[opts.format],
      n: opts.engine === 'openai' ? 1 : Math.min(Math.max(opts.n, 1), 4),
      quality: 'high',
      model: process.env.N8N_OPENAI_IMAGE_MODEL || 'gpt-image-1-mini',
    }),
    /* The instance stops a run at 180 seconds. */
    signal: AbortSignal.timeout(175_000),
  });
  if (res.status === 404) throw new Error('n8n: the Flier Image workflow is not published');
  const json = (await res.json().catch(() => null)) as { ok?: boolean; images?: { url?: string; b64?: string }[]; error?: string } | null;
  if (!res.ok || !json?.ok || !json.images?.length) throw new Error(`n8n ${opts.engine}: ${json?.error ?? `answered ${res.status}`}`);
  const images = await Promise.all(
    json.images.map(async (image) => {
      if (image.b64) return Buffer.from(image.b64, 'base64');
      if (image.url && /^https?:\/\//.test(image.url)) {
        const r = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      }
      return null;
    }),
  );
  return images.filter((image): image is Buffer => Boolean(image?.length));
}
