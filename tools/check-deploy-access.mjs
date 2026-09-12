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

delete process.env.DEPLOY_ALLOWLIST;
t(canDeploy("micheledallida@gmail.com") === true, "the rollout account may deploy");
t(canDeploy("MicheleDallida@Gmail.com") === true, "case does not matter");
t(canDeploy("  micheledallida@gmail.com  ") === true, "surrounding space does not matter");
t(canDeploy("jephthahkofi@gmail.com") === false, "another real account may not");
t(canDeploy("someone@example.com") === false, "a stranger may not");
t(canDeploy(null) === false, "no address may not");
t(canDeploy("") === false, "an empty address may not");
t(deploysAreOpen() === false, "deploys are not open by default");

process.env.DEPLOY_ALLOWLIST = "a@b.com, C@D.com";
t(canDeploy("a@b.com") === true && canDeploy("c@d.com") === true, "an explicit list is honoured");
t(canDeploy("micheledallida@gmail.com") === false, "an explicit list REPLACES the default");

process.env.DEPLOY_ALLOWLIST = "*";
t(deploysAreOpen() === true && canDeploy("anyone@anywhere.com") === true, "* opens it to everybody");
t(canDeploy(null) === false, "even wide open, no address is still nobody");

console.log(bad === 0 ? "\nall good" : `\n${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
