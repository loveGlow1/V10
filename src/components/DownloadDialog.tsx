"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Download, FileCode2, FileArchive, Loader2, MonitorSmartphone, X } from "lucide-react";
import { strToU8, unzipSync, zipSync } from "fflate";

import { canShareFile, downloadBlob, isPhone } from "@/components/SaveFileButton";

/* Download, with a choice that fits what the project is.
 *
 *   page    one HTML page           Code + page as shown (.zip)
 *                                   Page as shown (.html)
 *                                   HTML file (.html)
 *   static  a site of static files  Code + page as shown (.zip)
 *                                   Page as shown (.html)
 *   app     Next.js, React, a backend
 *                                   Source code (.zip) — every file, untouched,
 *                                   as GitHub has it (lib/builder/source-zip.ts)
 *
 * "Page as shown" is the page as it stands in the preview after its scripts
 * ran — asked of the preview itself (lib/builder/preview/snapshot.ts): the
 * live frame when there is one, else a hidden one loaded for the purpose.
 *
 * Saving is the same as everywhere else (SaveFileButton): a file on a
 * computer; on a phone the share sheet, which opens only straight from a tap,
 * so a file is made on the first tap and saved on the second. */

type Kind = "page" | "static" | "app" | "media";
type OptionId = "zip-shown" | "shown" | "html" | "app-zip";

const OPTIONS: Record<OptionId, { title: string; detail: string; icon: typeof Download }> = {
  "zip-shown": { title: "Code + page as shown", detail: ".zip — the page's code, and exactly how it looks right now", icon: FileArchive },
  shown: { title: "Page as shown", detail: ".html — what's on screen right now, as one file", icon: MonitorSmartphone },
  html: { title: "HTML file", detail: ".html — the page's code as one file, styles built in", icon: FileCode2 },
  "app-zip": { title: "Source code", detail: ".zip — every file and folder, untouched, as on GitHub", icon: FileArchive },
};

const FOR_KIND: Record<Kind, OptionId[]> = {
  page: ["zip-shown", "shown", "html"],
  static: ["zip-shown", "shown"],
  app: ["app-zip"],
  media: [],
};

const slug = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";

async function bytesOf(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/* ── The page as shown ───────────────────────────────────────────────── */

function askForSnapshot(target: Window, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const done = (html: string | null) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(html);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; id?: string; html?: string | null } | null;
      if (data?.source === "quickstark-preview" && data.type === "snapshot" && data.id === id) done(typeof data.html === "string" ? data.html : null);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMessage);
    target.postMessage({ source: "quickstark-host", type: "snapshot", id }, "*");
  });
}

async function pageAsShown(projectId: string, frame?: () => HTMLIFrameElement | null): Promise<string> {
  const live = frame?.()?.contentWindow;
  if (live) {
    const html = await askForSnapshot(live, 3000);
    if (html) return html;
  }
  /* No live preview to ask: the page loaded out of sight, given a moment for
     its scripts to run, and asked the same way. */
  const document_ = await (await fetch(`/preview/${projectId}`, { credentials: "same-origin", cache: "no-store" })).text();
  const hidden = document.createElement("iframe");
  hidden.setAttribute("sandbox", "allow-scripts");
  hidden.setAttribute("aria-hidden", "true");
  hidden.tabIndex = -1;
  Object.assign(hidden.style, { position: "fixed", left: "-10000px", top: "0", width: "1280px", height: "900px", border: "0", opacity: "0", pointerEvents: "none" });
  try {
    const loaded = new Promise<void>((resolve) => hidden.addEventListener("load", () => resolve(), { once: true }));
    hidden.srcdoc = document_;
    document.body.appendChild(hidden);
    await loaded;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const html = hidden.contentWindow ? await askForSnapshot(hidden.contentWindow, 5000) : null;
    if (!html) throw new Error("The page did not answer");
    return html;
  } finally {
    hidden.remove();
  }
}

/* ── The dialog ───────────────────────────────────────────────────────── */

type Phase = { option: OptionId; state: "preparing" | "ready"; file?: File } | null;

