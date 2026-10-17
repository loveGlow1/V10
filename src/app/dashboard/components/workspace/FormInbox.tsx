"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Inbox, Loader2, Trash2 } from "lucide-react";

/* The project's forms inbox: what visitors sent through the forms on pages
   with no database of their own. See src/lib/forms/inbox.ts and
   /api/projects/[id]/forms. */

type Message = {
  id: string;
  form: string;
  name: string | null;
  email: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function when(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function FormInbox({ projectId }: { projectId: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/forms`;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "The inbox couldn't be read.");
        setMessages([]);
        return;
      }
      setMessages(body.messages ?? []);
      setUnread(body.unread ?? 0);
      setTotal(body.total ?? 0);
      setProblem(null);
    } catch {
      setProblem("The inbox couldn't be read. Check your connection.");
      setMessages([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(ids: string[] | null) {
    setMessages((current) =>
      (current ?? []).map((m) => (ids === null || ids.includes(m.id) ? { ...m, read_at: m.read_at ?? new Date().toISOString() } : m)),
    );
    setUnread((count) => (ids === null ? 0 : Math.max(0, count - ids.length)));
    await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids, read: true } : { read: true }),
    }).catch(() => {});
  }

  async function remove(id: string) {
    setConfirming(null);
    const gone = messages?.find((m) => m.id === id);
    setMessages((current) => (current ?? []).filter((m) => m.id !== id));
    setTotal((count) => Math.max(0, count - 1));
    if (gone && !gone.read_at) setUnread((count) => Math.max(0, count - 1));
    const response = await fetch(base, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (!response?.ok) {
      setProblem("That message couldn't be deleted.");
      void load();
    }
  }

  function toggle(message: Message) {
    setOpen((current) => (current === message.id ? null : message.id));
    if (!message.read_at) void markRead([message.id]);
  }

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted" />
        <h3 className="text-[14px] font-medium text-ink">Form messages</h3>
        {unread > 0 && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{unread} new</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {unread > 0 && (
            <button
              onClick={() => void markRead(null)}
              className="h-8 rounded-lg px-2.5 text-[12px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
            >
              Mark all read
            </button>
          )}
          {total > 0 && (
            <a
              href={`${base}?format=csv`}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.09] px-2.5 text-[12px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </a>
          )}
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        What people send through your site&apos;s forms — contact, waitlist, RSVP. You also get an email for each new one.
      </p>

      {messages === null ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading…
        </p>
      ) : messages.length === 0 ? (
        <p className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 text-[12.5px] leading-relaxed text-muted md:rounded-xl">
          {problem ?? "No messages yet. When someone fills in a form on your site, it shows up here."}
        </p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[18px] border border-line/[0.07] bg-layer/[0.02] md:rounded-xl">
          {messages.map((message, index) => {
            const expanded = open === message.id;
            const who = message.name ?? message.email ?? "Someone";
            const extra = Object.entries(message.data ?? {});
            return (
              <li key={message.id} className={index > 0 ? "border-t border-line/[0.06]" : ""}>
                <button
                  onClick={() => toggle(message)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-layer/[0.03]"
                >
                  <span
                    aria-label={message.read_at ? undefined : "Unread"}
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${message.read_at ? "bg-transparent" : "bg-accent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`truncate text-[13px] ${message.read_at ? "text-soft" : "font-medium text-ink"}`}>{who}</span>
                      <span className="shrink-0 rounded-full bg-layer/[0.08] px-1.5 py-px text-[10.5px] text-muted">{message.form}</span>
                      <span className="ml-auto shrink-0 text-[11.5px] text-muted">{when(message.created_at)}</span>
                    </span>
                    {!expanded && message.message && (
                      <span className="mt-0.5 block truncate text-[12px] text-muted">{message.message}</span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div className="px-3.5 pb-3.5 pl-[30px] text-[12.5px] leading-relaxed text-soft">
                    {message.email && (
                      <p>
                        <a href={`mailto:${message.email}`} className="text-ink underline underline-offset-2">
                          {message.email}
                        </a>
                      </p>
                    )}
                    {extra.map(([key, value]) => (
                      <p key={key}>
                        <span className="text-muted">{key}:</span> {String(value)}
                      </p>
                    ))}
                    {message.message && <p className="mt-2 whitespace-pre-wrap break-words text-ink">{message.message}</p>}
                    <div className="mt-3 flex items-center gap-2">
                      {message.email && (
                        <a
                          href={`mailto:${message.email}`}
                          className="h-8 rounded-lg bg-solid px-3 text-[12px] font-medium leading-8 text-onSolid"
                        >
                          Reply
                        </a>
                      )}
                      {confirming === message.id ? (
                        <button
                          onClick={() => void remove(message.id)}
                          className="h-8 rounded-lg border border-red-500/40 px-3 text-[12px] text-red-400"
                        >
                          Tap again to delete
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirming(message.id)}
                          aria-label="Delete message"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-layer/[0.05] hover:text-ink"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && messages && messages.length > 0 && <p className="mt-2 text-[12px] text-amber-400">{problem}</p>}
    </section>
  );
}
