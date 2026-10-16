/* The pre-publish checklist, worked out in the browser from what the existing
 * routes already return: the project's files (/api/projects/[id]/files), its
 * database (/api/projects/[id]/backend) and the names of the secrets set on
 * its hosting (/api/projects/[id]/secrets). Nothing here calls anything new,
 * and nothing here reads a secret's VALUE — only names.
 *
 * Each check is a plain object in a list, so adding one is adding an entry:
 * the panel draws whatever this returns, in order. A check that cannot be
 * worked out from what is on hand is left out rather than guessed at. */

export type CheckLevel = "pass" | "warn" | "block";

export type Check = {
  id: string;
  label: string;
  level: CheckLevel;
  /** One line under the label when it is not a pass. */
  detail?: string;
  /** Which existing action fixes it, when one does. The panel maps it. */
  fix?: "database" | "chat";
  /** For "chat" fixes: what to ask the builder. */
  ask?: string;
};

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
          ask: "Add a page title and a meta description for search engines and link previews.",
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
          ask: "Add a favicon and a social share image (og:image) for link previews.",
        },
  );

  /* Only when there are forms. A form that posts nowhere — no action, no
     handler — is the thing to catch. */
  const forms = text.match(/<form\b[^>]*>/gi) ?? [];
  if (forms.length) {
    const wired = forms.every((tag) => /\b(action|onSubmit)\s*=/.test(tag));
    checks.push(
      wired
        ? { id: "forms", label: "Forms connected", level: "pass" }
        : {
            id: "forms",
            label: "Forms connected",
            level: "warn",
            detail: "A form has nowhere to send what is typed into it.",
            fix: "chat",
            ask: "Make every form on the site actually submit somewhere and confirm to the visitor that it was sent.",
          },
    );
  }

  /* Local image paths that are not among the project's files. Remote images
     are not checked: that would mean fetching them. */
  const missing = new Set<string>();
  for (const match of text.matchAll(/\bsrc\s*=\s*["']([^"'{}]+\.(?:png|jpe?g|gif|webp|svg|avif))["']/gi)) {
    const src = match[1];
    if (/^(https?:|data:|\/\/)/i.test(src)) continue;
    const clean = src.replace(/^\.?\//, "");
    if (!paths.has(clean) && !paths.has(`public/${clean}`)) missing.add(src);
  }
  checks.push(
    missing.size === 0
      ? { id: "images", label: "No broken images", level: "pass" }
      : {
          id: "images",
          label: "No broken images",
          level: "warn",
          detail: `${missing.size} image${missing.size === 1 ? "" : "s"} not found: ${[...missing].slice(0, 3).join(", ")}`,
          fix: "chat",
          ask: `These images are referenced but missing from the project: ${[...missing].join(", ")}. Replace them with images that exist.`,
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
