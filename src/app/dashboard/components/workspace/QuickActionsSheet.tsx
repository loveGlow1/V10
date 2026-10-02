"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Eye, Info, TerminalSquare, UploadCloud, X } from "lucide-react";

import { publishedLabel, publishedUrl } from "@/lib/publish/naming";
import { safeHttpUrl } from "@/lib/safe-url";

import { isPublished, type Project } from "../../ProjectsContext";

/* What the ⋯ in a phone's app header opens: the handful of things you do to
   an app rather than say to it, in one sheet up from the bottom.

   Deploy and Preview are the two that matter most, so they are the two big
   cards; Manage, Code and Info are rows under them. Info is answered inside
   the sheet rather than sending you somewhere else — it is four facts, and a
   screen change for four facts is a long way to go. Phones only: from md up
   every one of these is already in the preview pane's toolbar. */
export default function QuickActionsSheet({
  open,
  project,
  onClose,
  onDeploy,
  onPreview,
  onManage,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onDeploy: () => void;
  onPreview: () => void;
  onManage: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [info, setInfo] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) setInfo(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  /* Then close: every action leaves the sheet, so none of them has to. */
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  /* The code is the GitHub repository once one is connected, and the
     download of what was built until then. */
  const repoUrl = safeHttpUrl(project?.repo_url);
  const codeHref = repoUrl ?? (project ? `/preview/${project.id}?download=1` : null);
  const live = project && isPublished(project) && project.slug;

  const row =
    "flex h-[54px] w-full items-center justify-between rounded-[16px] bg-layer/[0.07] px-5 text-left text-[16px] text-ink transition-colors active:bg-layer/[0.12]";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="quick-actions"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[75] flex flex-col justify-end bg-black/55 backdrop-blur-[6px] md:hidden"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.32 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            className="rounded-t-[28px] border-t border-line/[0.1] bg-canvas pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.45)]"
          >
            <header className="relative flex h-[64px] items-center justify-center border-b border-line/[0.08] px-14">
              {info && (
                <button
                  onClick={() => setInfo(false)}
                  aria-label="Back to quick actions"
                  className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-layer/[0.08] text-ink"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <p className="truncate text-[18px] font-medium text-ink">{info ? "App info" : "Quick Actions"}</p>
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-layer/[0.08] text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {info ? (
              <dl className="space-y-1 px-5 py-5 text-[15px]">
                {[
                  ["Name", project?.name ?? "—"],
                  ["Status", project?.status ?? "—"],
                  ["Published", live ? "Yes" : "Not yet"],
                  ["Last updated", project ? new Date(project.updated_at).toLocaleString() : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 border-b border-line/[0.06] py-3 last:border-b-0">
                    <dt className="shrink-0 text-muted">{label}</dt>
                    <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
                  </div>
                ))}
                {live && (
                  <div className="flex items-start justify-between gap-4 py-3">
                    <dt className="shrink-0 text-muted">Address</dt>
                    <dd className="min-w-0 text-right">
                      <a href={publishedUrl(project.slug!)} target="_blank" rel="noreferrer" className="break-all text-accent">
                        {publishedLabel(project.slug!)}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="space-y-3 px-4 pt-5">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={run(onDeploy)}
                    className="flex h-[130px] flex-col justify-between rounded-[18px] bg-gradient-to-tr from-[#1f7bff] via-[#45b8f5] to-[#7ef6f0] p-4 text-left text-[#0b1830] shadow-[0_10px_30px_rgba(31,123,255,0.25)] transition-transform active:scale-[0.98]"
                  >
                    <UploadCloud className="h-8 w-8" strokeWidth={2.25} />
                    <span className="text-[17px] font-semibold leading-tight">{live ? "Update Your App" : "Deploy Your App"}</span>
                  </button>
                  <button
                    onClick={run(onPreview)}
                    className="flex h-[130px] flex-col justify-between rounded-[18px] bg-white p-4 text-left text-[#111113] transition-transform active:scale-[0.98]"
                  >
                    <Eye className="h-8 w-8" strokeWidth={2.25} />
                    <span className="text-[17px] font-semibold leading-tight">View Preview</span>
                  </button>
                </div>

                <button onClick={run(onManage)} className={row}>
                  Manage your App
                  <ChevronRight className="h-5 w-5 text-soft" />
                </button>

                {codeHref && (
                  <a
                    href={codeHref}
                    onClick={onClose}
                    {...(repoUrl ? { target: "_blank", rel: "noreferrer" } : { download: "" })}
                    className={row}
                  >
                    {repoUrl ? "View Code" : "Download Code"}
                    <TerminalSquare className="h-5 w-5 text-soft" />
                  </a>
                )}

                <button onClick={() => setInfo(true)} className={row}>
                  View Info
                  <Info className="h-5 w-5 text-soft" />
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
