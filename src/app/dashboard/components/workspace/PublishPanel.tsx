"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { isServerBuild } from "@/lib/builder/build-mode";
import type { Diagnosis } from "@/lib/publish/diagnosis";
import { publishedLabel, publishedUrl } from "@/lib/publish/naming";

import QrCode from "../billing/QrCode";
import { loadChecks, runChecks, type Check as CheckItem } from "./publish-checks";

/* Taking a project live, and pointing a domain at it.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *
 * One panel, the same for a Website and a Web App, in this order:
 *   Status → Address (and domains) → Checklist → Publish → Footer.
 * While a publish runs, the progress steps take the place of everything below
 * the status; when it lands, the success view; when it fails, the failure view.
 * The run itself is held by the parent (PreviewPanel), so closing the panel
 * does not stop it and the header button keeps showing where it is.
 *
 * Two things happen here and they are deliberately in one panel, in this order,
 * because the second one has no meaning without the first: a domain needs
 * something to point at. Connecting a domain to an unpublished project sends
 * somebody to configure DNS for a page that does not exist, and the failure
 * arrives days later looking like a DNS problem.
 *
 * ── What this promises ────────────────────────────────────────────────────
 *
 * Nothing here says "Published" before the server has said so. Every state
 * below is read from a response, never set optimistically — a button that turns
 * green on click and a page that is not live is the exact failure the whole
 * publishing design is built to prevent, and undoing it in the UI would be
 * undoing it in the wrong place.
 *
 * ── DNS ───────────────────────────────────────────────────────────────────
 *
 * The record shown is the one Vercel returned for THIS domain. Not a constant,
 * not a guess, and not stored anywhere in this codebase. See
 * lib/publish/vercel-domains.ts. */

type DomainRow = {
  id: string;
  domain: string;
  status: "pending" | "awaiting_dns" | "live" | "failed" | string;
  record: { type: string; name: string; value: string } | null;
  ssl: string;
  error: string | null;
  verifiedAt: string | null;
};

type Published = {
  url: string;
  version: number;
  publishedAt: string;
  /* What it actually cost, as the ledger recorded it — not what the panel
     quoted beforehand. A person who was quoted one number and charged another
     should see the one that was taken. */
  charged: number;
} | null;

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* A clipboard a browser would not give us is not worth an error
             message — the value is on screen and can be selected. */
        }
      }}
      aria-label={`Copy ${label}`}
      className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-layer/[0.08] hover:text-ink"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/* One line of the DNS record, laid out as the provider's own form asks for it:
   type, name, value. People copy these one field at a time into three boxes. */
function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line/[0.06] py-1.5 last:border-b-0">
      <span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{value}</span>
      <Copyable value={value} label={label} />
    </div>
  );
}

const STATE: Record<string, { text: string; tone: string }> = {
  live: { text: "Live", tone: "text-emerald-400" },
  awaiting_dns: { text: "Pending DNS", tone: "text-amber-400" },
  pending: { text: "Verifying", tone: "text-muted" },
  ssl: { text: "SSL issuing", tone: "text-amber-400" },
  failed: { text: "Error", tone: "text-rose-400" },
};

/* A domain's chip: SSL still being issued on a verified domain is its own state. */
function domainState(row: DomainRow) {
  if (row.status === "live" && row.ssl && row.ssl !== "active") return STATE.ssl;
  return STATE[row.status] ?? STATE.pending;
}

/** A publish in progress or just finished, held above the panel so it outlives it. */
export type PublishRun = {
  phase: "running" | "done" | "failed";
  startedAt: number;
  webApp: boolean;
  /** Whether this was the project's first time live. */
  first: boolean;
  result?: { url: string; version: number; publishedAt: string; charged: number; building: boolean };
  problem?: { message: string; stage: string; status: number };
};

/** What the parent knows about the Web App deployment (GET /api/projects/[id]/deploy). */
export type DeployState = {
  building: boolean;
  /** The status request failed while a deploy was running; it is being retried. */
  reconnecting: boolean;
  /** The last deployment failed (from the build row), with the site not up. */
  failure: Diagnosis | null;
  failureText: string | null;
  /** The newest deployment failed while an older one keeps serving. */
  behind: Diagnosis | null;
};

