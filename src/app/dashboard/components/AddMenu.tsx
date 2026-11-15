"use client";

/* The composer's + : one round button, the same in every composer — Home, the
 * workspace chat and the Creative Director. A tap opens the device's own
 * picker straight away, with no menu of ours in front of it: on an iPhone or
 * iPad that is the system list (Photo Library, Take Photo or Video, Choose
 * Files — and Google Drive, iCloud and any other file app installed there);
 * on Android the system chooser; on a computer the file dialog.
 *
 * It only gathers files; each composer keeps its own upload, checks and
 * limits, and drop and paste still work alongside it (use-file-drop.tsx). */

import { useRef } from "react";
import { Plus } from "lucide-react";

export default function AddMenu({
  onFiles,
  accept,
  disabled = false,
  size = "md",
  className = "",
}: {
  /** What was picked. */
  onFiles: (files: FileList) => void;
  /** What the composer accepts; the system picker offers exactly this. */
  accept?: string;
  disabled?: boolean;
  /** md 36px; responsive 32px on phones growing to 40px, for Home's row. */
  size?: "md" | "responsive";
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const box = size === "responsive" ? "h-8 w-8 sm:h-10 sm:w-10" : "h-9 w-9";

  return (
    <div className={`relative shrink-0 ${className}`}>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          /* Cleared so picking the same file again still fires. */
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        aria-label="Add images or files"
        title="Add photos, videos or files — or paste a screenshot, or drop files here"
        className={`flex ${box} items-center justify-center rounded-full bg-layer/[0.08] text-ink transition hover:bg-layer/[0.14] active:scale-[0.97] disabled:opacity-40`}
      >
        <Plus className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
