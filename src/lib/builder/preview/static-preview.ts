/* A static site of several files — index.html beside its stylesheet, its
 * script, its other pages — previewed as one document.
 *
 * The preview is a sandboxed srcdoc frame with no address of its own, so
 * "style.css" next to the page resolves to nothing. Each page is therefore
 * served with its local stylesheets and scripts inlined, its pictures swapped
 * for their stored addresses, and a small script that opens the site's other
 * pages in place when a link to one is followed. Visual edit works as it does
 * on a single page: each element is tagged with the file and line it was
 * written at (see single-page-edit.ts). Nothing stored is changed. */

import type { FileTree } from "../tree";

import { withSinglePageEdit } from "./single-page-edit";
import { withSnapshotBridge } from "./snapshot";

/** The page a static site opens on, when the tree is one. */
export function staticEntryOf(tree: FileTree): string | null {
  const paths = tree.map((file) => file.path);
  if (paths.includes("index.html")) return "index.html";
  return paths.find((path) => /^[^/]+\.html?$/i.test(path)) ?? null;
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at + 1);
}

/* A reference from a page, as a path in the tree. Null for anything that
   leaves the site — another origin, a data address, an anchor. */
function local(ref: string, from: string): string | null {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const clean = ref.split("#")[0].split("?")[0];
  const parts = (clean.startsWith("/") ? clean.slice(1) : dirOf(from) + clean).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const attr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/* ── Modules ────────────────────────────────────────────────────────────
 *
 * A page with no address cannot resolve "./utils.js": an inlined module's
 * imports had nothing to be relative to, and the first one threw — the
 * script stopped, and the site sat there unscripted. So each local module is
 * turned into an address of its own (a data: URL) with ITS imports rewritten
 * to the same, all the way down. A cycle is left as written rather than
 * followed for ever. Bare specifiers ("react", a CDN) are left as they are. */
const IMPORT = /(\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*(?:[\w*{}\s,$]+)\s*from\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g;

function moduleSource(path: string, code: string, files: Map<string, string>, seen: Map<string, string | null>): string {
  return code.replace(IMPORT, (whole, head: string, quote: string, spec: string) => {
    if (!/^(\.{1,2}\/|\/)/.test(spec)) return whole;
    const at = local(spec, path);
    const found = at ? [at, `${at}.js`, `${at}.mjs`, `${at}/index.js`].find((candidate) => files.has(candidate)) : undefined;
    if (!found) return whole;
    const url = moduleUrl(found, files, seen);
    return url ? `${head}${quote}${url}${quote}` : whole;
  });
}

function moduleUrl(path: string, files: Map<string, string>, seen: Map<string, string | null>): string | null {
  if (seen.has(path)) return seen.get(path) ?? null;
  seen.set(path, null);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource(path, files.get(path) ?? "", files, seen))}`;
  seen.set(path, url);
  return url;
}

/* ── Local files, fetched ───────────────────────────────────────────────
 *
 * fetch("data/menu.json") from a page with no address goes nowhere. The
 * site's own text files are kept on the window and answered from there,
 * resolved from whichever page is showing; anything else goes to the
 * network as it would. Installed at the top of <head>, before any script of
 * the page's own runs. */
const DATA_FILE = /\.(json|txt|csv|md|xml|svg|geojson|tsv)$/i;
const MOST_DATA_BYTES = 2_000_000;

function fetchShim(files: Map<string, string>): string {
  const data: Record<string, string> = {};
  let total = 0;
  for (const [path, content] of files) {
    if (!DATA_FILE.test(path) || total + content.length > MOST_DATA_BYTES) continue;
    data[path] = content;
    total += content.length;
  }
  if (Object.keys(data).length === 0) return "";
  const script = `(function(){if(window.__qsFetch)return;window.__qsFetch=1;var F=${JSON.stringify(data).replace(/</g, "\\u003c")};var T={json:'application/json',svg:'image/svg+xml',csv:'text/csv',xml:'application/xml',geojson:'application/geo+json'};function find(u){if(typeof u!=='string'||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(u))return null;var c=u.split('#')[0].split('?')[0];var here=window.__qsHere||'index.html';var parts=(c.charAt(0)==='/'?c.slice(1):here.slice(0,here.lastIndexOf('/')+1)+c).split('/'),out=[];for(var i=0;i<parts.length;i++){var p=parts[i];if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p);}var path=out.join('/');return Object.prototype.hasOwnProperty.call(F,path)?path:null;}var real=window.fetch;window.fetch=function(input,init){var u=typeof input==='string'?input:(input&&input.url);var path=find(u);if(path===null)return real.apply(this,arguments);var ext=path.split('.').pop().toLowerCase();return Promise.resolve(new Response(F[path],{status:200,headers:{'Content-Type':T[ext]||'text/plain'}}));};})();`;
  return `<script data-qs-fetch>${script}</script>`;
}

function inlinePage(path: string, html: string, files: Map<string, string>, assets: Record<string, string>): string {
  const modules = new Map<string, string | null>();
  const picture = (ref: string, from: string) => {
    const at = local(ref, from);
    return at ? assets[at] ?? null : null;
  };
  const cssUrls = (css: string, from: string) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote: string, ref: string) => {
      const found = picture(ref, from);
      return found ? `url("${found}")` : whole;
    });

  let out = html
    /* <link rel="stylesheet" href="style.css"> */
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']?stylesheet/i.test(tag)) return tag;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      const at = href ? local(href, path) : null;
      const css = at ? files.get(at) : undefined;
      return css === undefined ? tag : `<style data-from="${attr(at!)}">${cssUrls(css, at!).replace(/<\/style/gi, "<\\/style")}</style>`;
    })
    /* <script src="app.js"></script> — a module with its imports made
       resolvable (moduleSource). */
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (whole, before: string, src: string, after: string) => {
      const at = local(src, path);
      const js = at ? files.get(at) : undefined;
      if (js === undefined) return whole;
      const isModule = /type=["']module["']/i.test(before + after);
      const code = isModule ? moduleSource(at!, js, files, modules) : js;
      return `<script${isModule ? ' type="module"' : ""} data-from="${attr(at!)}">${code.replace(/<\/script/gi, "<\\/script")}</script>`;
    })
    /* An inline <script type="module"> that imports the site's own files. */
    .replace(/<script\b([^>]*type=["']module["'][^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs: string, code: string) =>
      /\bsrc=/i.test(attrs) || /data-from=/i.test(attrs) ? whole : `<script${attrs}>${moduleSource(path, code, files, modules)}</script>`,
    )
    /* Pictures in markup. */
    .replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (whole, name: string, quote: string, ref: string) => {
      const found = picture(ref, path);
      return found ? `${name}=${quote}${found}${quote}` : whole;
    });
  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (whole, css: string) => whole.replace(css, cssUrls(css, path)));
  /* Local files answer fetch(), from the top of <head>, before the page's own scripts. */
  const shim = fetchShim(files);
  if (shim) {
    const head = /<head\b[^>]*>/i.exec(out);
    out = head ? out.slice(0, head.index + head[0].length) + shim + out.slice(head.index + head[0].length) : shim + out;
  }
  return out;
}

/** The static site as previewable pages, opening on `entry`. */
export function staticSiteDocument(tree: FileTree, assets: Record<string, string>, entry: string): string {
  const files = new Map(tree.map((file) => [file.path, file.content]));
  const all: Record<string, string> = { ...assets };
  for (const file of tree) {
    if (/\.svg$/i.test(file.path) && !all[file.path]) {
      all[file.path] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
    }
  }

  const pageList = tree.filter((file) => /\.html?$/i.test(file.path));
  /* Every page, ready to open. Kept to sites of a sensible size: past it the
     other pages are simply not opened in place. */
  const pages: Record<string, string> = {};
  let total = 0;
  for (const page of pageList) {
    const ready = withSnapshotBridge(inlinePage(page.path, withSinglePageEdit(page.content, page.path), files, all));
    total += ready.length;
    if (page.path !== entry && total > 4_000_000) continue;
    pages[page.path] = ready;
  }

  /* Following a link to another page of the site opens it in place. The page
     map is kept on the window (document.open keeps the window), and each page
     written gets the same small script again, for the page it now is. */
  const boot = `function qsBoot(here){window.__qsHere=here;var P=window.__qsP||{};function resolve(ref){if(!ref||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(ref))return null;var c=ref.split('#')[0].split('?')[0];var abs=c.charAt(0)==='/';var base=abs?'':here.slice(0,here.lastIndexOf('/')+1);var parts=(abs?c.slice(1):base+c).split('/'),out=[];for(var i=0;i<parts.length;i++){var p=parts[i];if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p);}var path=out.join('/');if(path===''||c.slice(-1)==='/')path=(path?path+'/':'')+'index.html';if(!P[path]&&P[path+'.html'])path+='.html';return P[path]?path:null;}document.addEventListener('click',function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey)return;var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a||a.target==='_blank')return;var to=resolve(a.getAttribute('href'));if(!to)return;e.preventDefault();var html=P[to];var tag='<scr'+'ipt>('+qsBoot.toString()+')('+JSON.stringify(to)+')</scr'+'ipt>';var at=html.toLowerCase().lastIndexOf('</body>');document.open();document.write(at<0?html+tag:html.slice(0,at)+tag+html.slice(at));document.close();window.scrollTo(0,0);});}`;
  const withNav = (path: string, html: string) => {
    const script = `<script data-qs-pages>window.__qsP=${JSON.stringify(pages).replace(/</g, "\\u003c")};(${boot})(${JSON.stringify(path)});</script>`;
    const close = html.toLowerCase().lastIndexOf("</body>");
    return close < 0 ? html + script : html.slice(0, close) + script + html.slice(close);
  };

  return withNav(entry, pages[entry] ?? withSnapshotBridge(inlinePage(entry, withSinglePageEdit(files.get(entry) ?? "", entry), files, all)));
}
