/* "Page as shown": the page as it stands in the preview, after its scripts
 * have run — the menu filled in, the tab switched, the form typed into — as an
 * HTML file that opens the same way anywhere.
 *
 * Only the browser running the page knows that state, so the preview
 * document carries a listener: asked by the workspace (postMessage, the only
 * channel an opaque-origin frame has), it answers with its own document,
 * frozen. Frozen means:
 *
 *   - its scripts removed, so opening the file does not run them a second
 *     time over content they already produced (a list filled twice);
 *   - what was typed or chosen in a form written into the markup, which a
 *     plain clone leaves behind;
 *   - the preview's own markers (data-qs-*) and helpers taken out, so the file
 *     is the site and nothing of the workspace.
 *
 * Styles stay, including the ones a script wrote (Tailwind's CDN puts its
 * stylesheet in a <style> tag), so the file looks as the preview did.
 * Pure strings here; the listener runs in the preview. */

export const SNAPSHOT_REQUEST = "snapshot";

const BRIDGE = `(function(){
  /* Marked on the page's own <html>: a static site's next page is written
     with document.open, which clears every listener but keeps the window and
     the document object — only the markup is new. */
  var root = document.documentElement;
  if (root.hasAttribute('data-qs-snapshot-on')) return;
  root.setAttribute('data-qs-snapshot-on', '');
  function freeze(){
    var live = document.documentElement, copy = live.cloneNode(true);
    var from = live.querySelectorAll('input,textarea,select'), to = copy.querySelectorAll('input,textarea,select');
    for (var i = 0; i < from.length && i < to.length; i++) {
      var a = from[i], b = to[i];
      if (a.tagName === 'TEXTAREA') b.textContent = a.value;
      else if (a.tagName === 'SELECT') { for (var j = 0; j < a.options.length; j++) { if (a.options[j].selected) b.options[j].setAttribute('selected', ''); else b.options[j].removeAttribute('selected'); } }
      else if (a.type === 'checkbox' || a.type === 'radio') { if (a.checked) b.setAttribute('checked', ''); else b.removeAttribute('checked'); }
      else if (a.type !== 'password' && a.type !== 'file') b.setAttribute('value', a.value);
    }
    var scripts = copy.querySelectorAll('script');
    for (var k = 0; k < scripts.length; k++) scripts[k].remove();
    /* The <html> itself too, which carries this listener's own marker. */
    var marked = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    for (var m = 0; m < marked.length; m++) {
      var names = [];
      for (var n = 0; n < marked[m].attributes.length; n++) { var name = marked[m].attributes[n].name; if (name.indexOf('data-qs') === 0) names.push(name); }
      for (var q = 0; q < names.length; q++) marked[m].removeAttribute(names[q]);
    }
    return '<!doctype html>\\n' + copy.outerHTML;
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'quickstark-host' || data.type !== '${SNAPSHOT_REQUEST}') return;
    var html = null;
    try { html = freeze(); } catch (error) {}
    try { (event.source || parent).postMessage({ source: 'quickstark-preview', type: '${SNAPSHOT_REQUEST}', id: data.id, html: html }, '*'); } catch (ignored) {}
  });
})();`;

/** The page with the "page as shown" listener added. Pure. */
export function withSnapshotBridge(html: string): string {
  const script = `<script data-qs-snapshot>${BRIDGE}</script>`;
  const close = html.toLowerCase().lastIndexOf("</body>");
  return close < 0 ? html + script : html.slice(0, close) + script + html.slice(close);
}
