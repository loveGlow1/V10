"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { publishedLabel, publishedUrl } from "@/lib/publish/naming";

/* Taking a project live, and pointing a domain at it.
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
  live: { text: "Connected", tone: "text-emerald-400" },
  awaiting_dns: { text: "Waiting for DNS", tone: "text-amber-400" },
  pending: { text: "Setting up", tone: "text-muted" },
  failed: { text: "Failed", tone: "text-rose-400" },
};

export default function PublishPanel({
  projectId,
  hasBuild,
  priceNote,
  slug,
  publishedAt,
}: {
  projectId: string | null;
  /* Whether there is anything to publish. A project with no build has nothing
     to put on an address, and the button says so rather than failing. */
  hasBuild: boolean;
  priceNote: string;
  /* The address already reserved, from the project row. Without this the panel
     only knew about a publish that happened in THIS session — so reopening the
     workspace showed a live project as though it had never been published. */
  slug: string | null;
  publishedAt: string | null;
}) {
  const [published, setPublished] = useState<Published>(
    slug && publishedAt
      ? { url: publishedUrl(slug), version: 0, publishedAt, charged: 0 }
      : null,
  );
  const [address, setAddress] = useState(slug ?? "");
  const [renaming, setRenaming] = useState(false);
  const [addressProblem, setAddressProblem] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  /* What went wrong, and at which step. The stage is worth keeping: "couldn't
     reserve the address" and "couldn't make it live" are different problems
     with different answers, and one sentence for both teaches nothing. */
  const [problem, setProblem] = useState<{ message: string; stage: string } | null>(null);

  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [typed, setTyped] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [domainProblem, setDomainProblem] = useState<string | null>(null);

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

  async function publish() {
    if (!projectId || publishing) return;
    setPublishing(true);
    setProblem(null);

    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await response.json();

      if (!response.ok || !body.published) {
        setProblem({ message: body.error ?? "That couldn't be published.", stage: body.stage ?? "publish" });
        return;
      }

      setPublished({ url: body.url, version: body.version, publishedAt: body.publishedAt, charged: body.charged ?? 0 });
      /* A domain connected earlier may have been waiting on exactly this. */
      void loadDomains(false);
    } catch {
      setProblem({ message: "That couldn't be published — the request didn't get through.", stage: "network" });
    } finally {
      setPublishing(false);
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
      setDomains((current) => [...current.filter((row) => row.id !== body.domain.id), body.domain]);
    } catch {
      setDomainProblem("That didn't get through. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function saveAddress() {
    if (!projectId || renaming) return;
    const wanted = address.trim().toLowerCase();
    if (!wanted || wanted === slug) { setRenaming(false); return; }

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

      setPublished((current) => (current ? { ...current, url: body.url } : current));
      setRenaming(false);
    } catch {
      setAddressProblem("That didn't get through. Try again.");
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

  const live = published !== null;

  return (
    <>
      <p className="hidden text-[13px] font-medium text-ink md:block">Publish this app</p>

      {/* ── The address ──────────────────────────────────────────────────── */}
      {live && renaming ? (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[12px] text-muted">{publishedLabel("").replace(/\/$/, "/")}</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveAddress();
                if (event.key === "Escape") { setAddress(slug ?? ""); setRenaming(false); }
              }}
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="min-w-0 flex-1 rounded-lg border border-line/[0.14] bg-layer/[0.03] px-2.5 py-2 text-[12px] text-ink focus:border-line/[0.24] focus:outline-none"
            />
            <button
              onClick={saveAddress}
              className="shrink-0 rounded-lg border border-line/[0.12] px-2.5 py-2 text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
            >
              Save
            </button>
          </div>
          {/* Said before it happens, not after. Nothing redirects — the old
              address is released and anyone may take it — so this is a decision
              rather than a detail. */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400">
            Changing this breaks the old address. Anything already linking to it stops working.
          </p>
          {addressProblem && <p className="mt-1 text-[11px] text-rose-300">{addressProblem}</p>}
        </div>
      ) : live ? (
        <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-2">
          <a
            href={published.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-[12px] text-emerald-300 hover:underline"
          >
            {published.url.replace(/^https:\/\//, "")}
          </a>
          <button
            onClick={() => { setAddress(slug ?? ""); setRenaming(true); }}
            aria-label="Change the address"
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-layer/[0.08] hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
      ) : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {hasBuild
            ? "Your app gets a quickstark address the moment it goes live."
            : "Goes live once your first build finishes."}
        </p>
      )}

      {live && (
        <p className="mt-1.5 text-[12px] text-muted">
          {published.version > 0 ? `Version ${published.version} is live` : "Live"}
          {published.charged > 0 ? ` · ${published.charged} credit${published.charged === 1 ? "" : "s"}` : ""}. Edits
          stay in preview until you publish again.
        </p>
      )}

      <p className="mt-1 text-[12px] leading-relaxed text-muted">{priceNote}</p>

      {problem && (
        /* Amber rather than red when the only thing wrong is the balance:
           that is not a fault, it is a thing to go and do, and colouring it
           like a crash tells somebody their app is broken when it is not. */
        <p
          className={`mt-2 rounded-lg border px-2.5 py-2 text-[12px] leading-relaxed ${
            problem.stage === "credits"
              ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-300"
              : "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
          }`}
        >
          {problem.message}
        </p>
      )}

      <button
        onClick={publish}
        disabled={!hasBuild || !projectId || publishing}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[13px] font-medium text-sunken transition-opacity disabled:bg-layer/[0.08] disabled:text-muted md:h-8 md:rounded-lg"
      >
        {publishing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {publishing ? "Publishing…" : live ? "Publish the latest version" : "Publish app"}
      </button>

      {/* ── Custom domains ───────────────────────────────────────────────────
          Only once something is live. Connecting a domain to a project with
          nothing on it points a customer's domain at a page that does not
          exist, and the failure looks like DNS days later. */}
      {live && (
        <div className="mt-4 border-t border-line/[0.06] pt-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Globe className="h-3.5 w-3.5" /> Your own domain
          </p>

          {domains.map((row) => {
            const state = STATE[row.status] ?? STATE.pending;
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

          {domains.some((row) => row.status !== "live") && (
            <button
              onClick={() => loadDomains(true)}
              disabled={verifying}
              className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-line/[0.1] text-[12px] text-ink transition-colors hover:bg-layer/[0.06]"
            >
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {verifying ? "Checking DNS…" : "Verify domain"}
            </button>
          )}

          <div className="mt-2.5 flex gap-1.5">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
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

          {domainProblem && <p className="mt-1.5 text-[11px] text-rose-300">{domainProblem}</p>}
        </div>
      )}
    </>
  );
}
