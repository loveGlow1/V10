/* Projects that make media rather than a website: a video (lib/video/workspace.ts)
 * or a flier (lib/flyers/workspace.ts). They are downloaded and shared, never
 * published as an app, so the workspace shows no Publish for them. Pure. */

export const MEDIA_INTENTS = ["video", "flier"] as const;

export function isMediaIntent(intent: string | null | undefined): boolean {
  return Boolean(intent) && (MEDIA_INTENTS as readonly string[]).includes(intent as string);
}
