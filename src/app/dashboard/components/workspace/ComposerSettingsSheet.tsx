"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, FileText, GitFork, Github, Loader2, X } from "lucide-react";

/* What the composer's sliders button opens: how the next message is handled,
   and the two things you do to the app as a whole from here.

   Model and Plan mode change what sending does. Save to GitHub and Fork are
   about the app, and sit under them. Fork asks before it copies, in place,
   because it makes a whole second app. A sheet up from the bottom on a phone;
   a centred card from md up. */
export default function ComposerSettingsSheet({
  open,
  onClose,
  modelName,
  modelMark,
  onChooseModel,
  planMode,
  onPlanMode,
  onSaveToGitHub,
  projectName,
  canFork,
  forking,
  forkError,
  onFork,
}: {
  open: boolean;
  onClose: () => void;
  modelName: string;
  modelMark: React.ReactNode;
  onChooseModel: () => void;
  planMode: boolean;
  onPlanMode: (on: boolean) => void;
  onSaveToGitHub: () => void;
  projectName: string;
  canFork: boolean;
  forking: boolean;
  forkError: string | null;
  onFork: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [confirmFork, setConfirmFork] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) setConfirmFork(false);
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

  const row =
    "flex w-full items-center gap-4 rounded-[18px] bg-layer/[0.07] px-5 text-left text-ink transition-colors active:bg-layer/[0.12] md:hover:bg-layer/[0.1]";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="composer-settings"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/55 backdrop-blur-[6px] md:items-center md:justify-center md:p-6"
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.32 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="w-full rounded-t-[28px] border-t border-line/[0.1] bg-canvas pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] md:max-w-[440px] md:rounded-[24px] md:border md:pb-5"
          >
            <header className="relative flex h-[64px] items-center justify-center border-b border-line/[0.08] px-14">
              <p className="text-[18px] font-semibold text-ink">Settings</p>
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-layer/[0.08] text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-3 px-4 pt-5">
              <button
                onClick={() => {
                  onClose();
                  onChooseModel();
                }}
                className={`${row} min-h-[74px] py-3`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">{modelMark}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-soft">Model</span>
                  <span className="block truncate text-[17px] font-medium">{modelName}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-soft" />
              </button>

              <div className={`${row} h-[58px]`}>
                <FileText className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold">Plan mode</span>
                  {planMode && (
                    <span className="block text-[12px] text-soft">Replies with a plan — nothing changes until you turn it off</span>
                  )}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={planMode}
                  aria-label="Plan mode"
                  onClick={() => onPlanMode(!planMode)}
                  className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors ${planMode ? "bg-accent" : "bg-layer/[0.16]"}`}
                >
                  <span
                    className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-[left] duration-200 ${planMode ? "left-[25px]" : "left-[3px]"}`}
                  />
                </button>
              </div>

              <button
                onClick={() => {
                  onClose();
                  onSaveToGitHub();
                }}
                className={`${row} h-[58px]`}
              >
                <Github className="h-6 w-6 shrink-0" />
                <span className="text-[17px]">Save to GitHub</span>
              </button>

              <div className="overflow-hidden rounded-[18px] bg-layer/[0.07]">
                <button
                  onClick={() => setConfirmFork((value) => !value)}
                  disabled={!canFork}
                  aria-expanded={confirmFork}
                  className="flex h-[58px] w-full items-center gap-4 px-5 text-left text-ink disabled:text-muted"
                >
                  <GitFork className="h-6 w-6 shrink-0" />
                  <span className="text-[17px]">Fork</span>
                </button>
                {confirmFork && (
                  <div className="px-5 pb-4">
                    <p className="text-[13px] leading-relaxed text-soft">
                      Makes a copy of {projectName} — its latest version and its files — that you can
                      change without touching the original. The chat, the live address and connected
                      services stay with this one.
                    </p>
                    {forkError && <p className="mt-2 text-[13px] text-warn">{forkError}</p>}
                    <button
                      onClick={onFork}
                      disabled={forking}
                      className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-solid text-[15px] font-medium text-onSolid disabled:opacity-50"
                    >
                      {forking && <Loader2 className="h-4 w-4 animate-spin" />}
                      {forking ? "Forking…" : "Create the fork"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