export function useProjectDownload({
  projectId,
  frame,
}: {
  projectId: string | null | undefined;
  /** The live preview, when there is one: "page as shown" is what it shows. */
  frame?: () => HTMLIFrameElement | null;
}): { open: () => void; element: ReactNode } {
  const [isOpen, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OptionId | null>(null);
  const [mounted, setMounted] = useState(false);
  const working = useRef(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setPhase(null);
    setError(null);
    setSaved(null);
    let live = true;
    void fetch(`/preview/${projectId}?download=kind`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { kind?: Kind; name?: string | null } | null) => {
        if (!live) return;
        setKind(body?.kind ?? "app");
        setName(body?.name ?? null);
      })
      .catch(() => live && setKind("app"));
    return () => {
      live = false;
    };
  }, [isOpen, projectId]);

  const close = useCallback(() => {
    setOpen(false);
    setPhase(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const make = useCallback(
    async (option: OptionId): Promise<File> => {
      const base = slug(name);
      if (option === "html") {
        return new File([await bytesOf(`/preview/${projectId}?download=1&format=html`)], `${base}.html`, { type: "text/html" });
      }
      if (option === "app-zip") {
        return new File([await bytesOf(`/preview/${projectId}?download=1`)], `${base}.zip`, { type: "application/zip" });
      }
      const shown = await pageAsShown(projectId as string, frame);
      if (option === "shown") return new File([shown], `${base}-as-shown.html`, { type: "text/html" });
      /* The code as stored, untouched, and the page as shown beside it. */
      const files = unzipSync(await bytesOf(`/preview/${projectId}?download=1&format=source`));
      files["page-as-shown.html"] = strToU8(shown);
      return new File([new Uint8Array(zipSync(files, { level: 6 }))], `${base}.zip`, { type: "application/zip" });
    },
    [projectId, name, frame],
  );

  const save = (file: File, option: OptionId) => {
    setSaved(option);
    setPhase(null);
    if (isPhone() && canShareFile(file)) {
      void navigator.share({ files: [file], title: file.name }).catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== "AbortError") downloadBlob(file);
      });
      return;
    }
    downloadBlob(file);
  };

  const choose = async (option: OptionId) => {
    /* Made before this tap: save it inside the tap (the phone's rule). */
    if (phase?.option === option && phase.state === "ready" && phase.file) return save(phase.file, option);
    if (working.current) return;
    working.current = true;
    setError(null);
    setSaved(null);
    setPhase({ option, state: "preparing" });
    try {
      const file = await make(option);
      if (isPhone() && canShareFile(file)) setPhase({ option, state: "ready", file });
      else save(file, option);
    } catch {
      setPhase(null);
      setError("That download could not be made. Try again in a moment.");
    } finally {
      working.current = false;
    }
  };

  const options = kind ? FOR_KIND[kind] : [];
  const element =
    isOpen && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="download-title"
              onClick={(event) => event.stopPropagation()}
              className="max-h-[92dvh] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-t-[24px] border border-line/[0.1] bg-canvas px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 shadow-[0_24px_60px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="download-title" className="text-[17px] font-semibold text-ink">Download</h2>
                  {name ? <p className="mt-0.5 truncate text-[13px] text-muted">{name}</p> : null}
                </div>
                <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-layer/[0.06] hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {kind === null ? (
                  <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking what this project is…
                  </p>
                ) : options.length === 0 ? (
                  <p className="py-4 text-[13px] text-muted">Fliers and videos download from their own Save buttons.</p>
                ) : (
                  options.map((id) => {
                    const { title, detail, icon: Icon } = OPTIONS[id];
                    const busy = phase?.option === id && phase.state === "preparing";
                    const ready = phase?.option === id && phase.state === "ready";
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => void choose(id)}
                        aria-busy={busy}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                          ready ? "border-accent/60 bg-accent/10" : "border-line/[0.1] hover:bg-layer/[0.05]"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-layer/[0.06] text-soft">
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-ink">{ready ? `Save ${title.toLowerCase()}` : title}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{busy ? "Preparing…" : ready ? "Ready — tap to save it to your device" : detail}</span>
                        </span>
                        <span className="shrink-0 text-muted">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved === id ? <Check className="h-4 w-4 text-accent" /> : <Download className="h-4 w-4" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return { open: () => setOpen(true), element };
}
