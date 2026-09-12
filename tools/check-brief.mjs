#!/usr/bin/env node
/* Checks that a message is read against the conversation it arrived in.
 *
 *   npm run check:brief
 *
 * Two things are measured, and they fail in opposite directions:
 *
 *   carryBrief   must carry the standing description when the message
 *                describes nothing ("rebuild"), and must NOT touch a message
 *                that describes something. The second half is the one worth
 *                guarding: a builder that quietly rewrites clear briefs is
 *                worse than one that forgets, because you cannot see it happen.
 *
 *   priorTurns   must produce turns the Messages API will actually accept —
 *                alternating, opening on the user, never ending on the
 *                assistant. A malformed list is a 400 at build time, which is
 *                exactly when nobody is watching this file.
 *
 * The opening case is the one from the screenshot that started this: an
 * e-commerce brief, a builder that asked for more, and "Rebuild" — which used
 * to reach the orchestrator as the entire design brief.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-brief");
mkdirSync(out, { recursive: true });

/* Compiled through a tsconfig rather than a bare file list, because brief.ts
   now reads the context engine (@/lib/context/…) to decide how much of a
   conversation travels with a message, and an alias needs `paths` to resolve. */
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true,
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/brief.ts"),
      join(process.cwd(), "src/lib/builder/download.ts"),
      join(process.cwd(), "src/app/dashboard/components/workspace/resume.ts"),
      join(process.cwd(), "src/app/dashboard/components/workspace/threadView.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

/* And the emitted specifiers made loadable: tsc leaves both the alias and the
   extensionless relative form, and Node's ESM loader resolves neither. */
const rewrite = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { rewrite(path); continue; }
    if (!path.endsWith(".js")) continue;
    const depth = path.slice(out.length + 1).split("/").length - 1;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace(/(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          const asFile = join(out, `${rest}.js`);
          const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
          return `${q}${prefix}${target}${q}`;
        })
        .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, head, spec, tail) =>
          /\.(js|json)$/.test(spec) ? whole : `${head}${spec}.js${tail}`),
    );
  }
};
rewrite(out);
const { carryBrief, conversational, priorTurns, isContinuation, countWords, trimToWords, carriedContextWords, MAX_CONTEXT_WORDS } =
  await import(join(out, "lib/builder/brief.js"));
const { wantsDownload } = await import(join(out, "lib/builder/download.js"));
const { resumableFrom, RESUME_WINDOW_MS } = await import(
  join(out, "app/dashboard/components/workspace/resume.js")
);
const { cardIndex, cardFor } = await import(
  join(out, "app/dashboard/components/workspace/threadView.js")
);

const you = (text) => ({ from: "you", text });
const bot = (text) => ({ from: "system", text, tone: "normal", kind: "chat" });
/* What the app writes when something has gone wrong. Not a reply — see below. */
const fault = (text) => ({ from: "system", text, tone: "error", kind: "chat" });
const notice = (text, kind) => ({ from: "system", text, tone: "normal", kind });

const STORE =
  "An e-commerce store selling highly customizable physical goods (e.g., modular furniture, custom PC builds, or bespoke apparel) with rule-based constraints and dynamic price calculation.";

/* [name, message, history, expectation]
   expectation.carries — the earlier message it must lean on, or null for none.
   expectation.keeps   — true when the message must reach the build untouched. */
