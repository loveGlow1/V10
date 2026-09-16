/* Which of the two things a generated project is.
 *
 * Nearly every project this platform builds is a set of pages that talk to
 * Supabase from the browser. `output: "export"` turns that into a directory of
 * files: nothing to provision, nothing to keep warm, served from a CDN, and
 * previewable and downloadable without a server existing anywhere. That is the
 * default and it should stay the default — it is right about 95% of the time
 * and it is the cheaper, faster and more robust of the two.
 *
 * The other 5% cannot be done that way at all. A route handler, a server
 * action, a middleware redirect and a secret API key are four different ways of
 * saying "this needs a server", and under `output: "export"` none of them work:
 * Next.js refuses the build on a route handler, and SILENTLY DROPS middleware,
 * which is worse — a route guard that compiles, deploys and protects nothing.
 *
 * ── Read from what was written, not from what was asked ───────────────────
 *
 * The brief tells the model which kind of project to write; this reads the
 * files that came back. Those are different questions and the second one is the
 * one that has to be right, because the config has to match the code. A model
 * told "no server" that writes a route handler anyway is a normal Tuesday, and
 * the honest response is to build it as a server app rather than to fail its
 * build on a conflict the customer never introduced.
 *
 * So this only ever RAISES. A static config over server code is a broken build;
 * a server config over static code is a working site that costs a little more
 * to host. When the two disagree, the expensive one is the safe one.
 */

import { code } from "./next-structure";
import type { FileTree } from "./tree";

export type BuildMode = "static" | "server";

export type ModeVerdict = {
  mode: BuildMode;
  /** Why, naming files. Empty for static: the default needs no justification. */
  because: string[];
};

const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/** A route handler. Under `output: "export"` this is a build error. */
const ROUTE_HANDLER = /^(?:src\/)?app\/(?:.*\/)?route\.[jt]sx?$/;

/** Root middleware. Under `output: "export"` this is silently ignored. */
const MIDDLEWARE = /^(?:src\/)?middleware\.[jt]s$/;

/* The directive on a line of its own, which is the only place it is a
   directive. Matched on the RAW source rather than the blanked copy for the one
   reason that matters here: blanking removes string bodies, and this directive
   IS a string. */
const USE_SERVER = /^[ \t]*["']use server["'][ \t]*;?[ \t]*$/m;

/* Reading an environment variable that is not published.
 *
 * NEXT_PUBLIC_ is inlined into the bundle and served to every visitor, so it is
 * not a secret and needs no server. Anything else being read is either a secret
 * — a Stripe key, an OpenAI key — or a build-time flag. The two exceptions
 * below are the flags: they exist in a static build and mean nothing about
 * hosting. */
const SECRET_ENV =
  /\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g;
const PUBLIC_ENV = /^(?:NEXT_PUBLIC_|NEXT_RUNTIME$|NODE_ENV$|VERCEL(?:_|$))/;

/* Packages that only work on a server, listed rather than guessed.
 *
 * The distinction is the whole point of the list: `stripe` holds a secret key
 * and cannot run in a browser, while `@stripe/stripe-js` is designed to and is
 * perfectly at home in a static site. A rule that matched "stripe" would send
 * every checkout page to a server it does not need. */
const SERVER_ONLY_PACKAGES = [
  "stripe",
  "openai",
  "resend",
  "nodemailer",
  "twilio",
  "@anthropic-ai/sdk",
  "@supabase/ssr",
  "@supabase/auth-helpers-nextjs",
];

const IMPORT_FROM = /(?:^|\n)\s*(?:import[^;\n]*?from\s*|export[^;\n]*?from\s*|(?:const|let|var)[^=\n]*=\s*require\s*\(\s*)["']([^"']+)["']/g;

/* Comments gone, strings KEPT.
 *
 * `code()` in next-structure.ts blanks both, which is right for reading code
 * and wrong for reading imports: the thing being read — the specifier — lives
 * inside a string, so blanking strings erases the very text this is looking
 * for. That is not hypothetical; it is the bug this function was written to fix
 * after `import { Resend } from "resend"` came back static.
 *
 * Comments still have to go, or a line somebody commented out reads as a live
 * import. Not length-preserving, because nothing here uses offsets. */
function withoutComments(source: string): string {
  let out = "";
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      out += character;
      if (character === "\\") {
        out += next ?? "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      out += " ";
      continue;
    }

    if (character === '"' || character === "'" || character === "`") quote = character;
    out += character;
  }

  return out;
}

/** Whether this path is a file whose contents are worth reading. */
function isSource(path: string): boolean {
  return SOURCE.test(path);
}

/**
 * Which build mode this tree needs, and why.
 *
 * Never throws and never guesses: every reason it returns names a file and a
 * fact about it. A tree with nothing server-shaped in it comes back static with
 * an empty list, which is the ordinary answer.
 */
export function buildModeOf(tree: FileTree): ModeVerdict {
  const because: string[] = [];

  for (const file of tree) {
    if (ROUTE_HANDLER.test(file.path)) {
      because.push(`${file.path} answers requests, which needs a server`);
      continue;
    }

    if (MIDDLEWARE.test(file.path)) {
      /* Worth saying out loud in the reason. A static export does not reject
         middleware, it ignores it — so the failure is a guard that protects
         nothing, on a site that built and deployed perfectly. */
      because.push(`${file.path} runs before a request, which a static export ignores rather than refuses`);
      continue;
    }

    if (!isSource(file.path)) continue;

    if (USE_SERVER.test(file.content)) {
      because.push(`${file.path} declares "use server", so it runs on a server`);
      continue;
    }

    const body = code(file.content);

    let secret: string | null = null;
    SECRET_ENV.lastIndex = 0;
    for (let match = SECRET_ENV.exec(body); match; match = SECRET_ENV.exec(body)) {
      const name = match[1] ?? match[2] ?? "";
      if (name && !PUBLIC_ENV.test(name)) {
        secret = name;
        break;
      }
    }
    if (secret) {
      because.push(`${file.path} reads ${secret}, which is not published to the browser`);
      continue;
    }

    let imported: string | null = null;
    const importable = withoutComments(file.content);
    IMPORT_FROM.lastIndex = 0;
    for (let match = IMPORT_FROM.exec(importable); match; match = IMPORT_FROM.exec(importable)) {
      const specifier = match[1];
      if (SERVER_ONLY_PACKAGES.includes(specifier)) {
        imported = specifier;
        break;
      }
    }
    if (imported) {
      because.push(`${file.path} imports ${imported}, which cannot run in a browser`);
    }
  }

  return because.length > 0 ? { mode: "server", because } : { mode: "static", because: [] };
}

/** The shorthand, for callers that only need the answer. */
export function isServerBuild(tree: FileTree): boolean {
  return buildModeOf(tree).mode === "server";
}
