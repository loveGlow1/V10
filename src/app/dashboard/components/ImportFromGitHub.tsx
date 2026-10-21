"use client";

/* Import from GitHub, from Home: start a project from a repository without
 * opening one first. Connects GitHub when it is not connected yet (and comes
 * back here), then either imports the repository straight into the workspace
 * — saved here, nothing made on GitHub until it is pushed — or forks it into
 * the person's own account first; either opens as a new project. See
 * useGitHubImport. */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, GitFork, Github, Loader2, X } from "lucide-react";

import { connectGitHubHref } from "@/lib/github/connect-link";

import { useGitHubImport } from "../useGitHubImport";

type Status = { configured: boolean; connected: boolean; login: string | null };

export default function ImportFromGitHub({
  open,
  onClose,
  onUpgrade,
}: {
  open: boolean;
  onClose: () => void;
  /** Opens the plans, for a plan that does not include GitHub. */
  onUpgrade?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const { repo, setRepo, importing, busy, error, upgrade, importRepo } = useGitHubImport(onClose);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    fetch("/api/integrations/github", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: Status) => setStatus(body))
      .catch(() => setStatus({ configured: false, connected: false, login: null }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const button =
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-40";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import from GitHub"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[480px] rounded-t-[24px] border border-line/[0.1] bg-canvas pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:pb-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line/[0.08] px-6 pb-4 pt-5">
          <div>
            <p className="text-[17px] font-semibold text-ink">Import from GitHub</p>
            <p className="mt-1 text-[13px] text-muted">Start a new project from a repository — yours or anyone&apos;s.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-6 py-5">
          {!status ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : !status.configured ? (
            <p className="text-[13px] text-muted">GitHub isn&apos;t set up on this deployment yet.</p>
          ) : !status.connected ? (
            <div>
              <p className="text-[13px] leading-relaxed text-muted">Connect your GitHub account first, so the repository can be read — and forked, if you choose to.</p>
              <a href={connectGitHubHref("/dashboard?import=github")} className={`${button} mt-3`}>
                <Github className="h-4 w-4" />
                Connect GitHub
              </a>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void importRepo("import");
              }}
            >
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  placeholder="owner/repo or github.com link"
                  aria-label="Repository to import"
                  className="h-9 min-w-0 w-full flex-1 rounded-lg border border-line/[0.12] bg-layer/[0.04] px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-line/[0.3]"
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="submit" disabled={importing || !repo.trim()} className="inline-flex flex-col items-start gap-0.5 rounded-lg bg-ink px-3.5 py-2.5 text-left text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-40">
                  <span className="flex items-center gap-2">
                    {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Import
                  </span>
                  <span className="text-[11.5px] font-normal opacity-70">Save it here. Nothing changes on GitHub until you push.</span>
                </button>
                <button
                  type="button"
                  onClick={() => void importRepo("fork")}
                  disabled={importing || !repo.trim()}
                  className="inline-flex h-auto flex-col items-start gap-0.5 rounded-lg border border-line/[0.14] px-3.5 py-2.5 text-left text-[13px] font-medium text-ink transition-colors hover:bg-layer/[0.06] disabled:opacity-40"
                >
                  <span className="flex items-center gap-2">
                    {busy === "fork" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
                    Fork
                  </span>
                  <span className="text-[11.5px] font-normal text-muted">
                    Copy it to {status.login ? `@${status.login}` : "your GitHub"} first. Standard and Pro.
                  </span>
                </button>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Public repos, or private ones your account can see. Up to about 120 source files. Imported work is saved
                in your workspace until you publish it or push it — back to the same repo when it&apos;s yours, or to a
                new one of your own. A single HTML page or a Next.js app shows a live preview; anything else opens in VS
                Code.
              </p>
            </form>
          )}
          {error ? (
            <p className="mt-3 text-[12.5px] leading-relaxed text-warn">
              {error}
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
