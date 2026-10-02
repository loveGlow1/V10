import type { FlyerFormat } from '../types';

/* Field names and values checked against POST /v1/ideogram-v3/generate
   (multipart/form-data, Api-Key header): aspect_ratio uses "WxH" with an x,
   rendering_speed TURBO|DEFAULT|QUALITY, magic_prompt AUTO|ON|OFF,
   num_images 1–8, style_type AUTO|GENERAL|REALISTIC|DESIGN|FICTION,
   style_reference_images as files (JPEG/PNG/WebP). */
const AR: Record<FlyerFormat, string> = {
  portrait: '2x3',
  story: '9x16',
  square: '1x1',
  landscape: '3x2',
};

export async function generateIdeogram(opts: {
  prompt: string;
  format: FlyerFormat;
  n: number;
  refs?: string[];
  negative?: string;
}): Promise<Buffer[]> {
  const { prompt, format, n, refs, negative } = opts;
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', AR[format]);
  form.append('rendering_speed', 'QUALITY');
  form.append('magic_prompt', 'OFF');
  form.append('num_images', String(n));
  if (negative) form.append('negative_prompt', negative);

  if (refs?.length) {
    for (const [i, url] of refs.slice(0, 3).entries()) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Ref fetch failed ${r.status}: ${url}`);
      const type = r.headers.get('content-type') ?? 'image/png';
      form.append('style_reference_images', new Blob([await r.arrayBuffer()], { type }), `ref-${i}.png`);
    }
  } else {
    form.append('style_type', 'DESIGN');
  }

  const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
    method: 'POST',
    headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY! },
    body: form,
  });
  if (!res.ok) throw new Error(`Ideogram ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { data: { url: string }[] };
  // Ideogram URLs expire - download immediately
  return Promise.all(
    json.data.map(async (d) => Buffer.from(await (await fetch(d.url)).arrayBuffer())),
  );
}
