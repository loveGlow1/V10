"use client";

/* One shell, drawn: xterm.js on a real bash in the project's sandbox.
 *
 * Everything the spec asks of a single terminal lives here —
 *   input       the real shell does history, Ctrl+R, Tab and job control;
 *               this adds the paste guard (more than 5 lines asks first),
 *               copy-on-Ctrl+C-with-a-selection, and the mobile sticky Ctrl;
 *   output      WebGL rendering, Unicode 11 widths, clickable URLs and
 *               file:line links that open the editor, a jump-to-bottom pill;
 *   blocks      every command as a block, from bash's own shell-integration
 *               marks (OSC 133/633 — see bridge-source.ts): running,
 *               succeeded, or failed with its exit code, its duration past 2s,
 *               and copy / rerun / Ask AI to fix on hover or focus;
 *   a11y        screen reader mode, reduced motion, 4.5:1 minimum contrast.
 * The connection, tabs and layout are the panel's (TerminalPanel). */

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Bot, Check, Copy, Loader2, RotateCw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import type { TerminalConnection } from "./connection";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* The ANSI palette per theme. xterm's minimumContrastRatio lifts anything a
   program prints that would still fall below 4.5:1 on this background. */
export const TERMINAL_THEMES = {
  dark: {
    background: "#181818", foreground: "#cccccc", cursor: "#e5e5e5", cursorAccent: "#181818",
    selectionBackground: "#264f78", selectionInactiveBackground: "#3a3d41",
    black: "#000000", red: "#f14c4c", green: "#23d18b", yellow: "#f5f543", blue: "#3b8eea", magenta: "#d670d6", cyan: "#29b8db", white: "#e5e5e5",
    brightBlack: "#808080", brightRed: "#ff6b6b", brightGreen: "#5ef0a8", brightYellow: "#ffff7a", brightBlue: "#6cb0ff", brightMagenta: "#ee9cee", brightCyan: "#5fd7f2", brightWhite: "#ffffff",
  },
  light: {
    background: "#f8f8f8", foreground: "#3b3b3b", cursor: "#3b3b3b", cursorAccent: "#f8f8f8",
    selectionBackground: "#add6ff", selectionInactiveBackground: "#e5ebf1",
    black: "#000000", red: "#cd3131", green: "#107c10", yellow: "#7a5c00", blue: "#0451a5", magenta: "#a626a4", cyan: "#0a7a8f", white: "#555555",
    brightBlack: "#666666", brightRed: "#b52a2a", brightGreen: "#0e6b0e", brightYellow: "#6b5000", brightBlue: "#0a4ea0", brightMagenta: "#8f1f8d", brightCyan: "#086b7d", brightWhite: "#2f2f2f",
  },
} as const;

const FONT = '"JetBrains Mono", "Geist Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

/* src/app/page.tsx:42:7 — a path, a line, maybe a column. Not inside a URL. */
const FILE_LINK = /(?:\.{1,2}\/)?(?:[\w@.+-]+\/)*[\w@.+-]+\.[A-Za-z][\w]{0,7}:(\d+)(?::(\d+))?/g;

type Block = {
  id: number;
  prompt: any;
  output: any;
  end: any | null;
  command: string;
  start: number;
  ms: number | null;
  code: number | null;
};

export type TerminalViewHandle = {
  focus: () => void;
  send: (data: string) => void;
  /** Ctrl as a sticky key: the next character typed goes as Ctrl+it. */
  armCtrl: () => void;
  clear: () => void;
  selectAll: () => void;
  copy: () => void;
  paste: () => void;
};

