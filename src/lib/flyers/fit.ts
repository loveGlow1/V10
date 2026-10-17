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
 * ── And the download is the platform's too ──────────────────────────────
 *
 * Whatever the builder wired to its "Download PNG" button is set aside: the
 * click is taken before it reaches the page's own handler, and the flier is
 * exported here, the same way on every flier —
 *
 *   - the canvas only: square corners, no shadow, nothing around it;
 *   - at twice its design size (capped at 4096px on the long edge), so a
 *     1200×628 flier saves as a sharp 2400×1256 PNG;
 *   - rendered ahead of time, after fonts and pictures load, so a tap saves
 *     at once;
 *   - on a phone, through the share sheet, whose "Save Image" puts it
 *     straight into Photos; on a computer, as a downloaded .png file.
 *
 * html-to-image (a pinned version, from jsDelivr) does the rendering.
 *
 * Pure string work here; the work itself runs in the browser. */

import { FLIER_MARK } from "./art";

export const FIT_MARK = "data-qs-flier-fit";
export const HTML_TO_IMAGE = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";

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
  /* ── The export ─────────────────────────────────────────────────── */
  var ready = null, rendering = null;
  function lib() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = '${HTML_TO_IMAGE}';
      tag.onload = function () { window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error('no renderer')); };
      tag.onerror = function () { reject(new Error('the renderer could not load')); };
      document.head.appendChild(tag);
    });
  }
  function pictures() {
    var imgs = canvas.getElementsByTagName('img'), waits = [];
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) waits.push(new Promise(function (r) { imgs[i].onload = imgs[i].onerror = r; }));
    }
    return Promise.all(waits);
  }
  function render() {
    if (rendering) return rendering;
    var ratio = Math.min(2, 4096 / Math.max(dim.w, dim.h));
    var options = {
      width: dim.w, height: dim.h, pixelRatio: ratio, cacheBust: true,
      style: { borderRadius: '0', boxShadow: 'none', transform: 'none', margin: '0', outline: 'none' }
    };
    rendering = Promise.all([lib(), document.fonts ? document.fonts.ready : null, pictures()])
      .then(function (got) {
        var h = got[0];
        /* Safari draws pictures inside the export only from the second pass. */
        return h.toBlob(canvas, options).then(function () { return h.toBlob(canvas, options); });
      })
      .then(function (blob) { if (!blob) throw new Error('empty image'); ready = blob; return blob; })
      .catch(function (error) { rendering = null; throw error; });
    return rendering;
  }
  function fileName() {
    var base = (document.title || 'flier').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'flier';
    return base + '-' + dim.w + 'x' + dim.h + '.png';
  }
  function phone() { return /iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent)); }
  function download(blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName(); a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  var note = null;
  function say(text, action) {
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font:600 15px/1.3 system-ui,sans-serif;padding:12px 18px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;max-width:90vw';
      document.body.appendChild(note);
    }
    note.textContent = text;
    if (action) {
      var b = document.createElement('button');
      b.textContent = action.label;
      b.style.cssText = 'background:#fff;color:#111;border:0;border-radius:999px;padding:8px 14px;font:700 14px system-ui,sans-serif';
      b.onclick = function () { action.run(); };
      note.appendChild(b);
    }
    clearTimeout(note.t);
    note.t = setTimeout(function () { if (note) { note.remove(); note = null; } }, action ? 15000 : 3500);
  }
  function deliver(blob) {
    var file = new File([blob], fileName(), { type: 'image/png' });
    if (phone() && navigator.canShare && navigator.canShare({ files: [file] })) {
      /* The share sheet's "Save Image" puts it straight into Photos. */
      return navigator.share({ files: [file], title: document.title || 'Flier' }).catch(function (error) {
        if (error && error.name === 'AbortError') return;
        /* The tap expired while the image was being made: one more tap. */
        say('Your image is ready.', { label: 'Save image', run: function () { deliver(blob); } });
      });
    }
    download(blob);
    say('Downloaded ' + fileName());
    return Promise.resolve();
  }
  function onClick(event) {
    var hit = event.target && event.target.closest ? event.target.closest('button, a, [role=button]') : null;
    if (!hit || !/download\\s*png|save\\s*(png|image)/i.test(hit.textContent || '')) return;
    if (hit.closest('[data-qs-fit-wrap]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (ready) { deliver(ready); return; }
    say('Making your image\u2026');
    render().then(deliver).catch(function () { say('The image could not be made. Try again in a moment.'); });
  }

  function start() {
    if (!setup()) return;
    fit();
    window.addEventListener('resize', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    window.addEventListener('click', onClick, true);
    /* Made ahead of time, so a tap saves at once. */
    setTimeout(function () { render().catch(function () {}); }, 600);
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
