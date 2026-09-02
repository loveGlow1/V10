import { randomUUID } from "node:crypto";

import { ATTACHMENTS_BUCKET, type AttachmentRow } from "@/lib/builder/attachments";
import { thumbnail } from "@/lib/builder/assets/asset-optimizer";
import { recordAsset, storeAsset } from "@/lib/builder/assets/asset-storage";
import { DEFAULT_QUALITY, type Asset, type AssetType } from "@/lib/builder/assets/asset-types";
import type { BuildKind } from "@/lib/builder/kinds";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Turning what somebody attached into assets the build can actually use.
 *
 * Uploading a photograph of your own product and watching the builder draw a
 * vector approximation of it instead is the most annoying thing this product
 * could do, and until now it was what happened. Three separate reasons, all of
 * which this file exists to fix:
 *
 *   1. An attachment was never an asset. It went to the model as something to
 *      LOOK AT, and the asset pipeline — whose first and highest-priority
 *      source is "what the user gave us" — had nothing to read, because
 *      nothing was ever written to project_assets.
 *
 *   2. Attachments live in a private bucket behind signed URLs that expire in
 *      an hour. A page that referenced one would work until lunchtime. So the
 *      bytes are copied into the public asset bucket, where they get a stable
 *      address and a year of cache.
 *
 *   3. The instruction that travelled with them said to "recreate what they
 *      show in HTML and CSS rather than linking to them" — right for a design
 *      screenshot, exactly wrong for a product photograph.
 *
 * That third one is the distinction this file draws, and it is a judgement
 * rather than a fact: an image somebody attaches is either CONTENT, which
 * belongs on the page as itself, or REFERENCE, which is a picture of what they
 * want the page to look like. A logo and a product shot are content. A
 * screenshot, a mockup, a competitor's homepage are reference.
 *
 * It is guessed from the filename first, because people name files, and from
 * the kind of thing being built second. Getting it wrong is recoverable in
 * both directions — a reference treated as content appears on the page and can
 * be removed, a product treated as reference gets redrawn and can be re-sent —
 * so it errs toward content, which is the case somebody is more likely to be
 * upset about. */

/* Named by what they are. Checked before anything else, because a filename is
   the closest thing to the person telling us directly. */
const BY_NAME: { match: RegExp; type: AssetType }[] = [
  { match: /\b(logo|wordmark|brandmark|brand[-_ ]?mark)\b/i, type: "logo" },
  { match: /\b(icon|favicon|symbol)\b/i, type: "icon" },
  { match: /\b(hero|banner|masthead|cover[-_ ]?photo)\b/i, type: "hero" },
  { match: /\b(product|item|sku|packshot|pack[-_ ]?shot)\b/i, type: "product" },
  { match: /\b(portrait|headshot|team|staff|author|founder)\b/i, type: "portrait" },
  { match: /\b(lifestyle|in[-_ ]?use|context)\b/i, type: "lifestyle" },
  { match: /\b(article|post|editorial|feature)\b/i, type: "article-cover" },
];

/* Named as something to copy rather than something to show. These never become
   assets; they stay as vision input and the page is built to look like them. */
const REFERENCE =
  /\b(screenshot|screen[-_ ]?grab|mockup|mock[-_ ]?up|wireframe|design|reference|inspo|inspiration|example|figma|sketch|comp|moodboard|mood[-_ ]?board)\b/i;

/* What an unnamed image most likely is, given what is being built. Somebody
   uploading a folder of photographs to a storefront is uploading their
   catalogue; the same folder on a web app is far more likely to be a design
   somebody wants matched. */
const BY_KIND: Record<BuildKind, AssetType | "reference"> = {
  ecommerce: "product",
  landing: "editorial",
  blog: "article-cover",
  webapp: "reference",
};

export type Intake = {
  /** Registered as project assets, and now first in line for their slots. */
  assets: Asset[];
  /** Left as vision input: pictures of what the page should look like. */
  reference: AttachmentRow[];
};

