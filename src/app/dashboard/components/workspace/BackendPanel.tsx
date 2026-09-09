"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Database, Download, Loader2, ShieldCheck, Unlink } from "lucide-react";

/* Where this app's data lives, and how to move it.
 *
 * The whole of this exists on the server already — /api/projects/[id]/backend
 * has read, link and unlink, and lib/builder/backend/connection.ts decides what
 * a build is built against. What it did not have was any way for a person to
 * reach it: nothing in the app called that endpoint, so linking your own
 * Supabase was a thing you could do with curl and no other way. This is the
 * missing half.
 *
 * ── The one thing this panel must not do ──────────────────────────────────
 *
 * It must not say the tables are in somebody's Supabase before they are.
 * Linking stores a pointer; it does not run the migration — that happens on the
 * next build, over a connection string, and only if one was given. So a fresh
 * link reads "linked, tables not created yet" and keeps reading that until a
 * build says otherwise. Somebody who believes their schema is live when it is
 * not will go looking for the bug in their own app.
 *
 * ── Why the key is checked in the browser ─────────────────────────────────
 *
 * A pasted URL and key are checked by asking that Supabase, from here, before
 * the link is saved. In the browser rather than on our server, for two reasons.
 * The honest one: this is exactly the request the generated app will make — a
 * browser, that URL, that anon key — so a check that passes here is a check
 * that means something. The careful one: the URL is typed by the person and the
 * validator deliberately allows self-hosted instances, so a server-side probe
 * would be our server fetching an address a user chose, which is a hole in a
 * feature that does not need one.
 *
 * A failed check never blocks the link. It cannot be authoritative — a paused
 * project, an offline laptop, a browser extension eating the request all look
 * the same from here — so it says what it saw and offers to link anyway. */

type Backend = {
  kind: "shared" | "own";
  url: string;
  schema: string;
  /** Whether the migration has actually been applied to it. */
  ready: boolean;
  /** Whether a connection string is stored — never the string itself. */
  hasDbUrl: boolean;
};

type Checked =
  | { state: "ok" }
  | { state: "rejected" }
  | { state: "unreachable" };

/* Ask that Supabase whether it is there and whether it knows this key.
 *
 * PostgREST answers its own root with the project's OpenAPI description when
 * the key is good, and 401 when the key belongs to a different project — which
 * is the mistake worth catching, since a URL from one project and a key from
 * another is what copying two values out of two browser tabs produces. */
async function check(url: string, anonKey: string): Promise<Checked> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { state: "rejected" };
    if (!response.ok) return { state: "unreachable" };
    return { state: "ok" };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const TROUBLE: Record<Exclude<Checked["state"], "ok">, string> = {
  rejected:
    "That Supabase answered, but refused the key — check the URL and the anon key are from the same project.",
  unreachable:
    "That Supabase didn't answer. It may be paused, the URL may have a typo, or your connection may have blocked the request.",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line/[0.06] py-2 last:border-b-0">
      <span className="w-[92px] shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-all text-[12px] text-ink">{children}</span>
    </div>
  );
}

