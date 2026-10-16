"use client";

/* The terminal panel: tabs of real shells in the project's sandbox.
 *
 * Owns the one connection (connection.ts) and the layout around the views
 * (TerminalView.tsx): tabs that are renamed with a double-click and reordered
 * by dragging, each with a live "running" dot and a kill button that takes
 * the whole process tree down; a split view of two shells side by side; the
 * banners that make the connection's state impossible to miss (starting,
 * reconnecting, ended, not set up, failed — each with what to do); and on a
 * phone, the accessory keys a soft keyboard does not have. Tabs, the split
 * and the settings are remembered per project. */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertTriangle, Columns2, Loader2, Plus, RotateCw, Settings2, X } from "lucide-react";

import { askChatFromAnotherTab } from "../visual-ask";
import { TerminalConnection } from "./connection";
import TerminalView, { type TerminalViewHandle } from "./TerminalView";

type Tab = { id: string; title: string };
type Saved = { tabs: Tab[]; active: string; split: string | null; scrollback: number; screenReader: boolean };

export type TerminalPanelHandle = {
  /** The editor's copy of a file, into the sandbox. */
  writeFile: (path: string, content: string) => void;
  /** Type a command into the active shell. */
  run: (command: string) => void;
};

type Props = {
  projectId: string;
  theme: "light" | "dark";
  visible: boolean;
  onPorts: (ports: { port: number; url: string }[]) => void;
  onRunning: (running: boolean) => void;
  onOpenFile: (path: string, line: number) => void;
  /** This deployment has no hosted sandboxes; the editor uses the in-browser terminal instead. */
  onUnconfigured?: () => void;
};

const newId = () => `t${Math.random().toString(36).slice(2, 8)}`;

function load(projectId: string): Saved | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(`qs-term:${projectId}`) ?? "null") as Saved | null;
    return saved && Array.isArray(saved.tabs) && saved.tabs.length ? saved : null;
  } catch {
    return null;
  }
}

