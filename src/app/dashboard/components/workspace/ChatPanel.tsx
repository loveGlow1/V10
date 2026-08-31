"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  GitFork,
  Github,
  MicOff,
  Paperclip,
  Shuffle,
  Sparkles,
} from "lucide-react";

import { DEFAULT_MODEL, groupedModels, modelById, shortModelName } from "../../models";
import { avatarFor } from "../../projectColours";
import { useProjects, type Project } from "../../ProjectsContext";
import { useWorkspaceTabs } from "../../WorkspaceTabsContext";
import { greetingFor, useAccountName } from "../../useAccountName";
import { MicMark, SendArrow } from "../marks";
import BuildActivity, { type ActivityStep } from "./BuildActivity";
import MessageRow, { type Message } from "./MessageRow";
import { ProviderMark } from "./modelMarks";
import Popover from "./Popover";
import { safeHttpUrl } from "@/lib/safe-url";

/* What the orchestrator decided this build was. Its own words, in ours — the
   raw value is a key ("webapp"), and an unrecognised one is passed through
   rather than dropped, because a branch added to the workflow later should
   show up here as itself instead of vanishing. */
const INTENT_LABEL: Record<string, string> = {
  webapp: "a web app",
  wordpress: "a WordPress site",
  ecommerce: "an online store",
};

/* How many files the build says it touched, if it said. Read defensively: this
   comes out of a workflow that can be edited in a browser, so anything but a
   real count is treated as "it did not say". */
function filesTouchedFrom(artifacts: Record<string, unknown> | undefined): number | null {
  const reported = artifacts?.filesTouched;
  return typeof reported === "number" && Number.isFinite(reported) && reported >= 0
    ? Math.floor(reported)
    : null;
}

/* What the orchestrator decided this build was, for the line under the clock.
   Its own words, in ours — the raw value is a key ("webapp"), and one this list
   does not know is passed through as itself rather than dropped, so a branch
   added to the workflow later still reads. */
function intentNote(intent: string): string | null {
  if (!intent || intent === "unclassified") return null;
  return `built ${INTENT_LABEL[intent] ?? intent}`;
}

/* The left half of a workspace: what you have asked for, and the box you ask in.

   The box is the composer Home already uses — the same orbiting highlight, the
   same graphite glass, the same send button — at the width this column gives
   it, carrying the controls that belong to an app that already exists: its
   repository, a fork of it, and the agent working on it.

   A message is a build. It goes to /api/build, which runs the orchestrator
   (n8n/README.md) and answers with what was made and where to see it. Nothing
   is invented while that is in flight and nothing is invented if it fails: a
   build that did not happen says so, in the conversation, next to the message
   that asked for it. */
