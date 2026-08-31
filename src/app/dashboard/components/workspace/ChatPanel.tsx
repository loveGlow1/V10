"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  ExternalLink,
  GitFork,
  Github,
  MicOff,
  Paperclip,
  Shuffle,
  X,
} from "lucide-react";

import { DEFAULT_MODEL, groupedModels, modelById, shortModelName } from "../../models";
import { avatarFor } from "../../projectColours";
import { useProjects, type BuildIntent, type Project } from "../../ProjectsContext";
import { useWorkspaceTabs } from "../../WorkspaceTabsContext";
import Q3DCanvas from "../../../Q3DCanvas";
import QMark from "../../../QMark";
import { greetingFor, useAccountName } from "../../useAccountName";
import { MicMark, SendArrow } from "../marks";
import BuildActivity, { type ActivityStep } from "./BuildActivity";
import MessageRow, { type Activity } from "./MessageRow";
import { ProviderMark } from "./modelMarks";
import Popover from "./Popover";
import { safeHttpUrl } from "@/lib/safe-url";
import { appendToThread, loadThread, type ThreadMessage } from "@/lib/project-messages";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import {
  ACCEPT,
  MAX_ATTACHMENTS,
  uploadAttachment,
  type Attachment,
} from "@/lib/project-attachments";

/* What the panel renders, which is a stored message plus a key to render it by.
   The shape itself lives in @/lib/project-messages, because the thread is now
   read back from a table and the two must not drift. */
/* What the classifier decided, in words for the tracker. Its own keys are
   edit / new_project / question / revert — see src/lib/builder/intent.ts. */
const INTENT_LABEL: Record<string, string> = {
  edit: "Read your message — an edit to the page",
  new_project: "Read your message — a new page",
  question: "Read your message — a question about the page",
  revert: "Read your message — undo the last change",
  clarify: "Read your message — needs one detail",
};