const QUOTA = /project limit reached|capacity reached/i;

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type StepState = "pending" | "running" | "done" | "failed";

function Step({ label, state }: { label: string; state: StepState }) {
  return (
    <li className="flex items-center gap-2 py-1 text-[12.5px]">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {state === "done" ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : state === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ink" />
        ) : state === "failed" ? (
          <X className="h-3.5 w-3.5 text-rose-400" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-layer/[0.25]" />
        )}
      </span>
      <span className={state === "pending" ? "text-muted" : state === "failed" ? "text-rose-300" : "text-ink"}>{label}</span>
    </li>
  );
}

const LEVEL_ICON = {
  pass: <Check className="h-3.5 w-3.5 text-emerald-400" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
  block: <X className="h-3.5 w-3.5 text-rose-400" />,
};

export default function PublishPanel({
  projectId,
  hasBuild,
  buildStamp = null,
  priceNote,
  slug,
  publishedAt,
  pending,
  run,
  setRun,
  deploy,
  onPublished,
  onRetry,
  retrying,
  retryError,
  onUnpublished,
  onOpenDatabase,
  onAsk,
}: {
  projectId: string | null;
  /* Whether there is anything to publish. A project with no build has nothing
     to put on an address, and the button says so rather than failing. */
  hasBuild: boolean;
  /* When the latest version landed: the checklist runs again for every new
     one, so a Fix that landed shows as fixed. */
  buildStamp?: string | null;
  priceNote: string;
  /* The address already reserved, from the project row. Without this the panel
     only knew about a publish that happened in THIS session — so reopening the
     workspace showed a live project as though it had never been published. */
  slug: string | null;
  publishedAt: string | null;
  /** The preview has changes the live site does not. */
  pending: boolean;
  run: PublishRun | null;
  setRun: (run: PublishRun | null) => void;
  deploy: DeployState;
  /** A publish landed: refresh the project row and follow the deployment. */
  onPublished: () => void;
  /** Retry the Web App deployment (the deploy route's POST). */
  onRetry: () => void;
  retrying: boolean;
  retryError: string | null;
  onUnpublished: () => void;
  onOpenDatabase: () => void;
  /** Send requests to the builder chat, one per file, in order. */
  onAsk: (texts: string[]) => void;
}) {
  const [published, setPublished] = useState<Published>(
    slug && publishedAt
      ? { url: publishedUrl(slug), version: 0, publishedAt, charged: 0 }
      : null,
  );
  /* The address as it stands, held here rather than read from the prop: the
     project row does not refresh the moment this saves, so the prop is stale
     until the workspace reloads and every comparison against it would be
     wrong. */
  const [live_slug, setLiveSlug] = useState(slug ?? "");
  const [address, setAddress] = useState(slug ?? "");
  /* Whether the editor is OPEN. */
  const [renaming, setRenaming] = useState(false);
  /* Whether a save is IN FLIGHT — a different question, and conflating the two
     is what made the Save button do nothing at all: the guard bailed out
     whenever the editor was open, which is exactly when Save is pressed. */
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressProblem, setAddressProblem] = useState<string | null>(null);

  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [typed, setTyped] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [domainProblem, setDomainProblem] = useState<string | null>(null);
  const [addingDomain, setAddingDomain] = useState(false);

  /* Website or Web App, read from the project's own files — the same rule the
     server publishes by (lib/builder/build-mode). Null until known. */
  const [webApp, setWebApp] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  /* "Back to the panel" from a stored failure, for this visit. */
  const [failureSeen, setFailureSeen] = useState(false);
  /* Ticks the website steps forward while its one request is in flight. */
  const [now, setNow] = useState(() => Date.now());

  const loadDomains = useCallback(
    async (showSpinner: boolean) => {
      if (!projectId) return;
      if (showSpinner) setVerifying(true);
      try {
        const response = await fetch(`/api/domains?projectId=${encodeURIComponent(projectId)}`);
        const body = await response.json();
        if (Array.isArray(body.domains)) setDomains(body.domains as DomainRow[]);
      } catch {
        /* Leaving what is on screen is better than emptying it: a failed
           refresh is not evidence that somebody's domains are gone. */
      } finally {
        if (showSpinner) setVerifying(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadDomains(false);
  }, [loadDomains]);

  /* The checklist runs when the panel opens. The files decide the type first,
     so a Web App's extra checks are asked for only when it is one. */
  useEffect(() => {
    if (!projectId || !hasBuild) return;
    let current = true;
    void (async () => {
      const files = await fetch(`/api/projects/${projectId}/files`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (!current || !files || !Array.isArray(files.files)) return;
      const server = isServerBuild(files.files);
      setWebApp(server);
      /* What the files say, at once; then the full run — a Web App's
         database and settings, and every image on the web actually loaded. */
      setChecks(runChecks({ files: files.files, webApp: false, backend: null, secretNames: null }));
      const full = await loadChecks(projectId, server);
      if (current && full) setChecks(full);
    })();
    return () => {
      current = false;
    };
  }, [projectId, hasBuild, buildStamp]);

  const running = run?.phase === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [running]);

  async function publish() {
    if (!projectId || running) return;
    const first = !published;
    const base: PublishRun = { phase: "running", startedAt: Date.now(), webApp: Boolean(webApp), first };
    setRun(base);
    setFailureSeen(false);

    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await response.json();

      if (!response.ok || !body.published) {
        setRun({
          ...base,
          phase: "failed",
          problem: { message: body.error ?? "That couldn't be published.", stage: body.stage ?? "publish", status: response.status },
        });
        return;
      }

      const result = {
        url: body.url,
        version: body.version,
        publishedAt: body.publishedAt,
        charged: body.charged ?? 0,
        building: Boolean(body.building),
      };
      setPublished({ url: result.url, version: result.version, publishedAt: result.publishedAt, charged: result.charged });
      setRun({ ...base, webApp: base.webApp || result.building, phase: "done", result });
      onPublished();
      /* A domain connected earlier may have been waiting on exactly this. */
      void loadDomains(false);
    } catch {
      setRun({
        ...base,
        phase: "failed",
        problem: { message: "That couldn't be published — the request didn't get through.", stage: "network", status: 0 },
      });
    }
  }

  async function connect() {
    if (!projectId || connecting || !typed.trim()) return;
    setConnecting(true);
    setDomainProblem(null);

    try {
      const response = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, domain: typed }),
      });
      const body = await response.json();

      if (!response.ok) {
        setDomainProblem(body.error ?? "That domain couldn't be connected.");
        return;
      }

      setTyped("");
      setAddingDomain(false);
      setDomains((current) => [...current.filter((row) => row.id !== body.domain.id), body.domain]);
    } catch {
      setDomainProblem("That didn't get through. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function saveAddress() {
    if (!projectId || savingAddress) return;

    const wanted = address.trim().toLowerCase();
    if (!wanted || wanted === live_slug) { setRenaming(false); return; }

    setSavingAddress(true);
    setAddressProblem(null);
    try {
      const response = await fetch("/api/publish", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, slug: wanted }),
      });
      const body = await response.json();

      if (!response.ok) {
        setAddressProblem(body.error ?? "That address couldn't be saved.");
        return;
      }

      /* Everything the server confirmed, together: the address it stored and
         the link it is served at. The editor closes only on success — a
         refused address keeps what was typed, so it can be corrected rather
         than retyped. */
      setLiveSlug(body.slug);
      setAddress(body.slug);
      setPublished((current) => (current ? { ...current, url: body.url } : current));
      setRenaming(false);
    } catch {
      setAddressProblem("That didn't get through. Try again.");
    } finally {
      setSavingAddress(false);
    }
  }

  async function disconnect(id: string) {
    setDomains((current) => current.filter((row) => row.id !== id));
    try {
      await fetch(`/api/domains?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      void loadDomains(false);
    }
  }

  async function unpublish() {
    if (!projectId || unpublishing) return;
    setUnpublishing(true);
    try {
      const response = await fetch(`/api/publish?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (response.ok) {
        setPublished(null);
        setConfirmUnpublish(false);
        onUnpublished();
      }
    } finally {
      setUnpublishing(false);
    }
  }

  const live = published !== null;
  const isApp = Boolean(webApp || run?.webApp || deploy.failure || deploy.behind);
  const kindWord = isApp ? "app" : "site";
  const blocked = Boolean(checks?.some((check) => check.level === "block"));

  /* ── Which view ─────────────────────────────────────────────────────────── */
  const storedFailure = !deploy.building && !failureSeen ? deploy.failure ?? deploy.behind : null;
  const view: "progress" | "failure" | "success" | "normal" =
    running || deploy.building || retrying
      ? "progress"
      : run?.phase === "failed" || storedFailure
        ? "failure"
        : run?.phase === "done"
          ? "success"
          : "normal";

  /* ── A: Status ──────────────────────────────────────────────────────────── */
  const status = (
    <div>
      <div className="flex items-center gap-2">
        <p className="hidden min-w-0 flex-1 text-[13px] font-medium text-ink md:block">Publish this {kindWord}</p>
        {webApp !== null || isApp ? (
          <span className="shrink-0 rounded-full border border-line/[0.1] px-2 py-0.5 text-[10.5px] font-medium text-soft">
            {isApp ? "Web App" : "Website"}
          </span>
        ) : null}
      </div>
      {live ? (
        <>
          <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-2">
            <a
              href={published.url}
              target="_blank"
              rel="noreferrer"
              /* Wrapped rather than truncated. A path address is longer than a
                 subdomain was, and an address ending in an ellipsis is one
                 somebody cannot read back or check. */
              className="min-w-0 flex-1 break-all text-[12px] leading-snug text-emerald-300 hover:underline"
            >
              {published.url.replace(/^https?:\/\//, "")}
            </a>
            <Copyable value={published.url} label="the address" />
            <a
              href={published.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the live site"
              className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-layer/[0.08] hover:text-ink"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            Last published {ago(published.publishedAt)}
            {published.version > 0 ? ` · v${published.version}` : ""}
            {published.charged > 0 ? ` · ${published.charged} credit${published.charged === 1 ? "" : "s"}` : ""}. Edits
            stay in preview until you publish again.
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {hasBuild ? "Not published yet." : "Goes live once your first build finishes."}
        </p>
      )}
    </div>
  );

  /* ── Progress ───────────────────────────────────────────────────────────── */
  if (view === "progress") {
    const posted = run?.phase !== "running";
    let steps: { label: string; state: StepState }[];
    if (isApp) {
      const pre: StepState = posted ? "done" : "running";
      const building: StepState = !posted ? "pending" : deploy.building || retrying ? "running" : "done";
      steps = [
        { label: "Preparing files", state: pre },
        { label: "Applying database changes", state: pre },
        { label: "Building and deploying", state: building },
        { label: "Checking it works", state: building === "done" ? "running" : "pending" },
        { label: "Live", state: "pending" },
      ];
    } else {
      /* One request does all three; the steps move on while it is in flight
         and finish together when it answers. */
      const elapsed = now - (run?.startedAt ?? now);
      const at = Math.min(2, Math.floor(elapsed / 900));
      steps = ["Saving version", "Reserving address", "Going live"].map((label, index) => ({
        label,
        state: index < at ? "done" : index === at ? "running" : "pending",
      }));
    }
    return (
      <>
        {status}
        <div className="mt-3 border-t border-line/[0.06] pt-3">
          <p className="text-[12.5px] font-medium text-ink">Publishing…</p>
          <ul className="mt-1.5">
            {steps.map((step) => (
              <Step key={step.label} label={step.label} state={step.state} />
            ))}
          </ul>
          {deploy.reconnecting ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Still working, reconnecting…
            </p>
          ) : null}
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            You can close this. Progress carries on in the Publish button.
          </p>
        </div>
      </>
    );
  }

  /* ── Failure ────────────────────────────────────────────────────────────── */
  if (view === "failure") {
    const problem = run?.phase === "failed" ? run.problem : null;
    const diagnosis = problem ? null : storedFailure;
    const message = problem?.message ?? diagnosis?.summary ?? deploy.failureText ?? "That couldn't be published.";
    const credits = problem?.stage === "credits";
    const quota = QUOTA.test(message) || QUOTA.test(deploy.failureText ?? "");
    const detail = diagnosis?.detail ?? (problem ? null : deploy.failureText);
    const stillLive = live || Boolean(deploy.behind);
    return (
      <>
        {status}
        <div className="mt-3 border-t border-line/[0.06] pt-3">
          {diagnosis?.headline ? <p className="text-[12.5px] font-medium text-ink">{diagnosis.headline}</p> : null}
          {/* Amber rather than red when the only thing wrong is the balance:
              that is not a fault, it is a thing to go and do. */}
          <p
            className={`mt-1 rounded-lg border px-2.5 py-2 text-[12px] leading-relaxed ${
              credits || quota
                ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-300"
                : "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
            }`}
          >
            {message}
          </p>
          <p className="mt-1.5 text-[12px] text-muted">
            {stillLive ? "Your previous version is still live." : "Nothing was published."}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {!quota && !credits ? (
              <button
                onClick={() => {
                  onAsk([
                    `Publishing failed: ${message}${diagnosis?.file ? ` (in ${diagnosis.file})` : ""}.` +
                      (detail ? `\n\nLog:\n${detail.slice(-2000)}` : "") +
                      "\n\nFix the cause so it publishes.",
                  ]);
                  setRun(null);
                  setFailureSeen(true);
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-sunken"
              >
                <Sparkles className="h-3.5 w-3.5" /> Fix with AI
              </button>
            ) : null}
            <button
              onClick={() => {
                if (problem || !isApp) void publish();
                else onRetry();
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.12] px-3 text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
            {detail ? (
              <button
                onClick={() => setShowLog((open) => !open)}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.12] px-3 text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
              >
                {showLog ? "Hide logs" : "View logs"}
              </button>
            ) : null}
          </div>
          {retryError ? <p className="mt-1.5 text-[11.5px] text-amber-300">{retryError}</p> : null}
          {showLog && detail ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line/[0.06] bg-sunken/40 p-2 font-mono text-[10.5px] leading-relaxed text-muted">
              {detail}
            </pre>
          ) : null}
          <button
            onClick={() => {
              setRun(null);
              setFailureSeen(true);
            }}
            className="mt-2.5 text-[11.5px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Back to publishing
          </button>
        </div>
      </>
    );
  }

  /* ── Success ────────────────────────────────────────────────────────────── */
  if (view === "success" && run?.result) {
    const url = run.result.url;
    return (
      <div>
        <p className="text-[15px] font-semibold text-ink">Your {kindWord} is live</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block break-all text-[14px] font-medium leading-snug text-emerald-300 hover:underline"
        >
          {url.replace(/^https?:\/\//, "")}
        </a>
        <div className="mt-2.5 flex gap-1.5">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-sunken"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
          <span className="flex h-8 items-center rounded-lg border border-line/[0.12] pl-2 pr-1 text-[12px] text-ink">
            Copy <Copyable value={url} label="the address" />
          </span>
          <button
            onClick={() => setSharing((on) => !on)}
            aria-expanded={sharing}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.12] px-3 text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
          >
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
        </div>
        {sharing ? (
          <div className="mt-2.5 flex flex-col items-center rounded-lg border border-line/[0.07] bg-layer/[0.02] p-3">
            <QrCode value={url} className="h-36 w-36" label={`QR code for ${url}`} />
            <p className="mt-1.5 text-[11.5px] text-muted">Scan to open, or copy the link above.</p>
          </div>
        ) : null}
        {run.first ? (
          <button
            onClick={() => {
              setRun(null);
              setAddingDomain(true);
            }}
            className="mt-3 flex items-center gap-1.5 text-[12px] text-ink underline underline-offset-2"
          >
            <Globe className="h-3.5 w-3.5" /> Add your own domain
          </button>
        ) : null}
        <button onClick={() => setRun(null)} className="mt-3 block text-[11.5px] text-muted underline underline-offset-2 hover:text-ink">
          Done
        </button>
      </div>
    );
  }

  /* ── Normal ─────────────────────────────────────────────────────────────── */
  const failing = checks?.filter((check) => check.level !== "pass").length ?? 0;
  const fixable = checks?.filter((check) => check.level !== "pass" && check.fix && (check.fix === "database" || check.asks?.length)) ?? [];
  return (
    <>
      {status}

      {/* ── B: Address ───────────────────────────────────────────────────── */}
      {live ? (
        <div className="mt-3 border-t border-line/[0.06] pt-3">
          <p className="text-[12.5px] font-medium text-ink">Address</p>
          {renaming ? (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveAddress();
                    if (event.key === "Escape") { setAddress(live_slug); setRenaming(false); }
                  }}
                  autoFocus
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="your-address"
                  className="min-w-0 flex-1 rounded-lg border border-line/[0.14] bg-layer/[0.03] px-2.5 py-2 text-[12px] text-ink placeholder:text-muted focus:border-line/[0.24] focus:outline-none"
                />
                <button
                  onClick={saveAddress}
                  disabled={savingAddress || !address.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line/[0.12] px-2.5 py-2 text-[12px] text-ink transition-colors hover:bg-layer/[0.06] disabled:text-muted"
                >
                  {savingAddress && <Loader2 className="h-3 w-3 animate-spin" />}
                  {savingAddress ? "Checking…" : "Save"}
                </button>
              </div>

              {/* The whole address, as it will read once saved. */}
              <p className="mt-1.5 break-all font-mono text-[11.5px] text-ink">
                {publishedLabel(address.trim().toLowerCase() || "your-address")}
              </p>
              {/* Said before it happens, not after. Nothing redirects — the old
                  address is released and anyone may take it. */}
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400">
                Changing this breaks the old address. Anything already linking to it stops working.
              </p>
              {addressProblem && <p className="mt-1 text-[11px] text-rose-300">✗ {addressProblem}</p>}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-soft">{publishedLabel(live_slug || "your-address")}</span>
              <button
                onClick={() => { setAddress(live_slug); setRenaming(true); }}
                aria-label="Change the address"
                className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-layer/[0.08] hover:text-ink"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Custom domains, only once something is live: connecting a domain to
              a project with nothing on it points it at a page that does not
              exist, and the failure looks like DNS days later. */}
          {domains.map((row) => {
            const state = domainState(row);
            return (
              <div key={row.id} className="mt-2.5 rounded-lg border border-line/[0.07] bg-layer/[0.02] p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{row.domain}</span>
                  <span className={`shrink-0 text-[11px] ${state.tone}`}>{state.text}</span>
                  <button
                    onClick={() => disconnect(row.id)}
                    aria-label={`Disconnect ${row.domain}`}
                    className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-layer/[0.08] hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {row.status === "live" ? (
                  <p className="mt-1.5 text-[11px] text-muted">
                    DNS verified · SSL {row.ssl === "active" ? "active" : "being issued"}
                  </p>
                ) : row.record ? (
                  <>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      Add this record at whoever manages {row.domain.split(".").slice(-2).join(".")}, then press Verify.
                      DNS can take a few minutes to an hour.
                    </p>
                    <div className="mt-1.5 rounded-md border border-line/[0.06] bg-sunken/40 px-2 py-1">
                      <RecordRow label="Type" value={row.record.type} />
                      <RecordRow label="Name" value={row.record.name} />
                      <RecordRow label="Value" value={row.record.value} />
                    </div>
                  </>
                ) : null}

                {row.error && <p className="mt-1.5 text-[11px] text-amber-400">{row.error}</p>}
              </div>
            );
          })}

          {domains.some((row) => row.status !== "live" || (row.ssl && row.ssl !== "active")) && (
            <button
              onClick={() => loadDomains(true)}
              disabled={verifying}
              className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-line/[0.1] text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
            >
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {verifying ? "Checking DNS…" : "Retry verification"}
            </button>
          )}

          {addingDomain ? (
            <div className="mt-2.5 flex gap-1.5">
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void connect();
                  if (event.key === "Escape") setAddingDomain(false);
                }}
                autoFocus
                placeholder="www.yourcompany.com"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="min-w-0 flex-1 rounded-lg border border-line/[0.1] bg-layer/[0.03] px-2.5 py-2 text-[12px] text-ink placeholder:text-muted focus:border-line/[0.2] focus:outline-none"
              />
              <button
                onClick={connect}
                disabled={connecting || !typed.trim()}
                className="shrink-0 rounded-lg border border-line/[0.1] px-3 text-[12px] text-ink transition-colors hover:bg-layer/[0.06] disabled:text-muted"
              >
                {connecting ? "…" : "Connect"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingDomain(true)}
              className="mt-2 flex items-center gap-1.5 text-[12px] text-ink transition-colors hover:text-soft"
            >
              <Globe className="h-3.5 w-3.5" /> Connect a domain
            </button>
          )}

          {domainProblem && <p className="mt-1.5 text-[11px] text-rose-300">{domainProblem}</p>}
        </div>
      ) : null}

      {/* ── C: Checklist ─────────────────────────────────────────────────── */}
      {hasBuild ? (
        <div className="mt-3 border-t border-line/[0.06] pt-3">
          <button
            onClick={() => setChecksOpen((open) => !open)}
            aria-expanded={checksOpen}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 text-[12.5px] font-medium text-ink">Before you publish</span>
            {checks === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
            ) : (
              <span className={`text-[11.5px] ${blocked ? "text-rose-300" : failing ? "text-amber-400" : "text-emerald-400"}`}>
                {blocked ? "Needs a fix" : failing ? `${failing} to look at` : "All good"}
              </span>
            )}
            <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform ${checksOpen || blocked ? "rotate-180" : ""}`} />
          </button>
          {(checksOpen || blocked) && checks ? (
            <>
            {/* Every problem the builder can fix, in one go: each check's own
                requests, one per file, sent together. */}
            {fixable.length > 1 ? (
              <button
                onClick={() => {
                  if (fixable.some((check) => check.fix === "database")) onOpenDatabase();
                  const asks = fixable.flatMap((check) => (check.fix === "chat" ? (check.asks ?? []) : []));
                  if (asks.length) onAsk(asks);
                }}
                className="mt-2 flex h-8 w-full items-center justify-center rounded-lg bg-ink text-[12px] font-medium text-sunken transition-opacity hover:opacity-90"
              >
                Fix all {fixable.length}
              </button>
            ) : null}
            <ul className="mt-1.5">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 py-1">
                  <span className="mt-0.5 shrink-0">{LEVEL_ICON[check.level]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-ink">{check.label}</span>
                    {check.detail ? <span className="block text-[11px] leading-relaxed text-muted">{check.detail}</span> : null}
                  </span>
                  {check.level !== "pass" && check.fix ? (
                    <button
                      onClick={() => {
                        if (check.fix === "database") onOpenDatabase();
                        else if (check.asks?.length) onAsk(check.asks);
                      }}
                      className="shrink-0 rounded-md border border-line/[0.12] px-2 py-0.5 text-[11px] text-ink transition-colors hover:bg-layer/[0.06]"
                    >
                      Fix
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── D: Publish ───────────────────────────────────────────────────── */}
      <button
        onClick={publish}
        disabled={!hasBuild || !projectId || running || blocked}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[13px] font-medium text-sunken transition-opacity disabled:bg-layer/[0.08] disabled:text-muted md:h-8 md:rounded-lg"
      >
        {live ? (pending ? "Publish changes" : "Publish again") : "Publish"}
      </button>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{priceNote}</p>

      {/* ── F: Footer ────────────────────────────────────────────────────── */}
      {live && !isApp ? (
        <div className="mt-3 border-t border-line/[0.06] pt-2.5">
          {confirmUnpublish ? (
            <div className="rounded-lg border border-line/[0.08] bg-layer/[0.02] p-2.5">
              <p className="text-[12px] leading-relaxed text-ink">
                Take {published.url.replace(/^https?:\/\//, "")} offline? Visitors will see a not-found page. You can
                publish again anytime.
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={unpublish}
                  disabled={unpublishing}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] px-3 text-[12px] text-rose-300"
                >
                  {unpublishing && <Loader2 className="h-3 w-3 animate-spin" />} Unpublish
                </button>
                <button
                  onClick={() => setConfirmUnpublish(false)}
                  className="flex h-8 items-center rounded-lg px-3 text-[12px] text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmUnpublish(true)} className="text-[11.5px] text-muted underline underline-offset-2 hover:text-ink">
              Unpublish
            </button>
          )}
        </div>
      ) : null}

      {/* The upgrade is the chat's to propose and confirm (it writes a whole app
          and says what it costs there); this only asks for it. */}
      {webApp === false ? (
        <button
          onClick={() => onAsk(["Upgrade this website to a web app with logins and a database."])}
          className="mt-3 block text-left text-[11.5px] text-muted underline underline-offset-2 hover:text-ink"
        >
          Need logins or a database? Upgrade to Web App
        </button>
      ) : null}
    </>
  );
}
