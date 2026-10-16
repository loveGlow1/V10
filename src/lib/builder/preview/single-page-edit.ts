/* Edit mode for a single-page build.
 *
 * A Next.js project is previewed through PREVIEW_RUNTIME, which compiles its
 * source and tags every element with data-qs-src as it does. A single page is
 * served as the HTML it was stored as, with no runtime at all — so turning
 * Edit on posted to a frame nobody was listening in, and nothing in it carried
 * a place to point at. The button did nothing.
 *
 * This gives that document the same two things: every element tagged with
 * where it was written in the stored HTML ("index.html:line:col" — the lines
 * the edit path numbers), and the same edit-mode script the runtime uses,
 * speaking the same messages to the same workspace. */

import { SINGLE_PAGE } from "../tree";
import { EDIT_MODE } from "./runtime";

/* Not worth pointing at: the document's frame, what lives in its head, and
   elements with nothing to see. */
const UNTAGGED = new Set([
  "html", "head", "body", "meta", "link", "script", "style", "title", "base",
  "noscript", "template", "br", "wbr", "source", "track", "param", "col", "colgroup",
]);

/* Whose content is text, not markup — a "<" inside them is not a tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "xmp"]);

/** The page with each element marked `data-qs-src="index.html:line:col"`. */
export function tagSourceLines(html: string, path: string = SINGLE_PAGE): string {
  const lineStarts = [0];
  for (let i = 0; i < html.length; i += 1) if (html.charCodeAt(i) === 10) lineStarts.push(i + 1);
  function where(offset: number): string {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return `${path}:${low + 1}:${offset - lineStarts[low] + 1}`;
  }

  const out: string[] = [];
  let copied = 0;
  let i = 0;
  /* Inside an <svg>, only the <svg> itself is tagged: its paths are too small
     to mean anything on their own. */
  let svgDepth = 0;

  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) break;

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = html.indexOf(">", open);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const closing = html[open + 1] === "/";
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(open + (closing ? 2 : 1), open + 80));
    if (!nameMatch) {
      i = open + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const nameEnd = open + (closing ? 2 : 1) + nameMatch[0].length;

    /* The end of the tag, past any ">" inside a quoted attribute. */
    let end = nameEnd;
    let quote = "";
    for (; end < html.length; end += 1) {
      const ch = html[end];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
    }

    if (closing) {
      if (name === "svg" && svgDepth > 0) svgDepth -= 1;
      i = end + 1;
      continue;
    }

    const selfClosing = html[end - 1] === "/";
    const attributes = html.slice(nameEnd, end);
    if (svgDepth === 0 && !UNTAGGED.has(name) && !/\sdata-qs-src\s*=/i.test(attributes)) {
      out.push(html.slice(copied, nameEnd), ` data-qs-src="${where(open)}"`);
      copied = nameEnd;
    }
    if (name === "svg" && !selfClosing) svgDepth += 1;
    i = end + 1;

    if (RAW_TEXT.has(name) && !selfClosing) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      i = close < 0 ? html.length : close;
    }
  }

  out.push(html.slice(copied));
  return out.join("");
}

/* The edit-mode script for a page with no runtime: the shared fragment, the
   listener for the workspace's side of it, and 'ready' so edit mode comes back
   on after a reload. */
const SINGLE_PAGE_EDIT = `
(function () {
  'use strict';
  function report(state, detail) {
    try {
      parent.postMessage({ source: 'quickstark-preview', state: state, detail: detail || null }, '*');
    } catch (ignored) {}
  }
${EDIT_MODE}
  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.source !== 'quickstark-workspace') return;
    if (typeof data.editMode === 'boolean') { touchLayout = data.touch === true; setEditing(data.editMode); return; }
    if (data.deselect === true) { clearPicks(); selected = null; lastRect = ''; place(selectBox, null); placeLabel(null); return; }
    if (data.selectParent === true) { selectParentOf(); return; }
    if (data.preview && typeof data.preview.src === 'string') previewChange(data.preview);
  });
  function ready() { report('ready', { routes: [], tokens: designTokens() }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
`;

/** The stored page, tagged and carrying the edit-mode script, for the preview. */
export function withSinglePageEdit(html: string): string {
  const tagged = tagSourceLines(html);
  const script = `<script data-qs-edit>${SINGLE_PAGE_EDIT}</script>`;
  const close = tagged.toLowerCase().lastIndexOf("</body>");
  return close < 0 ? tagged + script : tagged.slice(0, close) + script + tagged.slice(close);
}