export default function ChatPanel({
  project,
  onOpenIntegrations,
  onOpenPreview,
  previewOpen = false,
  initialPrompt,
  onBuildSettled,
}: {
  project: Project | null;
  onOpenIntegrations: () => void;
  /** Raises the preview sheet over the conversation. Phones only — see Workspace. */
  onOpenPreview: () => void;
  /** Whether that sheet is currently up, so the pill can stand down while it is. */
  previewOpen?: boolean;
  /** What Home was asked for, when the workspace was opened by sending from it. */
  initialPrompt?: string | null;
  /** Called once a build has finished, win or lose — a build spends credits. */
  onBuildSettled?: () => void;
}) {
  const router = useRouter();
  const { create, build } = useProjects();
  /* A build running is what makes a session active. The tab strip shows it, so
     a workspace left for another one still says it is working. */
  const { setBusy } = useWorkspaceTabs();
  /* Written by the orchestrator by way of the projects row, so it is filtered
     before it decides anything — the same rule the panel and the links above
     follow. Null means there is nothing to announce. */
  const previewUrl = safeHttpUrl(project?.preview_url);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelOpen, setModelOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const [building, setBuilding] = useState(false);
  /* When the build in flight was sent. The tracker counts from it, so it is
     state rather than a ref — the panel has to re-render when it changes. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /* The phases /api/build has reported for the build in flight. Replaced by
     id rather than appended to, so the orchestrator's `running` step becomes
     its own `done` step with a duration instead of appearing twice. */
  const [liveSteps, setLiveSteps] = useState<ActivityStep[]>([]);
  /* Whose workspace this is. Empty until the session answers, and empty for
     good on an account that never gave a name — the greeting handles both. */
  const { firstName } = useAccountName();
  /* Read after mount rather than during render: this component is server
     rendered too, and the server's hour is not the reader's. A neutral opener
     until then, so the first paint is never wrong about the time of day. */
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => setGreeting(greetingFor()), []);
  const streamRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nextId = useRef(0);

  // A new project is a new conversation; keeping the old one would attribute
  // messages to the wrong app.
  useEffect(() => {
    setMessages([]);
    setDraft("");
    setStartedAt(null);
    setLiveSteps([]);
    nextId.current = 0;
  }, [project?.id]);

  /* The prompt Home arrived with, sent once. Guarded by a ref rather than by
     the message list: a re-render while the build is in flight would otherwise
     see an empty conversation and start it a second time.

     Deliberately not in the dependency list — this is a one-shot on arrival,
     and re-running it whenever `send` is redefined is exactly the loop the
     ref is there to prevent. */
  const openingPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!project || !initialPrompt) return;
    const key = `${project.id}:${initialPrompt}`;
    if (openingPrompt.current === key) return;
    openingPrompt.current = key;
    void send(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, initialPrompt]);

  /* Follows the conversation, but only while the reader is already at the foot
     of it. A build now reports a phase at a time, so this fires repeatedly
     during one — and yanking the view back down mid-stream, while someone is
     reading an earlier reply, is the one thing that would make the live updates
     worse than the silence they replaced.

     80px of slack rather than an exact match: a list can settle a pixel or two
     off the bottom on its own, and that must still count as being at it. */
  const pinned = useRef(true);
  useEffect(() => {
    const stream = streamRef.current;
    if (stream && pinned.current) stream.scrollTop = stream.scrollHeight;
  }, [messages, building, liveSteps]);

  /* Told to the strip rather than to a tab of its own: another prompt in this
     app is the same app. The cleanup clears the mark when the workspace is left
     mid-build, so a tab cannot be left pulsing over a panel that is gone. */
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    setBusy(projectId, building);
    return () => setBusy(projectId, false);
  }, [projectId, building, setBusy]);

  // One handler for both popovers in the toolbar: an outside press closes
  // whichever is open, the way a menu behaves.
  useEffect(() => {
    if (!modelOpen && !forkOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setModelOpen(false);
        setForkOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [modelOpen, forkOpen]);

  async function send(prompt?: string) {
    const text = (prompt ?? draft).trim();
    if (!text || !project || building) return;

    const sentAt = Date.now();
    setMessages((current) => [
      ...current,
      { id: nextId.current++, from: "you", text, at: sentAt },
    ]);
    if (prompt === undefined) setDraft("");
    setBuilding(true);
    setStartedAt(sentAt);
    setLiveSteps([]);

    /* Collected here as well as rendered, so the finished message keeps the
       real timeline the build reported rather than a summary written after
       the fact. */
    const reported: ActivityStep[] = [];

    try {
      const outcome = await build(project.id, text, (step) => {
        const next: ActivityStep = {
          id: step.id,
          label: step.label,
          detail: step.detail,
          state: step.state,
          ms: step.ms,
        };
        const at = reported.findIndex((existing) => existing.id === next.id);
        if (at === -1) reported.push(next);
        else reported[at] = next;
        setLiveSteps([...reported]);
      });
      /* Only offer a link the build actually returned, and only if it is an
         absolute http(s) address. A branch whose provisioning step is not
         connected yet comes back without one, and an empty href would look
         like a preview that failed to open. safeHttpUrl is what keeps a
         `javascript:` address out of an anchor in this origin — the server
         filters too, and this is the half that cannot be bypassed by anything
         reaching the browser another way. */
      /* The preview is not among these: the tracker below the reply carries it,
         and offering the same address twice in one card reads as two different
         destinations. These are the two it does not carry. */
      const links = [
        { label: "View code", href: safeHttpUrl(outcome.links.repo) },
        { label: "Open admin", href: safeHttpUrl(outcome.links.admin) },
      ].filter((link): link is { label: string; href: string } => link.href !== null);

      /* Measured, not estimated: the clock started when the request went out
         and stops here. `files touched` is the orchestrator's own figure — the
         same one the build was priced from — and is left off entirely when it
         did not report one, rather than shown as zero. */
      const touched = filesTouchedFrom(outcome.artifacts);
      const note = [intentNote(outcome.intent), touched === null ? null : `${touched} ${touched === 1 ? "file" : "files"} touched`]
        .filter(Boolean)
        .join(" · ");
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          from: "system",
          text: outcome.message,
          at: Date.now(),
          links: links.length ? links : undefined,
          tone: outcome.status === "Failed" ? "error" : "normal",
          activity: {
            steps: reported,
            startedAt: sentAt,
            finishedAt: Date.now(),
            failed: outcome.status === "Failed",
            note: note || undefined,
            previewHref: safeHttpUrl(outcome.links.preview),
          },
        },
      ]);
    } catch (error) {
      /* A build that never reached the orchestrator has no steps to show — the
         message is the whole of what is known, so no tracker is attached. */
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          from: "system",
          text: (error as Error).message,
          at: Date.now(),
          tone: "error",
        },
      ]);
    } finally {
      setBuilding(false);
      setStartedAt(null);
      setLiveSteps([]);
      /* Even a refused build is worth a refresh: "not enough credits" is the
         one answer where the number in the header is the whole explanation. */
      onBuildSettled?.();
    }
  }

  /* A fork is a second app you can change without touching this one. Until a
     build exists there is nothing to copy but the name, which the panel says
     before you press it rather than after. */
  async function fork() {
    if (!project || forking) return;
    setForking(true);
    const copy = await create(`${project.name} copy`);
    setForking(false);
    setForkOpen(false);
    if (copy) {
      router.push(`/dashboard/project/${copy.id}`);
    }
  }

  // The same recorder Home uses: the audio is captured and the browser's own
  // recogniser, where there is one, types into the box while it runs.
  async function toggleRecording() {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.onstop = () => stream.getTracks().forEach((track) => track.stop());
      recorder.start();
      setIsRecording(true);

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let heard = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            heard += event.results[i][0].transcript;
          }
          setDraft(heard);
        };
        recognition.start();
      }
    } catch {
      // Permission refused or unsupported: leave the button where it was rather
      // than showing a recording that is not happening.
      setIsRecording(false);
    }
  }

  const chosen = modelById(model);

  const control =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.06] text-ink transition-all hover:border-line/[0.12] active:scale-[0.98]";
  const chip =
    "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line/[0.08] bg-layer/[0.06] px-2.5 text-[13px] text-ink transition-all hover:border-line/[0.12] active:scale-[0.98]";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-line/[0.06] md:border-r">
      {/* From md up only. On a phone the bar above already names the app, beside
          the way back out of it, and the same name a row under it is the word
          twice. h-[53px] on both halves so the two headers rule off at the same
          line. */}
      <header className="hidden h-[53px] shrink-0 items-center gap-2.5 border-b border-line/[0.06] px-4 md:flex">
        <span
          className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${avatarFor(project?.id)}`}
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {project?.name ?? "Loading…"}
        </p>
      </header>

      <div
        ref={streamRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {/* Who this is and what it is for, at the top of the thread rather than
            floating in the middle of it — so it scrolls away as the
            conversation grows instead of competing with it. The name is the
            one on the account; without one the greeting simply stops after the
            time of day rather than addressing a blank. */}
        <div className="pb-1">
          <h2 className="flex flex-wrap items-center gap-x-2 text-[22px] font-semibold leading-tight text-ink">
            <Sparkles className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              {greeting}
              {firstName && (
                <>
                  , <span className="text-accent">{firstName}</span>
                </>
              )}
            </span>
            <span aria-hidden>👋</span>
          </h2>
          <p className="mt-1 text-[13px] text-muted">How can I help you build today?</p>
        </div>

        {messages.length === 0 && !building && (
          <p className="pt-6 text-center text-sm text-muted">
            Describe a change and it will appear here.
          </p>
        )}

        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            avatarClass={avatarFor(project?.id)}
            onOpenPreview={onOpenPreview}
          />
        ))}

        {/* The build in flight. One step, because one is all that is known
            while /api/build is out — see BuildActivity for why it is not five.
            The clock under it is real and ticking. */}
        {building && startedAt !== null && (
          <div className="rounded-xl border border-line/[0.06] bg-layer/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-onSolid ${avatarFor(project?.id)}`}
              >
                <Sparkles className="h-3 w-3" />
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                QuickStark AI
              </p>
            </div>
            <div className="mt-2.5">
              <BuildActivity
                running
                startedAt={startedAt}
                steps={
                  liveSteps.length
                    ? liveSteps
                    : /* Before the first frame lands. The request really has
                         been sent, and saying so is better than an empty list
                         under a heading that says work is happening. */
                      [{ id: "sent", label: "Sending the build", state: "running" }]
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* The moment the build has something to show.

          It sits above the composer rather than in the thread because it is not
          a message — it stays put as the conversation scrolls under it, and it
          is still there ten replies later when someone wants another look.
          Phones only: from md up the preview is already on screen beside this,
          so announcing it would be pointing at something visible.

          It pops rather than fades in, and it stands down while the sheet is up
          — which is what makes closing the sheet the moment it springs back.
          That is the moment someone might think they have put the preview away
          for good, and this is what says otherwise. Announcing a preview as
          ready over the top of the preview itself would say nothing. */}
      <AnimatePresence>
        {previewUrl && !previewOpen && (
          <motion.div
            key="preview-ready"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.7 }}
            className="shrink-0 px-3 pb-1 md:hidden"
          >
            <button
              onClick={onOpenPreview}
              className="mx-auto flex h-11 items-center gap-2 rounded-full bg-solid px-5 text-[14px] font-medium text-onSolid shadow-[0_8px_28px_rgba(0,0,0,0.45)] transition-transform active:scale-[0.97]"
            >
              <Eye className="h-4 w-4" />
              Your Preview is ready
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="shrink-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* Home's composer, brought over whole: the orbiting highlight outside,
            the graphite glass inside. */}
        <div className="group relative w-full overflow-visible rounded-[26px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden rounded-[26px]">
            <div className="absolute -inset-[150%] animate-orbit-border bg-[conic-gradient(from_0deg_at_50%_50%,rgba(236,243,255,0.40)_0deg,rgba(236,243,255,0.12)_78deg,rgba(236,243,255,0.04)_128deg,rgba(236,243,255,0.34)_196deg,rgba(236,243,255,0.10)_268deg,rgba(236,243,255,0.04)_310deg,rgba(236,243,255,0.40)_360deg)]" />
          </div>

          <div className="relative z-30 flex min-h-[128px] w-full flex-col justify-between overflow-visible rounded-[26px] border-[1.5px] border-line/[0.11] bg-sunken bg-clip-padding p-3.5">
            <div className="relative">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter breaks the line — the convention
                  // every chat composer already trained people on.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                aria-label="Describe a change"
                rows={2}
                className="relative z-10 h-[52px] w-full resize-none bg-transparent text-base text-ink outline-none"
              />
              <AnimatePresence>
                {!draft && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 select-none text-base text-faint"
                  >
                    Describe a change…
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div ref={toolbarRef} className="relative mt-3 flex items-center justify-between gap-2">
              <div className="flex shrink-0 items-center gap-[3px]">
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    console.log(event.target.files);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add photos or files"
                  className={control}
                >
                  <Paperclip className="h-4 w-4 -rotate-45" />
                </button>

                {/* The repository this app pushes to. There is no connection to
                    make yet, so it opens the drawer where that connection will
                    be made rather than failing on its own. */}
                <button
                  onClick={onOpenIntegrations}
                  title="Connect a repository"
                  aria-label="Connect a repository"
                  className={control}
                >
                  <Github className="h-4 w-4" />
                </button>

                <button
                  onClick={() => {
                    setForkOpen((open) => !open);
                    setModelOpen(false);
                  }}
                  aria-expanded={forkOpen}
                  className={chip}
                >
                  <GitFork className="h-4 w-4" />
                  <span className="font-medium tracking-tight">Fork</span>
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-[3px]">
                <button
                  onClick={() => {
                    setModelOpen((open) => !open);
                    setForkOpen(false);
                  }}
                  aria-expanded={modelOpen}
                  aria-label="Choose a model"
                  className={chip}
                >
                  <ProviderMark provider={chosen.provider} />
                  <span className="font-medium tracking-tight">{shortModelName(chosen)}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${modelOpen ? "rotate-180" : ""}`}
                  />
                </button>

                <button
                  onClick={toggleRecording}
                  title={isRecording ? "Stop Recording" : "Start Recording"}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] ${
                    isRecording
                      ? "animate-pulse border-red-500 bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                      : "border-line/[0.08] bg-layer/[0.06] text-white hover:border-line/[0.12]"
                  }`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <MicMark className="h-4 w-4" />}
                </button>

                {/* Send sits in the bar's own material rather than shouting over
                    it, and only lifts once there is something to send. */}
                <button
                  onClick={() => void send()}
                  disabled={!draft.trim() || building}
                  aria-label="Send"
                  className={`flex h-[34px] w-[38px] shrink-0 items-center justify-center rounded-[15px] border transition-all active:scale-[0.98] disabled:cursor-not-allowed ${
                    draft.trim() && !building
                      ? "border-transparent bg-layer/[0.16] text-ink hover:bg-layer/[0.22]"
                      : "border-transparent bg-layer/[0.07] text-ink/30"
                  }`}
                >
                  <SendArrow className="h-4 w-4 md:hidden" />
                  <ArrowUp className="hidden h-4 w-4 stroke-[2.5] md:block" />
                </button>
              </div>

              {/* Anchored to the row rather than to the chip that opens it: a
                  panel hung off a control near the right edge has only the
                  width between that control and the edge, which on a phone is
                  not enough for it. */}
                  <Popover
                    open={forkOpen}
                    onClose={() => setForkOpen(false)}
                    title="Fork this app"
                    align="left"
                    side="top"
                    width="w-[min(300px,100%)]"
                    sheetOnMobile={false}
                  >
                    <p className="text-[13px] font-medium text-ink">Fork this app</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                      Opens a copy you can change without touching{" "}
                      {project?.name ?? "this one"}. Nothing is built yet, so the copy starts from
                      the same place this one did.
                    </p>
                    <button
                      onClick={fork}
                      disabled={!project || forking}
                      className="mt-3 h-9 w-full rounded-lg bg-solid text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 disabled:opacity-40"
                    >
                      {forking ? "Forking…" : "Create the fork"}
                    </button>
                  </Popover>
                  {/* Hung off the chip on every size. The bar sits at the foot
                      of the screen, so on a phone the list opens right above the
                      thumb that asked for it rather than in the middle. */}
                  <Popover
                    open={modelOpen}
                    onClose={() => setModelOpen(false)}
                    title="Select model"
                    align="right"
                    side="top"
                    width="w-[min(340px,100%)]"
                    sheetOnMobile={false}
                  >
                    <p className="-mx-3.5 -mt-3.5 mb-1.5 flex items-center justify-center gap-2 rounded-t-xl border-b border-line/[0.06] bg-layer/[0.02] px-3 py-2.5 text-center text-[12px] text-muted">
                      <Shuffle className="h-3.5 w-3.5 shrink-0" />
                      Model changes apply from your next message
                    </p>

                    <div
                      className="-mx-1.5 max-h-[52vh] overflow-y-auto overscroll-contain px-1.5"
                      role="menu"
                    >
                      {groupedModels().map((group) => (
                        <div key={group.provider}>
                          {group.label && (
                            <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                              {group.label}
                            </p>
                          )}
                          {group.models.map((option) => {
                            const selected = model === option.id;
                            return (
                              <button
                                key={option.id}
                                role="menuitem"
                                onClick={() => {
                                  setModel(option.id);
                                  setModelOpen(false);
                                }}
                                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-layer/[0.05] ${
                                  selected ? "bg-layer/[0.06]" : ""
                                }`}
                              >
                                <span className="mt-0.5 shrink-0">
                                  <ProviderMark provider={option.provider} />
                                </span>

                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={`truncate text-[13px] font-medium ${
                                        selected ? "text-accent" : "text-ink"
                                      }`}
                                    >
                                      {option.name}
                                    </span>
                                    {option.badge && (
                                      <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">
                                        {option.badge}
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                                    {option.blurb}
                                    {option.note && (
                                      <>
                                        {" · "}
                                        <span className="text-warn">{option.note}</span>
                                      </>
                                    )}
                                  </span>
                                </span>

                                {selected && (
                                  <Check className="mt-0.5 h-4 w-4 shrink-0 stroke-[2.5] text-accent" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </Popover>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