type Props = {
  connection: TerminalConnection;
  sid: string;
  theme: "light" | "dark";
  fontSize: number;
  scrollback: number;
  screenReader: boolean;
  visible: boolean;
  onOpenFile: (path: string, line: number) => void;
  onAskAI: (text: string) => void;
  onRunning: (sid: string, running: boolean) => void;
  onFocus: () => void;
  onFontSize: (size: number) => void;
  onCtrlArmed?: (armed: boolean) => void;
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView(props, ref) {
  const { connection, sid, theme, fontSize, scrollback, screenReader, visible } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const blocksRef = useRef<Block[]>([]);
  const pending = useRef<{ prompt: any; command: string }>({ prompt: null, command: "" });
  const ctrl = useRef(false);
  const callbacks = useRef(props);
  callbacks.current = props;

  const [gutter, setGutter] = useState<{ block: Block; top: number }[]>([]);
  const [rowHeight, setRowHeight] = useState(18);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [unread, setUnread] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pasteAsk, setPasteAsk] = useState<{ text: string; lines: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      /* Clipboard refused (permissions); the selection is still there. */
    }
  }, []);

  /* Selected text without the padding a terminal row carries. */
  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (!term?.hasSelection()) return;
    void copyText(term.getSelection().split("\n").map((line: string) => line.replace(/\s+$/, "")).join("\n"), "selection");
  }, [copyText]);

  const paste = useCallback(async (text?: string) => {
    const term = termRef.current;
    if (!term) return;
    const value = text ?? (await navigator.clipboard.readText().catch(() => ""));
    if (!value) return;
    const lines = value.replace(/\r?\n$/, "").split(/\r?\n/).length;
    if (lines > 5 && text === undefined) {
      setPasteAsk({ text: value, lines });
      return;
    }
    term.paste(value);
    term.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
    send: (data: string) => {
      connection.input(sid, data);
      termRef.current?.focus();
    },
    armCtrl: () => {
      ctrl.current = !ctrl.current;
      callbacks.current.onCtrlArmed?.(ctrl.current);
      termRef.current?.focus();
    },
    clear: () => termRef.current?.clear(),
    selectAll: () => termRef.current?.selectAll(),
    copy: copySelection,
    paste: () => void paste(),
  }));

  /* Where each visible block's command line is, for the gutter. */
  const layoutGutter = useCallback(() => {
    const term = termRef.current;
    if (!term?.element) return;
    const screen = term.element.querySelector(".xterm-screen") as HTMLElement | null;
    const height = screen && term.rows ? screen.clientHeight / term.rows : 18;
    setRowHeight(height);
    const top = term.buffer.active.viewportY;
    const shown: { block: Block; top: number }[] = [];
    for (const block of blocksRef.current) {
      const line = block.prompt?.line ?? -1;
      if (line < 0 || block.prompt?.isDisposed) continue;
      if (line >= top && line < top + term.rows) shown.push({ block, top: (line - top) * height });
    }
    setGutter(shown);
  }, []);

  const outputOf = useCallback((block: Block): string => {
    const term = termRef.current;
    if (!term || !block.output || block.output.isDisposed) return "";
    const buffer = term.buffer.active;
    const last = block.end && !block.end.isDisposed ? block.end.line : buffer.length;
    let text = "";
    for (let y = block.output.line; y < last; y += 1) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const next = buffer.getLine(y + 1);
      text += line.translateToString(true) + (next?.isWrapped ? "" : "\n");
    }
    return text.replace(/\s+$/, "");
  }, []);

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-unicode11"),
        import("@xterm/addon-web-links"),
      ]);
      if (disposed || !hostRef.current) return;
      const reduced = prefersReducedMotion();
      const term = new Terminal({
        allowProposedApi: true,
        scrollback,
        fontFamily: FONT,
        fontSize,
        lineHeight: 1.4,
        cursorBlink: !reduced,
        cursorStyle: "bar",
        cursorInactiveStyle: "outline",
        minimumContrastRatio: 4.5,
        screenReaderMode: screenReader,
        macOptionIsMeta: true,
        theme: TERMINAL_THEMES[theme],
        overviewRuler: { width: 8 },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.loadAddon(new WebLinksAddon((_event: MouseEvent, uri: string) => window.open(uri, "_blank", "noopener,noreferrer")));
      term.open(hostRef.current);
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        /* No WebGL: the DOM renderer is slower and still correct. */
      }
      termRef.current = term;
      fitRef.current = fit;
      cleanups.push(() => term.dispose());

      /* file:line links → the editor. */
      const fileLinks = term.registerLinkProvider({
          provideLinks(y: number, done: (links: any[] | undefined) => void) {
            const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
            const links: any[] = [];
            for (const match of text.matchAll(FILE_LINK)) {
              const index = match.index ?? 0;
              if (/[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(text.slice(0, index))) continue;
              const whole = match[0];
              const path = whole.replace(/:(\d+)(?::(\d+))?$/, "").replace(/^\.\//, "").replace(/^\/home\/user\/project\//, "");
              links.push({
                range: { start: { x: index + 1, y }, end: { x: index + whole.length, y } },
                text: whole,
                decorations: { underline: true, pointerCursor: true },
                activate: () => callbacks.current.onOpenFile(path, Number(match[1])),
              });
            }
            done(links.length ? links : undefined);
          },
        });
      cleanups.push(() => fileLinks.dispose());

      /* Command blocks from the shell's own marks. */
      const osc133 = term.parser.registerOscHandler(133, (data: string) => {
        const [kind, arg] = data.split(";");
        if (kind === "A") pending.current.prompt = term.registerMarker(0);
        if (kind === "C") {
          const block: Block = {
            id: Date.now() + Math.random(),
            prompt: pending.current.prompt ?? term.registerMarker(0),
            output: term.registerMarker(0),
            end: null,
            command: pending.current.command,
            start: performance.now(),
            ms: null,
            code: null,
          };
          pending.current = { prompt: null, command: "" };
          blocksRef.current.push(block);
          if (blocksRef.current.length > 500) blocksRef.current.shift();
          callbacks.current.onRunning(sid, true);
          layoutGutter();
        }
        if (kind === "D") {
          const block = [...blocksRef.current].reverse().find((b) => b.code === null);
          if (block) {
            block.code = Number(arg ?? 0) || 0;
            block.ms = performance.now() - block.start;
            block.end = term.registerMarker(0);
            if (block.code !== 0 && block.prompt && !block.prompt.isDisposed) {
              term.registerDecoration({ marker: block.prompt, overviewRulerOptions: { color: "#f14c4c" } });
            }
            callbacks.current.onRunning(sid, false);
            layoutGutter();
          }
        }
        return true;
      });
      const osc633 = term.parser.registerOscHandler(633, (data: string) => {
        if (data.startsWith("E;")) pending.current.command = data.slice(2);
        return true;
      });
      cleanups.push(() => osc133.dispose(), () => osc633.dispose());

      /* Keys: copy with a selection, paste through the browser, sticky Ctrl. */
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown") return true;
        const key = event.key.toLowerCase();
        const mod = event.ctrlKey || event.metaKey;
        if ((mod && key === "c" && term.hasSelection()) || (event.ctrlKey && event.shiftKey && key === "c")) {
          copySelection();
          event.preventDefault();
          return false;
        }
        if ((event.metaKey && key === "v") || (event.ctrlKey && key === "v")) return false;
        return true;
      });
      const typing = term.onData((data: string) => {
        if (ctrl.current && data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0);
          ctrl.current = false;
          callbacks.current.onCtrlArmed?.(false);
          if (code >= 64 && code <= 95) {
            connection.input(sid, String.fromCharCode(code - 64));
            return;
          }
        }
        connection.input(sid, data);
      });
      const resized = term.onResize(({ cols, rows }: { cols: number; rows: number }) => connection.resize(sid, cols, rows));
      const scrolled = term.onScroll(() => {
        const buffer = term.buffer.active;
        const up = buffer.viewportY < buffer.baseY;
        setScrolledUp(up);
        if (!up) setUnread(false);
        layoutGutter();
      });
      const written = term.onWriteParsed(() => {
        const buffer = term.buffer.active;
        if (buffer.viewportY < buffer.baseY) setUnread(true);
      });
      const rendered = term.onRender(() => layoutGutter());
      cleanups.push(() => typing.dispose(), () => resized.dispose(), () => scrolled.dispose(), () => written.dispose(), () => rendered.dispose());

      /* Pasting more than five lines asks first. */
      const onPaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text") ?? "";
        const lines = text.replace(/\r?\n$/, "").split(/\r?\n/).length;
        if (lines > 5) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setPasteAsk({ text, lines });
        }
      };
      term.element?.addEventListener("paste", onPaste, true);
      cleanups.push(() => term.element?.removeEventListener("paste", onPaste, true));

      const onFocusIn = () => {
        setFocused(true);
        callbacks.current.onFocus();
      };
      const onFocusOut = () => setFocused(false);
      term.textarea?.addEventListener("focus", onFocusIn);
      term.textarea?.addEventListener("blur", onFocusOut);

      cleanups.push(connection.onOutput(sid, (bytes) => term.write(bytes)));
      cleanups.push(
        connection.onExit(sid, (code) => {
          setExited(code);
          callbacks.current.onRunning(sid, false);
        }),
      );

      fitNow();
      connection.openShell(sid, term.cols, term.rows);
    })();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
    // One terminal per mount; options below follow their props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Fit to the box — but on a phone never narrower than 80 columns: the
     terminal scrolls sideways rather than cutting output off. */
  function fitNow() {
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host || !visible) return;
    host.style.width = "100%";
    const dims = fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    const narrow = window.innerWidth < 640;
    const cols = narrow ? Math.max(80, dims.cols) : dims.cols;
    if (cols !== term.cols || dims.rows !== term.rows) term.resize(cols, dims.rows);
    if (cols > dims.cols) {
      const cell = host.clientWidth / Math.max(1, dims.cols);
      host.style.width = `${Math.ceil(cols * cell) + 4}px`;
    }
    layoutGutter();
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitNow);
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = TERMINAL_THEMES[theme];
  }, [theme]);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    requestAnimationFrame(fitNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize]);
  useEffect(() => {
    if (termRef.current) termRef.current.options.scrollback = scrollback;
  }, [scrollback]);
  useEffect(() => {
    if (termRef.current) termRef.current.options.screenReaderMode = screenReader;
  }, [screenReader]);
  useEffect(() => {
    if (visible) requestAnimationFrame(fitNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* Touch: pinch for the font size, a long press for the menu. */
  const touch = useRef<{ distance: number; size: number; timer: number; x: number; y: number } | null>(null);
  function onTouchStart(event: React.TouchEvent) {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      touch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), size: fontSize, timer: 0, x: 0, y: 0 };
    } else if (event.touches.length === 1) {
      const t = event.touches[0];
      const timer = window.setTimeout(() => setMenu({ x: t.clientX, y: t.clientY }), 550);
      touch.current = { distance: 0, size: fontSize, timer, x: t.clientX, y: t.clientY };
    }
  }
  function onTouchMove(event: React.TouchEvent) {
    const start = touch.current;
    if (!start) return;
    if (event.touches.length === 2 && start.distance) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const ratio = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / start.distance;
      props.onFontSize(Math.round(Math.max(9, Math.min(28, start.size * ratio))));
    } else if (event.touches.length === 1 && Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 10) {
      window.clearTimeout(start.timer);
    }
  }
  function onTouchEnd() {
    if (touch.current) window.clearTimeout(touch.current.timer);
    touch.current = null;
  }

  function rerun(block: Block) {
    if (!block.command) return;
    connection.input(sid, `${block.command}\r`);
    termRef.current?.focus();
  }

  function restartShell() {
    setExited(null);
    termRef.current?.reset();
    blocksRef.current = [];
    setGutter([]);
    const term = termRef.current;
    connection.openShell(sid, term?.cols ?? 80, term?.rows ?? 24);
  }

  const label = (block: Block) => {
    if (block.code === null) return "Running";
    if (block.code === 137) return "Memory limit reached. Process stopped";
    const time = block.ms !== null && block.ms >= 2000 ? ` · ${(block.ms / 1000).toFixed(1)}s` : "";
    return block.code === 0 ? `Succeeded${time}` : `exit ${block.code}${time}`;
  };

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full overflow-x-auto overflow-y-hidden ${focused ? "" : "[&_.xterm-cursor]:opacity-60"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* The command gutter: one mark per command, beside its prompt line. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[18px]" aria-hidden={gutter.length === 0}>
        {gutter.map(({ block, top }) => {
          const failed = block.code !== null && block.code !== 0;
          return (
            <div key={block.id} className="group pointer-events-auto absolute left-0 flex items-center" style={{ top, height: rowHeight }}>
              <button
                aria-label={`${block.command || "Command"}: ${label(block)}`}
                title={label(block)}
                className="ml-[5px] flex h-3 w-3 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vs-accent)]"
              >
                {block.code === null ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--vs-muted)] motion-reduce:animate-none" />
                ) : failed ? (
                  <span className="h-2 w-2 rounded-full bg-[#f14c4c]" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#3fb950] opacity-70" />
                )}
              </button>
              <div className="invisible absolute left-[18px] top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-[6px] border border-[var(--vs-border)] bg-[var(--vs-side)] px-1 py-0.5 text-[11.5px] text-[var(--vs-text)] shadow-[0_2px_10px_rgba(0,0,0,0.2)] group-focus-within:visible group-hover:visible">
                <span className={`px-1 ${failed ? "text-[#f14c4c]" : "text-[var(--vs-muted)]"}`}>{label(block)}</span>
                <button onClick={() => void copyText(block.command, "command")} title="Copy command" aria-label="Copy command" className="rounded p-1 hover:bg-[var(--vs-hover)]">
                  <Copy className="h-3 w-3" />
                </button>
                <button onClick={() => void copyText(outputOf(block), "output")} title="Copy output" aria-label="Copy output" className="rounded p-1 hover:bg-[var(--vs-hover)]">
                  <Copy className="h-3 w-3 opacity-70" />
                </button>
                <button onClick={() => rerun(block)} title="Rerun" aria-label="Rerun command" className="rounded p-1 hover:bg-[var(--vs-hover)]">
                  <RotateCw className="h-3 w-3" />
                </button>
                {failed ? (
                  <button
                    onClick={() =>
                      props.onAskAI(
                        `This command failed in the terminal (exit ${block.code}). Explain why and fix the project so it works — don't run anything.\n\n$ ${block.command}\n\n${outputOf(block).slice(-4000)}`,
                      )
                    }
                    title="Ask AI to fix"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--vs-accent)] hover:bg-[var(--vs-hover)]"
                  >
                    <Bot className="h-3 w-3" />
                    Ask AI to fix
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={hostRef} className="h-full pl-[18px]" />

      {scrolledUp ? (
        <button
          onClick={() => {
            termRef.current?.scrollToBottom();
            setUnread(false);
          }}
          className="absolute bottom-3 right-5 z-20 flex items-center gap-1.5 rounded-full border border-[var(--vs-border)] bg-[var(--vs-side)] px-3 py-1 text-[12px] text-[var(--vs-text)] shadow-[0_2px_10px_rgba(0,0,0,0.2)] transition-opacity duration-150"
        >
          {unread ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--vs-accent)]" /> : null}↓ Jump to bottom
        </button>
      ) : null}

      {copied ? (
        <span className="absolute right-5 top-2 z-20 flex items-center gap-1 rounded-md bg-[var(--vs-side)] px-2 py-0.5 text-[11.5px] text-[var(--vs-muted)]">
          <Check className="h-3 w-3" /> Copied {copied}
        </span>
      ) : null}

      {exited !== null ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-[var(--vs-border)] bg-[var(--vs-side)] px-3 py-1.5 text-[12px]">
          <span className="text-[var(--vs-muted)]">The shell exited{exited ? ` (code ${exited})` : ""}.</span>
          <button onClick={restartShell} className="rounded bg-[var(--vs-accent)] px-2 py-0.5 text-white">
            Restart
          </button>
        </div>
      ) : null}

      {pasteAsk ? (
        <div role="alertdialog" aria-label={`Paste ${pasteAsk.lines} lines?`} className="absolute left-1/2 top-4 z-30 w-[min(360px,90%)] -translate-x-1/2 rounded-[8px] border border-[var(--vs-border)] bg-[var(--vs-side)] p-3 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
          <p className="font-medium text-[var(--vs-text)]">Paste {pasteAsk.lines} lines?</p>
          <p className="mt-1 text-[12px] text-[var(--vs-muted)]">Each line may run as a command.</p>
          <pre className="mt-2 max-h-24 overflow-auto rounded bg-[var(--vs-editor)] p-2 text-[11.5px] text-[var(--vs-muted)]">{pasteAsk.text.slice(0, 600)}</pre>
          <div className="mt-3 flex justify-end gap-2">
            <button autoFocus onClick={() => setPasteAsk(null)} className="rounded border border-[var(--vs-border)] px-3 py-1 text-[12.5px]">
              Cancel
            </button>
            <button
              onClick={() => {
                const text = pasteAsk.text;
                setPasteAsk(null);
                void paste(text);
              }}
              className="rounded bg-[var(--vs-accent)] px-3 py-1 text-[12.5px] text-white"
            >
              Paste
            </button>
          </div>
        </div>
      ) : null}

      {menu ? (
        <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} onTouchStart={() => setMenu(null)}>
          <div
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 160) }}
            className="absolute w-[170px] rounded-[6px] border border-[var(--vs-border)] bg-[var(--vs-side)] py-1 text-[13px] text-[var(--vs-text)] shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            {(
              [
                ["Copy", () => copySelection(), !termRef.current?.hasSelection()],
                ["Paste", () => void paste(), false],
                ["Select All", () => termRef.current?.selectAll(), false],
                ["Clear", () => termRef.current?.clear(), false],
              ] as [string, () => void, boolean][]
            ).map(([name, run, disabled]) => (
              <button
                key={name}
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setMenu(null);
                  run();
                }}
                className="block w-full px-3 py-1 text-left hover:bg-[var(--vs-select)] disabled:opacity-40"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export default TerminalView;
