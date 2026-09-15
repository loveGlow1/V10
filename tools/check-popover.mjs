#!/usr/bin/env node
/* A menu you can press a button in.
 *
 *   npm run check:popover
 *
 * Two controls in this app went dead at the same time and for the same reason,
 * and neither of them reported anything — which is what made it expensive.
 * Publishing did nothing at all: the panel opened, the Publish button inside it
 * did not respond, and no error appeared anywhere because no request was ever
 * made. The model list did the same thing: it opened, every model was there,
 * and pressing one changed nothing.
 *
 * ONE CAUSE. AnchoredPanel portals its card into document.body so that no
 * ancestor can clip it. Every call site had been written earlier, when the card
 * was an absolutely-positioned CHILD of the control, and each carried its own
 * outside-press handler shaped like:
 *
 *     if (ref.current && !ref.current.contains(event.target)) setOpen(false);
 *
 * Once the card is in the body it is no longer inside `ref`, so a press on the
 * card's own buttons satisfies that condition. The panel closed on MOUSEDOWN,
 * the element under the pointer was gone before MOUSEUP, and the browser
 * therefore never fired a click. A dead button with nothing in the console.
 *
 * AnchoredPanel already had the handler that gets this right — it excludes the
 * card and the control both — and Popover was not passing onClose down to it,
 * so it was switched off on every one of them.
 *
 * No DOM here: this reads the source. That is the honest scope of it. It cannot
 * prove a button fires; it can prove the arrangement that stopped it firing has
 * not come back, which is the part that was silent.
 */

import { readFileSync } from "node:fs";

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const read = (path) => readFileSync(path, "utf8");

const POPOVER = "src/app/dashboard/components/workspace/Popover.tsx";
const ANCHORED = "src/app/dashboard/components/AnchoredPanel.tsx";

// ── The fix itself ────────────────────────────────────────────────────────

const popover = read(POPOVER);
const anchoredCall = popover.slice(popover.indexOf("<AnchoredPanel"));
has(
  /<AnchoredPanel[\s\S]*?onClose=\{onClose\}/.test(anchoredCall),
  "Popover hands onClose to AnchoredPanel",
  "without it AnchoredPanel's outside-press handler never runs, and every call site is on its own",
);

const anchored = read(ANCHORED);
has(
  /panel\.current\?\.contains\(target\)/.test(anchored),
  "AnchoredPanel does not treat a press inside its own card as outside it",
);
has(
  /offsetParent[\s\S]{0,200}anchor\?\.contains\(target\)/.test(anchored),
  "and does not treat a press on the control as outside it either",
  "otherwise the control's own toggle closes and reopens on one click",
);

// ── And the arrangement that broke ────────────────────────────────────────
/* Named one by one rather than found by a pattern. Each of these was a real
   handler in a real file, and naming the file is what makes a failure here
   readable: the check is "this exact thing is not back", not "nothing in the
   codebase looks vaguely like it". */

const REGRESSED = [
  {
    file: "src/app/dashboard/components/workspace/PreviewPanel.tsx",
    ref: "publishRef",
    what: "the publish panel — the Publish button did nothing at all",
  },
  {
    file: "src/app/dashboard/components/workspace/ChatPanel.tsx",
    ref: "toolbarRef",
    what: "the workspace model list — a model could be read and not chosen",
  },
  {
    file: "src/app/dashboard/page.tsx",
    ref: "composerBoxRef",
    what: "Home's model list, the same way",
  },
];

for (const { file, ref, what } of REGRESSED) {
  const source = read(file);
  has(
    !new RegExp(`${ref}\\.current`).test(source),
    `nothing asks whether a press landed inside ${ref} — ${what}`,
    `${ref}.current is read again in ${file}; a portalled card is never inside it`,
  );
}

// ── Every popover can still be closed ─────────────────────────────────────
/* The other half of the same change. Forwarding onClose only helps where a
   call site passes one, and a menu with no way out is its own bug. */

const CALLERS = [
  "src/app/dashboard/components/workspace/PreviewPanel.tsx",
  "src/app/dashboard/components/workspace/ChatPanel.tsx",
  "src/app/dashboard/page.tsx",
];

let opened = 0;
for (const file of CALLERS) {
  const source = read(file);
  for (const tag of source.match(/<Popover\b[\s\S]*?>/g) ?? []) {
    opened += 1;
    has(
      /onClose=\{/.test(tag),
      `a <Popover> in ${file.split("/").pop()} can be closed`,
      tag.slice(0, 120).replace(/\s+/g, " "),
    );
  }
}
has(opened >= 4, `every popover call site was read — ${opened} found`);

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
