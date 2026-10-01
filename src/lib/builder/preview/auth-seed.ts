/* Staying signed in to the app being previewed.
 *
 * The preview runs the project in a sandboxed frame with an opaque origin, so
 * it has no localStorage of its own, and the supabase client there keeps its
 * session in memory (see runtime.ts liveSupabase). That holds for as long as
 * the frame does — and the frame is rebuilt every time an update lands or
 * someone presses refresh. So a person signed in, asked for a change, and was
 * then told "Sign in to save properties" by an app they were sure they were
 * signed in to.
 *
 * The frame now reports every write to its auth storage to the workspace,
 * which keeps them in this tab's sessionStorage for this project, and writes
 * them back into the next frame before any of its scripts run. One project,
 * one tab: closing the tab signs the preview out, as a browser session would.
 *
 * Only supabase's own auth keys are carried, and only from the frame itself —
 * the workspace checks the message came from its own iframe. Pure apart from
 * the storage it is handed, so it can be tested without a browser. */

/* What supabase-js names its session and PKCE verifier. Nothing else crosses. */
const AUTH_KEY = /^sb-[a-z0-9-]{1,80}-auth-token(?:-code-verifier)?$/;
const LARGEST = 32_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const slot = (projectId: string) => `quickstark:preview-auth:${projectId}`;

function read(store: Store, projectId: string): Record<string, string> {
  try {
    const raw = store.getItem(slot(projectId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => AUTH_KEY.test(entry[0]) && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Records one write the frame reported. Anything that is not an auth key is ignored. */
export function rememberAuthWrite(store: Store, projectId: string, key: unknown, value: unknown): boolean {
  if (typeof key !== "string" || !AUTH_KEY.test(key)) return false;
  if (value !== null && (typeof value !== "string" || value.length > LARGEST)) return false;
  const kept = read(store, projectId);
  if (value === null) delete kept[key];
  else kept[key] = value;
  try {
    if (Object.keys(kept).length === 0) store.removeItem(slot(projectId));
    else store.setItem(slot(projectId), JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

/**
 * The preview page with this tab's session for the project written in ahead
 * of every script, or unchanged when there is none.
 */
export function withAuthSeed(html: string, store: Store | null, projectId: string): string {
  if (!store) return html;
  const kept = read(store, projectId);
  if (Object.keys(kept).length === 0) return html;
  /* Escaped so no value can close the script it sits in. */
  const json = JSON.stringify(kept)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
  const script = `<script>window.__qsAuthSeed=${json};</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}