type Message = ThreadMessage & {
  id: number;
  /* View-only, never written to the thread table. A message reloaded from a
     previous visit has none of these, which is why all three are optional —
     see MessageRow. */
  at?: number;
  applied?: boolean;
  activity?: Activity;
};

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
  const { create, build, watchBuild } = useProjects();
  /* A build running is what makes a session active. The tab strip shows it, so
     a workspace left for another one still says it is working. */
  const { setBusy } = useWorkspaceTabs();
  /* Written by the orchestrator by way of the projects row, so it is filtered
     before it decides anything — the same rule the panel and the links above
     follow. Null means there is nothing to announce. */
  const previewUrl = safeHttpUrl(project?.preview_url);
  /* A page exists, so a message is ambiguous in a way it cannot be before one
     does — and only then is there anything for "New project" to replace. */
  const hasPage = Boolean(previewUrl);
  const [messages, setMessages] = useState<Message[]>([]);
  /* Whether this project's stored thread has arrived. Nothing may be sent
     before it does, or an app with history would be built again on arrival. */
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  /* What the composer says the next message is. "auto" leaves it to the
     classifier; anything else is the person telling it outright, which always
     wins. */
  const [mode, setMode] = useState<"auto" | "new_project">("auto");
  /* A message that would replace the page, waiting to be confirmed. Held whole
     so the same text can be sent again either way. */
  const [pendingConfirm, setPendingConfirm] = useState<{ text: string } | null>(null);
  /* Files chosen for the message being written. They belong to the message, not
     to the project, so they are cleared once it is sent. */
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelOpen, setModelOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const [building, setBuilding] = useState(false);
  /* The phases of the message in flight, and the clock they run against. Both
     are drawn from what this panel genuinely observes — the classifier's answer
     and the wait for the page — rather than from a script. */
  const [phases, setPhases] = useState<ActivityStep[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  /* Whose workspace this is. Empty until the session answers, and empty for
     good on an account that never gave a name — the greeting handles both. */
  const { firstName } = useAccountName();
  /* Read after mount rather than during render: this component is server
     rendered too, and the server's hour is not the reader's. */
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => setGreeting(greetingFor()), []);
  const streamRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nextId = useRef(0);

  /* Who is writing, so a message can be stored against them. Read once: the
     panel is inside an authenticated route, and a thread cannot be saved
     without it. */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setUserId(data.user?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* A new project is a new conversation — and now it is that project's own
     conversation, read back rather than started empty. Before this, reopening
     an app showed a blank panel for something that had been built and discussed
     at length.

     `cancelled` because switching apps twice quickly would otherwise let the
     first thread arrive after the second and paint the wrong conversation. */
  useEffect(() => {
    setMessages([]);
    setDraft("");
    nextId.current = 0;
    setThreadLoaded(false);

    const id = project?.id;
    if (!id) return;

    let cancelled = false;
    void loadThread(id).then((thread) => {
      if (cancelled) return;
      setMessages(thread.map((message) => ({ id: nextId.current++, ...message })));
      setThreadLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  /* The prompt Home arrived with, sent once. Guarded by a ref rather than by
     the message list: a re-render while the build is in flight would otherwise
     see an empty conversation and start it a second time.

     It waits for the thread, and then refuses to send if there is one. The
     prompt rides in the URL, so reloading a workspace re-delivers it — which
     used to be the point, when nothing was stored and a reload would otherwise
     open an empty conversation for an app that had never been built. Now that
     the conversation is kept, re-sending it would run the same build a second
     time and charge for it. An app with history has already been asked.

     Deliberately not in the dependency list — this is a one-shot on arrival,
     and re-running it whenever `send` is redefined is exactly the loop the
     ref is there to prevent. */
  const openingPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!project || !initialPrompt || !threadLoaded) return;
    const key = `${project.id}:${initialPrompt}`;
    if (openingPrompt.current === key) return;
    openingPrompt.current = key;
    if (messages.length > 0) return;
    void send(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, initialPrompt, threadLoaded]);

  /* Follows the conversation, but only while the reader is already at the foot
     of it. Phases land one at a time during a build, so this fires repeatedly
     — and yanking the view back down while someone reads an earlier reply is
     the one thing that would make live updates worse than no updates.

     80px of slack rather than an exact match: a list can settle a pixel or two
     off the bottom on its own, and that must still count as being at it. */
  const pinned = useRef(true);
  useEffect(() => {
    const stream = streamRef.current;
    if (stream && pinned.current) stream.scrollTop = stream.scrollHeight;
  }, [messages, building, phases]);

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

  async function attachFiles(files: FileList) {
    if (!project || !userId) return;

    const room = MAX_ATTACHMENTS - attached.length;
    if (room <= 0) {
      say({
        from: "system",
        text: `I can take ${MAX_ATTACHMENTS} files with one message. Send these, then attach the rest.`,
        tone: "error",
      });
      return;
    }

    setUploading(true);
    /* One at a time and reported one at a time: a rejected file should say
       which file and why, rather than failing the whole selection. */
    for (const file of Array.from(files).slice(0, room)) {
      const result = await uploadAttachment(file, project.id, userId);
      if (result.error) {
        say({ from: "system", text: result.error, tone: "error" });
        continue;
      }
      if (result.attachment) {
        const added = result.attachment;
        setAttached((current) => [...current, added]);
      }
    }
    setUploading(false);
  }

  /* Every message goes through here, so nothing can be shown without also being
     kept. The write is not awaited and its failure is not raised: a message on
     screen should stay on screen, and losing a row from the history is not
     worth interrupting a build over. */
  function say(message: ThreadMessage, view?: { applied?: boolean; activity?: Activity }) {
    setMessages((current) => [
      ...current,
      { id: nextId.current++, at: Date.now(), ...message, ...view },
    ]);
    /* Only the stored half is written. The clock and the applied mark are this
       session's view of the message, not part of the record. */
    if (project?.id && userId) void appendToThread(project.id, userId, message);
  }

  /* The phases of the run in flight, kept in a ref as well as in state. The
     state is what the live tracker draws; the ref is what the finished message
     keeps, and reading state back inside the same async function would only
     ever see the value it closed over. */
  const run = useRef<ActivityStep[]>([]);

  /* Merges a phase in by id, so a step that was running becomes the same step
     finished rather than a second line saying the same thing. */
  function setPhase(step: ActivityStep) {
    const at = run.current.findIndex((existing) => existing.id === step.id);
    if (at === -1) run.current = [...run.current, step];
    else {
      const next = [...run.current];
      next[at] = step;
      run.current = next;
    }
    setPhases(run.current);
  }

  /* The run as it stands, for the message that ends it. `failed` is read from
     the reply rather than from the steps: a page that generated fine can still
     come back with a status that says otherwise. */
  function timelineOf(startedAt: number, failed: boolean): Activity {
    return {
      steps: run.current,
      startedAt,
      finishedAt: Date.now(),
      failed,
      previewHref: null,
    };
  }

  async function send(prompt?: string, options: { intentOverride?: BuildIntent | null; confirmNewProject?: boolean; silent?: boolean } = {}) {
    const text = (prompt ?? draft).trim();
    if (!text || !project || building) return;

    /* Taken before the send and put back if it fails, so a refused message
       keeps its files as well as its words — re-attaching four screenshots to
       retry a sentence is the kind of thing that makes people give up. */
    const sent = attached;

    /* `silent` is the re-send behind a confirmation: the message is already in
       the conversation, and saying it twice would read as sending it twice. */
    if (!options.silent) {
      say({
        from: "you",
        text: sent.length > 0 ? `${text}\n\n(${sent.map((f) => f.name).join(", ")})` : text,
      });
    }
    setAttached([]);
    if (prompt === undefined) setDraft("");
    setBuilding(true);
    const runStarted = Date.now();
    setRunStartedAt(runStarted);
    run.current = [];
    setPhase({
      id: "classify",
      label: "Reading your message",
      detail: "Working out what it asks for…",
      state: "running",
    });

    /* Noted before the build starts, because it is what tells a page that has
       just been built from the one that was already there: the build's save
       step stamps last_build_at, and anything older than this moment belongs to
       a previous build. */
    const startedAt = Date.now();

    try {
      const reply = await build(project.id, text, {
        intentOverride: options.intentOverride ?? (mode === "auto" ? null : mode),
        confirmNewProject: options.confirmNewProject === true,
        attachmentIds: sent.map((file) => file.id),
      });

      /* Nothing was changed. The page is exactly as it was, so this is a
         sentence to read rather than a failure to recover from — and the text
         goes back in the composer so it can be reworded, not retyped. */
      if (reply.error || !reply.outcome) {
        if (reply.steps?.length) {
          run.current = [];
          for (const step of reply.steps) setPhase(step);
        }
        say(
          {
            from: "system",
            text: reply.error ?? "I couldn't send that one. Your message is still in the box — try it again.",
            tone: "error",
          },
          /* The steps it did get through are worth keeping: they say how far it
             got before it stopped. */
          reply.steps?.length ? { activity: timelineOf(runStarted, true) } : undefined,
        );
        if (prompt === undefined) setDraft(text);
        setAttached(sent);
        return;
      }

      /* A build that would replace the page. Nothing has happened yet, and
         nothing will until one of the two buttons is pressed. */
      if (reply.needsConfirmation) {
        /* Asked, not warned. This is the panel checking before it replaces a
           page — the two buttons under it are the whole point, and marking the
           sentence as a problem made a question look like something had already
           gone wrong. */
        say({ from: "system", text: reply.outcome.message });
        setPendingConfirm({ text });
        /* Nothing ran, so the files are still this message's. */
        setAttached(sent);
        return;
      }

      setPendingConfirm(null);
      const outcome = reply.outcome;
      /* The server's own account of what it did, which replaces the one this
         panel was guessing at. It names the operations and what each cost —
         which classifier answered, how many patch blocks landed, what the model
         call was billed at — none of which the browser can know. The inferred
         step stays only as the fallback for a reply that carries no list. */
      if (reply.steps?.length) {
        run.current = [];
        for (const step of reply.steps) setPhase(step);
      } else {
        setPhase({
          id: "classify",
          label: INTENT_LABEL[reply.intent ?? ""] ?? "Read your message",
          state: "done",
        });
      }
      /* Only offer a link the build actually returned, and only if it is an
         absolute http(s) address. A branch whose provisioning step is not
         connected yet comes back without one, and an empty href would look
         like a preview that failed to open. safeHttpUrl is what keeps a
         `javascript:` address out of an anchor in this origin — the server
         filters too, and this is the half that cannot be bypassed by anything
         reaching the browser another way. */
      const links = [
        { label: "Open preview", href: safeHttpUrl(outcome.links.preview) },
        { label: "View code", href: safeHttpUrl(outcome.links.repo) },
        { label: "Open admin", href: safeHttpUrl(outcome.links.admin) },
      ].filter((link): link is { label: string; href: string } => link.href !== null);

      say(
        {
          from: "system",
          text: outcome.message,
          links: links.length ? links : undefined,
          tone: outcome.status === "Failed" ? "error" : "normal",
        },
        /* An edit is finished the moment it answers. A full build is not — its
           page is still being generated, so both the mark and the timeline wait
           for the row.

           "Applied" is only ever said about a message that changed the page. A
           question and a clarifying question both answer without touching it,
           and marking those applied would put a green tick under a sentence
           that did nothing — the one thing the mark is there to rule out. */
        outcome.status === "Building"
          ? {}
          : {
              applied:
                outcome.status !== "Failed" &&
                reply.intent !== "question" &&
                reply.intent !== "clarify",
              activity: timelineOf(runStarted, outcome.status === "Failed"),
            },
      );

      /* The reply above arrives as soon as the prompt has been classified — the
         page itself is still being generated, which takes as long as it takes.
         This is the wait for it, and it is why the composer stays busy: the
         message said the preview link updates as it finishes, and this is what
         makes that true without a reload. */
      if (outcome.status === "Building") {
        setPhase({
          id: "generate",
          label: "Generating the page",
          detail: "This runs in the orchestrator and takes as long as it takes…",
          state: "running",
        });
        const finished = await watchBuild(project.id, startedAt);
        const preview = safeHttpUrl(finished?.preview_url);

        if (preview) {
          setPhase({ id: "generate", label: "Page generated", state: "done" });
          say(
            { from: "system", text: "Your page is ready." },
            {
              applied: true,
              /* The address rides on the tracker rather than as a link chip
                 beside it — offering the same page twice in one card reads as
                 two destinations. */
              activity: { ...timelineOf(runStarted, false), previewHref: preview },
            },
          );
        } else if (finished?.status === "Failed") {
          setPhase({ id: "generate", label: "The build did not finish", state: "done" });
          /* The build came back and said so. Generation happens after the reply,
             so a failure there cannot travel in the response — it is written to
             the row instead, which is the same row this was waiting on. */
          say({
            from: "system",
            text: "The build didn't finish, so the page is unchanged. Worth trying again — or describing a smaller page, since a very large one can run past what a single build allows.",
            tone: "error",
          });
        } else {
          /* Left running rather than ticked: the wait gave up, the build did
             not. Marking it done would say this panel knows an outcome it does
             not have. */
          setPhase({
            id: "generate",
            label: "Still generating when the wait gave up",
            state: "running",
          });
          say({
            from: "system",
            /* Not "it failed": nothing here knows that. The build may still
               land, and the workspace will show it when it does — so it is not
               marked as a problem either. */
            text: "This one is taking longer than usual. I've stopped waiting on it, but it may still finish — the preview appears here if it does.",
          });
        }
      }
    } catch (error) {
      say({ from: "system", text: (error as Error).message, tone: "error" });
      /* The text comes from wherever it was thrown, so the wording lives with
         the throw — see src/lib/builder/edit.ts and the route. */
    } finally {
      setBuilding(false);
      setRunStartedAt(null);
      setPhases([]);
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
            conversation grows instead of competing with it. Without a name on
            the account the greeting simply stops after the time of day rather
            than addressing a blank. */}
        <div className="pb-1">
          <h2 className="flex items-center gap-x-2 text-[22px] font-semibold leading-tight text-ink">
            {/* The logo itself, live — the same component the top bar, the
                sidebar, the sign-in panel and the hero all mount, rather than a
                picture of it. It carries its own rotation, once every sixteen
                seconds and linear, which is why there is no CSS animation on
                this: adding one would spin the canvas as well as the mark
                inside it and read as two motions fighting.

                It sits first in a row that does not wrap. As flex items the
                mark and the words are separate wrap opportunities, so a narrow
                panel would drop the whole greeting below the mark and leave it
                alone on the line above. Unwrapped, the words wrap inside their
                own item and the mark keeps its place at the left.

                Given its size directly, the way the drawer gives it one. The
                canvas fills its wrapper, and a wrapper with no height of its
                own leaves it free to take whatever height it likes — measured
                at 32 wide by 150 tall, cropped back to a square by an
                overflow-hidden that hid the mistake rather than fixing it.

                `scale` is the other half, and the half that was making it look
                tiny: it sets how much of the frame the mark fills, not how big
                the frame is. At 0.62 in a 32px box the mark drew 9.5px against
                22px words — a logo with more padding around it than logo.

                It is sized larger than a still mark would need, and that is
                the point rather than an overshoot. This one turns about Y, so
                what anyone actually sees is its width times |cos t| — the mean
                of |cos| over a revolution is 2/pi, about 0.64, and it passes
                through zero twice every sixteen seconds. Sizing it by its
                face-on width, the way you would size a static logo, is what
                made three rounds of "still too small" look like it should have
                been big enough on paper.

                1.1 in a 56px box measures 30.3px face-on, so it averages about
                19 while turning — roughly what 0.95 in a 44px box only looked
                like it was giving. Measured off the vector mark, whose viewBox
                comes from the same camera, so the fraction of the frame it
                fills is the fraction the 3D one fills. */}
            <Q3DCanvas scale={1.1} spinAxisTiltDeg={90} className="h-14 w-14 shrink-0" />
            {/* The landing page's own wordmark treatment, brought across so the
                greeting is in the brand's voice rather than in plain white and
                a flat green. The time of day takes the silver gradient and its
                sweep — a band of light at 100 degrees crossing the letters
                every seven seconds, which is the slant — and the name takes the
                green one, which carries a glow of its own. Both classes are the
                ones page.tsx already uses on QuickStark.Ai; this is not a
                second set that would drift from them. */}
            {/* The wave sits inside this span rather than beside it as a third
                flex item. As a sibling it was its own wrap opportunity, so a
                long name and a 56px mark could push it alone onto the next
                line — a greeting on one line and a hand on the next. Inline,
                it travels with the words it belongs to. */}
            <span className="min-w-0">
              <span className="wordmark-quickstart metal-shimmer">{greeting}</span>
              {firstName && (
                <>
                  , <span className="wordmark-ai">{firstName}</span>
                </>
              )}{" "}
              <span aria-hidden>👋</span>
            </span>
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
            onOpenPreview={onOpenPreview}
          />
        ))}

        {/* The message in flight. Its phases are the ones this panel actually
            watches happen — the classifier answering, and the wait for a page
            that is generated after the reply — so the list grows as they land
            rather than on a timer. The clock is the real one. */}
        {building && runStartedAt !== null && (
          <div className="rounded-xl border border-line/[0.06] bg-layer/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <QMark scale={1.85} className="h-[22px] w-[22px] shrink-0" />
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                QuickStark<span className="wordmark-ai">.Ai</span>
              </p>
            </div>
            <div className="mt-2.5">
              <BuildActivity running startedAt={runStartedAt} steps={phases} />
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
        {/* What is going with this message. Named rather than counted: "logo.svg,
            hero.png" is the difference between knowing what you attached and
            trusting that two files are the right two. */}
        {(attached.length > 0 || uploading) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
            {attached.map((file) => (
              <span
                key={file.id}
                className="flex max-w-[220px] items-center gap-1.5 rounded-md border border-line/[0.1] bg-layer/[0.04] py-1 pl-2 pr-1 text-[12px] text-ink"
              >
                <Paperclip className="h-3 w-3 shrink-0 -rotate-45 text-muted" />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setAttached((current) => current.filter((f) => f.id !== file.id))}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {uploading && <span className="text-[12px] text-muted">Attaching…</span>}
          </div>
        )}

        {/* What the next message will be taken to mean, and a way to say
            otherwise. Only once a page exists: before that every message is the
            first build, and there is nothing a chip could change. */}
        {hasPage && !pendingConfirm && (
          <div className="mb-2 flex items-center gap-2 px-1 text-[12px]">
            <button
              type="button"
              onClick={() => setMode(mode === "new_project" ? "auto" : "new_project")}
              className={`rounded-md border px-2 py-1 transition-colors ${
                mode === "new_project"
                  ? "border-line/[0.16] bg-layer/[0.06] text-ink"
                  : "border-line/[0.08] text-muted hover:text-ink"
              }`}
            >
              {mode === "new_project" ? "New project" : "Editing this app"}
            </button>
            {mode === "new_project" && (
              <span className="text-muted">The next message replaces this page.</span>
            )}
          </div>
        )}

        {/* The one question worth interrupting for. Nothing has happened yet,
            and neither button is the quiet default: replacing a page someone
            paid for is not something to fall into by pressing return. */}
        {pendingConfirm && (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[12px]">
            <button
              type="button"
              onClick={() => {
                const { text } = pendingConfirm;
                setPendingConfirm(null);
                setMode("auto");
                void send(text, { confirmNewProject: true, intentOverride: "new_project", silent: true });
              }}
              className="rounded-md border border-danger/40 px-2 py-1 text-danger transition-colors hover:bg-danger/10"
            >
              Replace this page
            </button>
            <button
              type="button"
              onClick={() => {
                const { text } = pendingConfirm;
                setPendingConfirm(null);
                setMode("auto");
                void send(text, { intentOverride: "edit", silent: true });
              }}
              className="rounded-md border border-line/[0.12] px-2 py-1 text-ink transition-colors hover:bg-layer/[0.06]"
            >
              Change the current page instead
            </button>
            <button
              type="button"
              onClick={() => setPendingConfirm(null)}
              className="px-1 py-1 text-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}

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
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files?.length) void attachFiles(files);
                    /* Cleared so choosing the same file twice still fires a
                       change — which is what happens when the first attempt was
                       rejected and the second is the same file. */
                    event.target.value = "";
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
