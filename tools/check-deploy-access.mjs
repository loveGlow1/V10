#!/usr/bin/env node
/* Who may have a project built and hosted.
 *
 *   npm run check:deploy-access
 *
 * Deploying uploads a customer's source to a third party and spends build
 * minutes on an account this platform pays for, and it has never once run
 * against the real API. So it is behind a named list, and the list has to be
 * right in both directions: the account in the rollout gets in, and nobody
 * else does — not another real customer, not a blank address, not a stranger.
 *
 * The widening switch is checked too, because the day it is used is the day
 * nobody re-reads this file.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const out = join(root, "node_modules", ".cache", "qs-access");
mkdirSync(out, { recursive: true });
const cfg = join(out, "tsconfig.json");
writeFileSync(cfg, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: { noEmit:false, outDir:out, rootDir:join(root,"src"), module:"esnext",
    moduleResolution:"bundler", declaration:false, incremental:false, plugins:[] },
  include: [join(root, "src/lib/publish/deploy-access.ts")],
}, null, 2));
execFileSync("npx", ["tsc", "-p", cfg], { cwd: root, stdio:["ignore","ignore","inherit"] });
const { canDeploy, deploysAreOpen } = await import(join(out, "lib/publish/deploy-access.js"));

let bad = 0;
const t = (cond, label) => { console.log(`${cond ? "ok   " : "FAIL "} ${label}`); if(!cond) bad++; };

/* ── Open by default ──────────────────────────────────────────────────────
 *
 * These four used to assert the opposite: a list of one address, everybody
 * else refused. That was right while the deploy path had never run, and it
 * stopped being right the day it ran twenty-seven files through a real Vercel
 * build — at which point the only thing the list still did was hide the
 * control from the people who had generated the projects, including the
 * account that pays for the deployments.
 *
 * So the default is now everybody, and what these assert is that "everybody"
 * means every signed-in ACCOUNT rather than every REQUEST. The line below
 * about an address that is not there is the one that still guards something. */
delete process.env.DEPLOY_ALLOWLIST;
t(deploysAreOpen() === true, "deploys are open by default — THE ROLLOUT IS OVER");
t(canDeploy("micheledallida@gmail.com") === true, "the original rollout account still may");
t(canDeploy("jephthahkofi@gmail.com") === true, "the owner account may");
t(canDeploy("bradscot221@gmail.com") === true, "any other signed-up account may");
t(canDeploy("someone@example.com") === true, "an account this test has never heard of may");
t(canDeploy("MicheleDallida@Gmail.com") === true, "case does not matter");
t(canDeploy("  micheledallida@gmail.com  ") === true, "surrounding space does not matter");

/* Signed IN is still the floor, and it is the whole floor this file guards.
   Ownership of the project is settled before this is ever consulted — see
   ownedProject() in the deploy route — so what must never pass here is a
   request carrying no identity at all. */
t(canDeploy(null) === false, "no address is still nobody, open or not");
t(canDeploy("") === false, "an empty address is still nobody");
t(canDeploy(undefined) === false, "a missing address is still nobody");

process.env.DEPLOY_ALLOWLIST = "a@b.com, C@D.com";
t(canDeploy("a@b.com") === true && canDeploy("c@d.com") === true, "an explicit list is honoured");
t(canDeploy("micheledallida@gmail.com") === false, "an explicit list REPLACES the default");

process.env.DEPLOY_ALLOWLIST = "*";
t(deploysAreOpen() === true && canDeploy("anyone@anywhere.com") === true, "* opens it to everybody");
t(canDeploy(null) === false, "even wide open, no address is still nobody");

console.log(bad === 0 ? "\nall good" : `\n${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
