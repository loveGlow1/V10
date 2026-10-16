"use client";

/* The code editor's terminal: a real shell, running Node.js inside this tab.
 *
 * WebContainers (StackBlitz's WebContainer API) run Node in the browser, so
 * `npm install`, `npm run dev` and every other command work without a server
 * anywhere — the person's own browser does the work. The project's files are
 * mounted when it starts and kept in step with the editor (writeFile), and a
 * server started inside it reports an address the editor can open.
 *
 * It needs the page to be cross-origin isolated, which the /code route is (see
 * next.config.mjs), and a browser that supports it (Chromium-based ones fully;
 * Firefox and Safari in part). Where it cannot start, it says so and the
 * editor carries on without it.
 *
 * Licensing: free for prototypes and open source; a commercial product needs
 * a StackBlitz licence. With NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID set, the
 * licensed client is initialised before booting. */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type TerminalHandle = {
  /** Keep the container's copy of a file in step with the editor. */
  writeFile: (path: string, content: string) => void;
  /** Type a command into the shell and press Enter. */
  run: (command: string) => void;
  clear: () => void;
};

type Props = {
  files: { path: string; content: string }[];
  theme: "light" | "dark";
  /** A server inside the container is listening. */
  onServerReady?: (port: number, url: string) => void;
  /** A port closed. */
  onPortClosed?: (port: number) => void;
};

/* One container per page — the API allows no more — shared by every mount. */
let booting: Promise<any> | null = null;
function bootContainer(): Promise<any> {
  if (booting) return booting;
  booting = (async () => {
    const api = await import("@webcontainer/api");
    const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID;
    if (clientId) api.auth.init({ clientId, scope: "" });
    return api.WebContainer.boot({ coep: "require-corp", workdirName: "project" });
  })();
  booting.catch(() => {
    booting = null;
  });
  return booting;
}

/* The flat file list as the nested tree mount() takes. */
function treeOf(files: { path: string; content: string }[]) {
  const root: Record<string, any> = {};
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) node[part] = { file: { contents: file.content } };
      else {
        node[part] = node[part] ?? { directory: {} };
        node = node[part].directory;
      }
    });
  }
  return root;
}

const THEMES = {
  dark: { background: "#181818", foreground: "#cccccc", cursor: "#cccccc", selectionBackground: "#264f78" },
  light: { background: "#f8f8f8", foreground: "#3b3b3b", cursor: "#3b3b3b", selectionBackground: "#add6ff" },
};

const CodeTerminal = forwardRef<TerminalHandle, Props>(function CodeTerminal({ files, theme, onServerReady, onPortClosed }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const containerRef = useRef<any>(null);
  const inputRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const pending = useRef<Map<string, string>>(new Map());
  /* Commands asked for before the shell was up, typed in when it is. */
  const queued = useRef<string[]>([]);
  const [state, setState] = useState<"starting" | "ready" | "unsupported" | "failed">("starting");
  const [reason, setReason] = useState("");

  /* Written now when the container is up, otherwise when it is. */
  const write = (path: string, content: string) => {
    const container = containerRef.current;
    if (!container) {
      pending.current.set(path, content);
      return;
    }
    const dir = path.split("/").slice(0, -1).join("/");
    void (async () => {
      try {
        if (dir) await container.fs.mkdir(dir, { recursive: true });
        await container.fs.writeFile(path, content);
      } catch {
        /* A file the container cannot take is not worth interrupting anyone for. */
      }
    })();
  };

  useImperativeHandle(ref, () => ({
    writeFile: write,
    run: (command: string) => {
      if (inputRef.current) void inputRef.current.write(`${command}\n`);
      else queued.current.push(command);
      termRef.current?.focus();
    },
    clear: () => termRef.current?.clear(),
  }));

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.25,
        theme: THEMES[theme],
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;
      cleanups.push(() => term.dispose());

      if (!window.crossOriginIsolated) {
        setState("unsupported");
        setReason("This page isn't cross-origin isolated, so the terminal can't start here.");
        term.writeln("\x1b[33mThe terminal needs a browser that supports WebContainers (Chrome, Edge or Brave work best).\x1b[0m");
        return;
      }

      term.writeln("\x1b[2mStarting Node.js in this tab…\x1b[0m");
      let container: any;
      try {
        /* Booting fetches the engine from stackblitz.com. A network, firewall
           or extension that blocks it would otherwise leave this on
           "Starting…" for ever, so it gives up after a while and says why. */
        container = await Promise.race([
          bootContainer(),
          new Promise((_, reject) =>
            window.setTimeout(
              () => reject(new Error("it took too long to start. Something may be blocking stackblitz.com (a firewall, VPN or ad blocker); allow it and reload this tab")),
              45_000,
            ),
          ),
        ]);
        await container.mount(treeOf(files));
      } catch (error) {
        if (disposed) return;
        setState("failed");
        setReason(error instanceof Error ? error.message : String(error));
        term.writeln(`\x1b[31mThe terminal could not start: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
        return;
      }
      if (disposed) return;
      containerRef.current = container;
      for (const [path, content] of pending.current) write(path, content);
      pending.current.clear();

      cleanups.push(container.on("server-ready", (port: number, url: string) => onServerReady?.(port, url)));
      cleanups.push(container.on("port", (port: number, type: string) => {
        if (type === "close") onPortClosed?.(port);
      }));

      const shell = await container.spawn("jsh", { terminal: { cols: term.cols, rows: term.rows } });
      void shell.output.pipeTo(
        new WritableStream({
          write(data: string) {
            term.write(data);
          },
        }),
      );
      const input = shell.input.getWriter();
      inputRef.current = input;
      const typing = term.onData((data: string) => void input.write(data));
      cleanups.push(() => typing.dispose());
      setState("ready");
      for (const command of queued.current.splice(0)) void input.write(`${command}\n`);

      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
          shell.resize({ cols: term.cols, rows: term.rows });
        } catch {
          /* Hidden panels have no size; the next resize fits them. */
        }
      });
      observer.observe(hostRef.current!);
      cleanups.push(() => observer.disconnect());
    })();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
    // Booted once per mount; files after that arrive through writeFile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme];
  }, [theme]);

  return (
    <div className="relative h-full w-full">
      {/* Why it could not start is written in the terminal itself; the
          attribute says it for anything reading the page. */}
      <div ref={hostRef} className="absolute inset-0 px-3 pt-1" data-terminal-state={state} title={reason || undefined} />
    </div>
  );
});

export default CodeTerminal;
