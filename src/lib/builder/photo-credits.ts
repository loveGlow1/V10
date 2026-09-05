/* Saying who took the photographs.
 *
 * Not decoration and not politeness: it is the condition on which the pictures
 * are free. Unsplash's API guidelines require the photographer and Unsplash
 * itself to be credited with links back, and it is the first thing a reviewer
 * looks at when an application asks to leave the 50-an-hour demo tier. Pexels
 * asks where practical. A build that fills a dozen slots and credits nobody is
 * a licence breach and a rejected application at the same time.
 *
 * It was being collected already — fillImages returns every credit it used —
 * and then dropped on the floor by the caller. This is the half that was
 * missing.
 *
 * ── Why it goes in the page rather than in our UI ──────────────────────────
 *
 * The obligation travels with the photograph. A credit shown in the builder is
 * seen by the one person who did not need telling; the page is where the
 * picture is published, so the page is where the line belongs.
 */

export type PhotoCredit = { author: string; source: string; url: string };

/* Our own identifier in the links back, which the guidelines ask for so a
   photographer can see where their work is being used. */
const UTM = "utm_source=quickstark&utm_medium=referral";

function withUtm(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + UTM;
}

/* &, <, > and the quote characters, so a photographer called "Ana & Co" cannot
   close the attribute they are being written into. */
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* One line per photographer, not per photograph: six pictures by one person is
   one credit, and a page that names them six times reads as a fault. Keyed on
   the link rather than the name, because two photographers share a name more
   often than they share a profile. */
function unique(credits: PhotoCredit[]): PhotoCredit[] {
  const seen = new Map<string, PhotoCredit>();
  for (const credit of credits) {
    if (!credit?.author || !credit?.url) continue;
    if (!seen.has(credit.url)) seen.set(credit.url, credit);
  }
  return [...seen.values()];
}

/**
 * Adds a credit line to a finished page. Returns the page unchanged when there
 * is nothing to credit.
 *
 * Appended before </body> rather than woven into the layout, because this runs
 * on a document a model wrote and nothing here knows what that document looks
 * like. A block that sits last, states its own colours and inherits no layout
 * cannot be pushed through a floated column or inverted by a dark section.
 *
 * Idempotent by marker: a page filled twice — a rebuild, a save replayed —
 * gets one credit block, not two.
 */
export function addPhotoCredits(html: string, credits: PhotoCredit[]): string {
  const list = unique(credits);
  if (list.length === 0) return html;
  if (html.includes("data-quickstark-credits")) return html;

  const links = list
    .map(
      (credit) =>
        `<a href="${escape(withUtm(credit.url))}" target="_blank" rel="noopener noreferrer nofollow">${escape(
          credit.author,
        )}</a>`,
    )
    .join(", ");

  /* Named separately from the photographers, which is what the guidelines ask
     for: the library is credited as well as the person. */
  const sources = unique(
    list.map((credit) => ({
      author: credit.source,
      source: credit.source,
      url: credit.source === "Pexels" ? "https://pexels.com" : "https://unsplash.com",
    })),
  )
    .map(
      (source) =>
        `<a href="${escape(withUtm(source.url))}" target="_blank" rel="noopener noreferrer nofollow">${escape(
          source.author,
        )}</a>`,
    )
    .join(" and ");

  const block =
    `\n<div data-quickstark-credits style="padding:14px 20px;font:400 12px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
    `color:#6b7280;background:transparent;text-align:center">` +
    `Photographs by ${links} on ${sources}.` +
    `</div>\n`;

  /* Before the closing tag where there is one. A fragment without </body> gets
     it appended, which is the same place by another name. */
  const close = html.lastIndexOf("</body>");
  return close === -1 ? html + block : html.slice(0, close) + block + html.slice(close);
}
