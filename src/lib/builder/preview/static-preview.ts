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

function inlinePage(path: string, html: string, files: Map<string, string>, assets: Record<string, string>): string {
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
    /* <script src="app.js"></script> */
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (whole, before: string, src: string, after: string) => {
      const at = local(src, path);
      const js = at ? files.get(at) : undefined;
      if (js === undefined) return whole;
      const type = /type=["']module["']/i.test(before + after) ? ' type="module"' : "";
      return `<script${type} data-from="${attr(at!)}">${js.replace(/<\/script/gi, "<\\/script")}</script>`;
    })
    /* Pictures in markup. */
    .replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (whole, name: string, quote: string, ref: string) => {
      const found = picture(ref, path);
      return found ? `${name}=${quote}${found}${quote}` : whole;
    });
  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (whole, css: string) => whole.replace(css, cssUrls(css, path)));
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
    const ready = inlinePage(page.path, withSinglePageEdit(page.content, page.path), files, all);
    total += ready.length;
    if (page.path !== entry && total > 4_000_000) continue;
    pages[page.path] = ready;
  }

  /* Following a link to another page of the site opens it in place. The page
     map is kept on the window (document.open keeps the window), and each page
     written gets the same small script again, for the page it now is. */
  const boot = `function qsBoot(here){var P=window.__qsP||{};function resolve(ref){if(!ref||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(ref))return null;var c=ref.split('#')[0].split('?')[0];var abs=c.charAt(0)==='/';var base=abs?'':here.slice(0,here.lastIndexOf('/')+1);var parts=(abs?c.slice(1):base+c).split('/'),out=[];for(var i=0;i<parts.length;i++){var p=parts[i];if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p);}var path=out.join('/');if(path===''||c.slice(-1)==='/')path=(path?path+'/':'')+'index.html';if(!P[path]&&P[path+'.html'])path+='.html';return P[path]?path:null;}document.addEventListener('click',function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey)return;var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a||a.target==='_blank')return;var to=resolve(a.getAttribute('href'));if(!to)return;e.preventDefault();var html=P[to];var tag='<scr'+'ipt>('+qsBoot.toString()+')('+JSON.stringify(to)+')</scr'+'ipt>';var at=html.toLowerCase().lastIndexOf('</body>');document.open();document.write(at<0?html+tag:html.slice(0,at)+tag+html.slice(at));document.close();window.scrollTo(0,0);});}`;
  const withNav = (path: string, html: string) => {
    const script = `<script data-qs-pages>window.__qsP=${JSON.stringify(pages).replace(/</g, "\\u003c")};(${boot})(${JSON.stringify(path)});</script>`;
    const close = html.toLowerCase().lastIndexOf("</body>");
    return close < 0 ? html + script : html.slice(0, close) + script + html.slice(close);
  };

  return withNav(entry, pages[entry] ?? inlinePage(entry, withSinglePageEdit(files.get(entry) ?? "", entry), files, all));
}
