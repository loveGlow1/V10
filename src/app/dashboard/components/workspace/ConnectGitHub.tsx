"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Lock, Upload } from "lucide-react";

/* The GitHub row's body in the Integrations drawer.
 *
 * Three states, in the order somebody meets them: not connected (a button that
 * sends them to GitHub), connected but on Free (pushing is a Standard and Pro
 * feature, so the button is Upgrade), and connected on a paid plan (a name for
 * the repository on the first push, and Push on every one after). The server
 * checks the plan again on every push — this only decides what to draw.
 */

type Linked = {
  owner: string;
  name: string;
  branch: string;
  url: string;
  private: boolean;
  lastCommit: string | null;
  pushedAt: string | null;
};

type Status = {
  configured: boolean;
  connected: boolean;
  login: string | null;
  canPush: boolean;
  repo: Linked | null;
  suggestedName: string | null;
  error?: string;
};

const RETURNED: Record<string, string> = {
  connected: "GitHub is connected.",
  cancelled: "GitHub sign-in was cancelled. Nothing was changed.",
  expired: "That sign-in took too long or came from somewhere else. Try Connect GitHub again.",
  failed: "GitHub didn't complete the sign-in. Try again in a moment.",
  unavailable: "Connect GitHub isn't set up on this deployment yet.",
};

const button =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line/[0.09] px-2.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink disabled:opacity-50";

export default function ConnectGitHub({
  projectId,
  returned,
  onUpgrade,
}: {
  projectId: string;
  /** The ?github= value the sign-in came back with. */
  returned: string | null;
  onUpgrade?: () => void;
}) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/github`;
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"push" | "disconnect" | null>(null);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [note, setNote] = useState<string | null>(returned && RETURNED[returned] ? RETURNED[returned] : null);
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Status;
      if (!alive.current) return;
      if (!response.ok) {
        setProblem(body.error ?? "Couldn't read your GitHub connection.");
        return;
      }
      setStatus(body);
      setName((current) => current || body.suggestedName || "");
    } catch {
      if (alive.current) setProblem("Couldn't reach QuickStark. Try again.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Back to this project's Integrations drawer, on the Source shelf. */
  const connectHref = `/api/integrations/github/authorize?next=${encodeURIComponent(
    `/dashboard/project/${projectId}?view=integrations`,
  )}`;

  async function push() {
    setBusy("push");
    setProblem(null);
    setNote(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status?.repo ? {} : { name: name.trim(), private: isPrivate }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        repo?: Linked;
        files?: number;
        connect?: boolean;
        upgrade?: boolean;
      };
      if (!alive.current) return;
      if (!response.ok) {
        setProblem(body.error ?? "The push didn't go through. Try again.");
        if (body.connect || body.upgrade) await load();
        return;
      }
      setStatus((current) => (current && body.repo ? { ...current, repo: body.repo } : current));
      setNote(`Pushed ${body.files ?? "the"} files to ${body.repo?.owner}/${body.repo?.name}.`);
    } catch {
      if (alive.current) setProblem("Couldn't reach QuickStark. Try again.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setProblem(null);
    try {
      await fetch("/api/integrations/github", { method: "DELETE" });
      if (alive.current) setNote("GitHub is disconnected.");
      await load();
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking GitHub…
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {note && <p className="text-[12px] text-emerald-400">{note}</p>}
      {problem && <p className="text-[12px] text-danger">{problem}</p>}

      {!status?.configured ? (
        <p className="text-[12px] text-muted">Connect GitHub isn&apos;t set up on this deployment yet.</p>
      ) : !status.connected ? (
        <a href={connectHref} className={`${button} w-fit`}>
          Connect GitHub
        </a>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              Connected{status.login ? ` as ${status.login}` : ""}
            </span>
            <button onClick={disconnect} disabled={busy !== null} className="underline-offset-2 hover:text-ink hover:underline">
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>

          {!status.canPush ? (
            <div className="rounded-lg border border-line/[0.07] bg-layer/[0.03] p-2.5">
              <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Saving your code to GitHub comes with Standard and Pro.
              </p>
              {onUpgrade && (
                <button onClick={onUpgrade} className={`${button} mt-2`}>
                  Upgrade
                </button>
              )}
            </div>
          ) : status.repo ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={status.repo.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-[12px] text-soft hover:text-ink"
              >
                <span className="truncate">
                  {status.repo.owner}/{status.repo.name}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <button onClick={push} disabled={busy !== null} className={button}>
                {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Push latest
              </button>
              {status.repo.pushedAt && (
                <p className="w-full text-[11px] text-muted">
                  Last pushed {new Date(status.repo.pushedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Repository name"
                aria-label="Repository name"
                className="h-9 w-full rounded-lg border border-line/[0.09] bg-layer/[0.03] px-2.5 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-line/25"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
                  Private repository
                </label>
                <button onClick={push} disabled={busy !== null || !name.trim()} className={button}>
                  {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Create and push
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
