import OpenAI, { toFile } from 'openai';
import type { FlyerFormat } from '../types';

/* Created on first use rather than at import: `new OpenAI()` throws without
   OPENAI_API_KEY, and the build imports this module while collecting route
   data — an import-time client would fail every build until the key is set. */
let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI());

const SIZE: Record<FlyerFormat, '1024x1024' | '1024x1536' | '1536x1024'> = {
  portrait: '1024x1536',
  story: '1024x1536',
  square: '1024x1024',
  landscape: '1536x1024',
};

async function urlToFile(url: string, i: number) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Ref fetch failed ${r.status}: ${url}`);
  const type = r.headers.get('content-type') ?? 'image/png';
  return toFile(Buffer.from(await r.arrayBuffer()), `ref-${i}.${type.split('/')[1] ?? 'png'}`, { type });
}

export async function generateOpenAI(opts: {
  model: 'gpt-image-2' | 'gpt-image-1.5';
  prompt: string;
  format: FlyerFormat;
  n: number;
  refs?: string[];
}): Promise<Buffer[]> {
  const { model, prompt, format, n, refs } = opts;

  const res = refs?.length
    ? await openai().images.edit({
        model,
        image: await Promise.all(refs.slice(0, 4).map(urlToFile)),
        prompt,
        size: SIZE[format],
        quality: 'high',
        n,
      })
    : await openai().images.generate({
        model,
        prompt,
        size: SIZE[format],
        quality: 'high',
        n,
      });

  return (res.data ?? []).map((d) => Buffer.from(d.b64_json!, 'base64'));
}