const CASES = [
  [
    "the screenshot: rebuild after a brief that was questioned",
    "Rebuild",
    [you(STORE), bot("Right now I build web apps and landing pages. Could you say a little more?")],
    { carries: STORE },
  ],
  ["bare yes", "yes", [you(STORE)], { carries: STORE }],
  ["go ahead", "Go ahead", [you(STORE)], { carries: STORE }],
  ["try again", "try again.", [you(STORE)], { carries: STORE }],
  ["build it", "build it", [you(STORE)], { carries: STORE }],
  ["continue", "Continue", [you(STORE)], { carries: STORE }],

  /* ── The restart family ─────────────────────────────────────────────────
   *
   * THE ONE THIS EXISTS FOR is "Rerun", which was missing. A customer pasted
   * a twelve-thousand-word brief for a bakery storefront, the build failed for
   * an unrelated reason, and they typed it. It matched nothing, so nothing was
   * carried, so the word "Rerun" became the brief — and the build produced a
   * news publication with posts and categories and not one product in it.
   *
   * The rest are here because which of these words somebody reaches for is a
   * coin toss, and every one of them means the same thing. A gap in this list
   * does not fail loudly; it spends a build on nothing and hands back a
   * working application of the wrong kind. */
  ["rerun — THE ONE", "Rerun", [you(STORE)], { carries: STORE }],
  ["re-run hyphenated", "re-run", [you(STORE)], { carries: STORE }],
  ["rerun it", "rerun it", [you(STORE)], { carries: STORE }],
  ["run it again", "run it again", [you(STORE)], { carries: STORE }],
  ["run again", "Run again.", [you(STORE)], { carries: STORE }],
  ["redo", "redo", [you(STORE)], { carries: STORE }],
  ["redo it", "Redo it", [you(STORE)], { carries: STORE }],
  ["regenerate", "regenerate", [you(STORE)], { carries: STORE }],
  ["start over", "start over", [you(STORE)], { carries: STORE }],
  ["one more time", "one more time", [you(STORE)], { carries: STORE }],
  ["do it again", "do it again", [you(STORE)], { carries: STORE }],
  ["rebuild it again", "rebuild it again", [you(STORE)], { carries: STORE }],
  /* Politeness must not change the meaning of a message. */
  ["please rerun", "please rerun", [you(STORE)], { carries: STORE }],
  ["rerun please", "Rerun please", [you(STORE)], { carries: STORE }],
  ["a question mark is still a continuation", "rerun?", [you(STORE)], { carries: STORE }],
  [
    "the most recent description wins, not the first",
    "rebuild",
    [you(STORE), bot("Your page is ready."), you("Build me a law firm landing page for Adjei & Co")],
    { carries: "Build me a law firm landing page for Adjei & Co" },
  ],
  [
    "a reply is never carried — only what the person asked for",
    "rebuild",
    [bot("I build web apps and landing pages, and I can add sections to this one.")],
    { carries: null, keeps: true },
  ],
  ["nothing to carry yet", "rebuild", [], { carries: null, keeps: true }],
  [
    "a continuation is not carried as the brief",
    "rebuild",
    [you("go ahead"), you("yes")],
    { carries: null, keeps: true },
  ],

  /* The other half: messages that must arrive exactly as typed. */
  ["a full brief", STORE, [you("hello there friend")], { carries: null, keeps: true }],
  [
    "an instruction that opens with a continuation word",
    "go with a darker header and a bigger hero",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "make it, with an object",
    "make it darker",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  /* The other side of widening the restart family. Every branch is anchored at
     both ends, so a restart word followed by an actual instruction is an
     instruction — and it must stay one, or widening this list would start
     eating the edits people type. */
  [
    "redo, with an instruction after it",
    "redo the hero in green",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "rerun, with an instruction after it",
    "rerun the checkout section with fewer fields",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "run, as a verb in a real brief",
    "Build a page for a running club that runs weekly 5k events",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "start over, with a subject",
    "start over on the pricing table only",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "build, with a subject",
    "build me a pricing page",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  [
    "yes plus an instruction",
    "yes, and add a contact form",
    [you(STORE)],
    { carries: null, keeps: true },
  ],
  ["a question is untouched", "what font is the heading?", [you(STORE)], { carries: null, keeps: true }],
];

let wrong = 0;

for (const [name, message, history, expected] of CASES) {
  const brief = carryBrief(message, history);
  const carried = brief.carried;

  const carryOk = carried === (expected.carries ?? null);
  const keepOk = expected.keeps ? brief.text === message.trim() : true;
  /* Whenever something is carried, both halves must be in what is sent: the
     description, and the words the person actually typed. */
  const composedOk =
    carried === null || (brief.text.includes(carried) && brief.text.includes(message.trim()));

  const ok = carryOk && keepOk && composedOk;
  if (!ok) wrong++;
  console.log(
    `${ok ? "ok  " : "WRONG"} ${name}\n      sent: ${JSON.stringify(brief.text.slice(0, 90))}${
      brief.text.length > 90 ? "…" : ""
    }`,
  );
}

/* ── The turn list the API is handed ─────────────────────────────────────── */
const THREADS = [
  ["opens on a reply", [bot("Your page is ready."), you("make it darker")]],
  ["ends on a reply", [you("build a shop"), bot("Your page is ready.")]],
  ["two in a row from one side", [you("a shop"), you("with a cart"), bot("Done."), bot("Next: add a footer")]],
  ["only replies", [bot("Done."), bot("Done.")]],
  ["empty", []],
  ["blank bodies", [you("   "), you("a shop")]],
];

for (const [name, thread] of THREADS) {
  const turns = priorTurns(thread);
  const opensRight = turns.length === 0 || turns[0].role === "user";
  const endsRight = turns.length === 0 || turns[turns.length - 1].role === "user";
  const alternates = turns.every((turn, at) => at === 0 || turns[at - 1].role !== turn.role);
  const ok = opensRight && endsRight && alternates;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} turns: ${name} -> ${turns.map((t) => t.role).join(", ") || "(none)"}`);
}

/* ── The thread is a conversation, not a log ──────────────────────────────
 *
 * The failure this is for cost somebody the evening before a launch, and it is
 * worth stating precisely because nothing about it looks like a bug.
 *
 * Every reply the builder writes lands in one table: the answers a model wrote,
 * and also "Your build is underway" and "I couldn't place that change in the
 * page, so I've left it exactly as it was." All of it was replayed into the
 * next model call as ASSISTANT turns. So a person whose edit failed once was,
 * on their next message, showing the model an example of the assistant
 * declining that exact request — and on the message after that, two examples.
 *
 * The model did the consistent thing. Every edit after the first failure failed,
 * whatever they typed, and from the outside the builder had simply stopped being
 * able to edit their page. Nothing errored, nothing was logged, and rephrasing
 * made it worse because each attempt added another example.
 *
 * A person's own words always travel — "it", "that" and "too" are the reason
 * any of this is sent. What must not travel is the builder's side when it was
 * not an answer.
 */
const REPLAYED = [
  ["a real reply is conversation", bot("Done. The header is darker now."), true],
  ["a person's message always travels", you("delete this part"), true],
  ["THE ONE: a failed edit is not a reply", fault("I couldn't place that change in the page."), false],
  ["nor is a file that would not upload", fault("IMG_7663.jpeg could not be uploaded."), false],
  ["a build notice is not conversation", notice("Your build is underway.", "build_started"), false],
  ["nor is a build that finished", notice("Your page is ready.", "build_ready"), false],
  ["nor is one that failed", { from: "system", text: "The page came out unfinished.", tone: "error", kind: "build_failed" }, false],
  /* Rows written before tone and kind were carried have neither. Those are the
     ordinary replies this has always sent, and dropping them would quietly
     empty the history of every project that existed before this change. */
  ["a row from before this existed is kept", { from: "system", text: "Done." }, true],
];

for (const [name, turn, expected] of REPLAYED) {
  const got = conversational(turn);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} ${name} -> ${got ? "sent" : "dropped"}`);
}

