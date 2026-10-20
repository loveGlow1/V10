"use client";

/* Connect WhatsApp — in Settings → Account.
 *
 * Shows a one-time code to send to the QuickStark.Ai WhatsApp assistant. The
 * number that sends it is linked to this account, and the assistant can then
 * answer questions about it — plan, credits, projects — read-only. While a code
 * is showing, the status is re-read every few seconds so the panel turns to
 * "Connected" the moment the message lands. */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";

type Status = { configured: boolean; linked: boolean; phone: string | null };
type Pending = { code: string; expiresAt: string; openUrl: string };

export function WhatsAppConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(async () => {
    const response = await fetch("/api/whatsapp/link", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return null;
    const body = (await response.json()) as Status;
    setStatus(body);
    return body;
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  /* Waiting for the message: re-read until linked or the code runs out. */
  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(async () => {
      setNow(Date.now());
      if (Date.parse(pending.expiresAt) <= Date.now()) return;
      const body = await read();
      if (body?.linked) setPending(null);
    }, 4000);
    return () => window.clearInterval(tick);
  }, [pending, read]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/whatsapp/link", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("A code couldn't be made just now. Try again.");
      return;
    }
    setPending((await response.json()) as Pending);
    setNow(Date.now());
  };

  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/whatsapp/link", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setPending(null);
    await read();
  };

  const copy = async () => {
    if (!pending) return;
    await navigator.clipboard.writeText(`LINK ${pending.code}`).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (!status) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Loading" />;
  }
  if (!status.configured) {
    return <span className="text-[13px] text-faint">Not available yet</span>;
  }

  if (pending) {
    const left = Math.max(0, Math.ceil((Date.parse(pending.expiresAt) - now) / 60000));
    const expired = left === 0;
    return (
      <div className="w-[260px] rounded-xl border border-line/[0.1] bg-layer/[0.03] p-3 text-left">
        {expired ? (
          <p className="text-[13px] text-muted">That code ran out.</p>
        ) : (
          <>
            <p className="text-[12px] text-muted">Send this to our WhatsApp from your phone:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 py-2 text-center font-mono text-[15px] font-semibold tracking-wider text-ink">
                LINK {pending.code}
              </code>
              <button
                type="button"
                onClick={copy}
                aria-label="Copy the code"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/[0.1] text-muted transition-colors hover:text-ink"
              >
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <a
              href={pending.openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] text-[13px] font-semibold text-white transition-all hover:brightness-95"
            >
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-faint">
              <Loader2 className="h-3 w-3 animate-spin" /> Waiting for your message · expires in {left} min
            </p>
          </>
        )}
        <div className="mt-2 flex gap-2">
          {expired && (
            <button type="button" onClick={start} disabled={busy} className="text-[12px] font-medium text-accent hover:underline">
              Get a new code
            </button>
          )}
          <button type="button" onClick={() => setPending(null)} className="text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (status.linked) {
    return (
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-ink">
          <span className="h-2 w-2 rounded-full bg-[#25D366]" /> {status.phone}
        </span>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="h-9 rounded-lg px-3 text-[13px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          Disconnect
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="flex h-9 items-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white transition-all hover:brightness-95 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        Connect WhatsApp
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </span>
  );
}
