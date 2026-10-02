export type Provider = 'gpt-image-2' | 'gpt-image-1.5' | 'ideogram-v3';
export type FlyerFormat = 'portrait' | 'square' | 'landscape' | 'story';

export interface BrandKit {
  name: string;
  colors: { primary: string; secondary?: string; accent?: string; background?: string; text?: string };
  fonts?: { heading?: string; body?: string };
  vibe?: string;
  logoUrl?: string;
  referenceImageUrls?: string[];
}

export interface FlyerSpec {
  headline: string;
  subhead?: string;
  details?: string[];
  cta?: string;
  imagery?: string;
  format: FlyerFormat;
  textMode: 'ai' | 'overlay';
}

export interface FlyerRequest {
  siteId?: string;
  brand: BrandKit;
  spec: FlyerSpec;
  provider?: Provider | 'auto';
  variants?: number;
}

export interface GenOutput { provider: Provider; images: Buffer[] }
