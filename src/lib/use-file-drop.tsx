"use client";

/* Files into a composer the way Claude takes them: dragged onto the box, or
 * pasted (a screenshot copied with Cmd/Ctrl+Shift+4, Print Screen or the
 * Snipping Tool lands as a picture). Hands them to the composer's own attach
 * — the same checks, limits and upload as its paperclip.
 *
 *   const drop = useFileDrop(attachFiles);
 *   <div {...drop.zone} className="relative …">
 *     <textarea onPaste={drop.onPaste} … />
 *     <DropHint show={drop.dragging} />
 *   </div>
 */

import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

/* A pasted screenshot is called "image.png" by every browser: given a name
   that says what it is and when, so two of them are not the same file. */
function named(file: File, index: number): File {
  if (file.name && file.name !== "image.png" && file.name !== "image.jpeg") return file;
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".");
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File([file], `Screenshot ${stamp}${index ? ` (${index + 1})` : ""}.${ext}`, { type: file.type, lastModified: Date.now() });
}

function asList(files: File[]): FileList {
  const transfer = new DataTransfer();
  files.forEach((file, i) => transfer.items.add(named(file, i)));
  return transfer.files;
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

export function useFileDrop(onFiles: (files: FileList) => void, options: { disabled?: boolean } = {}) {
  const [dragging, setDragging] = useState(false);
  /* dragenter/dragleave fire for every child the pointer crosses: counted,
     so the hint does not flicker. */
  const depth = useRef(0);
  const disabled = options.disabled === true;

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );
  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);
  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length) onFiles(asList(files));
    },
    [disabled, onFiles],
  );

  /* Only a paste that carries files is taken; text pastes as text. */
  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      if (disabled) return;
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!files.length) return;
      event.preventDefault();
      onFiles(asList(files));
    },
    [disabled, onFiles],
  );

  return { dragging, zone: { onDragEnter, onDragOver, onDragLeave, onDrop }, onPaste };
}

/** The "drop it here" layer over a composer while files are dragged onto it. */
export function DropHint({ show, label = "Drop to attach" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-accent/70 bg-canvas/80 backdrop-blur-[2px]"
    >
      <span className="rounded-full bg-accent/[0.14] px-3 py-1 text-[12.5px] font-medium text-accent">{label}</span>
    </div>
  );
}
