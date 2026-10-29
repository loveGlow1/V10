export type Provider =
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'gpt-image-2'
  | 'gpt-image-1.5'
  | 'ideogram-v3'
  | 'minimax-image'
  | 'n8n-minimax'
  | 'n8n-openai'
  | 'fal-nano-banana';

export type FlyerFormat = 'portrait' | 'square' | 'landscape' | 'story';
export type Stage = 'preview' | 'final';
export type StyleIntent = 'brand' | 'typography' | 'photo';

export interface BrandKit {
  name: string;
  colors: { primary: string; secondary?: string; accent?: string; background?: string; text?: string };
  fonts?: { heading?: string; body?: string };
  vibe?: string;
  logoUrl?: string;
  /** The flier's own logo, in the flyers bucket (<user>/brand/…). Never drawn
      by a model: stamped onto every image after it is made, in the same
      corner, so every version and every change carries the same mark. Kept
      from one revision to the next until another logo is attached or the
      person asks for none — see logo.ts. */
  logoPath?: string;
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
  styleIntent?: StyleIntent;
}

export interface FlyerRequest {
  siteId?: string;
  brand: BrandKit;
  spec: FlyerSpec;
  provider?: Provider | 'auto';
  variants?: number;
  stage?: Stage;
  parentJobId?: string;
  selectedPreviewPath?: string;
}

export interface GenOutput { provider: Provider; images: Buffer[] }
