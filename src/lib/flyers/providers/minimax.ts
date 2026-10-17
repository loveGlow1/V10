import type { FlyerFormat } from '../types';

/* MiniMax image-01, on MiniMax's own API — the same MINIMAX_API_KEY the video
   pipeline's main API uses.

   POST https://api.minimax.io/v1/image_generation (Bearer key): model image-01,
   prompt ≤1500 characters, n 1–9, response_format base64 so nothing has to be
   fetched again; width and height 512–2048, divisible by 8, which wins over
   aspect_ratio. A final is asked for at the largest size the shape allows,
   a draft at MiniMax's standard size for the ratio. There is no image input,
   so a final is made again from the prompt rather than from the draft. */

const RATIO: Record<FlyerFormat, string> = { portrait: '2:3', square: '1:1', landscape: '3:2', story: '9:16' };
const LARGE: Record<FlyerFormat, [number, number]> = {
  portrait: [1344, 2016],
  square: [2048, 2048],
  landscape: [2016, 1344],
  story: [1152, 2048],
};

const ERRORS: Record<number, string> = {
  1002: 'MiniMax is rate-limiting right now',
  1004: 'the MiniMax key was refused',
  1008: 'the MiniMax account is out of credit',
  1026: 'MiniMax refused the prompt as sensitive',
  2013: 'MiniMax refused the settings',
  2049: 'the MiniMax key is not valid',
};

export async function generateMiniMaxImage(opts: { prompt: string; format: FlyerFormat; n: number; large?: boolean }): Promise<Buffer[]> {
  const size = opts.large ? { width: LARGE[opts.format][0], height: LARGE[opts.format][1] } : { aspect_ratio: RATIO[opts.format] };
  const res = await fetch('https://api.minimax.io/v1/image_generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
    body: JSON.stringify({ model: 'image-01', prompt: opts.prompt.slice(0, 1500), n: Math.min(Math.max(opts.n, 1), 9), response_format: 'base64', ...size }),
    signal: AbortSignal.timeout(180_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: { image_base64?: string[] }; base_resp?: { status_code?: number; status_msg?: string } } | null;
  const code = Number(json?.base_resp?.status_code ?? -1);
  if (code !== 0) throw new Error(`MiniMax image ${res.status}: ${ERRORS[code] ?? json?.base_resp?.status_msg ?? 'failed'}`);
  return (json?.data?.image_base64 ?? []).map((b64) => Buffer.from(b64, 'base64'));
}
