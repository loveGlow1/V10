/* The pre-publish checklist, worked out in the browser from what the existing
 * routes already return: the project's files (/api/projects/[id]/files), its
 * database (/api/projects/[id]/backend) and the names of the secrets set on
 * its hosting (/api/projects/[id]/secrets). Nothing here calls anything new,
 * and nothing here reads a secret's VALUE — only names.
 *
 * Each check is a plain object in a list, so adding one is adding an entry:
 * the panel draws whatever this returns, in order. A check that cannot be
 * worked out from what is on hand is left out rather than guessed at.
 *
 * ── Fix requests name the place ───────────────────────────────────────────
 *
 * The builder edits one file per request and has to find the spot. "Make
 * every form submit somewhere" names neither, and the builder answers that it
 * could not place the change. So each finding carries where it is — the file,
 * the line, the tag as written — and its Fix sends one request per file
 * quoting it. */

export type CheckLevel = "pass" | "warn" | "block";

export type Check = {
  id: string;
  label: string;
  level: CheckLevel;
  /** One line under the label when it is not a pass. */
  detail?: string;
  /** Which existing action fixes it, when one does. The panel maps it. */
  fix?: "database" | "chat";
  /** For "chat" fixes: what to ask the builder, one request per file. */
  asks?: string[];
};

/** Where a finding is: the file, the 1-based line, and the code as written. */
type Spot = { path: string; line: number; code: string };

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

function quote(code: string) {
  const flat = code.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

/* A JSX/HTML opening tag read to its real end: a ">" inside {…} or quotes
   (an arrow function, a comparison) does not close it. */
function tagAt(text: string, start: number): string {
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inQuote) {
      if (char === inQuote) inQuote = null;
    } else if (char === '"' || char === "'" || char === "`") inQuote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth <= 0) return text.slice(start, i + 1);
  }
  return text.slice(start, start + 200);
}

/* The file a title, description or icon belongs in, when there is one. */
function headFile(files: File[]): string | null {
  const order = [/^(src\/)?app\/layout\.[jt]sx$/, /^(src\/)?pages\/_app\.[jt]sx$/, /^(public\/)?index\.html?$/, /\.html?$/];
  for (const pattern of order) {
    const hit = files.find((file) => pattern.test(file.path));
    if (hit) return hit.path;
  }
  return null;
}

type File = { path: string; content: string };

export type BackendInfo = { mode: string | null; ready: boolean } | null;

const PAGE = /\.(html?|[jt]sx)$/i;

/* Names the platform provides on its own, so code reading them is not
   missing anything. */
const PROVIDED = /^(NODE_ENV|VERCEL.*|NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY|SCHEMA)|NEXT_RUNTIME|PORT)$/;

export const DATABASE_LABEL: Record<string, string> = {
  quickstark_managed: "Managed",
  shared: "Shared",
  own: "Own",
};

