/* Ready-to-post versions of the cut, made beside it: the shapes the social
   apps want, each the whole picture over a blurred fill of itself (nothing
   cropped away), and a WhatsApp file small enough not to be squashed again
   (its limit is 16 MB). Which are made depends on the cut's own shape. */
export type ExportKind = "vertical" | "feed" | "whatsapp";
export const EXPORT_LABEL: Record<ExportKind, string> = { vertical: "Reels · TikTok · Shorts (9:16)", feed: "Instagram & Facebook feed (4:5)", whatsapp: "WhatsApp (small file)" };
export function exportsFor(aspect: string): ExportKind[] {
  return aspect === "9:16" ? ["feed", "whatsapp"] : aspect === "4:5" ? ["vertical", "whatsapp"] : ["vertical", "feed", "whatsapp"];
}

/** Where a ready-to-post version of a cut is stored: beside it. Pure. */
export const exportPath = (cutPath: string, kind: ExportKind) => cutPath.replace(/\.mp4$/, `-${kind}.mp4`);

export const isExportKind = (value: unknown): value is ExportKind => value === "vertical" || value === "feed" || value === "whatsapp";
