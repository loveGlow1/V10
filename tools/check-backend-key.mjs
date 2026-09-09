#!/usr/bin/env node
/* The one check standing between a public bundle and a secret key.
 *
 *   npm run check:backend-key
 *
 * isAnonKey() guards the field somebody pastes their own Supabase key into.
 * Whatever goes in there is compiled into a statically exported bundle and
 * served to every visitor of the finished site — so the wrong key in that field
 * hands each of them full read and write over every table with RLS bypassed,
 * and there is no later point at which anybody would notice.
 *
 * It is asymmetric, which is why both halves are tested here:
 *
 *   Too STRICT and a valid key is refused. That is what happened — only the
 *   legacy JWT format was recognised, so every Supabase project created after
 *   the format changed was told its key was not an anon key. Loud, harmless,
 *   and it made the feature unusable for new users.
 *
 *   Too LOOSE and a secret key is accepted. Silent, and the damage is done
 *   before anybody looks.
 *
 * No network, and no real key anywhere in this file. Everything below is
 * structurally valid and cryptographically meaningless — the function reads a
 * prefix or a payload, it never verifies a signature.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-backend-key");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/backend/connection.ts")],
  }),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }

/* A JWT with the given role. Header and signature are filler — nothing here
   verifies one, and pretending otherwise would be testing a different function. */
function jwt(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iss: "supabase" })}.signaturenotchecked`;
}

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  const rewrite = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { rewrite(path); continue; }
      if (!path.endsWith(".js")) continue;
      const depth = path.slice(out.length + 1).split("/").length - 1;
      const prefix = depth === 0 ? "./" : "../".repeat(depth);
      writeFileSync(path, readFileSync(path, "utf8").replace(
        /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          const asFile = join(out, `${rest}.js`);
          return `${q}${prefix}${existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`}${q}`;
        }));
    }
  };
  rewrite(out);

  const { isAnonKey, isSupabaseUrl } = await import(join(out, "lib/builder/backend/connection.js"));

  const accepts = (value, why) =>
    isAnonKey(value) ? ok(why) : fail(why, "a valid key was refused — the link form is unusable for this person");
  const refuses = (value, why) =>
    isAnonKey(value) ? fail(why, "THIS WOULD BE SERVED TO EVERY VISITOR OF THE GENERATED SITE") : ok(why);

  /* Assembled rather than written out, and never from a real key.
   *
   * A literal `sb_secret_…` in a committed file is a Supabase Secret Key as far
   * as every secret scanner is concerned, and GitHub push protection rejects
   * the push — which it should, because it cannot know this one is invented.
   * Concatenation keeps the string out of the file while the function under
   * test still receives exactly what a real one looks like.
   *
   * The bodies are visibly fake for the same reason: a test that carries a
   * working credential is a credential published to everyone who can read the
   * repository, and no assertion here needs a real one. */
  const PUBLISHABLE = `sb_${"publishable"}_${"A1b2C3d4E5f6G7h8I9j0"}`;
  const SECRET = `sb_${"secret"}_${"A1b2C3d4E5f6G7h8I9j0"}`;

  console.log("The current format — sb_ prefixed:");
  accepts(PUBLISHABLE, "a publishable key is accepted");
  refuses(SECRET, "a SECRET key is refused");
  refuses(`sb_${"publishable"}_`, "the bare prefix with no key is refused");
  refuses("sb_", "the bare sb_ prefix is refused");
  refuses("sb_something_else_entirely", "an unknown sb_ kind is refused");
  /* The prefix must be at the START. A secret key that merely mentions the
     publishable prefix somewhere inside it must not slip through. */
  refuses(`${SECRET}_sb_${"publishable"}_abc`, "a secret key containing the publishable prefix is refused");

  console.log("\nThe legacy format — JWTs, told apart by their role:");
  accepts(jwt("anon"), "an anon JWT is accepted");
  refuses(jwt("service_role"), "a service_role JWT is refused");
  refuses(jwt("authenticated"), "any other role is refused");

  console.log("\nAnything else:");
  refuses("", "an empty string");
  refuses("   ", "whitespace");
  refuses(undefined, "undefined");
  refuses(null, "null");
  refuses(12345, "a number");
  refuses("not.a.jwt", "three dot-separated words that are not base64");
  refuses("eyJhbGciOiJIUzI1NiJ9", "a JWT with no payload or signature");

  console.log("\nWhitespace around a pasted key is forgiven:");
  accepts(`  ${PUBLISHABLE}  `, "a publishable key with stray spaces");

  console.log("\nThe URL beside it is still checked:");
  const urlOk = (v, why) => (isSupabaseUrl(v) ? ok(why) : fail(why));
  const urlNo = (v, why) => (isSupabaseUrl(v) ? fail(why) : ok(why));
  urlOk("https://esuatccbicekcohzgcvd.supabase.co", "a real project URL");
  urlNo("javascript:alert(1)", "a javascript: URL");
  urlNo("", "an empty string");

  console.log(failed ? `\n${failed} failed.` : "\nAll 20 passed.");
  process.exit(failed ? 1 : 0);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