const TerminalPanel = forwardRef<TerminalPanelHandle, Props>(function TerminalPanel(
  { projectId, theme, visible, onPorts, onRunning, onOpenFile, onUnconfigured },
  ref,
) {
  const connection = useMemo(() => new TerminalConnection(projectId), [projectId]);
  const [state, setState] = useState(connection.state);
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [split, setSplit] = useState<string | null>(null);
  const [scrollback, setScrollback] = useState(10_000);
  const [screenReader, setScreenReader] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [touch, setTouch] = useState(false);
  const [ready, setReady] = useState(false);
  const views = useRef<Map<string, TerminalViewHandle>>(new Map());
  const portsRef = useRef(onPorts);
  portsRef.current = onPorts;
  const focusedPane = useRef<string>("");

  /* Restored, or one fresh tab. */
  useEffect(() => {
    const saved = load(projectId);
    if (saved) {
      setTabs(saved.tabs);
      setActive(saved.active || saved.tabs[0].id);
      setSplit(saved.split && saved.tabs.some((tab) => tab.id === saved.split) ? saved.split : null);
      setScrollback(Math.min(50_000, Math.max(1_000, saved.scrollback || 10_000)));
      setScreenReader(Boolean(saved.screenReader));
    } else {
      const first = { id: newId(), title: "bash" };
      setTabs([first]);
      setActive(first.id);
    }
    try {
      setTouch(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setTouch(false);
    }
    setReady(true);
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(`qs-term:${projectId}`, JSON.stringify({ tabs, active, split, scrollback, screenReader } satisfies Saved));
    } catch {
      /* Remembered for this visit only. */
    }
  }, [ready, projectId, tabs, active, split, scrollback, screenReader]);

  /* The connection, for as long as the panel exists. */
  useEffect(() => {
    const off = connection.onChange((c) => {
      setState(c.state);
      setError(c.error);
      portsRef.current(c.ports.map((port) => ({ port, url: c.portAddress(port) })));
      /* Shells another device opened show up as tabs here too. */
      setTabs((current) => {
        const known = new Set(current.map((tab) => tab.id));
        const extra = c.sessions.filter((s) => !known.has(s.s)).map((s) => ({ id: s.s, title: s.title || "bash" }));
        return extra.length ? [...current, ...extra] : current;
      });
    });
    connection.start();
    return () => {
      off();
      connection.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  useEffect(() => onRunning(Object.values(running).some(Boolean)), [running, onRunning]);

  useEffect(() => {
    if (state === "unconfigured") onUnconfigured?.();
  }, [state, onUnconfigured]);

  /* Shown and connected: typing goes to the shell, not the editor behind it. */
  useEffect(() => {
    if (!visible || state !== "open" || !active) return;
    /* The view's xterm loads a moment after the connection opens; keep
       trying briefly until it has taken the focus. */
    let tries = 0;
    const id = window.setInterval(() => {
      views.current.get(active)?.focus();
      const inShell = document.activeElement?.closest?.(".xterm");
      if (inShell || ++tries >= 20) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [visible, state, active]);

  useImperativeHandle(ref, () => ({
    writeFile: (path, content) => connection.writeFile(path, content),
    run: (command) => views.current.get(focusedPane.current || active)?.send(`${command}\r`),
  }));

  const addTab = useCallback(() => {
    const tab = { id: newId(), title: "bash" };
    setTabs((current) => [...current, tab]);
    setActive(tab.id);
    return tab.id;
  }, []);

  function closeTab(id: string) {
    connection.kill(id);
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      if (next.length === 0) {
        const fresh = { id: newId(), title: "bash" };
        setActive(fresh.id);
        setSplit(null);
        return [fresh];
      }
      if (active === id) setActive(next[next.length - 1].id === split ? next[0].id : next[next.length - 1].id);
      if (split === id) setSplit(null);
      return next;
    });
    setRunning((current) => ({ ...current, [id]: false }));
  }

  function toggleSplit() {
    if (split) {
      setSplit(null);
      return;
    }
    const other = tabs.find((tab) => tab.id !== active)?.id ?? addTab();
    setSplit(other);
  }

  function rename(id: string, title: string) {
    const clean = title.trim().slice(0, 40) || "bash";
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, title: clean } : tab)));
    connection.title(id, clean);
    setRenaming(null);
  }

  function drop(onto: string) {
    if (!dragging || dragging === onto) return;
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.id === dragging);
      const to = current.findIndex((tab) => tab.id === onto);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragging(null);
  }

  const shown = split ? [active, split] : [active];
  const key = (data: string) => views.current.get(focusedPane.current || active)?.send(data);

  const banner = (() => {
    if (state === "connecting") return { tone: "info", text: "Starting the terminal…", spin: true };
    if (state === "reconnecting") return { tone: "warn", text: "Reconnecting…", spin: true };
    if (state === "ended") return { tone: "warn", text: error, action: "Got it" };
    if (state === "unconfigured") return { tone: "warn", text: error || "The terminal isn't set up on this deployment yet." };
    if (state === "error") return { tone: "error", text: error || "The terminal lost its connection.", action: "Restart" };
    return null;
  })();

  if (!ready) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tabs. */}
      <div className="flex h-[30px] shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]" role="tablist" aria-label="Terminals">
        {tabs.map((tab) => {
          const on = shown.includes(tab.id);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active}
              draggable={renaming !== tab.id}
              onDragStart={() => setDragging(tab.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => drop(tab.id)}
              onClick={() => {
                if (tab.id === split) return;
                setActive(tab.id);
                requestAnimationFrame(() => views.current.get(tab.id)?.focus());
              }}
              onDoubleClick={() => setRenaming(tab.id)}
              className={`group flex h-[24px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] pl-2 pr-1 text-[12px] ${
                on ? "bg-[var(--vs-select)] text-[var(--vs-text)]" : "text-[var(--vs-muted)] hover:bg-[var(--vs-hover)]"
              } ${dragging === tab.id ? "opacity-50" : ""}`}
            >
              <span
                aria-label={running[tab.id] ? "running" : undefined}
                className={`h-1.5 w-1.5 rounded-full ${running[tab.id] ? "bg-[#3fb950] motion-safe:animate-pulse" : "bg-[var(--vs-faint)] opacity-50"}`}
              />
              {renaming === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.title}
                  onBlur={(event) => rename(tab.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") rename(tab.id, (event.target as HTMLInputElement).value);
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  className="w-24 bg-transparent outline-none"
                  aria-label="Terminal name"
                />
              ) : (
                <span className="max-w-[140px] truncate">{tab.title}</span>
              )}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                title="Kill terminal (ends everything running in it)"
                aria-label={`Kill ${tab.title}`}
                className="rounded p-0.5 opacity-60 hover:bg-[var(--vs-hover)] hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button onClick={addTab} title="New terminal" aria-label="New terminal" className="ml-0.5 rounded p-1 text-[var(--vs-muted)] hover:bg-[var(--vs-hover)]">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={toggleSplit}
          aria-pressed={Boolean(split)}
          title={split ? "Unsplit" : "Split terminal"}
          aria-label="Split terminal"
          className={`rounded p-1 hover:bg-[var(--vs-hover)] ${split ? "text-[var(--vs-text)]" : "text-[var(--vs-muted)]"}`}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
        <div className="relative">
          <button onClick={() => setSettingsOpen((on) => !on)} title="Terminal settings" aria-label="Terminal settings" className="rounded p-1 text-[var(--vs-muted)] hover:bg-[var(--vs-hover)]">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {settingsOpen ? (
            <div className="absolute left-0 top-7 z-40 w-[230px] rounded-[6px] border border-[var(--vs-border)] bg-[var(--vs-side)] p-3 text-[12px] text-[var(--vs-text)] shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
              <label className="block text-[var(--vs-muted)]" htmlFor="qs-scrollback">
                Scrollback lines
              </label>
              <select
                id="qs-scrollback"
                value={scrollback}
                onChange={(event) => setScrollback(Number(event.target.value))}
                className="mt-1 w-full rounded border border-[var(--vs-border)] bg-[var(--vs-input)] px-1 py-0.5"
              >
                {[10_000, 20_000, 30_000, 50_000].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </select>
              <label className="mt-3 flex items-center gap-2">
                <input type="checkbox" checked={screenReader} onChange={(event) => setScreenReader(event.target.checked)} />
                Screen reader mode
              </label>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  void connection.restart();
                }}
                className="mt-3 flex items-center gap-1.5 text-[var(--vs-accent)] hover:underline"
              >
                <RotateCw className="h-3 w-3" /> Restart the sandbox
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {banner ? (
        <div
          role="status"
          className={`flex shrink-0 items-center gap-2 border-y border-[var(--vs-border)] px-3 py-1 text-[12px] ${
            banner.tone === "error" ? "text-[#f14c4c]" : banner.tone === "warn" ? "text-[var(--vs-modified)]" : "text-[var(--vs-muted)]"
          }`}
        >
          {banner.spin ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span className="min-w-0 flex-1">{banner.text}</span>
          {banner.action ? (
            <button
              onClick={() => (banner.action === "Restart" ? void connection.restart() : connection.acknowledge())}
              className="rounded bg-[var(--vs-accent)] px-2 py-0.5 text-white"
            >
              {banner.action}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The views: every tab stays mounted, so a hidden one keeps its screen. */}
      <div className="flex min-h-0 flex-1">
        {state !== "unconfigured"
          ? tabs.map((tab) => {
              const index = shown.indexOf(tab.id);
              return (
                <div
                  key={tab.id}
                  className={`${index < 0 ? "hidden" : "flex"} min-w-0 flex-1 ${index === 1 ? "border-l border-[var(--vs-border)]" : ""}`}
                  style={{ order: index }}
                  onFocusCapture={() => (focusedPane.current = tab.id)}
                >
                  <TerminalView
                    ref={(handle) => {
                      if (handle) views.current.set(tab.id, handle);
                      else views.current.delete(tab.id);
                    }}
                    connection={connection}
                    sid={tab.id}
                    theme={theme}
                    fontSize={fontSize}
                    scrollback={scrollback}
                    screenReader={screenReader}
                    visible={visible && index >= 0}
                    onOpenFile={onOpenFile}
                    onAskAI={(text) => askChatFromAnotherTab({ projectId, texts: [text] })}
                    onRunning={(sid, on) => setRunning((current) => (current[sid] === on ? current : { ...current, [sid]: on }))}
                    onFocus={() => (focusedPane.current = tab.id)}
                    onFontSize={setFontSize}
                    onCtrlArmed={setCtrlArmed}
                  />
                </div>
              );
            })
          : null}
      </div>

      {/* A phone's missing keys. Ctrl is sticky: tap it, then a letter. */}
      {touch ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-[var(--vs-border)] px-2 py-1 [scrollbar-width:none]">
          {(
            [
              ["Esc", "\x1b"],
              ["Tab", "\t"],
              ["Ctrl", null],
              ["↑", "\x1b[A"],
              ["↓", "\x1b[B"],
              ["←", "\x1b[D"],
              ["→", "\x1b[C"],
              ["|", "|"],
              ["~", "~"],
              ["/", "/"],
            ] as [string, string | null][]
          ).map(([name, data]) => (
            <button
              key={name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (data === null ? views.current.get(focusedPane.current || active)?.armCtrl() : key(data))}
              aria-pressed={data === null ? ctrlArmed : undefined}
              className={`h-8 min-w-[40px] shrink-0 rounded-[6px] border px-2 font-mono text-[13px] ${
                data === null && ctrlArmed
                  ? "border-[var(--vs-accent)] bg-[var(--vs-accent)] text-white"
                  : "border-[var(--vs-border)] bg-[var(--vs-input)] text-[var(--vs-text)]"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

export default TerminalPanel;
