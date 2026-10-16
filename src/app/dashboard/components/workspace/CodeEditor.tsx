"use client";

/* The code editor: the project's real source in the VS Code workbench, in a
 * tab of its own.
 *
 * Laid out the way VS Code is — activity bar, side bar (Explorer, Search,
 * Source Control), tabs with breadcrumbs, the editor, the status bar — in VS
 * Code's own Light Modern and Dark Modern colours. The editor itself is Monaco,
 * which is the editor inside VS Code, loaded from jsDelivr rather than bundled:
 * it is several megabytes that only this screen uses.
 *
 * Files come from and go to /api/projects/[id]/files; a save is a new build on
 * top of the one this tab opened, so the preview shows it straight away, and
 * every workspace tab open on the same project is told to reload
 * (BroadcastChannel) — edit here, watch it there.
 *
 * The panel underneath has VS Code's Problems, Terminal and Ports: the
 * terminal is a real shell running Node.js in this tab (see CodeTerminal), so
 * npm install and npm run dev work, and a server started there shows up under
 * Ports. The command palette (Ctrl+Shift+P / F1), Go to File (Ctrl+P) and the
 * usual shortcuts work as they do there.
 *
 * Nothing in the chrome is decoration: every icon here does what it does in VS
 * Code, and what VS Code has that this does not (extensions, git history) is
 * left out rather than drawn as a button that does nothing. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FilePlus2,
  Files,
  GitBranch,
  Loader2,
  Moon,
  PanelBottom,
  PanelLeft,
  Play,
  Radio,
  Search,
  Sun,
  TerminalSquare,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import CodeTerminal, { type TerminalHandle } from "./CodeTerminal";
import CommandPalette, { type PaletteItem } from "./CommandPalette";

export const CODE_CHANNEL = "quickstark-code";

const MONACO = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs";

/* The editor font VS Code uses on each platform. */
const EDITOR_FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace";

type ProjectFile = { path: string; content: string };
type Loaded = { name: string; buildId: string | null; singlePage: boolean; files: ProjectFile[] };
type Theme = "light" | "dark";
type View = "explorer" | "search" | "scm";

const THEME_KEY = "qs-code-theme";

/* VS Code's Light Modern and Dark Modern workbench colours, as variables so
   the chrome below is written once. */
const THEMES: Record<Theme, React.CSSProperties> = {
  light: {
    ["--vs-bar" as string]: "#f8f8f8",
    ["--vs-side" as string]: "#f8f8f8",
    ["--vs-editor" as string]: "#ffffff",
    ["--vs-border" as string]: "#e5e5e5",
    ["--vs-text" as string]: "#3b3b3b",
    ["--vs-muted" as string]: "#616161",
    ["--vs-faint" as string]: "#8b8b8b",
    ["--vs-hover" as string]: "#f2f2f2",
    ["--vs-select" as string]: "#e4e6f1",
    ["--vs-input" as string]: "#ffffff",
    ["--vs-tab" as string]: "#f8f8f8",
    ["--vs-accent" as string]: "#005fb8",
    ["--vs-accent-hover" as string]: "#0258a8",
    ["--vs-badge" as string]: "#005fb8",
    ["--vs-modified" as string]: "#895503",
    ["--vs-folder" as string]: "#c09553",
  },
  dark: {
    ["--vs-bar" as string]: "#181818",
    ["--vs-side" as string]: "#181818",
    ["--vs-editor" as string]: "#1f1f1f",
    ["--vs-border" as string]: "#2b2b2b",
    ["--vs-text" as string]: "#cccccc",
    ["--vs-muted" as string]: "#9d9d9d",
    ["--vs-faint" as string]: "#6e6e6e",
    ["--vs-hover" as string]: "#2a2d2e",
    ["--vs-select" as string]: "#37373d",
    ["--vs-input" as string]: "#313131",
    ["--vs-tab" as string]: "#181818",
    ["--vs-accent" as string]: "#0078d4",
    ["--vs-accent-hover" as string]: "#026ec1",
    ["--vs-badge" as string]: "#0078d4",
    ["--vs-modified" as string]: "#e2c08d",
    ["--vs-folder" as string]: "#dcb67a",
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let monacoPromise: Promise<any> | null = null;

/* One Monaco per page, however many times the component mounts. */
function loadMonaco(): Promise<any> {
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.monaco) return resolve(w.monaco);
    const script = document.createElement("script");
    script.src = `${MONACO}/loader.js`;
    script.onload = () => {
      w.require.config({ paths: { vs: MONACO } });
      /* Workers from the CDN, through a same-origin blob — a worker cannot be
         started straight from another origin. */
      w.MonacoEnvironment = {
        getWorkerUrl: () =>
          URL.createObjectURL(
            new Blob(
              [`self.MonacoEnvironment={baseUrl:'${MONACO.replace(/\/vs$/, "/")}'};importScripts('${MONACO}/base/worker/workerMain.js');`],
              { type: "text/javascript" },
            ),
          ),
      };
      w.require(["vs/editor/editor.main"], () => resolve(w.monaco), reject);
    };
    script.onerror = () => reject(new Error("The editor could not be loaded."));
    document.head.appendChild(script);
  });
  return monacoPromise;
}

