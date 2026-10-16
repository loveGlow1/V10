"use client";

/* The code editor: the project's real source in a VS Code–style editor, in a
 * tab of its own.
 *
 * Monaco — the editor inside VS Code — is loaded from jsDelivr rather than
 * bundled: it is several megabytes that only this screen uses. Files come from
 * and go to /api/projects/[id]/files; a save is a new build on top of the one
 * this tab opened, so the preview shows it straight away, and every workspace
 * tab open on the same project is told to reload (BroadcastChannel) — that is
 * the "real time" half: edit here, watch it there. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  Loader2,
  Save,
  X,
} from "lucide-react";

export const CODE_CHANNEL = "quickstark-code";

const MONACO = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs";

type ProjectFile = { path: string; content: string };
type Loaded = { name: string; buildId: string | null; singlePage: boolean; files: ProjectFile[] };

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

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const modelsRef = useRef<Map<string, any>>(new Map());
  const baseRef = useRef<string | null>(null);

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
        /* Generated projects import packages this editor has no types for;
           red squiggles under every import would be noise, not help. Syntax is
           still checked. */
        for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
          defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
          defaults.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowJs: true, target: 99 });
        }
        editorRef.current = monaco.editor.create(hostRef.current, {
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          tabSize: 2,
        });
        setReady(true);
      })
      .catch((error: Error) => setEditorFailed(error.message));
    return () => {
      cancelled = true;
    };
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
        setDrafts((current) => {
          const next = new Map(current);
          next.set(active, value);
          return next;
        });
      });
      modelsRef.current.set(active, model);
    }
    if (editor.getModel() !== model) editor.setModel(model);
    editor.focus();
    // contentOf is read only when a model is first made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready]);

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

  /* Ctrl/Cmd+S, the way every editor saves. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

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

  function openFile(path: string) {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
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
    openFile(name);
  }

  const paths = useMemo(() => [...new Set([...saved.keys(), ...drafts.keys()])].sort(), [saved, drafts]);
  const tree = useMemo(() => treeOf(paths), [paths]);

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
              style={{ paddingLeft: 8 + depth * 12 }}
              className="flex h-[22px] w-full items-center gap-1 pr-2 text-left text-[13px] text-[#cccccc] hover:bg-white/[0.05]"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              {expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#dcb67a]" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-[#dcb67a]" />}
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
          style={{ paddingLeft: 22 + depth * 12 }}
          className={`flex h-[22px] w-full items-center gap-1.5 pr-2 text-left text-[13px] hover:bg-white/[0.05] ${
            active === node.path ? "bg-[#37373d] text-white" : "text-[#cccccc]"
          }`}
        >
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#519aba]" />
          <span className="truncate">{node.name}</span>
          {changed ? <Circle className="ml-auto h-2 w-2 shrink-0 fill-current text-white/70" /> : null}
        </button>
      );
    });
  }

  if (loadError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#1e1e1e] px-6 text-center">
        <div>
          <p className="text-[14px] text-[#cccccc]">{loadError}</p>
          <button onClick={() => void load()} className="mt-4 rounded bg-[#0e639c] px-4 py-1.5 text-[13px] text-white hover:bg-[#1177bb]">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#1e1e1e] text-[#cccccc]">
      {/* Title bar */}
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-black/40 bg-[#323233] px-3 text-[12.5px]">
        <span className="font-semibold text-white">{loaded?.name ?? "Loading…"}</span>
        <span className="text-white/40">Code</span>
        <span className="ml-auto flex items-center gap-2">
          {notice ? (
            <span className={notice.tone === "ok" ? "text-emerald-300" : "text-red-300"}>{notice.text}</span>
          ) : dirty.length > 0 ? (
            <span className="text-white/60">
              {dirty.length} unsaved {dirty.length === 1 ? "change" : "changes"}
            </span>
          ) : loaded ? (
            <span className="text-white/40">All changes saved</span>
          ) : null}
          <button
            onClick={() => void save()}
            disabled={saving || dirty.length === 0}
            title="Save (Ctrl+S)"
            className="flex h-6 items-center gap-1.5 rounded bg-[#0e639c] px-2.5 text-[12px] text-white transition-colors hover:bg-[#1177bb] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Explorer */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-black/40 bg-[#252526]">
          <div className="flex h-8 shrink-0 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-white/60">
            Explorer
            {loaded && !loaded.singlePage ? (
              <button onClick={newFile} title="New file" aria-label="New file" className="rounded p-0.5 hover:bg-white/[0.08]">
                <FilePlus2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {loaded ? renderNodes(tree, 0) : <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-white/40" />}
          </div>
        </aside>

        {/* Tabs and editor */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto bg-[#252526]">
            {tabs.map((path) => {
              const changed = dirty.includes(path);
              return (
                <div
                  key={path}
                  className={`group flex shrink-0 items-center gap-1.5 border-r border-black/40 px-3 text-[13px] ${
                    active === path ? "bg-[#1e1e1e] text-white" : "bg-[#2d2d2d] text-white/60"
                  }`}
                >
                  <button onClick={() => setActive(path)} title={path} className="flex items-center gap-1.5">
                    <FileCode2 className="h-3.5 w-3.5 text-[#519aba]" />
                    {path.split("/").pop()}
                  </button>
                  <button onClick={() => closeTab(path)} aria-label={`Close ${path}`} className="rounded p-0.5 hover:bg-white/[0.1]">
                    {changed ? <Circle className="h-2 w-2 fill-current group-hover:hidden" /> : null}
                    <X className={`h-3.5 w-3.5 ${changed ? "hidden group-hover:block" : ""}`} />
                  </button>
                </div>
              );
            })}
          </div>
          {active ? (
            <div className="shrink-0 border-b border-black/30 px-4 py-1 text-[12px] text-white/50">{active.split("/").join(" › ")}</div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            <div ref={hostRef} className="absolute inset-0" />
            {editorFailed ? (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-red-300">
                {editorFailed} Check your connection and reload this tab.
              </p>
            ) : !active && loaded ? (
              <p className="absolute inset-0 flex items-center justify-center text-[13px] text-white/40">Open a file from the explorer.</p>
            ) : null}
          </div>
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-6 shrink-0 items-center gap-3 bg-[#007acc] px-3 text-[12px] text-white">
        <span>{loaded?.singlePage ? "Single page" : `${paths.length} files`}</span>
        <span className="ml-auto">Saving builds a new version — no credits used.</span>
      </footer>
    </div>
  );
}