function classify(row: AttachmentRow, kind: BuildKind): AssetType | "reference" {
  const name = row.name ?? "";
  if (REFERENCE.test(name)) return "reference";

  const named = BY_NAME.find((entry) => entry.match.test(name));
  if (named) return named.type;

  return BY_KIND[kind];
}

/* The slot names the planner will ask for, so an upload can be tagged with the
   one it should fill. Numbered per type in upload order, which is the only
   ordering anybody has expressed — and the reason it matters is that eight
   product photographs have to land in eight different slots. */
function slotFor(type: AssetType, index: number): string {
  if (type === "logo" || type === "hero") return type;
  if (type === "product") return `product-${index + 1}`;
  if (type === "article-cover") return index === 0 ? "lead" : `article-${index}`;
  if (type === "portrait") return "author";
  if (type === "editorial") return `feature-${index + 1}`;
  if (type === "lifestyle") return `lifestyle-${index + 1}`;
  return `${type}-${index + 1}`;
}

const isImage = (mime: string): boolean => mime.startsWith("image/");

/**
 * Registers every attached image that is content, and hands back the rest.
 *
 * Never throws and never blocks a build: an upload that cannot be copied stays
 * out of the library and the build proceeds without it, which is the same state
 * as not having attached it. Already-registered attachments are skipped, so a
 * second build on the same project does not duplicate them.
 */
export async function intakeAttachments(opts: {
  projectId: string;
  kind: BuildKind;
  rows: AttachmentRow[];
  /** Already in the library, so the same upload is not taken in twice. */
  existing: Asset[];
}): Promise<Intake> {
  const { projectId, kind, rows, existing } = opts;
  const assets: Asset[] = [];
  const reference: AttachmentRow[] = [];

  /* An attachment is taken in once. Its own id is kept in the asset's tags so a
     rebuild recognises it rather than copying the bytes again.
     
     Worked out before storage is even looked at, because the answer does not
     depend on storage: an upload that is already an asset is finished with
     either way, and the early return below used to hand it back as a reference
     for the model to redraw — the exact behaviour this file exists to stop,
     reappearing on the one path where nothing could be stored. */
  const alreadyTaken = new Set(
    existing.flatMap((asset) => asset.tags?.filter((tag) => tag.startsWith("upload:")) ?? []),
  );
  const fresh = rows.filter(
    (row) => isImage(row.mime) && !alreadyTaken.has(`upload:${row.id}`),
  );

  const supabase = createSupabaseServiceClient();
  if (!supabase) return { assets, reference: fresh };

  const counts = new Map<AssetType, number>();

  for (const row of fresh) {
    const decided = classify(row, kind);
    if (decided === "reference") {
      reference.push(row);
      continue;
    }

    const index = counts.get(decided) ?? 0;
    counts.set(decided, index + 1);

    const bytes = await read(supabase, row.path);
    if (!bytes) {
      /* Could not be copied, so it is not an asset. Passed on as reference
         rather than dropped: the model can still look at it, which is strictly
         better than the upload vanishing without explanation. */
      reference.push(row);
      continue;
    }

    const id = randomUUID();
    const format = row.mime.includes("png") ? "png" : row.mime.includes("webp") ? "webp" : "jpeg";

    const stored = await storeAsset({
      projectId,
      assetId: id,
      bytes,
      contentType: row.mime,
      format,
    });
    if (!stored) {
      reference.push(row);
      continue;
    }

    const asset: Asset = {
      id,
      projectId,
      type: decided,
      source: "user",
      status: "ready",
      url: stored.url,
      thumbnailUrl: thumbnail(stored.url),
      format: format === "png" ? "png" : format === "webp" ? "webp" : "jpeg",
      quality: DEFAULT_QUALITY,
      altText: row.name ?? "Uploaded image",
      /* The slot it should fill, its type, and where it came from. The first is
         what places it, the last is what stops it being taken in twice. */
      tags: [slotFor(decided, index), decided, `upload:${row.id}`],
      createdAt: new Date().toISOString(),
    };

    await recordAsset(asset).catch(() => false);
    assets.push(asset);
  }

  return { assets, reference };
}

async function read(
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  path: string,
): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}