export default function BackendPanel({ projectId }: { projectId: string | null }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [loading, setLoading] = useState(true);
  /* Set when the endpoint says this deployment cannot do backends at all —
     no service-role key. Worth showing plainly rather than as a failed save
     after somebody has typed three fields in. */
  const [unavailable, setUnavailable] = useState(false);

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [dbUrl, setDbUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Set when the check failed and the person has been offered the link anyway.
     The next submit skips the check rather than asking them to wait through it
     a second time to be told the same thing. */
  const [overridable, setOverridable] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /* The migration, fetched only when asked for. It is a few hundred lines of
     SQL that most people never need — with a connection string stored the next
     build applies it — so it is not on the wire for every panel open. */
  const [sql, setSql] = useState<string | null>(null);
  const [sqlNote, setSqlNote] = useState<string | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/backend`);
      if (response.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) return;
      setBackend((await response.json()) as Backend);
    } catch {
      /* Leave the panel in its loading-failed state rather than inventing one:
         an empty answer is not evidence that a link is gone. */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function link(skipCheck: boolean) {
    if (!projectId || saving) return;

    const typedUrl = url.trim().replace(/\/+$/, "");
    const typedKey = anonKey.trim();
    if (!typedUrl || !typedKey) return;

    setProblem(null);

    if (!skipCheck) {
      setChecking(true);
      const result = await check(typedUrl, typedKey);
      setChecking(false);
      if (result.state !== "ok") {
        setProblem(TROUBLE[result.state]);
        setOverridable(true);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/backend`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: typedUrl,
          anonKey: typedKey,
          ...(dbUrl.trim() ? { dbUrl: dbUrl.trim() } : {}),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        /* The server's own sentence, which is more specific than anything that
           could be written here — it is the one that knows a service key was
           pasted into the anon field. */
        setProblem(body.error ?? "That couldn't be saved.");
        setOverridable(false);
        return;
      }

      setBackend({
        kind: "own",
        url: body.url,
        schema: body.schema,
        ready: Boolean(body.ready),
        hasDbUrl: Boolean(body.hasDbUrl),
      });
      setOpen(false);
      setOverridable(false);
      setUrl("");
      setAnonKey("");
      setDbUrl("");
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function loadSql() {
    if (!projectId || sqlLoading) return;
    setSqlLoading(true);
    setSqlNote(null);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/backend/schema`,
      );
      const body = await response.json();
      if (!response.ok) {
        setSqlNote(body.error ?? "That couldn't be read.");
        return;
      }
      /* A null sql is an answer rather than a failure — no database, or nothing
         built yet — and the server sends the sentence to show for it. */
      if (!body.sql) {
        setSqlNote(body.reason ?? "There's nothing to create.");
        return;
      }
      setSql(body.sql as string);
    } catch {
      setSqlNote("That didn't get through. Try again.");
    } finally {
      setSqlLoading(false);
    }
  }

  function download() {
    if (!sql) return;
    const blob = new Blob([sql], { type: "application/sql" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "migration.sql";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function unlink() {
    if (!projectId || unlinking) return;
    setUnlinking(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/backend`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setProblem(body.error ?? "That couldn't be undone.");
        return;
      }
      setConfirming(false);
      await load();
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="w-full max-w-[520px] px-4 py-4 lg:pl-5">
      <h2 className="text-[17px] font-semibold text-ink">Database</h2>
      <p className="mt-1 text-[13px] text-muted">
        Where this app keeps its data, and how to move it to a Supabase you own.
      </p>

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading…
        </p>
      )}

      {unavailable && (
        <p className="mt-4 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 text-[12px] leading-relaxed text-muted md:rounded-xl">
          This workspace can&apos;t manage databases yet — it has no service-role key configured.
        </p>
      )}

      {!loading && !unavailable && backend && (
        <>
          <div className="mt-4 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <Database className="h-4 w-4 text-muted" />
              {backend.kind === "own" ? "Your Supabase" : "QuickStark's Supabase"}
            </p>

            <div className="mt-2.5">
              <Row label="Instance">{backend.url}</Row>
              <Row label="Schema">
                <span className="font-mono">{backend.schema}</span>
              </Row>
              <Row label="Tables">
                {backend.ready ? (
                  <span className="text-emerald-400">Created</span>
                ) : backend.kind === "own" && !backend.hasDbUrl ? (
                  <span className="text-amber-400">Yours to create — no connection string stored</span>
                ) : (
                  <span className="text-amber-400">Not created yet — the next build makes them</span>
                )}
              </Row>
            </div>

            {backend.kind === "shared" && (
              /* Said here rather than in a help page, because this is the
                 moment it matters: the ceiling is not the storage, it is that
                 the accounts and the data are not the owner's. */
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Fine for building and previewing. For a real business, the data sits in someone
                else&apos;s account and the sign-ins come from a pool shared with every other app
                here — so exporting, backing up or leaving are not yours to do.
              </p>
            )}
          </div>

          {/* ── Running the migration yourself ──────────────────────────
              Offered for a linked Supabase whether or not a connection string
              is stored: with one, this is what the next build will run and
              somebody is entitled to read it first; without one, it is the
              only way the tables ever appear, and the link endpoint has
              already told them to run it. */}
          {backend.kind === "own" && (
            <div className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
              <p className="text-[13px] font-medium text-ink">This app&apos;s tables, as SQL</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {backend.hasDbUrl
                  ? "The next build runs this for you. Here it is if you would rather read it first, or run it now."
                  : "No connection string is stored, so these are yours to create — paste this into your Supabase SQL editor."}
              </p>

              {!sql && (
                <button
                  onClick={loadSql}
                  disabled={sqlLoading}
                  className="mt-3 flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink disabled:text-muted md:h-8 md:rounded-lg"
                >
                  {sqlLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  {sqlLoading ? "Reading…" : "Show the SQL"}
                </button>
              )}

              {sqlNote && <p className="mt-2 text-[12px] leading-relaxed text-muted">{sqlNote}</p>}

              {sql && (
                <>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(sql);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        } catch {
                          /* Not worth an error: the SQL is on screen below and
                             can be selected by hand. */
                        }
                      }}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={download}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  </div>

                  {/* Its own scroll box, both ways: SQL has long lines and this
                      panel is 520px on a desktop and narrower on a phone. */}
                  <pre className="mt-3 max-h-[260px] overflow-auto rounded-lg border border-line/[0.07] bg-layer/[0.04] p-3 font-mono text-[11.5px] leading-relaxed text-soft">
                    {sql}
                  </pre>
                </>
              )}
            </div>
          )}

          {backend.kind === "own" && !confirming && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => { setOpen(true); setProblem(null); setOverridable(false); }}
                className="h-10 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
              >
                Replace
              </button>
              <button
                onClick={() => setConfirming(true)}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          )}

          {backend.kind === "own" && confirming && (
            <div className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
              <p className="text-[12px] leading-relaxed text-muted">
                The next build goes back to QuickStark&apos;s Supabase. Nothing is deleted from
                yours — every table and row stays in your account.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={unlink}
                  disabled={unlinking}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-ink transition-colors hover:bg-layer/[0.06] disabled:text-muted md:h-8 md:rounded-lg"
                >
                  {unlinking && <Loader2 className="h-3 w-3 animate-spin" />}
                  {unlinking ? "Disconnecting…" : "Disconnect"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="h-10 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] md:h-8 md:rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {backend.kind === "shared" && !open && (
            <button
              onClick={() => { setOpen(true); setProblem(null); setOverridable(false); }}
              className="mt-3 h-10 rounded-xl bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 md:h-8 md:rounded-lg"
            >
              Connect your own Supabase
            </button>
          )}

          {open && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void link(false);
              }}
              className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl"
            >
              <label className="block text-[12px] text-muted" htmlFor="backend-url">
                Project URL
              </label>
              <input
                id="backend-url"
                value={url}
                onChange={(event) => { setUrl(event.target.value); setOverridable(false); }}
                placeholder="https://your-project.supabase.co"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-1.5 h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-line/25 md:h-9 md:rounded-lg"
              />

              <label className="mt-3 block text-[12px] text-muted" htmlFor="backend-anon">
                Anon key
              </label>
              <input
                id="backend-anon"
                value={anonKey}
                onChange={(event) => { setAnonKey(event.target.value); setOverridable(false); }}
                placeholder="eyJhbGciOi…"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-1.5 h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 font-mono text-[12px] text-ink outline-none placeholder:text-muted focus-visible:border-line/25 md:h-9 md:rounded-lg"
              />
              {/* The one warning worth putting in front of somebody rather than
                  behind a refusal: the service key sits directly under the anon
                  key in the Supabase dashboard, and it is the paste that ends
                  with every visitor holding full access. The server refuses it
                  too — this is so it does not have to. */}
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                The one labelled <span className="text-ink">anon / public</span>. Not the service
                key — that one would be served to every visitor of your app.
              </p>

              <label className="mt-3 block text-[12px] text-muted" htmlFor="backend-db">
                Connection string <span className="text-muted">— optional</span>
              </label>
              <input
                id="backend-db"
                type="password"
                value={dbUrl}
                onChange={(event) => setDbUrl(event.target.value)}
                placeholder="postgresql://postgres:…"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-1.5 h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 font-mono text-[12px] text-ink outline-none placeholder:text-muted focus-visible:border-line/25 md:h-9 md:rounded-lg"
              />
              <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  With it, builds create this app&apos;s tables in your Supabase for you. Stored
                  write-only — nothing can read it back, including you.
                </span>
              </p>

              {problem && (
                <p className="mt-3 text-[12px] leading-relaxed text-amber-400">{problem}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving || checking || !url.trim() || !anonKey.trim()}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 disabled:opacity-30 md:h-8 md:rounded-lg"
                >
                  {(saving || checking) && <Loader2 className="h-3 w-3 animate-spin" />}
                  {checking ? "Checking…" : saving ? "Linking…" : "Link"}
                </button>

                {overridable && (
                  <button
                    type="button"
                    onClick={() => void link(true)}
                    disabled={saving}
                    className="h-10 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
                  >
                    Link anyway
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { setOpen(false); setProblem(null); setOverridable(false); }}
                  className="h-10 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] md:h-8 md:rounded-lg"
                >
                  Cancel
                </button>
              </div>

              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                Linking points the next build at your Supabase. It does not move what is already
                here, and nothing is created until that build runs.
              </p>
            </form>
          )}

          {problem && !open && (
            <p className="mt-3 text-[12px] leading-relaxed text-amber-400">{problem}</p>
          )}
        </>
      )}
    </div>
  );
}
