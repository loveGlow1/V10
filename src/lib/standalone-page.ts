import JSON5 from "json5";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

import { PREFLIGHT_CSS } from "./tailwind-preflight";

/* Turning a generated page into a file that works on its own.
 *
 * Every page the builder produces styles itself with the Tailwind play CDN:
 *
 *   <script src="https://cdn.tailwindcss.com"></script>
 *
 * That is the right call while the page lives at a URL — it is two lines
 * instead of a build step, and it is what leaves the model room to finish the
 * document. It is the wrong thing to hand somebody as a file. Downloaded and
 * opened from disk, that script is a network request the viewer will not make:
 * iOS Quick Look, an email attachment, a file:// tab on a plane. The script
 * never runs, no utility class resolves, and what renders is the raw document —
 * blue underlined links, Times New Roman, and an inline SVG at its natural size
 * because `h-5 w-5` meant nothing. The page looks broken. It is not broken; it
 * is unstyled, which looks the same and is worse, because the person cannot
 * tell which.
 *
 * So the export compiles. Tailwind runs here, over this page's own markup, and
 * the classes it actually uses become a stylesheet inside the file. What comes
 * out needs no network, no script, and no CDN that might one day stop
 * answering: it is one HTML file that renders the same in ten years as it does
 * now. That is what a download should be.
 *
 * Nothing is executed. The page is model output shaped by someone's prompt, so
 * its inline `tailwind.config` is read with JSON5 — a parser, not an evaluator.
 * A config that will not parse costs the custom palette, not the export. */

/* The CDN script, in the forms a model actually writes it: with or without a
   version path, single or double quotes, self-closed or not. */
const CDN_SCRIPT =
  /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*>\s*<\/script>/gi;

/* The configuration block that follows it. Non-greedy to the closing brace at
   the start of a line, which is how every one of these is formatted — anchoring
   on the last `}` in the script instead would swallow the rest of the file if
   the tag were ever unterminated. */
const CONFIG_SCRIPT =
  /<script\b[^>]*>\s*(?:window\.)?tailwind\.config\s*=\s*(\{[\s\S]*?\n?\})\s*;?\s*<\/script>/i;

/* A webfont link, which is the other thing in a generated page that only works
   online. Rare — the build prompt asks for system stacks — but five of the
   pages stored when this was written pull one, and a masthead set in a fallback
   serif is exactly the "it looks wrong" this whole export exists to prevent. */
const FONT_LINK =
  /<link\b[^>]*\bhref\s*=\s*["'](https:\/\/fonts\.googleapis\.com\/css2?\?[^"']+)["'][^>]*>/gi;

/* The preconnect hints that come with it. Harmless in a file, but they are
   references to a host the file no longer needs, and leaving them means "no
   remote reference of any kind" is not quite true. */
