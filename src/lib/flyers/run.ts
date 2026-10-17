import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateFalNanoBanana } from './providers/fal';
import { chargeCredits } from '@/lib/credits-server';
import { buildPrompt, NEGATIVE } from './prompt';
import { providerChain, refsFor } from './router';
import { generateOpenAI } from './providers/openai';
import { generateIdeogram } from './providers/ideogram';
import { generateGemini } from './providers/gemini';
import { generateMiniMaxImage } from './providers/minimax';
import { generateN8nImage } from './providers/n8n';
import type { FlyerRequest, GenOutput, Provider } from './types';

/* Created on first use rather than at import: createClient throws without a
   URL, and the build imports this module while collecting route data. */
let adminClient: SupabaseClient | null = null;
const admin = () =>
  (adminClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));

const PREVIEW_NOTE =
  'The first reference image is the approved draft. Keep its layout, composition and hierarchy; refine it into a polished, high-resolution final flyer.';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* Credits per image delivered: a draft on Nano Banana 2 is cheap, a final at
   full resolution is not. Charged once per job, for what arrived. */
export const FLYER_IMAGE_COST = { preview: 1, final: 3 } as const;
export const flyerJobCost = (stage: 'preview' | 'final', n: number) => FLYER_IMAGE_COST[stage] * n;

/** A storage path inside this user's own folder, with no way out of it. */
export function isOwnPreviewPath(path: unknown, userId: string): path is string {
  return typeof path === 'string' && path.startsWith(`${userId}/`) && !path.split('/').includes('..') && !path.includes('\\');
}

async function withSelectedPreview(req: FlyerRequest, userId: string): Promise<FlyerRequest> {
  if (!req.selectedPreviewPath) return req;
  if (!isOwnPreviewPath(req.selectedPreviewPath, userId)) throw new Error('Invalid preview path');
  const { data, error } = await admin().storage.from('flyers').createSignedUrl(req.selectedPreviewPath, 600);
  if (error || !data) throw error ?? new Error('Selected preview not found');
  return {
    ...req,
    brand: {
      ...req.brand,
      referenceImageUrls: [data.signedUrl, ...(req.brand.referenceImageUrls ?? [])],
    },
  };
}

async function runProvider(p: Provider, req: FlyerRequest, n: number): Promise<GenOutput> {
  const base = buildPrompt(req.brand, req.spec, p);
  const prompt = req.selectedPreviewPath ? `${PREVIEW_NOTE}\n${base}` : base;
  const refs = refsFor(req, p);
  const format = req.spec.format;

  let images: Buffer[];
  switch (p) {
    case 'ideogram-v3':
      images = await generateIdeogram({ prompt, format, n, refs, negative: NEGATIVE });
      break;
    case 'n8n-minimax':
      images = await generateN8nImage({ engine: 'minimax', prompt, format, n });
      break;
    case 'n8n-openai': {
      /* One image per call there, so several drafts are several calls. */
      const settled = await Promise.allSettled(Array.from({ length: n }, () => generateN8nImage({ engine: 'openai', prompt, format, n: 1 })));
      images = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      if (!images.length) {
        const first = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
        throw first?.reason instanceof Error ? first.reason : new Error('n8n openai failed');
      }
      break;
    }
    case 'fal-nano-banana':
      images = await generateFalNanoBanana({ prompt, format, n, refs });
      break;
    case 'minimax-image':
      images = await generateMiniMaxImage({ prompt, format, n, large: req.stage === 'final' });
      break;
    case 'nano-banana-2':
      images = await generateGemini({ tier: 'flash', prompt, format, n, refs, size: '1K' });
      break;
    case 'nano-banana-pro':
      images = await generateGemini({ tier: 'pro', prompt, format, n, refs, size: '2K' });
      break;
    default:
      images = await generateOpenAI({ model: p, prompt, format, n, refs });
  }
  if (!images.length) throw new Error(`${p} returned no images`);
  return { provider: p, images };
}

export async function runFlyerJob(jobId: string, userId: string, input: FlyerRequest) {
  await admin().from('flyer_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId);

  try {
    const req = await withSelectedPreview(input, userId);
    const stage = req.stage ?? 'preview';
    const n = Math.min(Math.max(req.variants ?? (stage === 'preview' ? 4 : 1), 1), 4);

    let result: GenOutput | null = null;
    const failures: string[] = [];
    for (const p of providerChain(req)) {
      try {
        result = await runProvider(p, req, n);
        break;
      } catch (e) {
        failures.push(`${p}: ${msg(e)}`);
      }
    }
    if (!result) throw new Error(failures.length ? `All providers failed -> ${failures.join(' | ')}` : 'No image provider is connected (GEMINI_API_KEY, OPENAI_API_KEY or IDEOGRAM_API_KEY).');

    const outputs: { provider: Provider; stage: string; path: string }[] = [];
    for (const [i, buf] of result.images.entries()) {
      const path = `${userId}/${jobId}/${stage}-${result.provider}-${i}.png`;
      const { error } = await admin().storage.from('flyers').upload(path, buf, {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) throw error;
      outputs.push({ provider: result.provider, stage, path });
    }

    await chargeCredits(admin(), {
      userId,
      action: 'generate',
      cost: flyerJobCost(stage, outputs.length),
      description: `Flyer ${stage}: ${outputs.length} ${outputs.length === 1 ? 'image' : 'images'} (${result.provider})`,
      dedupeKey: `flyer:${jobId}`,
    });

    await admin().from('flyer_jobs')
      .update({
        status: 'done',
        outputs,
        error: failures.length ? `Fallback used -> ${failures.join(' | ')}` : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  } catch (e) {
    await admin().from('flyer_jobs')
      .update({ status: 'failed', error: msg(e), updated_at: new Date().toISOString() })
      .eq('id', jobId);
  }
}
