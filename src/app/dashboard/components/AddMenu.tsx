"use client";

/* The composer's + : one round button that opens the same list in every
 * composer — Home, the workspace chat and the Creative Director:
 *
 *   Photo Library           pictures (and videos where the composer takes them)
 *   Take Photo or Video     the camera, straight away — on phones and tablets
 *   Choose Files            anything the composer accepts
 *   Google Drive            Google's own picker (lib/google-drive.ts) — shown
 *                           once the site's Google keys are set
 *
 * It only gathers files; each composer keeps its own upload, checks and
 * limits, and drop and paste still work alongside it (use-file-drop.tsx). */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, FolderClosed, Images, Loader2, Plus } from "lucide-react";

import { asFileList, driveReady, pickFromDrive } from "@/lib/google-drive";

/* Drive's mark drawn as a plain outline, matching the line icons beside it. */
function DriveIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8.6 3.5h6.8l6.1 10.6-3.4 5.9H5.9l-3.4-5.9z" />
      <path d="M8.6 3.5 15 14.1M15.4 3.5 9 14.1M2.5 14.1h19" />
    </svg>
  );
}

export default function AddMenu({
  onFiles,
  accept,
  disabled = false,
  size = "md",
  className = "",
}: {
  /** What was picked, from any entry. */
  onFiles: (files: FileList) => void;
  /** What the composer accepts (Choose Files offers exactly this). */
  accept?: string;
  disabled?: boolean;
  /** md 36px; responsive 32px on phones growing to 40px, for Home's row. */
  size?: "md" | "responsive";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  /* Drawn over the page, above the +, so a composer box that hides its
     overflow cannot cut the list off. */
  const [place, setPlace] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (!open && !note) return;
    const at = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      setPlace({ left: Math.max(8, Math.min(r.left, window.innerWidth - 264)), bottom: window.innerHeight - r.top + 8 });
    };
    at();
    window.addEventListener("resize", at);
    window.addEventListener("scroll", at, true);
    return () => {
      window.removeEventListener("resize", at);
      window.removeEventListener("scroll", at, true);
    };
  }, [open, note]);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Videos only where the composer takes them. */
  const takesVideo = !accept || /video|\.mp4|\.mov|\.webm/i.test(accept);
  const media = takesVideo ? "image/*,video/*" : "image/*";

  /* The camera entry is for devices that have one in hand. */
  useEffect(() => {
    try {
      setTouch(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      /* Desktop. */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node) && !sheet.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [note]);

  const picked = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(event.target.files);
    /* Cleared so picking the same file again still fires. */
    event.target.value = "";
  };

  const fromDrive = async () => {
    setOpen(false);
    setBusy(true);
    try {
      const files = await pickFromDrive();
      if (files.length) onFiles(asFileList(files));
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Google Drive could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  const entries: { label: string; Icon: (props: { className?: string }) => React.ReactNode; go: () => void }[] = [
    { label: "Photo Library", Icon: Images, go: () => libraryInput.current?.click() },
    ...(touch ? [{ label: "Take Photo or Video", Icon: Camera, go: () => cameraInput.current?.click() }] : []),
    { label: "Choose Files", Icon: FolderClosed, go: () => fileInput.current?.click() },
    ...(driveReady ? [{ label: "Google Drive", Icon: DriveIcon, go: () => void fromDrive() }] : []),
  ];

  const box = size === "responsive" ? "h-8 w-8 sm:h-10 sm:w-10" : "h-9 w-9";

  return (
    <div ref={menu} className={`relative shrink-0 ${className}`}>
      <input ref={libraryInput} type="file" multiple accept={media} className="sr-only" tabIndex={-1} onChange={picked} />
      <input ref={cameraInput} type="file" accept={media} capture="environment" className="sr-only" tabIndex={-1} onChange={picked} />
      <input ref={fileInput} type="file" multiple accept={accept} className="sr-only" tabIndex={-1} onChange={picked} />
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || busy}
        aria-label="Add images or files"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add photos, videos or files — or paste a screenshot, or drop files here"
        className={`flex ${box} items-center justify-center rounded-full text-ink transition hover:bg-layer/[0.14] active:scale-[0.97] disabled:opacity-40 ${open ? "bg-layer/[0.14]" : "bg-layer/[0.08]"}`}
      >
        {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Plus className={`h-[18px] w-[18px] transition-transform ${open ? "rotate-45" : ""}`} />}
      </button>
      {open && place && createPortal(
        <div ref={sheet} role="menu" style={{ position: "fixed", left: place.left, bottom: place.bottom }} className="z-[200] w-64 overflow-hidden rounded-2xl border border-line/[0.1] bg-panel shadow-2xl shadow-black/40">
          {entries.map(({ label, Icon, go }, i) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                go();
              }}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-[15px] text-ink transition-colors hover:bg-layer/[0.07] focus-visible:bg-layer/[0.07] focus-visible:outline-none ${i ? "border-t border-line/[0.08]" : ""}`}
            >
              {label}
              <Icon className="h-5 w-5 shrink-0 text-soft" />
            </button>
          ))}
        </div>,
        document.body,
      )}
      {note && place && createPortal(
        <p role="status" style={{ position: "fixed", left: place.left, bottom: place.bottom }} className="z-[200] w-64 rounded-xl border border-line/[0.1] bg-panel px-3 py-2 text-[12.5px] text-soft shadow-xl">
          {note}
        </p>,
        document.body,
      )}
    </div>
  );
}