/* And the whole loop, end to end: the thread as it actually stood at 19:04,
   after four failures. What reaches the model must contain none of them. */
const AFTER_FOUR_FAILURES = [
  you("Delete this part out of the page. $4,000–$12,000 before a single visitor arrives"),
  fault("I couldn't place that change in the page, so I've left it exactly as it was."),
  you("Delete this outta my page"),
  fault("I couldn't place that change in the page, so I've left it exactly as it was."),
  you("Delete thos outta my page; $4,000–$12,000 before a single visitor arrives"),
  fault("I couldn't place that change in the page, so I've left it exactly as it was."),
];

const afterFailures = priorTurns(AFTER_FOUR_FAILURES);
const carriesNoFailures = afterFailures.every((turn) => !String(turn.content).includes("couldn't place"));
if (!carriesNoFailures) wrong++;
console.log(
  `${carriesNoFailures ? "ok  " : "WRONG"} four failures in a row teach the model nothing -> ${
    afterFailures.map((t) => t.role).join(", ") || "(none)"
  }`,
);

/* Their own three messages still travel, joined into one user turn. Dropping
   the failures must not drop the requests they were failures of. */
const keptTheirWords = afterFailures.some((turn) => String(turn.content).includes("$4,000"));
if (!keptTheirWords) wrong++;
console.log(`${keptTheirWords ? "ok  " : "WRONG"} but their own words still travel`);

/* The filter runs BEFORE the last six are taken. Take the window first and a
   thread of six failures leaves nothing behind — which would be a different
   way of losing the conversation. */
