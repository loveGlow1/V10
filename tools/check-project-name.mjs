#!/usr/bin/env node
/* Checks the prompt-to-name step against real prompts.
 *
 *   npm run check:name
 *
 * The cases below are the prompts this account actually sent — read out of the
 * projects table, where they had been stored verbatim as names. They are the
 * reason this step exists, so they are what it is measured against.
 *
 * Expectations are written as a rule rather than a fixed string wherever the
 * exact wording does not matter: what matters is that a name is short, is not
 * shouting, and does not end mid-phrase on a joining word.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-name");
mkdirSync(out, { recursive: true });

try {
  execFileSync(
    "npx",
    ["tsc", "src/app/dashboard/projectName.ts", "--outDir", out,
     "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const { nameFromPrompt } = await import(join(out, "projectName.js"));

  /* [prompt, expected name] — expected null means "no exact claim, just the
     rules below". */
  const CASES = [
    ["Build a dashboard with sign-in, a chart and a table", "Dashboard with sign-in, a chart"],
    ["Build an online store with a product catalogue, cart and Stripe checkout", "Online store with a product"],
    ["Build me a job application tracking app", "Job application tracking"],
    ["Build me a Law Firm website named Adjei & Co", "Adjei & Co"],
    ["CREATE A LANDING PAGE FOR ST MONICA'S", "Landing Page for St Monica's"],
    ["CREATE A LAW FIRM LANDING PAGE NAMED ADJEI", "Adjei"],
    ["Create a premium, modern, mobile-first landing page", "Premium, modern, mobile-first"],
    ["I want to build a DIASPORA ASSIST app", "Diaspora Assist"],
    ["MASTER AI LANDING PAGE PROMPT — SERIES SERVICE", "Master AI Landing Page Prompt"],
    ["SERIES SERVICE COMPANY — AI LANDING PAGE", "Series Service Company"],
    ["please can you make me a portfolio site", "Portfolio site"],
    ["hey, build me an app", "Untitled app"],
    ["", "Untitled app"],
    ["   ", "Untitled app"],
    ["a", "Untitled app"],
  ];

  let failed = 0;
  for (const [prompt, want] of CASES) {
    const got = nameFromPrompt(prompt);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${JSON.stringify(prompt).slice(0, 52).padEnd(54)} -> ${JSON.stringify(got)}`);
    if (!ok) console.log(`        wanted ${JSON.stringify(want)}`);
  }

  /* Rules that must hold for every case, expected string or not. */
  for (const [prompt] of CASES) {
    const got = nameFromPrompt(prompt);
    if (got.length > 32) { console.log(`FAIL  too long: ${JSON.stringify(got)}`); failed++; }
    if (got !== got.toUpperCase() ? false : /[A-Z]{4,}/.test(got) && got === got.toUpperCase()) {
      console.log(`FAIL  still shouting: ${JSON.stringify(got)}`); failed++;
    }
    if (/\b(?:a|an|the|for|with|and|to|of|named|called)$/i.test(got)) {
      console.log(`FAIL  ends on a joining word: ${JSON.stringify(got)}`); failed++;
    }
    if (!got.trim()) { console.log("FAIL  empty name"); failed++; }
  }

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} failed.`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
