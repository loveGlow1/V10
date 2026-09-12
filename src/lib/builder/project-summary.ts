/* What a preview shows when the build produced a project rather than a page.
 *
 * The single-page stack has an obvious answer to "what do we show": the page.
 * A Next.js project has none. It is `.tsx` source, and there is no HTML in it
 * anywhere — the HTML is what `next build` produces, and nothing here runs
 * `next build`. So the honest options are a blank preview or a true account of
 * what was made, and this is the second one.
 *
 * ── What it must not be ───────────────────────────────────────────────────
 *
 * Not a mockup of the app. The temptation is to render something that looks
 * like the storefront — a hero, a product grid — so the preview pane has
 * something in it. That would be the exact failure the blueprints spend
 * paragraphs forbidding: a picture of a working thing, shown to somebody who
 * then believes they have one. A preview that lies about what was built is
 * worse than a preview that is honest about being a summary.
 *
 * So this says what exists, names it precisely, and says what to do next. It is
 * a receipt, and it reads like one.
 *
 * ── Why it is worth building rather than a one-line placeholder ───────────
 *
 * "Your project was built. Download it." is honest and useless. The person
 * asked for a store and got a zip; what they need to know is whether the store
 * they asked for is in it — which routes exist, whether the admin is there,
 * whether the tables were really created. Every one of those is knowable from
 * the tree and the manifest, so it is shown, and the preview becomes the one
 * place the build can be checked without reading forty files.
 *
 * Served sandboxed, like every other preview (see lib/publish/serve.ts), so it
 * is one self-contained document with no external anything.
 */

import type { ArchitectureManifest } from "./architecture";
import { LAYER_LABEL, LAYERS } from "./architecture";
import { KIND_LABEL } from "./kinds";
import type { DataModel } from "./schema";
import type { FileTree } from "./tree";

/* Escaped everywhere it is interpolated. Every value below came out of a model
   or out of a project name somebody typed, and this document is served to the
   person who owns it — but from the same origin family as everything else, so
   the sandbox is doing real work and this must not undo it. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The addresses this project answers on, read from the files that answer them.
 *
 * Derived rather than declared: scaffold.ts asked for a set of routes, but what
 * matters is which ones came back, and the difference between those two is
 * exactly what somebody checking a build wants to see.
 */
export function routesOf(tree: FileTree): string[] {
  return tree
    .map((file) => file.path)
    .filter((path) => /^app\/.*page\.tsx$/.test(path))
    .map((path) =>
      path
        .replace(/^app/, "")
        .replace(/\/page\.tsx$/, "")
        /* Route groups are organisational and are not in the URL. */
        .replace(/\/\([^)]*\)/g, ""),
    )
    .map((route) => (route === "" ? "/" : route))
    .sort((a, b) => a.localeCompare(b));
}

/* Grouped so the listing reads as a project rather than as forty paths. The
   order is the order somebody looks in: what it does, then what it looks like,
   then the plumbing they did not ask for and should not have to read. */
