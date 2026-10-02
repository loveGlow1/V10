import { GoogleGenAI } from '@google/genai';
import type { FlyerFormat } from '../types';

/* Created on first use rather than at import, like the OpenAI client: the
   build imports this module while collecting route data. */
let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

/* GA ids at ai.google.dev: gemini-3.1-flash-image (Nano Banana 2),
   gemini-3-pro-image (Nano Banana Pro). */
const MODELS = {
  flash: process.env.GEMINI_FLASH_IMAGE_MODEL ?? 'gemini-3.1-flash-image',
  pro: process.env.GEMINI_PRO_IMAGE_MODEL ?? 'gemini-3-pro-image',
} as const;

const AR: Record<FlyerFormat, string> = {
  portrait: '2:3',
  story: '9:16',
  square: '1:1',
  landscape: '3:2',
};

async function toInlinePart(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Ref fetch failed ${r.status}: ${url}`);
  const mimeType = r.headers.get('content-type') ?? 'image/png';
  const data = Buffer.from(await r.arrayBuffer()).toString('base64');
  return { inlineData: { mimeType, data } };
}

export async function generateGemini(opts: {
  tier: 'flash' | 'pro';
  prompt: string;
  format: FlyerFormat;
  n: number;
  refs?: string[];
  size: '1K' | '2K' | '4K';
}): Promise<Buffer[]> {
  const { tier, prompt, format, n, refs, size } = opts;
  const model = MODELS[tier];
  const refParts = await Promise.all((refs ?? []).slice(0, 14).map(toInlinePart));

  // Gemini returns one image per call - fan out for n variants
  const generateOne = async (): Promise<Buffer> => {
    const res = await ai().models.generateContent({
      model,
      contents: [{ role: 'user', parts: [...refParts, { text: prompt }] }],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: AR[format], imageSize: size },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      throw new Error(`${model} returned no image (finishReason: ${res.candidates?.[0]?.finishReason ?? 'unknown'})`);
    }
    return Buffer.from(part.inlineData.data, 'base64');
  };

  const settled = await Promise.allSettled(Array.from({ length: n }, generateOne));
  const images = settled
    .filter((s): s is PromiseFulfilledResult<Buffer> => s.status === 'fulfilled')
    .map((s) => s.value);

  if (!images.length) {
    const first = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    throw first?.reason instanceof Error ? first.reason : new Error(`${model} failed`);
  }
  return images;
}
