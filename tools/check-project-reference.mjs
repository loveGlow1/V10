#!/usr/bin/env node
/* A project of their own, named as the reference: "like my Aurelia Estates
 * site" puts that project's real page in front of the model.
 *
 *   npm run check:project-reference
 *
 * Offline. project-reference.ts is pure apart from its loader, which runs
 * against a fake client; the build route is read as source.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-project-reference");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler",
    skipLibCheck: true, strict: true, types: ["node"], typeRoots: [join(root, "node_modules", "@types")],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  files: [join(root, "src/lib/builder/project-reference.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
(function fix(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { fix(path); continue; }
    if (!entry.endsWith(".js")) continue;
    writeFileSync(path, readFileSync(path, "utf8")
      .replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_, a, spec, b) => {
        let rel = relative(dirname(path), join(out, spec)).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return `${a}${rel}${b}`;
      })
      .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, a, spec, b) => (spec.endsWith(".js") ? whole : `${a}${spec}.js${b}`)));
  }
})(join(out, "lib"));
const R = await import(join(out, "lib/builder/project-reference.js"));

let failed = 0;
const has = (cond, t, d) => {
  if (cond) console.log(`ok    ${t}`);
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${JSON.stringify(d)}` : ""}`); }
};

const projects = [
  { id: "a", name: "Aurelia Estates", slug: "aurelia-estates" },
  { id: "b", name: "Landing page for a bakery", slug: "bakery-landing" },
  { id: "c", name: "New project", slug: "new-project" },
  { id: "d", name: "Jephthah Kofi", slug: "jephthah-kofi" },
  { id: "e", name: "Aurelia Estates Rentals", slug: null },
];
const ids = (prompt, current = "x") => R.referencedProjects(prompt, projects, current).map((p) => p.id);

has(ids("Make it look like my Aurelia Estates site").includes("a"), "a project named in the message is found");
has(ids("same layout as aurelia estates please")[0] === "a", "case and punctuation do not matter");
has(ids("copy the hero from aurelia-estates.quickstark.tech").includes("a"), "its published address names it too");
has(ids("Use the same style as Aurelia Estates Rentals")[0] === "e", "the longer name wins when the longer one is said");
has(ids("Start a new project for a gym").length === 0, "a generic name like New project is never a reference");
has(ids("Build a bakery website").length === 0, "a word from a name is not the name");
has(ids("Make a landing page for a bakery").length === 0, "a name said as a plain request is not a reference");
has(ids("Make it like my landing page for a bakery")[0] === "b", "the same name, pointed at, is");
has(ids("Take the Jephthah Kofi site hero").includes("d"), "a name followed by site counts");
has(ids("Like my Aurelia Estates site", "a").length === 0, "a project is never its own reference");
has(ids("Mix my Aurelia Estates, my Jephthah Kofi site and my Landing page for a bakery").length === R.MAX_REFERENCES, "capped");

const big = `<html><body><h1>Aurelia</h1><img src="data:image/png;base64,${"A".repeat(50000)}"><script>${"x".repeat(5000)}</script>${"<p>room</p>".repeat(5000)}</body></html>`;
const lean = R.leanReferenceHtml(big);
has(!/AAAAAAAA/.test(lean) && !/xxxxxxxx/.test(lean), "inline data and scripts are taken out");
has(lean.length <= R.MAX_REFERENCE_CHARS + 60 && /cut for length/.test(lean), "and the page is cut to a size, saying so");

const text = R.referenceText([{ id: "a", name: "Aurelia Estates", html: "<h1>Aurelia</h1>" }]);
has(/<reference_project>[\s\S]*<h1>Aurelia<\/h1>[\s\S]*<\/reference_project>/.test(text), "the model is shown the real page");
has(/never by guessing/.test(text) && /Do not invent facts/.test(text), "and told to read it, not guess, and to invent nothing");

/* The loader: the person's own projects (RLS), then each one's latest build. */
const calls = [];
const fake = {
  from: (table) => {
    const q = {
      select: () => q, is: () => q, order: () => q, limit: () => q,
      eq: (column, value) => { calls.push([table, column, value]); return q; },
      then: (resolve) => resolve({ data: table === "projects" ? projects : null }),
      maybeSingle: async () => ({ data: { html: "<h1>Aurelia</h1>" } }),
    };
    return q;
  },
};
const loaded = await R.loadReferencedProjects(fake, "Like my Aurelia Estates site", "x");
has(loaded.length === 1 && loaded[0].name === "Aurelia Estates" && loaded[0].html === "<h1>Aurelia</h1>", "the loader returns the named project's latest page");
has(calls.some(([t, c, v]) => t === "project_builds" && c === "project_id" && v === "a"), "read from that project's builds");

const route = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
has(/loadReferencedProjects\(supabase, prompt, project\.id\)/.test(route), "the build route reads references under the person's own session");
has(/files\.blocks\.unshift\(\{ type: "text", text: referencedText \}\)/.test(route), "edits, questions and clarifications see the reference");
has(/userMessage\(project\.name, buildBrief, \[attachedText, referencedText\]/.test(route), "a first build sees it");
has(/referencedText \? `\$\{stageRequest \?\? prompt\}\\n\\n\$\{referencedText\}`/.test(route), "and so does a multi-file edit");

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : "\nAll project reference checks passed.");
process.exit(failed ? 1 : 0);
