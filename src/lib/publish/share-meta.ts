/* What a link to a published page shows when it is pasted into WhatsApp,
 * X, Facebook or LinkedIn: a title, a line, and a picture.
 *
 * Written into the page when it is SERVED, from the snapshot being served,
 * rather than trusted to the page itself. Two reasons. Pages are written by a
 * model that often leaves og:image out — the Jimmy Bankz page had a title and
 * a description and no picture, so every share was a bare link. And a picture
 * chosen at build time goes stale the moment the hero changes: the share card
 * kept showing a photograph the page no longer had. Read from the page that is
 * live, it is always the picture that is live.
 *
 *   og:image   the hero photograph — an <img data-hero-photo>, else one
 *              marked fetchpriority="high", else the first https image
 *   og:url     the address it was served on, so a renamed site shares its
 *              new address
 *   twitter    summary_large_image, so X shows the picture large
 *
 * The live hero always wins; a page's own og:image is kept only when it has
 * no hero picture. og:url is always ours.
 * Pure (tools/check-publish.mjs). */

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The page's hero picture, as an absolute https address, or null. */
export function heroImageOf(html: string): string | null {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const src = (tag: string) => tag.match(/\ssrc\s*=\s*["'](https:\/\/[^"']+)["']/i)?.[1] ?? null;
  const pick =
    imgs.find((tag) => /\sdata-hero-photo\b/i.test(tag) && src(tag)) ??
    imgs.find((tag) => /\sfetchpriority\s*=\s*["']high["']/i.test(tag) && src(tag)) ??
    imgs.find((tag) => src(tag));
  return pick ? src(pick)!.replace(/&amp;/g, "&") : null;
}

/** The page with its share card filled in for the address it is served on. */
export function withShareMeta(html: string, input: { url: string }): string {
  const head = html.match(/<head\b[^>]*>/i);
  if (!head) return html;

  let page = html.replace(/<meta\b[^>]*property\s*=\s*["']og:url["'][^>]*>\s*/gi, "");
  const tags: string[] = [`<meta property="og:url" content="${escape(input.url)}">`];

  /* The hero that is live wins over a card written at build time: that is
     the card that kept showing a photograph the page no longer had. A page's
     own card is kept only when it has no hero to take one from. */
  const image = heroImageOf(page);
  if (image) page = page.replace(/<meta\b[^>]*(property|name)\s*=\s*["'](og:image(:\w+)?|twitter:image)["'][^>]*>\s*/gi, "");
  const hasImage = /<meta\b[^>]*(property|name)\s*=\s*["'](og:image|twitter:image)["']/i.test(page);
  if (image) {
    tags.push(`<meta property="og:image" content="${escape(image)}">`);
    tags.push(`<meta name="twitter:image" content="${escape(image)}">`);
  }
  if (!/<meta\b[^>]*name\s*=\s*["']twitter:card["']/i.test(page)) {
    tags.push(`<meta name="twitter:card" content="${hasImage || image ? "summary_large_image" : "summary"}">`);
  }
  if (!/<meta\b[^>]*property\s*=\s*["']og:type["']/i.test(page)) tags.push(`<meta property="og:type" content="website">`);

  const at = page.search(/<head\b[^>]*>/i) + (page.match(/<head\b[^>]*>/i)?.[0].length ?? 0);
  page = `${page.slice(0, at)}\n${tags.join("\n")}${page.slice(at)}`;
  return page;
}
