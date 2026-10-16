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

/* Up to this long to boot; past it the panel says so and offers Retry rather
   than sitting on "Starting…". */
const BOOT_TIMEOUT_MS = 15_000;

function log(stage: string, detail?: unknown) {
  console.info(`[terminal] ${stage}`, detail ?? "");
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
  const [state, setState] = useState<"starting" | "ready" | "unsupported" | "failed" | "exited">("starting");
  const [reason, setReason] = useState("");
  /* Bumped by Retry / Restart: starts the shell (and, if need be, the boot)
     over without reloading the page. */
  const [attempt, setAttempt] = useState(0);

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
      if (inputRef.current) inputRef.current.write(`${command}\n`).catch((error) => log("input write failed", error));
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
      log("booting");
      let container: any;
      let timer = 0;
      try {
        /* Booting fetches the engine from stackblitz.com. A network, firewall
           or extension that blocks it would otherwise leave this on
           "Starting…" for ever, so it gives up after a while and says why. */
        container = await Promise.race([
          bootContainer(),
          new Promise((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("it took too long to start. Something may be blocking stackblitz.com (a firewall, VPN or ad blocker)")),
              BOOT_TIMEOUT_MS,
            );
          }),
        ]);
        window.clearTimeout(timer);
        log("booted");
        await container.mount(treeOf(files));
        log("mounted", `${files.length} files`);
      } catch (error) {
        window.clearTimeout(timer);
        if (disposed) return;
        log("boot failed", error);
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

      let shell: any;
      try {
        shell = await container.spawn("jsh", { terminal: { cols: term.cols, rows: term.rows } });
      } catch (error) {
        if (disposed) return;
        log("spawn failed", error);
        setState("failed");
        setReason(error instanceof Error ? error.message : String(error));
        term.writeln(`\x1b[31mThe shell could not start: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
        return;
      }
      if (disposed) {
        shell.kill();
        return;
      }
      log("shell spawned");
      cleanups.push(() => shell.kill());
      shell.output
        .pipeTo(
          new WritableStream({
            write(data: string) {
              term.write(data);
            },
          }),
        )
        .catch((error: unknown) => log("output stream ended", error));
      const input = shell.input.getWriter();
      inputRef.current = input;
      const send = (data: string) => input.write(data).catch((error: unknown) => log("input write failed", error));
      const typing = term.onData((data: string) => void send(data));
      cleanups.push(() => typing.dispose());
      cleanups.push(() => {
        inputRef.current = null;
      });
      /* A shell that ends would otherwise leave a prompt that takes nothing. */
      void shell.exit.then((code: number) => {
        if (disposed) return;
        log("shell exited", code);
        inputRef.current = null;
        typing.dispose();
        setState("exited");
        setReason(`The shell exited (code ${code}).`);
        term.writeln(`\r\n\x1b[33mThe shell exited (code ${code}). Press Restart to start a new one.\x1b[0m`);
      });
      /* Sized to the panel as it is now, not as it was when the spawn began. */
      try {
        fit.fit();
        shell.resize({ cols: term.cols, rows: term.rows });
      } catch {
        /* A hidden panel has no size; the observer below fits it when shown. */
      }
      setState("ready");
      term.focus();
      for (const command of queued.current.splice(0)) void send(`${command}\n`);

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
    // Booted once per mount (and per Retry); files after that arrive through writeFile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme];
  }, [theme]);

  return (
    <div className="relative h-full w-full">
      {/* Why it could not start is written in the terminal itself; the
          attribute says it for anything reading the page. */}
      <div ref={hostRef} className="absolute inset-0 px-3 pt-1" data-terminal-state={state} title={reason || undefined} />
      {state === "failed" || state === "exited" ? (
        <button
          type="button"
          onClick={() => {
            setState("starting");
            setReason("");
            setAttempt((n) => n + 1);
          }}
          className="absolute bottom-3 right-4 rounded border border-[#0078d4] bg-[#0078d4] px-3 py-1 text-[12px] text-white hover:bg-[#026ec1]"
        >
          {state === "exited" ? "Restart" : "Retry"}
        </button>
      ) : null}
    </div>
  );
});

export default CodeTerminal;
