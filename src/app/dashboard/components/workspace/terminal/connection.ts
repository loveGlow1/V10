"use client";

/* The terminal's link to the project's sandbox: one WebSocket for every tab.
 *
 * Opening asks /api/projects/[id]/terminal for the sandbox and a short-lived
 * token, then connects straight to the bridge inside it (see
 * lib/terminal/bridge-source.ts). It never gives up quietly:
 *   - a dropped connection is retried with backoff, each time with a fresh
 *     token, and the bridge replays every chunk after the last sequence number
 *     seen per shell — so nothing is lost and nothing arrives twice;
 *   - keystrokes typed while it is down are held and sent, in order, when it
 *     is back;
 *   - a keep-alive runs while the page is visible, so the sandbox does not
 *     pause under somebody working in it.
 * A sandbox that had to be made afresh (the old one ended) is reported, so
 * the panel can say "Session ended" rather than pretend nothing happened. */

export type ConnectionState = "connecting" | "open" | "reconnecting" | "ended" | "unconfigured" | "error";

export type SessionInfo = { s: string; title: string; seq: number };

type Listener<T> = (value: T) => void;

const BACKOFF = [500, 1000, 2000, 4000, 8000];
const KEEPALIVE_MS = 4 * 60 * 1000;

export class TerminalConnection {
  state: ConnectionState = "connecting";
  error = "";
  sessions: SessionInfo[] = [];
  ports: number[] = [];
  portUrl = "";

  private ws: WebSocket | null = null;
  private lastSeq = new Map<string, number>();
  private outbox: string[] = [];
  private attempts = 0;
  private closed = false;
  private hadSandbox = false;
  private firstOpen = true;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  private output = new Map<string, Set<Listener<Uint8Array>>>();
  /* Output for a shell no view is attached to yet — the replay after a page
     load arrives before its tab has mounted. Handed over on attach. */
  private held = new Map<string, Uint8Array[]>();
  private exits = new Map<string, Set<Listener<number>>>();
  private stateListeners = new Set<Listener<TerminalConnection>>();

  constructor(private readonly projectId: string) {}

  start() {
    this.closed = false;
    void this.connect();
    this.keepalive = setInterval(() => {
      if (document.visibilityState === "visible" && this.state === "open") {
        void fetch(`/api/projects/${this.projectId}/terminal`, { method: "PATCH" }).catch(() => undefined);
      }
    }, KEEPALIVE_MS);
  }

  stop() {
    this.closed = true;
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }

  /** Ends the sandbox — every shell and process — and starts a fresh one. */
  async restart() {
    this.ws?.close();
    this.lastSeq.clear();
    this.sessions = [];
    this.set("connecting");
    await fetch(`/api/projects/${this.projectId}/terminal`, { method: "DELETE" }).catch(() => undefined);
    this.hadSandbox = false;
    this.firstOpen = true;
    void this.connect();
  }

  private set(state: ConnectionState, error = "") {
    this.state = state;
    this.error = error;
    for (const listener of this.stateListeners) listener(this);
  }

  onChange(listener: Listener<TerminalConnection>) {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  onOutput(sid: string, listener: Listener<Uint8Array>) {
    const set = this.output.get(sid) ?? new Set();
    set.add(listener);
    this.output.set(sid, set);
    for (const chunk of this.held.get(sid) ?? []) listener(chunk);
    this.held.delete(sid);
    return () => void set.delete(listener);
  }

  onExit(sid: string, listener: Listener<number>) {
    const set = this.exits.get(sid) ?? new Set();
    set.add(listener);
    this.exits.set(sid, set);
    return () => void set.delete(listener);
  }

  private async connect() {
    if (this.closed) return;
    try {
      const response = await fetch(`/api/projects/${this.projectId}/terminal${this.firstOpen ? "?sync=1" : ""}`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        portUrl?: string;
        created?: boolean;
        error?: string;
        unconfigured?: boolean;
      };
      if (response.status === 503 && body.unconfigured) return this.set("unconfigured", body.error ?? "");
      if (!response.ok || !body.url) throw new Error(body.error ?? "The terminal could not start.");
      this.firstOpen = false;
      this.portUrl = body.portUrl ?? "";
      /* A new sandbox where there was one before: whatever ran there is gone. */
      if (body.created && this.hadSandbox) {
        this.lastSeq.clear();
        this.sessions = [];
        this.set("ended", "The session ended, so a fresh one was started. Anything that was running has stopped.");
      }
      this.hadSandbox = true;
      this.open(body.url);
    } catch (error) {
      this.scheduleRetry(error instanceof Error ? error.message : String(error));
    }
  }

  private open(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      ws.send(JSON.stringify({ t: "hello", resume: Object.fromEntries(this.lastSeq) }));
      for (const message of this.outbox.splice(0)) ws.send(message);
      if (this.state !== "ended") this.set("open");
    };
    ws.onmessage = (event) => this.receive(String(event.data));
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.scheduleRetry("");
    };
  }

  private scheduleRetry(reason: string) {
    if (this.closed) return;
    if (this.attempts >= 8) return this.set("error", reason || "The terminal lost its connection.");
    this.set("reconnecting", reason);
    const wait = BACKOFF[Math.min(this.attempts, BACKOFF.length - 1)];
    this.attempts += 1;
    this.retry = setTimeout(() => void this.connect(), wait);
  }

  /** After "ended" has been read, back to normal. */
  acknowledge() {
    if (this.state === "ended") this.set(this.ws?.readyState === WebSocket.OPEN ? "open" : "connecting");
  }

  private receive(text: string) {
    let message: { t: string; s?: string; q?: number; d?: string; code?: number; list?: unknown };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.t === "o" && message.s && typeof message.q === "number" && message.d) {
      /* Replay can overlap what was already shown on a fast reconnect; a
         sequence number is never written twice. */
      if ((this.lastSeq.get(message.s) ?? 0) >= message.q) return;
      this.lastSeq.set(message.s, message.q);
      const bytes = Uint8Array.from(atob(message.d), (c) => c.charCodeAt(0));
      const listeners = this.output.get(message.s);
      if (listeners?.size) for (const listener of listeners) listener(bytes);
      else this.held.set(message.s, [...(this.held.get(message.s) ?? []), bytes]);
    } else if (message.t === "exit" && message.s) {
      for (const listener of this.exits.get(message.s) ?? []) listener(message.code ?? 0);
      this.lastSeq.delete(message.s);
    } else if (message.t === "sessions" && Array.isArray(message.list)) {
      this.sessions = message.list as SessionInfo[];
      for (const listener of this.stateListeners) listener(this);
    } else if (message.t === "ports" && Array.isArray(message.list)) {
      this.ports = message.list as number[];
      for (const listener of this.stateListeners) listener(this);
    }
  }

  private send(message: Record<string, unknown>) {
    const text = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.outbox.push(text);
  }

  openShell(sid: string, cols: number, rows: number) {
    this.send({ t: "open", s: sid, cols, rows });
  }
  input(sid: string, data: string) {
    this.send({ t: "i", s: sid, d: data });
  }
  resize(sid: string, cols: number, rows: number) {
    this.send({ t: "resize", s: sid, cols, rows });
  }
  kill(sid: string) {
    this.send({ t: "kill", s: sid });
  }
  title(sid: string, title: string) {
    this.send({ t: "title", s: sid, title });
  }
  /** The editor's copy of a file, so a dev server in the sandbox sees it. */
  writeFile(path: string, content: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "write", path, content }));
  }

  portAddress(port: number): string {
    return this.portUrl.replace("{port}", String(port));
  }
}
