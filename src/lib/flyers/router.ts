import type { FlyerRequest, Provider } from './types';

const MIN_REFS_FOR_PRO = 2;

const FALLBACK: Record<Provider, Provider[]> = {
  'nano-banana-2': ['nano-banana-pro', 'gpt-image-2'],
  'nano-banana-pro': ['gpt-image-2', 'ideogram-v3'],
  'gpt-image-2': ['nano-banana-pro', 'ideogram-v3'],
  'gpt-image-1.5': ['gpt-image-2', 'nano-banana-pro'],
  'ideogram-v3': ['gpt-image-2', 'nano-banana-pro'],
};

export function pickPrimary(req: FlyerRequest): Provider {
  if (req.provider && req.provider !== 'auto') return req.provider;
  if ((req.stage ?? 'preview') === 'preview') return 'nano-banana-2';
  if (req.spec.styleIntent === 'typography') return 'ideogram-v3';
  const refCount = req.brand.referenceImageUrls?.length ?? 0;
  if (req.brand.logoUrl && refCount >= MIN_REFS_FOR_PRO) return 'nano-banana-pro';
  return 'gpt-image-2';
}

export function providerChain(req: FlyerRequest): Provider[] {
  const primary = pickPrimary(req);
  return [primary, ...FALLBACK[primary].filter((p) => p !== primary)];
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
  const all = ([req.brand.logoUrl, ...shots].filter(Boolean) as string[]).filter(isPublicHttpsUrl);
  if (p === 'nano-banana-2' || p === 'nano-banana-pro') return all.slice(0, 14);
  return all.slice(0, 4);                                            // OpenAI edits
}
