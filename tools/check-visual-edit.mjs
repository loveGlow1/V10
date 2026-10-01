#!/usr/bin/env node
/* Visual edits: a change made by pointing at the preview, written straight
 * into the source.
 *
 *   npm run check:visual-edit
 *
 * lib/builder/visual-edit.ts finds the element a click named and changes its
 * words, its classes or its picture — exactly, or not at all. These pin both
 * halves: the edits it makes, and the ones it must hand to the AI rather than
 * guess. Every edited file is parsed afterwards; an edit that breaks the code
 * is the one thing this must never do.
 *
 * When this was written the same path was driven in Chromium against Aurelia
 * Estates' real preview: a click on the hero heading reported
 * app/page.tsx:53:10, the change showed in the preview, and the edit landed on
 * lines 53–54 of the stored file and nowhere else. CI has no browser, so that
 * is not repeated here.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-visual-edit");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: [],
    },
    files: [join(process.cwd(), "src/lib/builder/visual-edit.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { applyVisualEdit, applyClassChange, locateElement, describeChange } = await import(join(out, "lib/builder/visual-edit.js"));
const ts = createRequire(import.meta.url)("typescript");
const parses = (source) => ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length === 0;

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

const PAGE = `"use client";
import { useState } from "react";

export default function Page({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <main className="mx-auto max-w-5xl px-6">
      <h1 className="text-[length:var(--text-3xl)] text-[var(--ink)] md:text-[length:var(--text-4xl)]">Homes, considered.</h1>
      <h2 className={open ? "text-lg" : "text-sm"}>Our story</h2>
      <p>{name} is an estate agency.</p>
      <p>
        Six listings, hand chosen.
      </p>
      <button onClick={() => setOpen(a => !a && 1 > 0)} className="px-4 py-2">Open</button>
      <img src="https://images.example.com/a.jpg" alt="A villa" className="w-full" />
      <img src={photo} alt="Chosen in code" />
      <section><h2 className="text-xl">Listings</h2><h2 className="text-xl">Listings</h2></section>
    </main>
  );
}
`;
const lineOf = (needle) => PAGE.split("\n").findIndex((line) => line.includes(needle)) + 1;
const colOf = (needle, tag) => PAGE.split("\n")[lineOf(needle) - 1].indexOf(`<${tag}`);
const at = (needle, tag) => `app/page.tsx:${lineOf(needle)}:${colOf(needle, tag)}`;
const changed = (before, after) => after.split("\n").filter((line, i) => line !== before.split("\n")[i]);

console.log("\nWords:");
{
  const r = applyVisualEdit(PAGE, { src: at("Homes, considered.", "h1"), tag: "h1", change: { text: "Homes, chosen." } });
  has(r.ok && r.source.includes(">Homes, chosen.</h1>"), "a heading's words are replaced");
  has(r.ok && changed(PAGE, r.source).length === 1 && parses(r.source), "on its own line only, and the file still parses");
  const multi = applyVisualEdit(PAGE, { src: at("<p>", "p").replace(/:\d+:/, `:${lineOf("        Six listings") - 1}:`), tag: "p", text: "Six listings, hand chosen.", change: { text: "Eight listings." } });
  has(multi.ok && /<p>\n\s+Eight listings\.\n\s+<\/p>/.test(multi.source) && parses(multi.source), "words on their own lines keep the layout around them");
  const markup = applyVisualEdit(PAGE, { src: at("Homes, considered.", "h1"), tag: "h1", change: { text: "Price {from} <3 & up" } });
  has(markup.ok && markup.source.includes('{"Price {from} <3 & up"}') && parses(markup.source), "words that look like markup are written as a string");
  const data = applyVisualEdit(PAGE, { src: at("{name} is", "p"), tag: "p", change: { text: "x" } });
  has(!data.ok && data.needsAi, "words built from data go to the AI", data.reason);
}

console.log("\nClasses:");
{
  const r = applyVisualEdit(PAGE, { src: at("Homes, considered.", "h1"), tag: "h1", change: { classes: [{ group: "textColor", value: "text-[var(--accent)]" }, { group: "align", value: "text-center" }] } });
  const line = r.ok && r.source.split("\n")[lineOf("Homes, considered.") - 1];
  has(line && line.includes("text-[var(--accent)]") && !line.includes("text-[var(--ink)]"), "the old colour goes, the new one comes", line);
  has(line && line.includes("text-[length:var(--text-3xl)]") && line.includes("md:text-[length:var(--text-4xl)]"), "size and responsive classes are left alone");
  const expr = applyVisualEdit(PAGE, { src: at("Our story", "h2"), tag: "h2", change: { classes: [{ group: "align", value: "text-center" }] } });
  has(!expr.ok && expr.needsAi, "classes built in code go to the AI", expr.reason);
  const bare = applyVisualEdit(PAGE, { src: at("{name} is", "p"), tag: "p", change: { classes: [{ group: "fontWeight", value: "font-bold" }] } });
  has(bare.ok && bare.source.includes('<p className="font-bold">{name}') && parses(bare.source), "an element with no classes is given one");
  const tricky = applyVisualEdit(PAGE, { src: at(">Open</button>", "button"), tag: "button", change: { classes: [{ group: "radius", value: "rounded-full" }] } });
  has(tricky.ok && tricky.source.includes('className="px-4 py-2 rounded-full"') && parses(tricky.source), "a > inside an onClick is not the end of the tag");
  has(applyClassChange("text-lg text-[length:var(--text-xl)] text-left", "fontSize", "text-2xl") === "text-left text-2xl", "a group swaps only its own classes");
}

console.log("\nPictures:");
{
  const r = applyVisualEdit(PAGE, { src: at('alt="A villa"', "img"), tag: "img", change: { imageSrc: "https://images.example.com/b.jpg" } });
  has(r.ok && r.source.includes('src="https://images.example.com/b.jpg"') && parses(r.source), "a picture's address is swapped");
  const code = applyVisualEdit(PAGE, { src: at('alt="Chosen in code"', "img"), tag: "img", change: { imageSrc: "https://images.example.com/b.jpg" } });
  has(!code.ok && code.needsAi, "a picture chosen in code goes to the AI");
  const bad = applyVisualEdit(PAGE, { src: at('alt="A villa"', "img"), tag: "img", change: { imageSrc: 'javascript:alert(1)' } });
  has(!bad.ok, "only an https address is written");
  const quote = applyVisualEdit(PAGE, { src: at('alt="A villa"', "img"), tag: "img", change: { imageSrc: 'https://x.com/a.jpg" onerror="alert(1)' } });
  has(!quote.ok, "and nothing that could close the attribute");
}

console.log("\nFinding the element:");
{
  const moved = applyVisualEdit(PAGE, { src: `app/page.tsx:${lineOf("Homes, considered.") + 3}:0`, tag: "h1", text: "Homes, considered.", change: { text: "Moved" } });
  has(moved.ok && moved.source.includes(">Moved</h1>"), "lines that moved are followed by its words");
  const twins = locateElement(PAGE, { src: `app/page.tsx:${lineOf("<section>") + 5}:0`, tag: "h2", text: "Listings", className: "text-xl" });
  has(twins === null, "two identical elements and no exact line: refused, not guessed");
  const exact = applyVisualEdit(PAGE, { src: `app/page.tsx:${lineOf("<section>")}:${PAGE.split("\n")[lineOf("<section>") - 1].lastIndexOf("<h2")}`, tag: "h2", change: { text: "Second" } });
  has(exact.ok && exact.source.includes('<h2 className="text-xl">Listings</h2><h2 className="text-xl">Second</h2>'), "the exact column picks the right twin");
  has(!applyVisualEdit(PAGE, { src: "app/page.tsx:2:0", tag: "nav", change: { text: "x" } }).ok, "an element that is not there is not invented");
  has(/<h1> in app\/page.tsx: text/.test(describeChange({ src: "app/page.tsx:8:6", tag: "h1", change: { text: "Hi" } })), "a change is described for the version history");
}

console.log("\nWired in:");
{
  const runtime = readFileSync(join(process.cwd(), "src/lib/builder/preview/runtime.ts"), "utf8");
  has(/tagWithSource\(path\)/.test(runtime) && /data-qs-src/.test(runtime), "the preview tags every element with where it was written");
  has(/report\('select', describeElement\(element\)\)/.test(runtime) && /window\.addEventListener\('click', onPick, true\)/.test(runtime), "edit mode selects on click, before the app's own handlers");
  const panel = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
  has(/event\.source !== frameRef\.current\.contentWindow/.test(panel) && /<VisualEditPanel/.test(panel), "the workspace takes selections only from its own frame");
  const route = readFileSync(join(process.cwd(), "src/app/api/projects/[id]/visual-edit/route.ts"), "utf8");
  has(/ownedProject\(id\)/.test(route) && !/from "@\/lib\/(?:credits|billing)|chargeCredits|spendCredits|recordCharge/.test(route), "the route checks ownership and charges nothing");
  const chat = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
  has(/VISUAL_ASK_EVENT/.test(chat), "requests for the AI go through the chat, charged like any edit");
}

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
