/* A flier is a picture, so it shrinks like one.
 *
 * A flier canvas is designed at one exact size — 1200×628, 1080×1920 — with
 * its type set in pixels for that size. The flier rules ask the builder to
 * scale the canvas down as a whole on a small screen, and a model does not
 * always manage it: it lets the box follow the window (width: 100%) while the
 * type stays at its design size, so on a phone the headline runs out of the
 * artwork and the canvas is cut off at the edge.
 *
 * So the platform does it, on every flier page it serves:
 *
 *   - the canvas is found: [data-qs-flier], or — for a flier made before the
 *     marker existed — the box whose shape matches the "1200 × 628 px" the
 *     page prints beside its download button;
 *   - it is pinned at its native size, exactly as designed;
 *   - a wrapper AROUND it is scaled to the space available, never above 1.
 *
 * The canvas itself is never transformed, so "Download PNG" — which captures
 * the canvas element — still exports it at full size, sharp.
 *
 * Pure string work here; the work itself runs in the browser. */

import { FLIER_MARK } from "./art";

export const FIT_MARK = "data-qs-flier-fit";

/** Whether a page is a flier canvas — marked, or an older one with a PNG download and a printed size. Pure. */
export function looksLikeFlier(html: string): boolean {
  if (html.includes(FLIER_MARK)) return true;
  return /download\s*png/i.test(html) && /\b\d{3,4}\s*(?:×|&times;|x)\s*\d{3,4}\s*px\b/i.test(html);
}

const SCRIPT = `(function () {
  var NATIVE = /(\\d{3,4})\\s*(?:\\u00d7|x)\\s*(\\d{3,4})\\s*px/i;
  function size(canvas) {
    var w = Number(canvas && canvas.getAttribute('data-width')), h = Number(canvas && canvas.getAttribute('data-height'));
    if (w > 0 && h > 0) return { w: w, h: h };
    var m = (document.body.innerText || '').match(NATIVE);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  }
  function find(dim) {
    var marked = document.querySelector('[${FLIER_MARK}]');
    if (marked) return marked;
    if (!dim) return null;
    var want = dim.w / dim.h, best = null, area = 0;
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('[data-qs-fit-wrap]') && !el.hasAttribute('data-qs-fit-canvas')) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 60) continue;
      if (Math.abs(r.width / r.height - want) / want > 0.03) continue;
      if (r.width * r.height > area) { best = el; area = r.width * r.height; }
    }
    return best;
  }
  var canvas = null, dim = null, wrap = null, scaler = null;
  function setup() {
    dim = size(document.querySelector('[${FLIER_MARK}]'));
    canvas = find(dim);
    if (!canvas) return false;
    dim = size(canvas) || dim;
    if (!dim) {
      var r = canvas.getBoundingClientRect();
      dim = { w: Math.round(r.width), h: Math.round(r.height) };
    }
    canvas.setAttribute('data-qs-fit-canvas', '');
    var s = canvas.style;
    s.setProperty('width', dim.w + 'px', 'important');
    s.setProperty('height', dim.h + 'px', 'important');
    s.setProperty('max-width', 'none', 'important');
    s.setProperty('max-height', 'none', 'important');
    s.setProperty('min-width', dim.w + 'px', 'important');
    s.setProperty('aspect-ratio', 'auto', 'important');
    s.setProperty('flex', 'none', 'important');
    s.setProperty('margin', '0', 'important');
    wrap = document.createElement('div');
    wrap.setAttribute('data-qs-fit-wrap', '');
    wrap.style.cssText = 'position:relative;overflow:hidden;margin:0 auto;max-width:100%;';
    scaler = document.createElement('div');
    scaler.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;width:' + dim.w + 'px;height:' + dim.h + 'px;';
    canvas.parentNode.insertBefore(wrap, canvas);
    scaler.appendChild(canvas);
    wrap.appendChild(scaler);
    return true;
  }
  function fit() {
    if (!wrap || !dim) return;
    var parent = wrap.parentElement;
    var cs = parent ? getComputedStyle(parent) : null;
    var room = parent ? parent.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0') : window.innerWidth;
    room = Math.min(room, document.documentElement.clientWidth - 16);
    var k = Math.min(1, room / dim.w);
    scaler.style.transform = 'scale(' + k + ')';
    wrap.style.width = dim.w * k + 'px';
    wrap.style.height = dim.h * k + 'px';
  }
  function start() {
    if (!setup()) return;
    fit();
    window.addEventListener('resize', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();`;

/** The page with the fit script added before </body>, once. Unchanged when it is not a flier. Pure. */
export function withFlierFit(html: string): string {
  if (!looksLikeFlier(html) || html.includes(FIT_MARK)) return html;
  const tag = `<script ${FIT_MARK}>${SCRIPT}</script>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? `${html}${tag}` : `${html.slice(0, at)}${tag}${html.slice(at)}`;
}