const buried = priorTurns([
  you("build me a shop for dentists with a booking form"),
  ...Array.from({ length: 8 }, () => fault("I couldn't place that change in the page.")),
]);
const survived = buried.some((turn) => String(turn.content).includes("dentists"));
if (!survived) wrong++;
console.log(`${survived ? "ok  " : "WRONG"} a run of failures does not push the real message out of the window`);

/* A handful of shapes that must never be read as "just do the last thing". */
for (const message of ["make the header darker", "add a contact form", "a shop for dentists"]) {
  const ok = !isContinuation(message);
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} not a continuation: ${JSON.stringify(message)}`);
}

/* ── Picking a build back up ─────────────────────────────────────────────── */
const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const MINUTE = 60 * 1000;

/* [name, check, expected] — expected is the start time it should wait from,
   or null for "leave it alone". */
const RESUMES = [
  [
    "a build running when the workspace opened",
    { status: "Building", updatedAt: ago(2 * MINUTE), threadLoaded: true, building: false, sentHere: false },
    NOW - 2 * MINUTE,
  ],
  [
    "a row left Building days ago is not a build",
    { status: "Building", updatedAt: ago(3 * 24 * 60 * MINUTE), threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "just past the window",
    { status: "Building", updatedAt: ago(RESUME_WINDOW_MS + MINUTE), threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "just inside it",
    { status: "Building", updatedAt: ago(RESUME_WINDOW_MS - MINUTE), threadLoaded: true, building: false, sentHere: false },
    NOW - (RESUME_WINDOW_MS - MINUTE),
  ],
  [
    "a finished build",
    { status: "Built", updatedAt: ago(MINUTE), threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "a failed build",
    { status: "Failed", updatedAt: ago(MINUTE), threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "before the thread has arrived",
    { status: "Building", updatedAt: ago(MINUTE), threadLoaded: false, building: false, sentHere: false },
    null,
  ],
  [
    "a wait already in flight",
    { status: "Building", updatedAt: ago(MINUTE), threadLoaded: true, building: true, sentHere: false },
    null,
  ],
  [
    "this session did its own waiting",
    { status: "Building", updatedAt: ago(MINUTE), threadLoaded: true, building: false, sentHere: true },
    null,
  ],
  [
    "no timestamp at all",
    { status: "Building", updatedAt: null, threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "an unreadable timestamp",
    { status: "Building", updatedAt: "not a date", threadLoaded: true, building: false, sentHere: false },
    null,
  ],
  [
    "a row stamped in the future waits from now, not from a negative clock",
    { status: "Building", updatedAt: new Date(NOW + MINUTE).toISOString(), threadLoaded: true, building: false, sentHere: false },
    NOW,
  ],
];

for (const [name, check, expected] of RESUMES) {
  const got = resumableFrom({ ...check, now: NOW });
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} resume: ${name} -> ${got === null ? "leave it" : `wait from ${got - NOW}ms`}`);
}

/* ── The finished build's card, put back on a reopened thread ────────────── */
const ready = (at) => ({ kind: "build_ready", at });
const said = (at) => ({ kind: "chat", at });
const started = (at) => ({ kind: "build_started", at });

const CARDS = [
  ["the only build", [said(1), started(2), ready(3)], true, 2],
  ["the most recent of several", [ready(1), said(2), ready(3), said(4)], true, 2],
  ["a thread with no build in it", [said(1), said(2)], true, -1],
  ["a build that never finished", [said(1), started(2)], true, -1],
  ["a project with no page yet", [ready(1)], false, -1],
  ["an empty thread", [], true, -1],
  ["an announcement with no timestamp", [{ kind: "build_ready" }], true, -1],
  ["a row from before the column existed", [{ kind: "chat", at: 1 }], true, -1],
];

for (const [name, thread, hasPage, expected] of CARDS) {
  const got = cardIndex(thread, hasPage);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} card: ${name} -> ${got === -1 ? "no card" : `message ${got}`}`);
}

/* The card counts its minutes from when the page landed, not from now. */
{
  const landed = Date.parse("2026-09-01T11:58:00Z");
  const card = cardFor(
    { id: "p1", name: "Demo Page", preview_url: "https://x.test", last_build_at: "2026-09-01T11:58:00Z" },
    landed,
    "Web app",
  );
  const ok =
    card.at === landed && card.hasPage === true && card.projectId === "p1" && card.stamp !== null;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} card: counts from when the page landed`);
}

