import JSON5 from "json5";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";

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
  CDN_SCRIPT.lastIndex = 0;
  if (!CDN_SCRIPT.test(html)) {
    return { html, cssBytes: 0, themeApplied: false };
  }

  const { config, found } = readConfig(html);

  /* Compiled against this page and nothing else: `content` is the markup
     itself, so the output carries the utilities this document uses rather than
     the whole framework. A page of this size typically yields tens of
     kilobytes, against the CDN script's several hundred. */
  const compiled = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: html, extension: "html" }],
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
  let out = html.replace(
    CDN_SCRIPT,
    `<style data-quickstark="tailwind">\n${css}\n</style>`,
  );
  out = out.replace(CONFIG_SCRIPT, "");

  return { html: out, cssBytes: Buffer.byteLength(css, "utf8"), themeApplied: found };
}

/** A filename someone can find again, derived from the project's own name. */
export function downloadNameFor(projectName: string): string {
  const stem =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page";
  return `${stem}.html`;
}
