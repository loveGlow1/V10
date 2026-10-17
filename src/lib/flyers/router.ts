import type { FlyerRequest, Provider } from './types';

const MIN_REFS_FOR_PRO = 2;

const FALLBACK: Record<Provider, Provider[]> = {
  'nano-banana-2': ['nano-banana-pro', 'gpt-image-2', 'ideogram-v3', 'minimax-image'],
  'nano-banana-pro': ['gpt-image-2', 'ideogram-v3', 'minimax-image'],
  'gpt-image-2': ['nano-banana-pro', 'ideogram-v3', 'minimax-image'],
  'gpt-image-1.5': ['gpt-image-2', 'nano-banana-pro', 'minimax-image'],
  'ideogram-v3': ['gpt-image-2', 'nano-banana-pro', 'minimax-image'],
  /* MiniMax image-01 on the account's MiniMax key: behind the others, which
     set text more reliably, and always there when it is the only key. */
  'minimax-image': ['gpt-image-2', 'ideogram-v3', 'nano-banana-pro'],
  'n8n-minimax': ['n8n-openai', 'fal-nano-banana', 'gpt-image-2', 'ideogram-v3', 'nano-banana-2', 'minimax-image'],
  'n8n-openai': ['n8n-minimax', 'fal-nano-banana', 'gpt-image-2', 'ideogram-v3', 'nano-banana-pro', 'minimax-image'],
  /* Nano Banana Pro on fal: the first paid model, behind the free credit. */
  'fal-nano-banana': ['gpt-image-2', 'ideogram-v3', 'nano-banana-pro', 'minimax-image'],
};

export function pickPrimary(req: FlyerRequest): Provider {
  if (req.provider && req.provider !== 'auto') return req.provider;
  if ((req.stage ?? 'preview') === 'preview') return 'nano-banana-2';
  if (req.spec.styleIntent === 'typography') return 'ideogram-v3';
  const refCount = req.brand.referenceImageUrls?.length ?? 0;
  if (req.brand.logoUrl && refCount >= MIN_REFS_FOR_PRO) return 'nano-banana-pro';
  return 'gpt-image-2';
}

/* Which providers this deployment has a key for. A chain only names those,
   so a missing key is skipped rather than tried and failed. */
const KEY: Record<Provider, string> = {
  'nano-banana-2': 'GEMINI_API_KEY',
  'nano-banana-pro': 'GEMINI_API_KEY',
  'gpt-image-2': 'OPENAI_API_KEY',
  'gpt-image-1.5': 'OPENAI_API_KEY',
  'ideogram-v3': 'IDEOGRAM_API_KEY',
  'minimax-image': 'MINIMAX_API_KEY',
  'n8n-minimax': 'N8N_WEBHOOK_TOKEN',
  'n8n-openai': 'N8N_WEBHOOK_TOKEN',
  'fal-nano-banana': 'FAL_KEY',
};
const n8nUrl = (env: Record<string, string | undefined>) => Boolean(env.N8N_FLIER_WEBHOOK_URL || env.N8N_WEBHOOK_URL);
export const providerConfigured = (p: Provider, env: Record<string, string | undefined> = process.env) =>
  Boolean(env[KEY[p]]) && (!p.startsWith('n8n-') || n8nUrl(env));

/* The n8n usage credit first: its gateway pays for MiniMax and OpenAI, so a
   draft goes to MiniMax there (four in one call) and a final to OpenAI there
   (the best lettering), before any model on a key of our own. */
const CREDIT_FIRST: Record<'preview' | 'final', Provider[]> = {
  preview: ['n8n-minimax', 'n8n-openai', 'fal-nano-banana'],
  final: ['n8n-openai', 'n8n-minimax', 'fal-nano-banana'],
};

/* FLIER_ENGINE=nano-banana puts Nano Banana Pro on fal ahead of the free
   credit — the sharpest lettering, paid for on FAL_KEY. */
const preferred = (env: Record<string, string | undefined>): Provider[] => (env.FLIER_ENGINE === 'nano-banana' ? ['fal-nano-banana'] : []);

export function providerChain(req: FlyerRequest, env: Record<string, string | undefined> = process.env): Provider[] {
  const primary = pickPrimary(req);
  const credit = req.provider && req.provider !== 'auto' ? [] : CREDIT_FIRST[req.stage === 'final' ? 'final' : 'preview'];
  const head = req.provider && req.provider !== 'auto' ? [] : preferred(env);
  const all: Provider[] = [...head, ...credit.filter((p) => !head.includes(p)), primary, ...FALLBACK[primary].filter((p) => p !== primary && !credit.includes(p) && !head.includes(p))];
  if (all.indexOf(primary) !== all.lastIndexOf(primary)) all.splice(all.lastIndexOf(primary), 1);
  for (const p of ['gpt-image-2', 'ideogram-v3', 'nano-banana-pro', 'minimax-image'] as Provider[]) if (!all.includes(p)) all.push(p);
  return all.filter((p) => providerConfigured(p, env));
}

/* Reference URLs arrive in the request body and are fetched by the server,
   so only public https addresses are allowed — never localhost, a private or
   link-local network, or a cloud metadata address. */
export function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.includes(':')) return false; // IPv6 literals: refuse rather than classify
  return true;
}

export function refsFor(req: FlyerRequest, p: Provider): string[] {
  const shots = (req.brand.referenceImageUrls ?? []).filter(isPublicHttpsUrl);
  if (p === 'ideogram-v3') return shots.slice(0, 3);                 // style refs only, no logo
  if (p === 'minimax-image' || p.startsWith('n8n-')) return [];       // no image input
  const all = ([req.brand.logoUrl, ...shots].filter(Boolean) as string[]).filter(isPublicHttpsUrl);
  if (p === 'nano-banana-2' || p === 'nano-banana-pro') return all.slice(0, 14);
  return all.slice(0, 4);                                            // OpenAI edits
}
