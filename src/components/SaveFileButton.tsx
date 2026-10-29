"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2 } from "lucide-react";

/* Saving a flier or a video to the device — on a phone as well as a computer.
 *
 * Why a plain <a download> was not enough on a phone:
 *
 *   - `download` is ignored for a link to another origin. Videos and clips
 *     live on storage, so a phone just opened the player instead of saving.
 *   - The share sheet — the only way into Photos on an iPhone — opens only
 *     straight from a tap. Fetching the file first and then calling share()
 *     spent that tap, and Safari refused it ("not allowed"), so Save did
 *     nothing at all.
 *
 * So on a phone the file is fetched BEFORE the tap that shares it: images
 * ahead of time (`prefetch`, they are small and usually already cached), so the
 * first tap opens the share sheet; a video on the first tap, after which the
 * button says "Save to Photos" and the second tap shares it. Where there is no
 * file share (an older phone, some in-app browsers) the bytes are downloaded
 * as a file instead, and if even fetching fails, the file opens in a new tab
 * where it can be long-pressed and saved. On a computer: a normal download,
 * with the right name, whichever origin it is on. */

export const isPhone = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod|android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent)));

async function fetchFile(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || type });
}

function downloadBlob(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const canShareFile = (file: File) => {
  try {
    return typeof navigator.share === "function" && Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
};

type Phase = "idle" | "preparing" | "ready" | "done" | "failed";

export default function SaveFileButton({
  url,
  name,
  type,
  prefetch = false,
  className,
  children,
  label,
  stopPropagation = false,
  iconClassName = "h-4 w-4",
  iconOnly = false,
}: {
  /** A round icon button: no words, the spinner says it is working. */
  iconOnly?: boolean;
  /** Where the bytes are — same origin or storage; redirects are followed. */
  url: string;
  /** The file name it is saved under. */
  name: string;
  /** Used when the server does not say. */
  type: string;
  /** Fetch on a phone before the tap, so the first tap opens the share sheet. For images. */
  prefetch?: boolean;
  className?: string;
  /** What the button says when idle. */
  children: ReactNode;
  label?: string;
  stopPropagation?: boolean;
  iconClassName?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const file = useRef<File | null>(null);
  const loading = useRef<Promise<File> | null>(null);

  const load = useCallback(() => {
    if (!loading.current) {
      loading.current = fetchFile(url, name, type).then((loaded) => (file.current = loaded));
      loading.current.catch(() => {
        loading.current = null;
      });
    }
    return loading.current;
  }, [url, name, type]);

  useEffect(() => {
    file.current = null;
    loading.current = null;
    setPhase("idle");
    if (prefetch && isPhone()) void load().catch(() => {});
  }, [prefetch, load]);

  const share = async (ready: File) => {
    try {
      await navigator.share({ files: [ready], title: ready.name });
      setPhase("done");
    } catch (error) {
      /* Closing the sheet is a choice, not a failure. */
      if ((error as { name?: string })?.name === "AbortError") return setPhase("idle");
      downloadBlob(ready);
      setPhase("done");
    }
  };

  const onClick = async (event: React.MouseEvent) => {
    if (stopPropagation) event.stopPropagation();
    if (phase === "preparing") return;

    if (isPhone()) {
      const ready = file.current;
      /* Ready before this tap: share now, inside the tap. */
      if (ready && canShareFile(ready)) return void share(ready);
      if (ready) {
        downloadBlob(ready);
        return setPhase("done");
      }
      setPhase("preparing");
      try {
        const loaded = await load();
        if (canShareFile(loaded)) setPhase("ready");
        else {
          downloadBlob(loaded);
          setPhase("done");
        }
      } catch {
        setPhase("failed");
        window.open(url, "_blank", "noopener");
      }
      return;
    }

    setPhase("preparing");
    try {
      downloadBlob(await load());
      setPhase("done");
    } catch {
      setPhase("failed");
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <button type="button" onClick={onClick} aria-label={label} aria-busy={phase === "preparing"} className={className}>
      {phase === "preparing" ? <Loader2 className={`${iconClassName} animate-spin`} /> : <Download className={iconClassName} />}
      {iconOnly ? null : phase === "preparing" ? "Preparing…" : phase === "ready" ? "Save to Photos" : children}
    </button>
  );
}
