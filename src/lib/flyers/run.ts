import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildPrompt, NEGATIVE } from './prompt';
import { pickProviders, refsFor } from './router';
import { generateOpenAI } from './providers/openai';
import { generateIdeogram } from './providers/ideogram';
import type { FlyerRequest, GenOutput, Provider } from './types';

/* Created on first use rather than at import: createClient throws without a
   URL, and the build imports this module while collecting route data. */
let adminClient: SupabaseClient | null = null;
const admin = () =>
  (adminClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));

async function runProvider(p: Provider, req: FlyerRequest, n: number): Promise<GenOutput> {
  const prompt = buildPrompt(req.brand, req.spec, p);
  const refs = refsFor(req, p);
  const images =
    p === 'ideogram-v3'
      ? await generateIdeogram({ prompt, format: req.spec.format, n, refs, negative: NEGATIVE })
      : await generateOpenAI({ model: p, prompt, format: req.spec.format, n, refs });
  return { provider: p, images };
}

export async function runFlyerJob(jobId: string, userId: string, req: FlyerRequest) {
  await admin().from('flyer_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId);

  try {
    const n = Math.min(Math.max(req.variants ?? 2, 1), 4);
    const providers = pickProviders(req);
    const isAuto = !req.provider || req.provider === 'auto';

    let results = (await Promise.allSettled(
      (isAuto ? providers : providers.slice(0, 1)).map((p) => runProvider(p, req, n)),
    ))
      .filter((r): r is PromiseFulfilledResult<GenOutput> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (!results.length && !isAuto) {
      const fallback: Provider = providers[0] === 'ideogram-v3' ? 'gpt-image-2' : 'ideogram-v3';
      results = [await runProvider(fallback, req, n)];
    }
    if (!results.length) throw new Error('All providers failed');

    const outputs: { provider: Provider; path: string }[] = [];
    for (const r of results) {
      for (const [i, buf] of r.images.entries()) {
        const path = `${userId}/${jobId}/${r.provider}-${i}.png`;
        const { error } = await admin().storage.from('flyers').upload(path, buf, {
          contentType: 'image/png',
          upsert: true,
        });
        if (error) throw error;
        outputs.push({ provider: r.provider, path });
      }
    }

    await admin().from('flyer_jobs')
      .update({ status: 'done', outputs, updated_at: new Date().toISOString() })
      .eq('id', jobId);
  } catch (e) {
    await admin().from('flyer_jobs')
      .update({ status: 'failed', error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() })
      .eq('id', jobId);
  }
}