/* ── Asking for the file ─────────────────────────────────────────────────── */
/* [message, expected] — true means "hand over the page", false means "this is
   about the page itself". The false half is the one that matters: handing
   someone a file when they asked for a button is the worse failure. */
const DOWNLOADS = [
  /* The message that was actually refused, typos and all. */
  ["Semd me à download file", true],
  ["can I download this?", true],
  ["download", true],
  ["Download the page please", true],
  ["send me the html", true],
  ["give me the file", true],
  ["can I have a copy of the file", true],
  ["export the site", true],
  ["I want to save the code", true],
  ["is the html downloadable?", true],
  ["zip it up for me", true],

  /* Edits that talk about downloading. The page is the subject. */
  ["add a download button", false],
  ["Add a download link to the hero", false],
  ["make the download button bigger", false],
  ["put a download icon in the nav", false],
  ["change the download section's colour", false],
  ["remove the download form", false],

  /* Ordinary messages that must not trip it. */
  ["make the header darker", false],
  ["what font is the heading?", false],
  ["build me a pricing page", false],
  ["", false],
];

for (const [message, expected] of DOWNLOADS) {
  const got = wantsDownload(message);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(
    `${ok ? "ok  " : "WRONG"} download: ${JSON.stringify(message)} -> ${got ? "hand over the file" : "not a download"}`,
  );
}

/* ── Counting and cutting in words ────────────────────────────────────────
 *
 * The limit somebody meets is a word count now, so the two functions behind it
 * have to be right at the boundary rather than approximately right. A trim that
 * is one word out is a brief ending mid-sentence, and a count that is one out is
 * a charge somebody cannot reproduce.
 */
const WORDS = [
  ["a plain sentence", "one two three", 3],
  ["leading and trailing space", "  one two  ", 2],
  ["newlines and tabs count as space", "one\ntwo\tthree\n\nfour", 4],
  ["runs of spaces are one break", "one     two", 2],
  ["nothing is nothing", "   ", 0],
  ["punctuation rides with its word", "hello, world! again", 3],
  /* The rule is wc -w: a run of non-space is a word, so a dash standing on its
     own between spaces counts as one. Word processors would say three here.
     Written down because it is the sort of difference somebody notices when
     their 1,000-word document is called 1,006 — and being one or two out either
     way is invisible against an allowance of 300. */
  ["a lone dash is its own word", "hello, world — again", 4],
];

for (const [name, text, expected] of WORDS) {
  const got = countWords(text);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} words: ${name} -> ${got}`);
}

const TRIMS = [
  ["exactly at the limit keeps everything", "one two three", 3, "one two three"],
  ["one over is cut on the boundary", "one two three four", 3, "one two three"],
  ["under the limit is untouched", "one two", 5, "one two"],
  ["zero words is nothing", "one two", 0, ""],
  /* The shape of what somebody wrote survives: a brief flattened into one line
     reads to the model as a different brief. */
  ["paragraphs survive the cut", "one two\n\nthree four five", 4, "one two\n\nthree four"],
];

for (const [name, text, max, expected] of TRIMS) {
  const got = trimToWords(text, max);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "WRONG"} trim: ${name} -> ${JSON.stringify(got)}`);
}

/* And the round trip the billing depends on: a composed brief has to give its
   carried half back, or a build is charged for words it did not carry. */
const CARRIED = "a description worth continuing that is long enough to be substantive";
const composed = carryBrief("rebuild", [you(CARRIED)]);
const readBack = carriedContextWords(composed.text);
const roundTrip = readBack === countWords(CARRIED);
if (!roundTrip) wrong++;
console.log(
  `${roundTrip ? "ok  " : "WRONG"} a composed brief gives its carried half back: ${readBack} words`,
);

const plain = carriedContextWords("just a brief nobody continued");
const plainOk = plain === 0;
if (!plainOk) wrong++;
console.log(`${plainOk ? "ok  " : "WRONG"} a brief nobody continued carries nothing: ${plain}`);

console.log(
  `\n${
    CASES.length + THREADS.length + RESUMES.length + CARDS.length + DOWNLOADS.length + WORDS.length + TRIMS.length + 6
  } checks · ${wrong} wrong`,
);
process.exit(wrong === 0 ? 0 : 1);
