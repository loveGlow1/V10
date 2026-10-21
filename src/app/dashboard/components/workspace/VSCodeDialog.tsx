"use client";

/* Where the code opens, offered as two choices because they cost different
 * things:
 *
 *   In browser         the editor in a tab of its own (CodeEditor). Free,
 *                      nothing to set up, saves straight into the preview.
 *   GitHub Codespaces  the real VS Code — extensions, Copilot, Agent mode,
 *                      MCP — on the project's GitHub repository. It runs on
 *                      the person's own Codespaces hours, which not everyone
 *                      has, so it is never the only way in.
 *
 * Codespaces works on the repository, so opening it saves the project there
 * first (the same push as Save to GitHub) unless GitHub already has newer work,
 * and "Sync from GitHub" brings what was done there back as a new build. */

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, Download, ExternalLink, GitFork, Github, Loader2, RefreshCw, UploadCloud, X } from "lucide-react";

import { useGitHubImport } from "../../useGitHubImport";
import { CODE_CHANNEL } from "./CodeEditor";

type Status = {
  configured: boolean;
  connected: boolean;
  canPush: boolean;
  repo: { owner: string; name: string; url: string; pushedAt: string | null } | null;
};

export default function VSCodeDialog({
  projectId,
  lastBuildAt,
  open,
  onClose,
  onUpgrade,
}: {
  projectId: string;
  /** When the project last changed, to know whether GitHub needs it pushed. */
  lastBuildAt: string | null;
  open: boolean;
  onClose: () => void;
  /** Opens the plans, for a plan that does not include GitHub. */
  onUpgrade?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [ahead, setAhead] = useState(false);
  const [busy, setBusy] = useState<"open" | "sync" | "save" | null>(null);
  /* Import or fork from GitHub: the same two Home offers — see useGitHubImport. */
  const forking = useGitHubImport(onClose);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setStatus(null);
    setAhead(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as Status | null;
      if (!response.ok || !body) {
        setStatus({ configured: false, connected: false, canPush: false, repo: null });
        return;
      }
      setStatus(body);
      if (body.connected && body.repo) {
        const sync = await fetch(`/api/projects/${projectId}/github/sync`, { cache: "no-store" });
        const state = (await sync.json().catch(() => null)) as { ahead?: boolean } | null;
        setAhead(Boolean(sync.ok && state?.ahead));
      }
    } catch {
      setStatus({ configured: false, connected: false, canPush: false, repo: null });
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setUpgrade(false);
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Saved to GitHub first unless GitHub already has newer work (pushing then
     would put the project's older files on top of it), then opened in a
     Codespace. The tab is opened on the click itself so it is not blocked as
     a popup, and pointed at the Codespace once the push has landed. */
  async function openCodespace() {
    if (busy) return;
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setBusy("open");
    setMessage(null);
    try {
      let repo = status?.repo ?? null;
      const stale = !repo || !repo.pushedAt || (lastBuildAt !== null && new Date(lastBuildAt) > new Date(repo.pushedAt));
      if (!ahead && stale) {
        const response = await fetch(`/api/projects/${projectId}/github`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = (await response.json().catch(() => ({}))) as {
          repo?: Status["repo"];
          error?: string;
          upgrade?: boolean;
        };
        if (!response.ok || !body.repo) {
          tab?.close();
          setUpgrade(Boolean(body.upgrade));
          setMessage({ tone: "error", text: body.error ?? "The project could not be saved to GitHub." });
          return;
        }
        repo = body.repo;
        setStatus((current) => (current ? { ...current, repo: body.repo ?? null } : current));
      }
      if (!repo) {
        tab?.close();
        return;
      }
      const url = `https://codespaces.new/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}?quickstart=1`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
      setMessage({
        tone: "ok",
        text: "VS Code is opening in a Codespace. When you're done there, commit your changes and press Sync from GitHub.",
      });
    } catch {
      tab?.close();
      setMessage({ tone: "error", text: "GitHub couldn't be reached. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  /* Save to GitHub without opening anything — the same push as the
     Integrations drawer. Held back when GitHub has newer work, which a push
     would bury under the project's older files. */
  async function saveToGitHub() {
    if (busy) return;
    if (ahead) {
      setMessage({ tone: "error", text: "GitHub has newer changes from VS Code. Sync them first, then save." });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => ({}))) as { repo?: Status["repo"]; error?: string; upgrade?: boolean };
      if (!response.ok || !body.repo) {
        setUpgrade(Boolean(body.upgrade));
        setMessage({ tone: "error", text: body.error ?? "The project could not be saved to GitHub." });
        return;
      }
      setStatus((current) => (current ? { ...current, repo: body.repo ?? null } : current));
      setMessage({ tone: "ok", text: `Saved to ${body.repo.owner}/${body.repo.name} on GitHub.` });
    } catch {
      setMessage({ tone: "error", text: "GitHub couldn't be reached. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    if (busy) return;
    setBusy("sync");
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/github/sync`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        buildId?: string;
        upToDate?: boolean;
        files?: number;
        skipped?: string[];
        error?: string;
      };
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "The changes could not be brought back." });
        return;
      }
      if (body.upToDate) {
        setAhead(false);
        setMessage({ tone: "ok", text: "Already up to date. Commit and push in the Codespace first, then sync." });
        return;
      }
      setAhead(false);
      const skipped = body.skipped?.length ? ` ${body.skipped.length} non-source ${body.skipped.length === 1 ? "file was" : "files were"} left out.` : "";
      setMessage({ tone: "ok", text: `Brought back ${body.files ?? 0} ${body.files === 1 ? "file" : "files"} from GitHub. The preview is updating.${skipped}` });
      try {
        const channel = new BroadcastChannel(CODE_CHANNEL);
        channel.postMessage({ projectId, buildId: body.buildId });
        channel.close();
      } catch {
        /* The workspace picks it up on its next refresh. */
      }
    } catch {
      setMessage({ tone: "error", text: "GitHub couldn't be reached. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  if (!mounted || !open) return null;

  const connectHref = `/api/integrations/github/authorize?next=${encodeURIComponent(`/dashboard/project/${projectId}`)}`;
  const card = "rounded-xl border border-line/[0.1] bg-layer/[0.03] p-4";
  const primary =
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-40";
  const secondary =
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line/[0.12] bg-layer/[0.04] px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-layer/[0.08] disabled:opacity-40";

  let codespaces: React.ReactNode;
  if (!status) {
    codespaces = <Loader2 className="h-4 w-4 animate-spin text-muted" />;
  } else if (!status.configured) {
    codespaces = <p className="text-[12.5px] text-muted">GitHub isn&apos;t set up on this deployment yet.</p>;
  } else if (!status.connected) {
    codespaces = (
      <a href={connectHref} className={secondary}>
        <Github className="h-4 w-4" />
        Connect GitHub
      </a>
    );
  } else {
    codespaces = (
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void openCodespace()} disabled={busy !== null} className={primary}>
          {busy === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Open in Codespaces
        </button>
        {status.repo ? (
          <button onClick={() => void sync()} disabled={busy !== null} className={secondary}>
            {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync from GitHub
          </button>
        ) : null}
        <button onClick={() => void saveToGitHub()} disabled={busy !== null} className={secondary}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Save to GitHub
        </button>
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open the code"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[520px] rounded-t-[24px] border border-line/[0.1] bg-canvas pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:pb-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line/[0.08] px-6 pb-4 pt-5">
          <div>
            <p className="text-[17px] font-semibold text-ink">VS Code</p>
            <p className="mt-1 text-[13px] text-muted">Open this project&apos;s code in the editor that suits you.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 px-6 py-5">
          <div className={card}>
            <div className="flex items-start gap-3">
              <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-soft" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">In browser</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  The built-in editor. Free, nothing to set up, and every save updates the preview.
                </p>
                <a
                  href={`/dashboard/project/${projectId}/code`}
                  target="_blank"
                  rel="noopener"
                  onClick={onClose}
                  className={`${secondary} mt-3`}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in browser
                </a>
              </div>
            </div>
          </div>

          <div className={card}>
            <div className="flex items-start gap-3">
              <Github className="mt-0.5 h-5 w-5 shrink-0 text-soft" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">GitHub Codespaces</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  The full VS Code: extensions, Copilot, Agent mode and MCP. Runs on your GitHub Codespaces hours.
                </p>
                {ahead ? (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
                    GitHub has changes from VS Code that aren&apos;t in this project yet. Sync them to bring them back.
                  </p>
                ) : null}
                <div className="mt-3">{codespaces}</div>
              </div>
            </div>
          </div>

          {status?.connected ? (
            <div className={card}>
              <div className="flex items-start gap-3">
                <GitFork className="mt-0.5 h-5 w-5 shrink-0 text-soft" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">Import or fork from GitHub</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                    Start a new project from any repository. Import saves it straight here — nothing changes on GitHub
                    until you push. Fork copies it into your GitHub account first.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void forking.importRepo("import");
                    }}
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    <input
                      value={forking.repo}
                      onChange={(event) => forking.setRepo(event.target.value)}
                      placeholder="owner/repo or github.com link"
                      aria-label="Repository to import or fork"
                      className="h-9 min-w-[160px] flex-1 rounded-lg border border-line/[0.12] bg-layer/[0.04] px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-line/[0.3]"
                    />
                    <button type="submit" disabled={busy !== null || forking.importing || !forking.repo.trim()} className={secondary}>
                      {forking.busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={() => void forking.importRepo("fork")}
                      disabled={busy !== null || forking.importing || !forking.repo.trim()}
                      className={secondary}
                    >
                      {forking.busy === "fork" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
                      Fork
                    </button>
                  </form>
                  {forking.error ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
                      {forking.error}
                      {forking.upgrade && onUpgrade ? (
                        <>
                          {" "}
                          <button
                            onClick={() => {
                              onClose();
                              onUpgrade();
                            }}
                            className="underline underline-offset-2"
                          >
                            See plans
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {message ? (
            <p className={`text-[12.5px] leading-relaxed ${message.tone === "ok" ? "text-soft" : "text-warn"}`}>
              {message.text}
              {upgrade && onUpgrade ? (
                <>
                  {" "}
                  <button
                    onClick={() => {
                      onClose();
                      onUpgrade();
                    }}
                    className="underline underline-offset-2"
                  >
                    See plans
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