const FONT_PRECONNECT =
  /<link\b[^>]*\bhref\s*=\s*["']https:\/\/fonts\.(?:googleapis|gstatic)\.com\/?["'][^>]*>\s*/gi;

/* Chrome's, so the stylesheet comes back referencing woff2 rather than the ttf
   an unknown agent is served. Every browser that can open the file supports it,
   and it is a third the size. */
const WOFF2_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* Enough for a family at several weights, not enough for a page to make the
   export fetch a private library's worth of fonts. */
const MAX_FONT_BYTES = 2 * 1024 * 1024;

const FONT_FILE = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;

/**
 * Google Fonts, fetched and written into the file as data: URIs.
 *
 * Two round trips rather than one — the stylesheet, then the faces it names —
 * because there is no way to ask for both at once. Both are cheap and neither
 * is on the path of anything but a download.
 *
 * Every failure leaves the link exactly where it was. A page that still fetches
 * its font online is worse than one that carries it, and far better than one
 * whose fonts were removed because a request timed out.
 */
async function inlineWebFonts(html: string): Promise<string> {
  FONT_LINK.lastIndex = 0;
  const links = [...html.matchAll(FONT_LINK)];
  if (links.length === 0) return html;

  let out = html;
  let budget = MAX_FONT_BYTES;

  for (const [tag, href] of links) {
    try {
      const sheet = await fetch(href, { headers: { "User-Agent": WOFF2_AGENT } });
      if (!sheet.ok) continue;
      let css = await sheet.text();

      FONT_FILE.lastIndex = 0;
      const files = [...new Set([...css.matchAll(FONT_FILE)].map((m) => m[1]))];

      for (const url of files) {
        const face = await fetch(url);
        if (!face.ok) throw new Error(`font ${face.status}`);
        const bytes = Buffer.from(await face.arrayBuffer());

        budget -= bytes.byteLength;
        if (budget < 0) throw new Error("fonts exceed what an export will carry");

        css = css.split(url).join(`data:font/woff2;base64,${bytes.toString("base64")}`);
      }

      /* Only once every face is in hand. Replacing the link against a
         half-inlined stylesheet would leave the page reaching for the rest. */
      out = out.replace(tag, `<style data-quickstark="fonts">\n${css}\n</style>`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("standalone: a webfont could not be inlined, leaving the link:", error);
    }
  }

  /* Only when nothing points at those hosts any more. */
  FONT_LINK.lastIndex = 0;
  if (!FONT_LINK.test(out)) out = out.replace(FONT_PRECONNECT, "");

  return out;
}

export type StandaloneResult = {
  html: string;
  /** Bytes of CSS compiled in. Zero means the page never used the CDN. */
  cssBytes: number;
  /** True when an inline tailwind.config was found and understood. */
  themeApplied: boolean;
};

/* What a config may contain before it is handed to Tailwind. Anything else in
   there is dropped rather than trusted — `content` in particular, which would
   otherwise let a page point the compiler at the filesystem. */
function safeConfig(raw: unknown): Partial<Config> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const config: Partial<Config> = {};

  if (source.darkMode === "class" || source.darkMode === "media") {
    config.darkMode = source.darkMode;
  }
  if (source.theme && typeof source.theme === "object") {
    config.theme = source.theme as Config["theme"];
  }
  return config;
}

/** The inline `tailwind.config`, or an empty config when there isn't a usable one. */
function readConfig(html: string): { config: Partial<Config>; found: boolean } {
  const match = html.match(CONFIG_SCRIPT);
  if (!match) return { config: {}, found: false };

  try {
    /* JSON5 rather than JSON: these are JavaScript object literals — unquoted
       keys, single quotes, trailing commas — and rather than eval or `vm`,
       which run whatever they are given. */
    return { config: safeConfig(JSON5.parse(match[1])), found: true };
  } catch {
    /* A config with a function in it, or simply malformed. The page still
       compiles against the default theme, so it is styled and laid out; only
       bespoke colour names are lost. Better than refusing to export. */
    return { config: {}, found: false };
  }
}

/**
 * The page as a single self-contained file.
 *
 * A page that never used the CDN comes back unchanged — inlining a stylesheet
 * it does not reference would only make the file bigger.
 */
export async function toStandalone(html: string): Promise<StandaloneResult> {
  /* Fonts first, and independently of Tailwind: a page can use a webfont
     without the CDN, and the early return below would otherwise let it leave
     with a stylesheet it has to fetch. */
  const withFonts = await inlineWebFonts(html);

  CDN_SCRIPT.lastIndex = 0;
  if (!CDN_SCRIPT.test(withFonts)) {
    return { html: withFonts, cssBytes: 0, themeApplied: false };
  }

  const { config, found } = readConfig(withFonts);

  /* Compiled against this page and nothing else: `content` is the markup
     itself, so the output carries the utilities this document uses rather than
     the whole framework. A page of this size typically yields tens of
     kilobytes, against the CDN script's several hundred. */
  const compiled = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: withFonts, extension: "html" }],
      /* Off, and replaced immediately below by the same CSS from a string this
         repository carries. Tailwind's own preflight plugin readFileSync's a
         path built from __dirname, and that read has now failed twice in two
         different ways — see tailwind-preflight.ts. Nothing else in the compile
         touches the disk, so with this off the whole thing is arithmetic. */
      corePlugins: { preflight: false },
      plugins: [
        plugin(({ addBase }) => {
          /* Postcss nodes rather than the plain object the types describe —
             which is exactly what Tailwind's own preflight plugin passes, and
             what addBase actually accepts. The cast is to the published types,
             not around a real constraint. */
          addBase(postcss.parse(PREFLIGHT_CSS).nodes as unknown as Parameters<typeof addBase>[0]);
        }),
      ],
    } as Config),
  ]).process("@tailwind base;\n@tailwind components;\n@tailwind utilities;", {
    from: undefined,
  });

  const css = compiled.css.trim();

  /* The CDN script goes; the config script goes with it, because it configures
     something that is no longer there and would sit in the file as a reference
     to a global that never arrives. The stylesheet takes their place, first, so
     the page's own <style> block still wins where the two overlap — which is
     the order the CDN produced as well. */
  CDN_SCRIPT.lastIndex = 0;
  let out = withFonts.replace(
    CDN_SCRIPT,
    `<style data-quickstark="tailwind">\n${css}\n</style>`,
  );
  out = out.replace(CONFIG_SCRIPT, "");

  return { html: out, cssBytes: Buffer.byteLength(css, "utf8"), themeApplied: found };
}

/**
 * Whether this deployment can actually compile a stylesheet.
 *
 * Not a question about configuration — there is nothing to configure. It is a
 * question about the bundle, and it exists because the answer was once no in
 * production and yes everywhere it was tested.
 *
 * Tailwind reads its own files off disk (`preflight` is a literal readFileSync
 * of preflight.css). Bundled by webpack, that path is rewritten into the chunk
 * directory, the file is not there, and every compile throws ENOENT. The
 * download route catches that and serves the stored page instead, so the
 * failure produces a file that downloads fine and opens unstyled — the exact
 * symptom the compiling was added to fix, with nothing anywhere saying why.
 * next.config.mjs keeps the package external now, which is the fix; this is how
 * a running deployment can be asked whether the fix is in it.
 *
 * Compiles a few bytes rather than asserting a file exists on a path, because
 * the thing worth knowing is whether the compile runs, not whether one of its
 * inputs is where this code guesses it should be.
 */
export async function canCompile(): Promise<{ ok: boolean; error?: string }> {
  try {
    const probe = await toStandalone(
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>' +
        '</head><body class="flex"><i class="h-5 w-5"></i></body></html>',
    );

    if (probe.cssBytes > 0 && !/cdn\.tailwindcss\.com/.test(probe.html)) return { ok: true };
    return { ok: false, error: `compiled ${probe.cssBytes} bytes, which is not a stylesheet` };
  } catch (error) {
    /* The reason, not just the fact. A bare false cost a deploy and a round
       trip to the person who reported it: the compile was failing in production
       and passing everywhere it could be tested, and nothing anywhere said what
       it was failing on. The message is the app's own — a module path or a
       missing file, not user data — and it is worth more than the guess it
       replaces. */
    return { ok: false, error: (error as Error)?.message?.slice(0, 300) ?? "unknown" };
  }
}