function pages(files: File[]) {
  return files.filter((file) => PAGE.test(file.path) && !/node_modules\//.test(file.path));
}

export function runChecks(input: {
  files: File[];
  webApp: boolean;
  backend: BackendInfo;
  secretNames: string[] | null;
}): Check[] {
  const { files, webApp, backend, secretNames } = input;
  const text = pages(files).map((file) => file.content).join("\n");
  const paths = new Set(files.map((file) => file.path.replace(/^\/+/, "")));
  const checks: Check[] = [];

  const hasTitle = /<title>[^<]{2,}<\/title>|\btitle\s*:\s*["'`][^"'`]{2,}/i.test(text);
  const hasDescription = /name=["']description["']|\bdescription\s*:\s*["'`][^"'`]{2,}/i.test(text);
  checks.push(
    hasTitle && hasDescription
      ? { id: "seo", label: "Page title and description set", level: "pass" }
      : {
          id: "seo",
          label: "Page title and description set",
          level: "warn",
          detail: hasTitle ? "No description for search results." : "No page title for search results and tabs.",
          fix: "chat",
          asks: [
            headFile(files)
              ? `In ${headFile(files)}, add a page title and a meta description for search engines and link previews.`
              : "Add a page title and a meta description for search engines and link previews.",
          ],
        },
  );

  const hasIcon =
    /rel=["'](?:shortcut )?icon["']|\bicons?\s*:/i.test(text) ||
    [...paths].some((path) => /(^|\/)(favicon\.(ico|png|svg)|icon\.(png|svg|ico))$/i.test(path));
  const hasShare = /og:image|openGraph\s*:|twitter:image/i.test(text) || [...paths].some((path) => /opengraph-image/i.test(path));
  checks.push(
    hasIcon && hasShare
      ? { id: "icons", label: "Favicon and social share image", level: "pass" }
      : {
          id: "icons",
          label: "Favicon and social share image",
          level: "warn",
          detail: hasIcon ? "No share image for link previews." : hasShare ? "No favicon." : "No favicon or share image.",
          fix: "chat",
          asks: [
            headFile(files)
              ? `In ${headFile(files)}, add a favicon and a social share image (og:image) for link previews.`
              : "Add a favicon and a social share image (og:image) for link previews.",
          ],
        },
  );

  /* Only when there are forms. A form that posts nowhere — no action, no
     onSubmit, no button in it doing the work — is the thing to catch. Lower
     case only: <Form> is a component (shadcn's wraps a real <form> inside),
     not the element. */
  const looseForms: Spot[] = [];
  let formCount = 0;
  for (const file of pages(files)) {
    for (const match of file.content.matchAll(/<form(?=[\s>])/g)) {
      formCount += 1;
      const start = match.index ?? 0;
      const tag = tagAt(file.content, start);
      const end = file.content.indexOf("</form>", start);
      const inner = end > start ? file.content.slice(start + tag.length, end) : "";
      const wired =
        /\b(action|onSubmit)\s*=/.test(tag) ||
        /\{\s*\.\.\./.test(tag) ||
        /<button\b[^>]*\bonClick\s*=/.test(inner) ||
        /\bdata-netlify\b|formspree|formsubmit/i.test(tag);
      if (!wired) looseForms.push({ path: file.path, line: lineOf(file.content, start), code: quote(tag) });
    }
  }
  if (formCount) {
    const byFile = new Map<string, Spot[]>();
    for (const spot of looseForms) byFile.set(spot.path, [...(byFile.get(spot.path) ?? []), spot]);
    checks.push(
      looseForms.length === 0
        ? { id: "forms", label: "Forms connected", level: "pass" }
        : {
            id: "forms",
            label: "Forms connected",
            level: "warn",
            detail: `Not sending anywhere: ${looseForms
              .slice(0, 3)
              .map((spot) => `${spot.path}:${spot.line}`)
              .join(", ")}${looseForms.length > 3 ? ` and ${looseForms.length - 3} more` : ""}`,
            fix: "chat",
            asks: [...byFile].map(
              ([path, spots]) =>
                `In ${path}, ${spots
                  .map((spot) => `the form at line ${spot.line} (\`${spot.code}\`)`)
                  .join(" and ")} ${spots.length === 1 ? "has" : "have"} no onSubmit handler, so nothing typed into ${
                  spots.length === 1 ? "it" : "them"
                } is sent anywhere. Add an onSubmit handler that prevents the page reload, saves or sends the entry, and shows the visitor a confirmation.`,
            ),
          },
    );
  }

  /* Local image paths that are not among the project's files. Remote images
     are not checked: that would mean fetching them. */
  const missing: Spot[] = [];
  for (const file of pages(files)) {
    for (const match of file.content.matchAll(/\bsrc\s*=\s*["']([^"'{}]+\.(?:png|jpe?g|gif|webp|svg|avif))["']/gi)) {
      const src = match[1];
      if (/^(https?:|data:|\/\/)/i.test(src)) continue;
      const clean = src.replace(/^\.?\//, "");
      if (!paths.has(clean) && !paths.has(`public/${clean}`)) {
        missing.push({ path: file.path, line: lineOf(file.content, match.index ?? 0), code: src });
      }
    }
  }
  const missingByFile = new Map<string, Spot[]>();
  for (const spot of missing) missingByFile.set(spot.path, [...(missingByFile.get(spot.path) ?? []), spot]);
  checks.push(
    missing.length === 0
      ? { id: "images", label: "No broken images", level: "pass" }
      : {
          id: "images",
          label: "No broken images",
          level: "warn",
          detail: `${missing.length} image${missing.length === 1 ? "" : "s"} not found: ${missing
            .slice(0, 3)
            .map((spot) => `${spot.code} (${spot.path}:${spot.line})`)
            .join(", ")}`,
          fix: "chat",
          asks: [...missingByFile].map(
            ([path, spots]) =>
              `In ${path}, ${spots.map((spot) => `line ${spot.line} uses "${spot.code}"`).join(" and ")}, which ${
                spots.length === 1 ? "is" : "are"
              } not in the project. Replace ${spots.length === 1 ? "it" : "them"} with an image that exists or a suitable stock photo URL.`,
          ),
        },
  );

  if (!webApp) return checks;

  const mode = backend?.mode && backend.mode !== "none" ? backend.mode : null;
  const usesDatabase = /supabase|createClient\(/i.test(files.map((file) => file.content).join("\n"));
  if (mode) {
    checks.push({ id: "database", label: `Database connected (${DATABASE_LABEL[mode] ?? mode})`, level: "pass" });
    checks.push(
      backend?.ready
        ? { id: "migrations", label: "Database changes applied", level: "pass" }
        : {
            id: "migrations",
            label: "Database changes applied",
            level: "warn",
            detail: "Some database changes haven't been applied yet.",
            fix: "database",
          },
    );
  } else if (usesDatabase) {
    checks.push({
      id: "database",
      label: "Database connected",
      level: "block",
      detail: "This app uses a database and none is connected.",
      fix: "database",
    });
  }

  /* Read by the code, set nowhere: names only. */
  if (secretNames) {
    const read = new Set<string>();
    for (const file of files) {
      for (const match of file.content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) read.add(match[1]);
    }
    const set = new Set(secretNames);
    const unset = [...read].filter((name) => !PROVIDED.test(name) && !set.has(name)).sort();
    checks.push(
      unset.length === 0
        ? { id: "env", label: "Environment variables complete", level: "pass" }
        : {
            id: "env",
            label: "Environment variables complete",
            level: "warn",
            detail: `Not set: ${unset.join(", ")}`,
            fix: "database",
          },
    );
  }

  return checks;
}

/** Fetches what the checks need and runs them. Never throws. */
export async function loadChecks(projectId: string, webApp: boolean): Promise<Check[] | null> {
  const json = (url: string) =>
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  const [files, backend, secrets] = await Promise.all([
    json(`/api/projects/${projectId}/files`),
    webApp ? json(`/api/projects/${projectId}/backend`) : Promise.resolve(null),
    webApp ? json(`/api/projects/${projectId}/secrets`) : Promise.resolve(null),
  ]);
  if (!files || !Array.isArray(files.files)) return null;
  return runChecks({
    files: files.files as File[],
    webApp,
    backend: backend ? { mode: (backend.mode as string | null) ?? null, ready: Boolean(backend.ready) } : null,
    secretNames: secrets && secrets.configured && Array.isArray(secrets.keys) ? (secrets.keys as string[]) : null,
  });
}