function group(path: string): string {
  if (/^app\/admin\//.test(path)) return "Admin";
  if (/^app\//.test(path)) return "Pages";
  if (/^components\//.test(path)) return "Components";
  if (/^lib\//.test(path)) return "Data layer";
  return "Project files";
}

const GROUP_ORDER = ["Pages", "Admin", "Components", "Data layer", "Project files"];

function lines(content: string): number {
  return content.split("\n").length;
}

export type SummaryInput = {
  projectName: string;
  manifest: ArchitectureManifest;
  tree: FileTree;
  model: DataModel;
  /* Whether the tables are actually there. The manifest says a database was
     asked for; this says whether it was created — and a summary that showed the
     first without the second would be describing an intention as a fact. */
  databaseReady: boolean;
  /* The address the project is actually running at, once there is one. Its
     presence changes what this document is for: with a live app the summary
     stops being a substitute for the thing and becomes the notes beside it. */
  liveUrl?: string | null;
  /* Why there is no address, when there is not. Shown rather than swallowed —
     "your app is not hosted" with no reason is the kind of thing people file a
     support ticket about. */
  deploymentError?: string | null;
};

/**
 * The preview document for a project of files.
 *
 * Deliberately plain. This is a status page, and a status page that has been
 * art-directed is one somebody has to look past to find the status.
 */
export function projectSummary(input: SummaryInput): string {
  const { projectName, manifest, tree, model, databaseReady } = input;
  const liveUrl = input.liveUrl ?? null;
  const deploymentError = input.deploymentError ?? null;

  const name = escape(projectName.trim() || "Your project");
  const kind = KIND_LABEL[manifest.type].toLowerCase();
  /* "A online store" is the kind of thing that makes a page read as generated.
     The five labels are known, so this is a vowel check rather than a
     dictionary — and it is written against the labels rather than English at
     large because that is all it ever sees. */
  const article = /^[aeiou]/.test(kind) ? "An" : "A";
  const routes = routesOf(tree);
  const on = LAYERS.filter((layer) => manifest[layer]);

  const grouped = new Map<string, { path: string; lines: number }[]>();
  for (const file of [...tree].sort((a, b) => a.path.localeCompare(b.path))) {
    const key = group(file.path);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ path: file.path, lines: lines(file.content) });
  }

  const fileSections = GROUP_ORDER.filter((key) => grouped.has(key))
    .map((key) => {
      const files = grouped.get(key)!;
      const rows = files
        .map(
          (file) =>
            `<li><code>${escape(file.path)}</code><span class="n">${file.lines} lines</span></li>`,
        )
        .join("");
      return `<section class="grp"><h3>${escape(key)} <span class="n">${files.length}</span></h3><ul class="files">${rows}</ul></section>`;
    })
    .join("");

  const routeList =
    routes.length > 0
      ? `<ul class="routes">${routes
          .map((route) => `<li><code>${escape(route)}</code></li>`)
          .join("")}</ul>`
      : `<p class="quiet">No routes were written, which for a project is a build that did not finish.</p>`;

  /* The database section states which of two things is true, and never blurs
     them. "Tables created" and "tables not created yet" look identical from
     everywhere except the row that records it, and somebody whose queries are
     failing needs to know which one they have. */
  const database =
    model.tables.length === 0
      ? ""
      : `<section class="card">
      <h2>Database <span class="${databaseReady ? "ok" : "warn"}">${
        databaseReady ? "created" : "not created yet"
      }</span></h2>
      <p class="quiet">Schema <code>${escape(model.schema)}</code>. Row-level security is on for every table, so a query returns only the rows its caller may see.</p>
      <ul class="tables">${model.tables
        .map(
          (table) =>
            `<li><code>${escape(table.name)}</code><span class="n">${table.columns.length} columns · ${table.policies.length} ${
              table.policies.length === 1 ? "policy" : "policies"
            }</span></li>`,
        )
        .join("")}</ul>
      ${
        model.buckets.length > 0
          ? `<p class="quiet">Storage: ${model.buckets
              .map((bucket) => `<code>${escape(bucket.name)}</code>`)
              .join(", ")}</p>`
          : ""
      }
      ${
        databaseReady
          ? ""
          : `<p class="quiet">The application was written against these tables, so its queries will fail until they exist.</p>`
      }
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 72px;
    background: #0b0b0f; color: #e8e8ec;
    font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 6px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
       color: #8b8b96; margin: 0 0 14px; font-weight: 600; }
  h3 { font-size: 13px; margin: 0 0 8px; font-weight: 600; color: #c8c8d2; }
  code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfd4e0; }
  .lede { color: #9a9aa6; margin: 0 0 32px; }

  /* The running app, given the weight the rest of the page deliberately does
     not take. Everything else here is a receipt; this is the thing itself. */
  .live { border-color: rgba(142,240,138,.35); }
  .live-link { color: #8ef08a; font-size: 15px; word-break: break-all; }
  .live-frame {
    display: block; width: 100%; height: 460px; margin-top: 16px;
    border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: #fff;
  }
  .quiet { color: #8b8b96; font-size: 13.5px; margin: 10px 0 0; }
  .card { border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.025);
          border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .layers { display: flex; flex-wrap: wrap; gap: 6px; }
  .layers li { border: 1px solid rgba(255,255,255,.1); border-radius: 999px;
               padding: 3px 11px; font-size: 12.5px; color: #d0d0da; }
  .routes { display: flex; flex-wrap: wrap; gap: 6px; }
  .routes li { background: rgba(255,255,255,.05); border-radius: 6px; padding: 3px 9px; }
  .tables li, .files li { display: flex; justify-content: space-between; gap: 16px;
    align-items: baseline; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .tables li:last-child, .files li:last-child { border-bottom: 0; }
  .n { color: #6e6e7a; font-size: 12px; white-space: nowrap; }
  .grp { margin-bottom: 18px; }
  .grp:last-child { margin-bottom: 0; }
  .ok { color: #62c08b; font-weight: 600; text-transform: none; letter-spacing: 0; }
  .warn { color: #e0a44a; font-weight: 600; text-transform: none; letter-spacing: 0; }
  pre { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.07);
        border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 12px 0 0; }
  pre code { color: #b9c2d0; }
  footer { color: #62626e; font-size: 12.5px; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">

  <h1>${name}</h1>
  <p class="lede">${article} ${escape(kind)} built as a Next.js project — ${tree.length} files.${
    liveUrl
      ? " It has been built and is running at the address below; everything after that is what went into it."
      : " This is a summary rather than the running app: the source has to be built before there is anything to look at, and a preview that showed you a mock-up of it would be telling you something untrue."
  }</p>

  ${
    liveUrl
      ? `<section class="card live">
    <h2>Your app is live</h2>
    <p><a class="live-link" href="${escape(liveUrl)}" target="_blank" rel="noopener noreferrer">${escape(liveUrl)}</a></p>
    <iframe class="live-frame" src="${escape(liveUrl)}" title="${name}" loading="lazy" referrerpolicy="no-referrer"></iframe>
  </section>`
      : deploymentError
        ? `<section class="card">
    <h2>Not hosted yet</h2>
    <p>${escape(deploymentError)}. The files below are complete either way, and running them locally is at the end of this page.</p>
  </section>`
        : ""
  }

  <section class="card">
    <h2>What it is made of</h2>
    <ul class="layers">${on
      .map((layer) => `<li>${escape(LAYER_LABEL[layer])}</li>`)
      .join("")}</ul>
  </section>

  <section class="card">
    <h2>Routes <span class="n">${routes.length}</span></h2>
    ${routeList}
  </section>

  ${database}

  <section class="card">
    <h2>Files</h2>
    ${fileSections}
  </section>

  <section class="card">
    <h2>Running it</h2>
    <p class="quiet">Download the project, then:</p>
    <pre><code>npm install
npm run dev</code></pre>
    ${
      manifest.backend
        ? `<p class="quiet">It reads its data from Supabase in the browser, so it needs <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and <code>NEXT_PUBLIC_SUPABASE_SCHEMA</code> in <code>.env.local</code>. They are named in the project's README. Never put a service-role key in any of them — all three are compiled into the site and served to every visitor.</p>`
        : ""
    }
  </section>

  <footer>Built with QuickStark.AI</footer>

</div>
</body>
</html>`;
}