/* Monaco's own themes, with the Modern editor backgrounds. */
function defineThemes(monaco: any) {
  monaco.editor.defineTheme("qs-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f5f5f5",
      "editorLineNumber.foreground": "#6e7681",
      "editorLineNumber.activeForeground": "#171184",
    },
  });
  monaco.editor.defineTheme("qs-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1f1f1f",
      "editor.lineHighlightBackground": "#2a2a2a",
      "editorLineNumber.foreground": "#6e7681",
      "editorLineNumber.activeForeground": "#cccccc",
    },
  });
}

/* The explorer's folders, built from the flat list of paths. */
type Node = { name: string; path: string; children: Node[]; file: boolean };
function treeOf(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", children: [], file: false };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const at = parts.slice(0, index + 1).join("/");
      let next = node.children.find((child) => child.name === part);
      if (!next) {
        next = { name: part, path: at, children: [], file: index === parts.length - 1 };
        node.children.push(next);
      }
      node = next;
    });
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => (a.file === b.file ? a.name.localeCompare(b.name) : a.file ? 1 : -1));
    nodes.forEach((child) => sort(child.children));
  };
  sort(root.children);
  return root.children;
}

/* The file-type marks VS Code's default icon theme draws, as small glyphs. */
function fileMark(path: string): { glyph: string; color: string } {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (name.startsWith(".git")) return { glyph: "◆", color: "#e44d26" };
  if (name.startsWith(".env")) return { glyph: "⚙", color: "#8b8b8b" };
  switch (ext) {
    case "tsx":
    case "jsx":
      return { glyph: "⚛", color: "#1f9cf0" };
    case "ts":
      return { glyph: "TS", color: "#3178c6" };
    case "js":
    case "mjs":
    case "cjs":
      return { glyph: "JS", color: "#cbcb41" };
    case "json":
      return { glyph: "{}", color: "#cbcb41" };
    case "css":
    case "scss":
      return { glyph: "#", color: "#42a5f5" };
    case "html":
      return { glyph: "<>", color: "#e37933" };
    case "md":
    case "mdx":
      return { glyph: "ⓘ", color: "#519aba" };
    case "sql":
      return { glyph: "≡", color: "#f55385" };
    case "svg":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
      return { glyph: "▣", color: "#a074c4" };
    default:
      return { glyph: "≡", color: "#8b8b8b" };
  }
}

/* What the status bar calls the active file's language. */
function languageOf(path: string | null): string {
  if (!path) return "";
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    {
      tsx: "TypeScript JSX",
      ts: "TypeScript",
      jsx: "JavaScript JSX",
      js: "JavaScript",
      mjs: "JavaScript",
      json: "JSON",
      css: "CSS",
      scss: "SCSS",
      html: "HTML",
      md: "Markdown",
      sql: "SQL",
      svg: "XML",
    } as Record<string, string>
  )[ext ?? ""] ?? "Plain Text";
}

function FileMark({ path }: { path: string }) {
  const mark = fileMark(path);
  return (
    <span
      aria-hidden
      style={{ color: mark.color }}
      className="flex w-4 shrink-0 justify-center font-mono text-[10px] font-bold leading-none"
    >
      {mark.glyph}
    </span>
  );
}

