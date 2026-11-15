"use client";

/* The composer's + : one round button that opens "Add images" and "Add
 * files". The same in every composer — Home, the workspace chat and the
 * Creative Director — so attaching works and looks the same everywhere.
 * It only opens the pickers; each composer keeps its own upload, checks and
 * limits, and drop/paste still work alongside it (use-file-drop.tsx). */

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Paperclip, Plus } from "lucide-react";

export default function AddMenu({
  onFiles,
  accept,
  imageAccept = "image/png,image/jpeg,image/webp,image/gif",
  disabled = false,
  size = "md",
  className = "",
}: {
  /** What was picked, from either entry. */
  onFiles: (files: FileList) => void;
  /** What "Add files" offers. */
  accept?: string;
  /** What "Add images" offers. */
  imageAccept?: string;
  disabled?: boolean;
  /** md 36px; sm 32px on phones growing to 40px, for Home's row. */
  size?: "md" | "responsive";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const picked = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(event.target.files);
    /* Cleared so picking the same file again still fires. */
    event.target.value = "";
  };

  const box = size === "responsive" ? "h-8 w-8 sm:h-10 sm:w-10" : "h-9 w-9";

  return (
    <div ref={menu} className={`relative shrink-0 ${className}`}>
      <input ref={imageInput} type="file" multiple accept={imageAccept} className="sr-only" tabIndex={-1} onChange={picked} />
      <input ref={fileInput} type="file" multiple accept={accept} className="sr-only" tabIndex={-1} onChange={picked} />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label="Add images or files"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add images or files — or paste a screenshot, or drop files here"
        className={`flex ${box} items-center justify-center rounded-full text-ink transition hover:bg-layer/[0.14] active:scale-[0.97] disabled:opacity-40 ${open ? "bg-layer/[0.14]" : "bg-layer/[0.08]"}`}
      >
        <Plus className={`h-[18px] w-[18px] transition-transform ${open ? "rotate-45" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-11 left-0 z-50 w-48 overflow-hidden rounded-xl border border-line/[0.1] bg-panel p-1 shadow-xl shadow-black/30">
          {(
            [
              ["Add images", ImagePlus, imageInput],
              ["Add files", Paperclip, fileInput],
            ] as const
          ).map(([label, Icon, input]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                input.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] text-ink transition-colors hover:bg-layer/[0.08] focus-visible:bg-layer/[0.08] focus-visible:outline-none"
            >
              <Icon className="h-4 w-4 text-soft" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