export default function CodeEditor({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Map<string, string>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editorFailed, setEditorFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /* The workbench around the editor. */
  const [theme, setTheme] = useState<Theme>("dark");
  const [view, setView] = useState<View>("explorer");
  const [sideOpen, setSideOpen] = useState(true);
  const [rootOpen, setRootOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<{ line: number; column: number }>({ line: 1, column: 1 });
  const [problems, setProblems] = useState({ errors: 0, warnings: 0 });

  /* The panel under the editor, and what is in it. */
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"problems" | "terminal" | "ports">("terminal");
  const [panelHeight, setPanelHeight] = useState(260);
  /* The terminal boots the first time it is shown, then stays — closing the
     panel hides it rather than ending the shell. */
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [ports, setPorts] = useState<{ port: number; url: string }[]>([]);
  const [allProblems, setAllProblems] = useState<{ path: string; line: number; message: string; error: boolean }[]>([]);
  const [palette, setPalette] = useState<"commands" | "files" | null>(null);
  const [minimap, setMinimap] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const terminalRef = useRef<TerminalHandle>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const modelsRef = useRef<Map<string, any>>(new Map());
  const baseRef = useRef<string | null>(null);
  /* A line to go to once the file it belongs to is on screen (a search hit). */
  const revealRef = useRef<number | null>(null);

  /* The theme somebody chose last, or the one their system is in. A phone
     starts with the side bar away, the way VS Code does at that width. */
  useEffect(() => {
    let chosen: Theme | null = null;
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") chosen = stored;
    } catch {
      /* No storage: follow the system. */
    }
    setTheme(chosen ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"));
    if (window.innerWidth < 768) setSideOpen(false);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Remembered for this visit only. */
    }
  }

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === "dark" ? "qs-dark" : "qs-light");
  }, [theme, ready]);

  /* ── Load the files ─────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
      if (!response.ok || !Array.isArray(body.files)) {
        setLoadError(body.error ?? "The code could not be opened.");
        return;
      }
      const data = body as Loaded;
      baseRef.current = data.buildId;
      setLoaded(data);
      setSaved(new Map(data.files.map((file) => [file.path, file.content])));
      setDrafts(new Map());
      for (const model of modelsRef.current.values()) model.dispose();
      modelsRef.current.clear();
      /* Open the file somebody most likely came for. */
      const first =
        data.files.find((file) => /^(?:src\/)?app\/page\.[jt]sx$/.test(file.path))?.path ??
        data.files.find((file) => file.path === "index.html")?.path ??
        data.files[0]?.path ??
        null;
      setTabs(first ? [first] : []);
      setActive(first);
      if (first) {
        const folders = new Set<string>();
        const parts = first.split("/");
        for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join("/"));
        setOpen(folders);
      }
    } catch {
      setLoadError("The code could not be opened. Check your connection and try again.");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Monaco ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!loaded || !hostRef.current || editorRef.current) return;
    let cancelled = false;
    loadMonaco()
      .then((monaco) => {
        if (cancelled || !hostRef.current) return;
        monacoRef.current = monaco;
        defineThemes(monaco);
        /* Generated projects import packages this editor has no types for;
           red squiggles under every import would be noise, not help. Syntax is
           still checked. */
        for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
          defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
          defaults.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowJs: true, target: 99 });
        }
        const editor = monaco.editor.create(hostRef.current, {
          theme: theme === "dark" ? "qs-dark" : "qs-light",
          automaticLayout: true,
          fontFamily: EDITOR_FONT,
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          tabSize: 2,
          renderLineHighlight: "all",
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          padding: { top: 6 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: "active", indentation: true },
        });
        editor.onDidChangeCursorPosition((event: any) =>
          setCursor({ line: event.position.lineNumber, column: event.position.column }),
        );
        editorRef.current = editor;
        setReady(true);
      })
      .catch((error: Error) => setEditorFailed(error.message));
    return () => {
      cancelled = true;
    };
    // The theme is applied by its own effect after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(
    () => () => {
      editorRef.current?.dispose();
      for (const model of modelsRef.current.values()) model.dispose();
    },
    [],
  );

  const contentOf = useCallback(
    (path: string) => drafts.get(path) ?? saved.get(path) ?? "",
    [drafts, saved],
  );

  /* The status bar's error and warning counts, for the file on screen. */
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !active) {
      setProblems({ errors: 0, warnings: 0 });
      return;
    }
    const count = () => {
      setAllProblems(
        monaco.editor
          .getModelMarkers({})
          .filter((m: any) => m.resource?.scheme === "file" && m.severity >= monaco.MarkerSeverity.Warning)
          .map((m: any) => ({
            path: String(m.resource.path).replace(/^\//, ""),
            line: m.startLineNumber,
            message: m.message,
            error: m.severity === monaco.MarkerSeverity.Error,
          })),
      );
      const model = modelsRef.current.get(active);
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      setProblems({
        errors: markers.filter((m: any) => m.severity === monaco.MarkerSeverity.Error).length,
        warnings: markers.filter((m: any) => m.severity === monaco.MarkerSeverity.Warning).length,
      });
    };
    count();
    const listener = monaco.editor.onDidChangeMarkers(count);
    return () => listener.dispose();
  }, [active, ready]);

  /* Show the active file, one model per file so each keeps its own undo. */
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor || !active) return;
    let model = modelsRef.current.get(active);
    if (!model) {
      model = monaco.editor.createModel(contentOf(active), undefined, monaco.Uri.parse(`file:///${active}`));
      model.onDidChangeContent(() => {
        const value = model.getValue();
        /* The terminal's copy follows every keystroke, so a dev server
           running there reloads as you type. */
        terminalRef.current?.writeFile(active, value);
        setDrafts((current) => {
          const next = new Map(current);
          next.set(active, value);
          return next;
        });
      });
      modelsRef.current.set(active, model);
    }
    if (editor.getModel() !== model) editor.setModel(model);
    const line = revealRef.current;
    if (line) {
      revealRef.current = null;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
    const position = editor.getPosition();
    if (position) setCursor({ line: position.lineNumber, column: position.column });
    editor.focus();
    // contentOf is read only when a model is first made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready]);

  useEffect(() => {
    editorRef.current?.updateOptions({ minimap: { enabled: minimap }, wordWrap: wordWrap ? "on" : "off", fontSize, lineHeight: Math.round(fontSize * 1.55) });
  }, [minimap, wordWrap, fontSize, ready]);

  const dirty = useMemo(
    () => [...drafts.entries()].filter(([path, value]) => saved.get(path) !== value).map(([path]) => path),
    [drafts, saved],
  );

  /* ── Save ───────────────────────────────────────────────────────────── */
  const save = useCallback(async () => {
    if (saving || dirty.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseBuildId: baseRef.current,
          files: dirty.map((path) => ({ path, content: contentOf(path) })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { buildId?: string; error?: string };
      if (!response.ok || !body.buildId) {
        setNotice({ tone: "error", text: body.error ?? "The code could not be saved." });
        return;
      }
      baseRef.current = body.buildId;
      setSaved((current) => {
        const next = new Map(current);
        for (const path of dirty) next.set(path, contentOf(path));
        return next;
      });
      setNotice({ tone: "ok", text: `Saved ${dirty.length === 1 ? dirty[0] : `${dirty.length} files`}. The preview is updating.` });
      try {
        const channel = new BroadcastChannel(CODE_CHANNEL);
        channel.postMessage({ projectId, buildId: body.buildId });
        channel.close();
      } catch {
        /* No BroadcastChannel: the workspace picks it up on its next refresh. */
      }
    } catch {
      setNotice({ tone: "error", text: "The code could not be saved. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }, [saving, dirty, projectId, contentOf]);

  /* VS Code's shortcuts. Captured before Monaco sees them, so the editor's
     own F1 palette gives way to this one. */
  const keymap = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keymap.current = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const hit = (fn: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
    };
    if (mod && !event.shiftKey && key === "s") return hit(() => void save());
    if (event.key === "F1" || (mod && event.shiftKey && key === "p")) return hit(() => setPalette("commands"));
    if (mod && !event.shiftKey && key === "p") return hit(() => setPalette("files"));
    if (mod && event.code === "Backquote") return hit(togglePanel);
    if (mod && !event.shiftKey && key === "b") return hit(() => setSideOpen((on) => !on));
    if (mod && event.shiftKey && key === "e") return hit(() => pick("explorer"));
    if (mod && event.shiftKey && key === "f") return hit(() => pick("search"));
    if (mod && event.shiftKey && key === "g") return hit(() => pick("scm"));
    if (mod && event.shiftKey && key === "m") return hit(() => showPanel("problems"));
    if (event.altKey && !mod && key === "z") return hit(() => setWordWrap((on) => !on));
    if (mod && (key === "=" || key === "+")) return hit(() => setFontSize((size) => Math.min(size + 1, 28)));
    if (mod && key === "-") return hit(() => setFontSize((size) => Math.max(size - 1, 9)));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keymap.current(event);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* Leaving with unsaved work asks first. */
  useEffect(() => {
    if (dirty.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.length]);

  /* A saved notice says its piece and goes, as VS Code's do. */
  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function openFile(path: string, line?: number) {
    if (line) revealRef.current = line;
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    if (active === path && line && editorRef.current) {
      revealRef.current = null;
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
      editorRef.current.focus();
    }
    setActive(path);
    if (window.innerWidth < 768) setSideOpen(false);
  }

  function closeTab(path: string) {
    setTabs((current) => {
      const next = current.filter((tab) => tab !== path);
      if (active === path) setActive(next[next.length - 1] ?? null);
      return next;
    });
  }

  function newFile() {
    if (!loaded || loaded.singlePage) return;
    const name = window.prompt("New file path, e.g. components/Banner.tsx")?.trim();
    if (!name) return;
    if (saved.has(name) || drafts.has(name)) {
      openFile(name);
      return;
    }
    setDrafts((current) => new Map(current).set(name, ""));
    setSaved((current) => new Map(current).set(name, "\u0000"));
    terminalRef.current?.writeFile(name, "");
    openFile(name);
  }

  /* ── Panel, terminal, palette ───────────────────────────────────────── */
  function showPanel(tab: "problems" | "terminal" | "ports") {
    setPanelTab(tab);
    setPanelOpen(true);
    if (tab === "terminal") setTerminalStarted(true);
  }

  function togglePanel() {
    if (panelOpen) setPanelOpen(false);
    else showPanel(panelTab);
  }

  /* What starts this project: its dev script, its start script, or a static
     server for a page with no package.json. */
  const runCommand = useMemo(() => {
    const pkg = contentOf("package.json");
    if (!pkg) return "npx --yes serve -l 3000 .";
    try {
      const scripts = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {};
      if (scripts.dev) return "npm install && npm run dev";
      if (scripts.start) return "npm install && npm start";
    } catch {
      /* Fall through. */
    }
    return "npm install";
  }, [contentOf]);

  /* Asked to run before the terminal has mounted: sent as soon as it has.
     The terminal itself holds it until its shell is up. */
  const [queuedRun, setQueuedRun] = useState<string | null>(null);
  function runProject() {
    showPanel("terminal");
    if (terminalRef.current) terminalRef.current.run(runCommand);
    else setQueuedRun(runCommand);
  }
  useEffect(() => {
    if (!queuedRun || !terminalRef.current) return;
    terminalRef.current.run(queuedRun);
    setQueuedRun(null);
  });

  function editorAction(id: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction(id)?.run();
  }

  /* Dragging the panel's top edge resizes it. */
  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;
    const move = (e: MouseEvent) => setPanelHeight(Math.max(120, Math.min(window.innerHeight - 160, startHeight + startY - e.clientY)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /* The activity bar: a second click on the open view puts the side bar
     away, as in VS Code. */
  function pick(next: View) {
    if (view === next && sideOpen) setSideOpen(false);
    else {
      setView(next);
      setSideOpen(true);
    }
  }

  const paths = useMemo(() => [...new Set([...saved.keys(), ...drafts.keys()])].sort(), [saved, drafts]);
  const tree = useMemo(() => treeOf(paths), [paths]);

  /* Search across every file, the way the Search view does: matching lines,
     grouped by file. */
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out: { path: string; hits: { line: number; text: string }[] }[] = [];
    for (const path of paths) {
      const lines = contentOf(path).split("\n");
      const hits: { line: number; text: string }[] = [];
      lines.forEach((text, index) => {
        if (hits.length < 50 && text.toLowerCase().includes(needle)) hits.push({ line: index + 1, text: text.trim().slice(0, 140) });
      });
      if (hits.length) out.push({ path, hits });
    }
    return out;
  }, [query, paths, contentOf]);

  const row = "flex h-[22px] w-full items-center gap-1.5 pr-2 text-left text-[13px] hover:bg-[var(--vs-hover)]";

  function renderNodes(nodes: Node[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      if (!node.file) {
        const expanded = open.has(node.path);
        return (
          <div key={node.path}>
            <button
              onClick={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(node.path)) next.delete(node.path);
                  else next.add(node.path);
                  return next;
                })
              }
              style={{ paddingLeft: 8 + depth * 8 }}
              className={row}
            >
              {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="truncate">{node.name}</span>
            </button>
            {expanded ? renderNodes(node.children, depth + 1) : null}
          </div>
        );
      }
      const changed = dirty.includes(node.path);
      return (
        <button
          key={node.path}
          onClick={() => openFile(node.path)}
          style={{ paddingLeft: 28 + depth * 8 }}
          className={`${row} ${active === node.path ? "bg-[var(--vs-select)]" : ""}`}
        >
          <FileMark path={node.path} />
          <span className={`truncate ${changed ? "text-[var(--vs-modified)]" : ""}`}>{node.name}</span>
          {changed ? <span className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--vs-modified)]">M</span> : null}
        </button>
      );
    });
  }

  const commands: PaletteItem[] = [
    { id: "save", label: "File: Save All", keys: "Ctrl+S", run: () => void save() },
    { id: "new", label: "File: New File…", run: newFile },
    { id: "goto", label: "Go to File…", keys: "Ctrl+P", run: () => setPalette("files") },
    { id: "run", label: "Run: Start the App", detail: runCommand, run: runProject },
    { id: "term", label: "View: Toggle Terminal", keys: "Ctrl+`", run: togglePanel },
    { id: "term-new", label: "Terminal: Focus Terminal", run: () => showPanel("terminal") },
    { id: "term-clear", label: "Terminal: Clear", run: () => terminalRef.current?.clear() },
    { id: "problems", label: "View: Show Problems", keys: "Ctrl+Shift+M", run: () => showPanel("problems") },
    { id: "ports", label: "View: Show Ports", run: () => showPanel("ports") },
    { id: "side", label: "View: Toggle Side Bar", keys: "Ctrl+B", run: () => setSideOpen((on) => !on) },
    { id: "explorer", label: "View: Show Explorer", keys: "Ctrl+Shift+E", run: () => pick("explorer") },
    { id: "search", label: "View: Show Search", keys: "Ctrl+Shift+F", run: () => pick("search") },
    { id: "scm", label: "View: Show Source Control", keys: "Ctrl+Shift+G", run: () => pick("scm") },
    { id: "minimap", label: "View: Toggle Minimap", run: () => setMinimap((on) => !on) },
    { id: "wrap", label: "View: Toggle Word Wrap", keys: "Alt+Z", run: () => setWordWrap((on) => !on) },
    { id: "zoom-in", label: "View: Zoom In", keys: "Ctrl+=", run: () => setFontSize((size) => Math.min(size + 1, 28)) },
    { id: "zoom-out", label: "View: Zoom Out", keys: "Ctrl+-", run: () => setFontSize((size) => Math.max(size - 1, 9)) },
    { id: "zoom-reset", label: "View: Reset Zoom", run: () => setFontSize(13) },
    { id: "theme", label: theme === "dark" ? "Preferences: Color Theme → Light Modern" : "Preferences: Color Theme → Dark Modern", run: toggleTheme },
    { id: "format", label: "Format Document", keys: "Shift+Alt+F", run: () => editorAction("editor.action.formatDocument") },
    { id: "find", label: "Find", keys: "Ctrl+F", run: () => editorAction("actions.find") },
    { id: "replace", label: "Replace", keys: "Ctrl+H", run: () => editorAction("editor.action.startFindReplaceAction") },
    { id: "line", label: "Go to Line…", keys: "Ctrl+G", run: () => editorAction("editor.action.gotoLine") },
    { id: "symbol", label: "Go to Symbol in Editor…", keys: "Ctrl+Shift+O", run: () => editorAction("editor.action.quickOutline") },
    { id: "comment", label: "Toggle Line Comment", keys: "Ctrl+/", run: () => editorAction("editor.action.commentLine") },
    { id: "fold", label: "Fold All", run: () => editorAction("editor.foldAll") },
    { id: "unfold", label: "Unfold All", run: () => editorAction("editor.unfoldAll") },
    { id: "multi", label: "Add Cursors to Line Ends", keys: "Shift+Alt+I", run: () => editorAction("editor.action.insertCursorAtEndOfEachLineSelected") },
    { id: "close", label: "View: Close Editor", run: () => active && closeTab(active) },
  ];
  const fileItems: PaletteItem[] = paths.map((path) => ({
    id: path,
    label: path.split("/").pop() ?? path,
    detail: path.split("/").slice(0, -1).join("/"),
    icon: <FileMark path={path} />,
    run: () => openFile(path),
  }));

  if (loadError) {
    return (
      <div style={THEMES[theme]} className="flex h-[100dvh] items-center justify-center bg-[var(--vs-editor)] px-6 text-center text-[var(--vs-text)]">
        <div>
          <p className="text-[14px]">{loadError}</p>
          <button
            onClick={() => void load()}
            className="mt-4 rounded-[2px] bg-[var(--vs-accent)] px-4 py-1.5 text-[13px] text-white hover:bg-[var(--vs-accent-hover)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const activityButton = (id: View, label: string, Icon: typeof Files, badge?: number) => {
    const on = sideOpen && view === id;
    return (
      <button
        key={id}
        onClick={() => pick(id)}
        aria-label={label}
        aria-pressed={on}
        title={label}
        className={`relative flex h-12 w-12 items-center justify-center transition-colors ${
          on ? "text-[var(--vs-text)]" : "text-[var(--vs-faint)] hover:text-[var(--vs-text)]"
        }`}
      >
        {on ? <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--vs-accent)]" /> : null}
        <Icon className="h-6 w-6" strokeWidth={1.5} />
        {badge ? (
          <span className="absolute bottom-2 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--vs-badge)] px-1 text-[9px] font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </button>
    );
  };

  const sideTitle = "flex h-[35px] shrink-0 items-center justify-between pl-5 pr-2 text-[11px] uppercase tracking-[0.04em] text-[var(--vs-muted)]";
  const iconButton = "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[var(--vs-muted)] hover:bg-[var(--vs-hover)]";
  const rootName = (loaded?.name ?? "project").toUpperCase();

  return (
    <div
      style={THEMES[theme]}
      className="flex h-[100dvh] flex-col bg-[var(--vs-editor)] text-[13px] text-[var(--vs-text)]"
    >
      {/* Title bar: the command centre in the middle, as VS Code draws it. */}
      <header className="relative flex h-[35px] shrink-0 items-center border-b border-[var(--vs-border)] bg-[var(--vs-bar)] px-2">
        <button onClick={() => setSideOpen((on) => !on)} aria-label="Toggle the side bar" title="Toggle the side bar" className={iconButton}>
          <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <button
            onClick={() => setPalette("files")}
            title="Go to File (Ctrl+P) · Commands (Ctrl+Shift+P)"
            className="pointer-events-auto flex h-[22px] w-[min(38vw,520px)] items-center justify-center gap-1.5 rounded-[6px] border border-[var(--vs-border)] bg-[var(--vs-input)] px-2 text-[12px] text-[var(--vs-muted)] hover:border-[var(--vs-faint)]"
          >
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{loaded?.name ?? "Loading…"}</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={runProject} title={`Run: ${runCommand}`} aria-label="Run the app" className={iconButton}>
            <Play className="h-4 w-4 text-[#3fb950]" strokeWidth={1.75} />
          </button>
          <button onClick={togglePanel} title="Toggle Panel (Ctrl+`)" aria-label="Toggle the panel" className={iconButton}>
            <PanelBottom className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || dirty.length === 0}
            title="Save (Ctrl+S)"
            className="flex h-[22px] items-center gap-1.5 rounded-[4px] bg-[var(--vs-accent)] px-2 text-[12px] text-white transition-colors hover:bg-[var(--vs-accent-hover)] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {dirty.length > 1 ? `Save ${dirty.length}` : "Save"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav className="flex w-12 shrink-0 flex-col items-center border-r border-[var(--vs-border)] bg-[var(--vs-bar)]">
          {activityButton("explorer", "Explorer", Files)}
          {activityButton("search", "Search", Search)}
          {activityButton("scm", "Source Control", GitBranch, dirty.length || undefined)}
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
            title={theme === "dark" ? "Light Modern" : "Dark Modern"}
            className="mb-1 mt-auto flex h-12 w-12 items-center justify-center text-[var(--vs-faint)] transition-colors hover:text-[var(--vs-text)]"
          >
            {theme === "dark" ? <Sun className="h-6 w-6" strokeWidth={1.5} /> : <Moon className="h-6 w-6" strokeWidth={1.5} />}
          </button>
        </nav>

        {/* Side bar */}
        {sideOpen ? (
          <aside className="absolute bottom-[22px] left-12 top-[35px] z-20 flex w-[min(300px,calc(100vw-48px))] shrink-0 flex-col border-r border-[var(--vs-border)] bg-[var(--vs-side)] md:static md:z-auto md:w-[260px]">
            {view === "explorer" ? (
              <>
                <div className={sideTitle}>
                  Explorer
                  {loaded && !loaded.singlePage ? (
                    <button onClick={newFile} title="New File…" aria-label="New file" className={iconButton}>
                      <FilePlus2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => setRootOpen((on) => !on)}
                  className="flex h-[22px] shrink-0 items-center gap-0.5 px-1 text-left text-[11px] font-bold tracking-[0.02em] hover:bg-[var(--vs-hover)]"
                >
                  {rootOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="truncate">{rootName}</span>
                </button>
                <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                  {!loaded ? (
                    <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-[var(--vs-faint)]" />
                  ) : rootOpen ? (
                    renderNodes(tree, 0)
                  ) : null}
                </div>
              </>
            ) : view === "search" ? (
              <>
                <div className={sideTitle}>Search</div>
                <div className="px-3 pb-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    className="h-[26px] w-full rounded-[4px] border border-[var(--vs-border)] bg-[var(--vs-input)] px-2 text-[13px] text-[var(--vs-text)] outline-none placeholder:text-[var(--vs-faint)] focus:border-[var(--vs-accent)]"
                  />
                  {query.trim().length >= 2 ? (
                    <p className="mt-2 text-[12px] text-[var(--vs-muted)]">
                      {results.length === 0
                        ? "No results found."
                        : `${results.reduce((n, r) => n + r.hits.length, 0)} results in ${results.length} ${results.length === 1 ? "file" : "files"}`}
                    </p>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                  {results.map((result) => (
                    <div key={result.path}>
                      <div className="flex h-[22px] items-center gap-1.5 px-3 text-[13px]">
                        <FileMark path={result.path} />
                        <span className="truncate">{result.path.split("/").pop()}</span>
                        <span className="truncate text-[11px] text-[var(--vs-faint)]">{result.path}</span>
                      </div>
                      {result.hits.map((hit) => (
                        <button
                          key={hit.line}
                          onClick={() => openFile(result.path, hit.line)}
                          className="block h-[22px] w-full truncate pl-9 pr-2 text-left text-[12.5px] text-[var(--vs-muted)] hover:bg-[var(--vs-hover)]"
                          title={`Line ${hit.line}`}
                        >
                          {hit.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className={sideTitle}>Source Control</div>
                <div className="px-3 pb-3">
                  <button
                    onClick={() => void save()}
                    disabled={saving || dirty.length === 0}
                    className="flex h-[26px] w-full items-center justify-center gap-1.5 rounded-[4px] bg-[var(--vs-accent)] text-[13px] text-white transition-colors hover:bg-[var(--vs-accent-hover)] disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save changes
                  </button>
                  <p className="mt-2 text-[12px] leading-snug text-[var(--vs-muted)]">
                    Saving makes a new version and updates the preview. No credits used.
                  </p>
                </div>
                <div className="flex h-[22px] items-center gap-0.5 px-1 text-[11px] font-bold tracking-[0.02em]">
                  <ChevronDown className="h-4 w-4" />
                  CHANGES
                  {dirty.length ? (
                    <span className="ml-auto mr-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--vs-badge)] px-1 text-[10px] font-semibold text-white">
                      {dirty.length}
                    </span>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                  {dirty.length === 0 ? (
                    <p className="px-5 py-1 text-[12px] text-[var(--vs-muted)]">No unsaved changes.</p>
                  ) : (
                    dirty.map((path) => (
                      <button key={path} onClick={() => openFile(path)} className={`${row} pl-5`}>
                        <FileMark path={path} />
                        <span className="truncate">{path.split("/").pop()}</span>
                        <span className="truncate text-[11px] text-[var(--vs-faint)]">{path.split("/").slice(0, -1).join("/")}</span>
                        <span className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--vs-modified)]">M</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </aside>
        ) : null}

        {/* Tabs, breadcrumbs and the editor */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[35px] shrink-0 items-stretch overflow-x-auto border-b border-[var(--vs-border)] bg-[var(--vs-tab)] [scrollbar-width:none]">
            {tabs.map((path) => {
              const changed = dirty.includes(path);
              const on = active === path;
              return (
                <div
                  key={path}
                  className={`group relative flex shrink-0 items-center gap-1.5 border-r border-[var(--vs-border)] pl-3 pr-1.5 text-[13px] ${
                    on ? "-mb-px bg-[var(--vs-editor)] text-[var(--vs-text)]" : "text-[var(--vs-muted)]"
                  }`}
                >
                  {on ? <span className="absolute inset-x-0 top-0 h-px bg-[var(--vs-accent)]" /> : null}
                  <button onClick={() => setActive(path)} title={path} className="flex items-center gap-1.5">
                    <FileMark path={path} />
                    <span className={changed ? "text-[var(--vs-modified)]" : ""}>{path.split("/").pop()}</span>
                  </button>
                  <button
                    onClick={() => closeTab(path)}
                    aria-label={`Close ${path}`}
                    className={`flex h-5 w-5 items-center justify-center rounded-[4px] hover:bg-[var(--vs-hover)] ${
                      on || changed ? "" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {changed ? <Circle className="h-2 w-2 fill-current group-hover:hidden" /> : null}
                    <X className={`h-3.5 w-3.5 ${changed ? "hidden group-hover:block" : ""}`} />
                  </button>
                </div>
              );
            })}
          </div>
          {active ? (
            <div className="flex h-[22px] shrink-0 items-center gap-1 overflow-hidden px-3 text-[12.5px] text-[var(--vs-muted)]">
              {active.split("/").map((part, index, parts) => (
                <React.Fragment key={index}>
                  {index === parts.length - 1 ? <FileMark path={active} /> : null}
                  <span className={index === parts.length - 1 ? "text-[var(--vs-text)]" : ""}>{part}</span>
                  {index < parts.length - 1 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}
                </React.Fragment>
              ))}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            <div ref={hostRef} className="absolute inset-0" />
            {editorFailed ? (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-red-500">
                {editorFailed} Check your connection and reload this tab.
              </p>
            ) : !active && loaded ? (
              <p className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--vs-faint)]">
                Open a file from the Explorer.
              </p>
            ) : null}
            {notice ? (
              <div
                role="status"
                className="absolute bottom-3 right-3 z-10 flex max-w-[360px] items-start gap-2 rounded-[6px] border border-[var(--vs-border)] bg-[var(--vs-side)] px-3 py-2.5 text-[13px] shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
              >
                {notice.tone === "ok" ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--vs-accent)]" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <span className="min-w-0 flex-1">{notice.text}</span>
                <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 text-[var(--vs-muted)] hover:text-[var(--vs-text)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          {/* The panel: Problems, Terminal, Ports. */}
          <section
            style={{ height: panelHeight }}
            className={`${panelOpen ? "flex" : "hidden"} shrink-0 flex-col border-t border-[var(--vs-border)] bg-[var(--vs-bar)]`}
          >
            <div onMouseDown={startResize} className="-mt-[3px] h-[5px] shrink-0 cursor-row-resize" aria-hidden />
            <div className="flex h-[30px] shrink-0 items-center gap-4 px-3 text-[11px] uppercase tracking-[0.04em]">
              {(
                [
                  ["problems", `Problems${allProblems.length ? ` ${allProblems.length}` : ""}`],
                  ["terminal", "Terminal"],
                  ["ports", `Ports${ports.length ? ` ${ports.length}` : ""}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => showPanel(id)}
                  className={`relative h-full ${panelTab === id ? "text-[var(--vs-text)]" : "text-[var(--vs-muted)] hover:text-[var(--vs-text)]"}`}
                >
                  {label}
                  {panelTab === id ? <span className="absolute inset-x-0 bottom-1 h-px bg-[var(--vs-accent)]" /> : null}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1 normal-case">
                {panelTab === "terminal" ? (
                  <>
                    <button onClick={runProject} title={`Run: ${runCommand}`} className={iconButton}>
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => terminalRef.current?.clear()} title="Clear Terminal" className={iconButton}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
                <button onClick={() => setPanelOpen(false)} title="Close Panel" aria-label="Close the panel" className={iconButton}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              <div className={`absolute inset-0 ${panelTab === "terminal" ? "" : "invisible"}`}>
                {terminalStarted && loaded ? (
                  <CodeTerminal
                    ref={terminalRef}
                    files={paths.map((path) => ({ path, content: contentOf(path) }))}
                    theme={theme}
                    onServerReady={(port, url) => {
                      setPorts((current) => [...current.filter((entry) => entry.port !== port), { port, url }]);
                      setNotice({ tone: "ok", text: `Your app is running on port ${port}. Open it from Ports.` });
                    }}
                    onPortClosed={(port) => setPorts((current) => current.filter((entry) => entry.port !== port))}
                  />
                ) : null}
              </div>
              {panelTab === "problems" ? (
                <div className="absolute inset-0 overflow-y-auto pb-2 text-[13px]">
                  {allProblems.length === 0 ? (
                    <p className="px-3 py-1 text-[var(--vs-muted)]">No problems have been detected in the workspace.</p>
                  ) : (
                    allProblems.map((problem, i) => (
                      <button
                        key={i}
                        onClick={() => openFile(problem.path, problem.line)}
                        className="flex h-[22px] w-full items-center gap-2 px-3 text-left hover:bg-[var(--vs-hover)]"
                      >
                        {problem.error ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                        <span className="truncate">{problem.message}</span>
                        <span className="shrink-0 text-[12px] text-[var(--vs-faint)]">
                          {problem.path} [Ln {problem.line}]
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              {panelTab === "ports" ? (
                <div className="absolute inset-0 overflow-y-auto px-3 py-1 text-[13px]">
                  {ports.length === 0 ? (
                    <p className="text-[var(--vs-muted)]">
                      No running servers. Press <Play className="inline h-3 w-3" /> Run (or type <code className="font-mono">{runCommand}</code> in the terminal) and the address appears here.
                    </p>
                  ) : (
                    ports.map((entry) => (
                      <div key={entry.port} className="flex h-[26px] items-center gap-3">
                        <Radio className="h-3.5 w-3.5 text-[#3fb950]" />
                        <span className="w-16 shrink-0 font-mono">{entry.port}</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--vs-muted)]">{entry.url}</span>
                        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[var(--vs-accent)] hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open in Browser
                        </a>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-[22px] shrink-0 items-center gap-3 border-t border-[var(--vs-border)] bg-[var(--vs-bar)] pl-2 pr-3 text-[12px] text-[var(--vs-muted)]">
        <span className="flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} />
          {dirty.length ? `${dirty.length} unsaved` : "saved"}
        </span>
        <span className="flex items-center gap-2" title="Problems in this file">
          <span className="flex items-center gap-0.5">
            <XCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
            {problems.errors}
          </span>
          <span className="flex items-center gap-0.5">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
            {problems.warnings}
          </span>
        </span>
        <button onClick={() => showPanel("terminal")} className="flex items-center gap-1 hover:text-[var(--vs-text)]" title="Terminal (Ctrl+`)">
          <TerminalSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          Terminal
        </button>
        {ports.length ? (
          <button onClick={() => showPanel("ports")} className="flex items-center gap-1 text-[#3fb950]" title="Running servers">
            <Radio className="h-3.5 w-3.5" strokeWidth={1.75} />
            {ports.map((entry) => entry.port).join(", ")}
          </button>
        ) : null}
        <span className="ml-auto hidden items-center gap-3 sm:flex">
          {active ? (
            <>
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span>LF</span>
              <span>{languageOf(active)}</span>
            </>
          ) : null}
          <span>{loaded?.singlePage ? "Single page" : `${paths.length} files`}</span>
        </span>
      </footer>

      <CommandPalette
        open={palette === "commands"}
        prefix=">"
        placeholder="Type a command"
        items={commands}
        onClose={() => setPalette(null)}
      />
      <CommandPalette
        open={palette === "files"}
        placeholder="Search files by name"
        items={fileItems}
        onClose={() => setPalette(null)}
      />
    </div>
  );
}
