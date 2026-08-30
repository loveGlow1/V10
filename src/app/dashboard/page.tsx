"use client";

import React, { useState, useRef, useEffect } from "react";
import TopNav from "./components/TopNav";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import BillingModal from "./components/billing/BillingModal";
import AccountSettingsModal, { type SectionId as SettingsSection } from "./components/AccountSettingsModal";
import { AGENTS } from "./agents";
import { DEFAULT_MODEL, groupedModels, modelById, shortModelName } from "./models";
import { useCredits } from "./useCredits";
import ProjectSwitcher from "./components/ProjectSwitcher";
import { AgentMark, MicMark } from "./components/marks";
import ProjectList from "./components/ProjectList";
import KeepBuilding from "./components/KeepBuilding";
import StartBuildButton from "./components/StartBuildButton";
import DashboardFooter from "./components/DashboardFooter";
import { ProjectsProvider } from "./ProjectsContext";
import SupportChat from "./components/SupportChat";
import PhoneField from "./components/PhoneField";
import { ComingSoonBadge, ComingSoonModal } from "./components/ComingSoon";
import WorkspaceTabs from "./components/workspace/WorkspaceTabs";
import Popover from "./components/workspace/Popover";
import { ProviderMark } from "./components/workspace/modelMarks";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paperclip,
  ChevronDown,
  Globe,
  Settings,
  SlidersHorizontal,
  Mic,
  MicOff,
  Smartphone,
  Layers,
  FileText,
  AppWindow,
  Bot,
  X,
  Check,
  Lock,
  Sparkles,
  Cpu,
  Github,
  ChevronRight,
  Shuffle,
  Image as ImageIcon,
  Camera,
  FolderOpen,
  Triangle,
} from "lucide-react";

/* What a new account holds — the Free tier's daily allowance plus the welcome
   credit — read from the credit economy rather than written out here, so this
   figure and the one signup actually grants cannot differ. The panel does not
   yet fetch the account's real balance, so until it does every session shows a
   fresh account's. */

/* The row under the composer. Each chip is a way into a build rather than a
   label: tapping one drops its prompt into the bar and puts the caret at the
   end, so the next thing a visitor does is edit a real sentence instead of
   facing an empty box. */
const STARTERS = [
  {
    label: "Storefront",
    icon: Layers,
    prompt: "Build an online store with a product catalogue, cart and Stripe checkout.",
  },
  {
    label: "Client Dashboard",
    icon: AppWindow,
    prompt: "Build a dashboard with sign-in, a customer table and charts for revenue and usage.",
  },
  {
    label: "AI Agent",
    icon: Bot,
    prompt: "Build an AI agent that answers questions from my documents and emails me a daily summary.",
  },
  {
    label: "Mobile App",
    /* Last, and not beta — beta means you can use it and it may break, and this
       is the opposite claim. Pressing it explains rather than filling the
       composer with a prompt nothing can build yet, so it sits at the end of the
       row behind the three that do build something. */
    soon: true,
    icon: Smartphone,
    prompt: "Build a mobile app for iOS and Android with sign-in, a home feed and push notifications.",
  },
] as const;

/* The bar suggests what to ask for by cycling its placeholder rather than
   sitting on one example. */
const PROMPTS = [
  "Build me an e-commerce platform with...",
  "Build me a SaaS app for...",
  "Build me a CRM system with...",
  "Build me a dashboard for...",
];

const projectTypes = [
  /* The blue pill says what beta says: you can use this, and it may break. It
     belongs on the one thing here that actually builds — not on Mobile App,
     which cannot be used at all and carries a coming-soon badge instead. */
  { id: "web", label: "Web App", icon: Layers, phoneIcon: Globe, beta: true },
  { id: "mobile", label: "Blog Post", icon: Smartphone, phoneIcon: Smartphone },
  { id: "landing", label: "Landing Page", icon: AppWindow, phoneIcon: AppWindow },
];

export default function DashboardPage() {
  const [billingOpen, setBillingOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  /* Which pane the settings panel opens on. The account menu wants its own; the
     project switcher wants the project's. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
  const [activeType, setActiveType] = useState("web");
  const [composerFocused, setComposerFocused] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [projectName, setProjectName] = useState<string | null>(null);

  // The phone header opens this; from md up the drawer never mounts.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  // Agent Selector State & Data. The agent list is what a phone chooses from:
  // the sheet has the room for it and the bar has not, so Q1 stays the mobile
  // control while a pointer gets the model picker below.
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("Q1");

  /* Model Selector State — the workspace's picker, on Home's bar from md up.
     Same list, same chip, so the model you pick before a build and the one you
     switch to inside it are named the same way in both places. */
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
  const composerBoxRef = useRef<HTMLDivElement>(null);

  // Privacy Settings Modal State & Data
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [selectedPrivacy, setSelectedPrivacy] = useState("public");

  // Advanced Controls Modal State & Data
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);
  const [maxxEnabled, setMaxxEnabled] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Auto");

  // File Upload Popover & Hidden Inputs State
  const [isUploadPopoverOpen, setIsUploadPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const photoLibraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const chooseFilesInputRef = useRef<HTMLInputElement>(null);

  // Voice Recording State & Refs
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  /* Why a send did not open an app. Held here rather than in the button so it
     can be shown under the composer, where the text that failed still is. */
  const [startError, setStartError] = useState<string | null>(null);
  /* The account's own balance rather than a constant. useCredits reads
     credit_balances directly, so it does not need the projects provider this
     page renders below it. */
  const { label: credits } = useCredits();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsUploadPopoverOpen(false);
      }
    };
    if (isUploadPopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUploadPopoverOpen]);

  // The panel and the chip that opens it sit at opposite ends of the composer
  // box, so that box is what a press has to land outside of to close it.
  // Reaching for the box itself — the textarea below — closes it too, on focus.
  useEffect(() => {
    if (!isModelPopoverOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (composerBoxRef.current && !composerBoxRef.current.contains(event.target as Node)) {
        setIsModelPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isModelPopoverOpen]);

  /* Stop once there is something in the box: the placeholder is hidden then,
     and a timer nobody can see is just work. */
  useEffect(() => {
    if (transcript) return;
    const id = window.setInterval(
      () => setPromptIndex((current) => (current + 1) % PROMPTS.length),
      3200,
    );
    return () => window.clearInterval(id);
  }, [transcript]);

  /* The drawer's New Task is the phone's primary action, so it has to land
     somewhere: it closes the drawer and puts the caret in the composer. */
  const focusComposer = React.useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.scrollIntoView({ block: "center", behavior: "smooth" });
    composer.focus({ preventScroll: true });
  }, []);

  // Handle Voice Recording Logic
  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      audioChunksRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const audioUrl = URL.createObjectURL(audioBlob);
          console.log("Audio recording saved:", audioUrl);
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event: any) => {
            let currentTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
              currentTranscript += event.results[i][0].transcript;
            }
            setTranscript(currentTranscript);
          };
          recognition.start();
        }
      } catch (error) {
        console.error("Microphone access denied or not supported:", error);
        alert("Microphone permission is required to record voice notes.");
      }
    }
  };

  const chosenModel = modelById(model);

  return (
    <ProjectsProvider>
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-canvas">
      {/* Shared with the project workspace, so a phone sees the same light on
          both screens. */}
      <PhoneField />

      <TopNav
        onUpgradeClick={() => setBillingOpen(true)}
        onAccountSettingsClick={() => {
          setSettingsSection("account");
          setAccountSettingsOpen(true);
        }}
        projectName={projectName ?? "No project yet"}
        credits={credits}
      />

      <TopBar
        onMenuClick={() => setSidebarOpen(true)}
        onUpgradeClick={() => setBillingOpen(true)}
        /* On a phone the open apps ride in the bar itself, on one line with the
           hamburger and Upgrade. */
        tabs={<WorkspaceTabs placement="inline" />}
      />

      {/* The same strip as its own row, from md up, where a browser's tabs go.
          It draws nothing until an app is opened, so an account that has never
          opened a project sees Home exactly as before. */}
      <WorkspaceTabs />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onUpgradeClick={() => {
          setSidebarOpen(false);
          setBillingOpen(true);
        }}
        onAccountSettings={() => {
          setSettingsSection("account");
          setAccountSettingsOpen(true);
        }}
        onNewTask={focusComposer}
        credits={credits}
      />

      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onUpgradeClick={() => {
          setAccountSettingsOpen(false);
          setBillingOpen(true);
        }}
        credits={credits}
        agents={AGENTS}
        selectedAgent={selectedAgent}
        initialSection={settingsSection}
      />
      <SupportChat />
      <ComingSoonModal open={comingSoonOpen} onClose={() => setComingSoonOpen(false)} />

      {/* Centred on the viewport: this screen has no sidebar to offset against. */}
      {/* pt-7 on a phone, not pt-10: the phone bar stands 12px taller than the
          header it replaced, and this is the 12px back.

          The heading's own offset below is a share of the screen rather than a
          fixed 72px. The reference puts it at 152 of a 668-tall page — 22.75% —
          and a fixed offset holds that on a 668-tall screen only: on a taller
          phone the whole block rides up toward the top instead of sitting where
          the reference sits. 22.75vh less the 80px of header and padding above
          it keeps the proportion at any height, and still resolves to 72px at
          668. */}
      <main className="relative z-10 mx-auto flex w-full flex-1 flex-col items-center px-4 pb-16 pt-7 md:px-5 md:pt-10">
        <ProjectSwitcher
          onSelectedChange={setProjectName}
          onOpenSettings={(pane) => {
            setSettingsSection(pane);
            setAccountSettingsOpen(true);
          }}
        />

        <h1 className="hero-offset text-center text-[clamp(18px,4.9vw,22px)] font-normal leading-[26px] tracking-normal text-ink sm:text-[32px] sm:font-semibold sm:leading-tight sm:tracking-tight">
          What will you build today?
        </h1>

        {/* Tabs and composer share this column, so they stay aligned. */}
        <div className="relative mt-14 w-[min(750px,calc(100vw-32px))] md:mt-7 md:w-[min(750px,calc(100vw-40px))]" ref={popoverRef}>
          {/* Target tabs, fused to the canvas below them */}
          <div className="relative z-40 mb-[14px] flex items-center gap-2 overflow-x-auto px-0 sm:gap-1 md:mb-0 md:px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {projectTypes.map((type) => {
              const Icon = type.icon;
              const PhoneIcon = type.phoneIcon;
              const active = activeType === type.id;
              return (
                <button
                  key={type.id}
                  onClick={() => setActiveType(type.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[13px] font-normal leading-[20px] transition-all md:leading-normal sm:gap-2 md:-mb-px md:py-2.5 md:font-medium md:flex-none md:shrink-0 md:justify-start md:rounded-b-none md:rounded-t-[14px] md:px-5 md:py-2.5 md:text-sm ${
                    active
                      ? "border-line/[0.16] bg-layer/[0.07] font-medium text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] md:border-line/[0.08] md:border-b-transparent md:bg-panel md:shadow-none"
                      : "border-line/[0.08] bg-layer/[0.03] text-faint hover:bg-layer/[0.06] hover:text-ink md:border-transparent md:text-muted"
                  }`}
                >
                  <PhoneIcon className={`h-4 w-4 shrink-0 md:hidden ${active ? "text-ink" : "text-faint"}`} />
                  <Icon className={`hidden h-4 w-4 md:block ${active ? "text-ink" : "text-muted"}`} />
                  {type.label}
                  {"beta" in type && type.beta ? (
                    <span className="rounded-full bg-[#2F6BFF] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white">
                      Beta
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Premium AI Chat Input Container with Exact Graphite Background & Continuous Orbiting Highlight */}
          <div ref={composerBoxRef} className="group relative w-full overflow-visible rounded-[26px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.35)] md:rounded-[14px]">
            {/* The upload menu, anchored to the composer it belongs to. It used
                to hang off the whole column, which put it above the tabs and
                behind the phone header — its first row was unreadable there. */}
            <AnimatePresence>
              {isUploadPopoverOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="absolute bottom-full left-0 right-0 z-[1000] mb-2.5 space-y-1.5 rounded-[20px] border border-line/[0.14] bg-panel p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl md:right-auto md:mb-3 md:w-72"
                >
                  <button
                    onClick={() => {
                      photoLibraryInputRef.current?.click();
                      setIsUploadPopoverOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-ink/90 hover:bg-layer/[0.06] transition-colors text-left group"
                  >
                    <span className="font-medium">Photo Library</span>
                    <ImageIcon className="w-4 h-4 text-muted group-hover:text-ink transition-colors" />
                  </button>
                  <button
                    onClick={() => {
                      cameraInputRef.current?.click();
                      setIsUploadPopoverOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-ink/90 hover:bg-layer/[0.06] transition-colors text-left group"
                  >
                    <span className="font-medium">Take Photo or Video</span>
                    <Camera className="w-4 h-4 text-muted group-hover:text-ink transition-colors" />
                  </button>
                  <button
                    onClick={() => {
                      chooseFilesInputRef.current?.click();
                      setIsUploadPopoverOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-ink/90 hover:bg-layer/[0.06] transition-colors text-left group"
                  >
                    <span className="font-medium">Choose Files</span>
                    <FolderOpen className="w-4 h-4 text-muted group-hover:text-ink transition-colors" />
                  </button>
                  <button
                    onClick={() => {
                      alert("Google Drive integration triggered");
                      setIsUploadPopoverOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-ink/90 hover:bg-layer/[0.06] transition-colors text-left group"
                  >
                    <span className="font-medium">Google Drive</span>
                    <Triangle className="w-4 h-4 text-muted group-hover:text-ink transition-colors" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {/* Continuously moving 360-degree white highlight orbiter */}
            <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden rounded-[26px] md:rounded-[14px]">
              <div className="absolute -inset-[150%] animate-orbit-border bg-[conic-gradient(from_0deg_at_50%_50%,rgba(236,243,255,0.40)_0deg,rgba(236,243,255,0.12)_78deg,rgba(236,243,255,0.04)_128deg,rgba(236,243,255,0.34)_196deg,rgba(236,243,255,0.10)_268deg,rgba(236,243,255,0.04)_310deg,rgba(236,243,255,0.40)_360deg)] md:bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_310deg,rgba(232,232,232,0.4)_340deg,#FFFFFF_355deg,transparent_360deg)]" />
            </div>

            {/* Inner Graphite Glass Box matching #26252A */}
            <div className="relative z-30 flex min-h-[154px] w-full flex-col justify-between overflow-hidden rounded-[26px] border-[1.5px] border-line/[0.11] bg-sunken bg-clip-padding p-3.5 sm:p-[18px] md:min-h-[159px] md:rounded-[14px] md:border-[3px] md:border-line/[0.1] md:bg-panel md:bg-clip-border">
              {/* A real placeholder attribute cannot animate, so the prompt is drawn
                  over the box instead and the whole line fades out and back in.
                  It sits behind the caret and ignores the pointer, so typing and
                  clicking still land in the textarea. */}
              <div className="relative">
                <textarea
                  ref={composerRef}
                  onFocus={() => {
                    setComposerFocused(true);
                    setIsModelPopoverOpen(false);
                  }}
                  onBlur={() => setComposerFocused(false)}
                  aria-label="Describe what you want to build"
                  rows={3}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="relative z-10 h-[70px] w-full resize-none bg-transparent text-base text-ink outline-none md:h-auto"
                />
                <AnimatePresence mode="wait">
                  {!transcript && (
                    <motion.span
                      key={promptIndex}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: "easeInOut" }}
                      aria-hidden
                      className="pointer-events-none absolute left-0 top-0 select-none text-base text-faint md:text-faint"
                    >
                      {PROMPTS[promptIndex]}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <div className="relative mt-3 flex items-center justify-between gap-2 sm:mt-4">
                <div className="relative flex shrink-0 items-center gap-[3px] sm:gap-2">
                  {/* Hidden File Inputs */}
                  <input
                    type="file"
                    ref={photoLibraryInputRef}
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />
                  <input
                    type="file"
                    ref={cameraInputRef}
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />
                  <input
                    type="file"
                    ref={chooseFilesInputRef}
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />

                  {/* Attachment Clip Button */}
                  <button
                    onClick={() => chooseFilesInputRef.current?.click()}
                    aria-label="Add photos or files"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.06] text-ink transition-all active:scale-[0.98] md:hidden"
                  >
                    <Paperclip className="h-4 w-4 -rotate-45" />
                  </button>
                  <button
                    onClick={() => {
                      // Both panels hang above the composer, so only one of
                      // them can be up at a time.
                      setIsUploadPopoverOpen(!isUploadPopoverOpen);
                      setIsModelPopoverOpen(false);
                    }}
                    aria-label="Add photos or files"
                    aria-expanded={isUploadPopoverOpen}
                    className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] md:flex sm:h-10 sm:w-10 ${
                      isUploadPopoverOpen
                        ? "bg-layer/[0.08] border-line/[0.2] text-ink"
                        : "bg-layer/[0.03] border-line/[0.08] hover:bg-layer/[0.06] hover:border-line/[0.12] text-ink"
                    }`}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>

                  {/* Source control, as in the reference toolbar */}
                  <button
                    title="Connect a repository"
                    aria-label="Connect a repository"
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] md:flex md:h-10 md:w-10"
                  >
                    <Github className="h-4 w-4" />
                  </button>

                  {/* Agent selector — the phone's control. The sheet it opens has
                      the room to describe each agent; the bar under a thumb has not,
                      so the phone keeps naming the agent and the desktop names the
                      model instead. */}
                  <button
                    onClick={() => setIsAgentModalOpen(true)}
                    aria-label="Choose an agent"
                    className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line/[0.08] bg-layer/[0.06] px-2.5 text-[13px] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] sm:h-10 sm:gap-2 sm:px-3.5 sm:text-sm md:hidden"
                  >
                    <AgentMark className="h-4 w-4 text-ink" />
                    <span className="font-medium tracking-tight">{selectedAgent}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-ink" />
                  </button>

                  {/* Model selector — the workspace's chip, from md up: the maker's
                      mark, the model's short name, and the list of Claude, ChatGPT
                      and Gemini behind it. */}
                  <button
                    onClick={() => {
                      setIsModelPopoverOpen((open) => !open);
                      setIsUploadPopoverOpen(false);
                    }}
                    aria-expanded={isModelPopoverOpen}
                    aria-label="Choose a model"
                    className="hidden h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line/[0.08] bg-layer/[0.03] px-2.5 text-[13px] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] md:flex md:h-10 md:gap-2 md:px-3.5 md:text-sm"
                  >
                    <ProviderMark provider={chosenModel.provider} />
                    <span className="font-medium tracking-tight">{shortModelName(chosenModel)}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-ink transition-transform ${
                        isModelPopoverOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-[3px] sm:gap-2">
                  <button
                    onClick={() => setIsPrivacyModalOpen(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-line/[0.08] bg-layer/[0.06] text-sm text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] md:bg-layer/[0.03] active:scale-[0.98] sm:h-10 sm:w-auto sm:px-3.5"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="hidden font-medium capitalize tracking-tight sm:inline">{selectedPrivacy}</span>
                  </button>
                  <button
                    onClick={() => setIsAdvancedModalOpen(true)}
                    title="Advanced controls"
                    aria-label="Advanced controls"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.06] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] sm:h-10 sm:w-10 md:bg-layer/[0.03]"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>

                  {/* Interactive Voice Recording Button */}
                  <button
                    onClick={toggleRecording}
                    title={isRecording ? "Stop Recording" : "Start Recording"}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] sm:h-10 sm:w-10 ${
                      isRecording
                        ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                        : "bg-layer/[0.06] border-line/[0.08] hover:bg-layer/[0.06] hover:border-line/[0.12] text-white md:bg-layer/[0.03]"
                    }`}
                  >
                    {isRecording ? (
                      <MicOff className="h-4 w-4" />
                    ) : (
                      <>
                        <MicMark className="h-4 w-4 md:hidden" />
                        <Mic className="hidden h-4 w-4 md:block" />
                      </>
                    )}
                  </button>

                  {/* Send sits in the bar's own material rather than shouting over it,
                      and only lifts once there is something to send. It names a
                      new app from what was typed and opens it; the build runs
                      in the workspace it opens. */}
                  <StartBuildButton prompt={transcript} onError={setStartError} />
                </div>
              </div>
            </div>

            {startError && (
              <p role="alert" className="mt-2 px-1 text-[12px] leading-relaxed text-danger">
                {startError}
              </p>
            )}

            {/* Hung off the whole composer rather than off the chip, and for the
                same reason the upload menu is: the graphite box clips what grows
                out of it, and the tabs above it would paint over a panel drawn
                inside. Opening upward keeps a list this tall on screen — the
                composer sits low enough that the room is above it. Never a sheet:
                the chip that opens it is desktop-only. */}
            <Popover
              open={isModelPopoverOpen}
              onClose={() => setIsModelPopoverOpen(false)}
              title="Select model"
              align="left"
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
                            setIsModelPopoverOpen(false);
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

          {/* Starters, centred under the composer. The row scrolls sideways
              rather than wrapping, so it stays one line on a phone and the chips keep
              the size they have on a desktop. */}
          <div className="mt-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* w-max + mx-auto centres the row under the composer while it fits, and lets
                it start at the left edge once it is wider than the column — centring the
                flex line itself would push the first chip out of reach when it scrolls. */}
            <div className="mx-auto flex w-max gap-2">
            {STARTERS.map((starter) => {
              const Icon = starter.icon;

              return (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => {
                    if ("soon" in starter && starter.soon) {
                      setComingSoonOpen(true);
                      return;
                    }
                    setTranscript(starter.prompt);
                    const composer = composerRef.current;
                    if (!composer) return;
                    composer.focus();
                    // Runs after React has written the new value, so the caret lands at
                    // the end of the prompt rather than wherever it last sat.
                    requestAnimationFrame(() => {
                      composer.setSelectionRange(starter.prompt.length, starter.prompt.length);
                    });
                  }}
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line/[0.06] bg-layer/[0.03] px-3 py-2 text-[13px] text-soft transition-colors hover:border-line/[0.12] hover:bg-layer/[0.06] hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-line/30"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />
                  {starter.label}
                  {"soon" in starter && starter.soon ? <ComingSoonBadge /> : null}
                </button>
              );
            })}
            </div>
          </div>
        </div>

        <ProjectList />
      </main>

      {/* Below the list of what has been built: the way back to the composer at
          the top of this page, and the footer under it. Outside main, so both
          run the full width rather than the column the composer sits in.

          From md up only. A phone's Home ends on the list — the composer is one
          thumb-flick back up, so a band inviting you to return to it is a screen
          of scrolling to say what the screen above already said, and a
          five-column footer of links is a page in its own right down there. The
          desktop has the room and the pointer that makes a link row worth
          having. */}
      <div className="hidden md:block">
        <KeepBuilding onKeepBuilding={focusComposer} />
        <DashboardFooter />
      </div>

      {/* Select Agent Modal Sheet */}
      <AnimatePresence>
        {isAgentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md bg-panel border border-line/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-ink tracking-tight">Select Agent</h3>
                <button
                  onClick={() => setIsAgentModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-layer/[0.04] border border-line/[0.06] flex items-center justify-center text-ink/70 hover:text-ink hover:bg-layer/[0.08] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                {AGENTS.map((agent) => {
                  const isSelected = selectedAgent === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => {
                        // The one that is not here yet explains itself rather
                        // than becoming the agent a build would be handed to.
                        if (agent.soon) {
                          setIsAgentModalOpen(false);
                          setComingSoonOpen(true);
                          return;
                        }
                        setSelectedAgent(agent.id);
                        setIsAgentModalOpen(false);
                      }}
                      className={`p-4 rounded-[18px] cursor-pointer transition-all duration-200 flex items-center justify-between border ${
                        agent.soon
                          ? "bg-layer/[0.02] border-line/[0.04]"
                          : isSelected
                            ? "bg-layer/[0.07] border-accent/50 shadow-[0_0_15px_rgba(52,245,160,0.08)]"
                            : "bg-layer/[0.035] border-line/[0.05] hover:bg-layer/[0.055] hover:border-line/[0.1]"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <h4 className={`text-sm font-semibold ${agent.soon ? "text-ink/55" : "text-ink"}`}>
                          {agent.title}
                        </h4>
                        <p className="text-xs text-muted font-normal">{agent.subtitle}</p>
                      </div>
                      {agent.soon ? (
                        <ComingSoonBadge />
                      ) : (
                        isSelected && (
                          <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Privacy Settings Modal Sheet */}
      <AnimatePresence>
        {isPrivacyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md bg-panel border border-line/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-ink tracking-tight">Privacy Settings</h3>
                <button
                  onClick={() => setIsPrivacyModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-layer/[0.04] border border-line/[0.06] flex items-center justify-center text-ink/70 hover:text-ink hover:bg-layer/[0.08] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                <div
                  onClick={() => {
                    setSelectedPrivacy("public");
                    setIsPrivacyModalOpen(false);
                  }}
                  className={`p-4 rounded-[18px] cursor-pointer transition-all duration-200 flex items-center justify-between border ${
                    selectedPrivacy === "public"
                      ? "bg-layer/[0.07] border-line/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                      : "bg-layer/[0.035] border-line/[0.05] hover:bg-layer/[0.055] hover:border-line/[0.1]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPrivacy === "public" ? "border-line" : "border-line/40"}`}>
                        {selectedPrivacy === "public" && <div className="w-2 h-2 rounded-full bg-solid" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-ink">Public</h4>
                        <Globe className="w-3.5 h-3.5 text-muted" />
                      </div>
                      <p className="text-xs text-muted font-normal">Anyone can view and explore</p>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => {
                    setSelectedPrivacy("private");
                    setIsPrivacyModalOpen(false);
                  }}
                  className={`p-4 rounded-[18px] cursor-pointer transition-all duration-200 flex items-center justify-between border ${
                    selectedPrivacy === "private"
                      ? "bg-layer/[0.07] border-line/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                      : "bg-layer/[0.035] border-line/[0.05] hover:bg-layer/[0.055] hover:border-line/[0.1]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPrivacy === "private" ? "border-line" : "border-line/40"}`}>
                        {selectedPrivacy === "private" && <div className="w-2 h-2 rounded-full bg-solid" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-ink">Private</h4>
                        <Lock className="w-3.5 h-3.5 text-muted" />
                      </div>
                      <p className="text-xs text-muted font-normal">Only visible to yourself, unless shared</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-layer/[0.04] border border-line/[0.08] text-xs font-medium text-warn">
                    <Globe className="w-3 h-3" />
                    <span>Standard</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Advanced Controls Modal Sheet */}
      <AnimatePresence>
        {isAdvancedModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md bg-panel border border-line/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-5"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-ink tracking-tight">Advanced Controls</h3>
                <button
                  onClick={() => setIsAdvancedModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-layer/[0.04] border border-line/[0.06] flex items-center justify-center text-ink/70 hover:text-ink hover:bg-layer/[0.08] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-layer/[0.05] flex items-center justify-center text-ink">
                      <Bot className="w-4 h-4 text-accent" />
                    </div>
                    <span className="text-sm font-semibold text-ink flex items-center gap-1">
                      Maxx <Sparkles className="w-3.5 h-3.5 text-accent" />
                    </span>
                  </div>
                  <button
                    onClick={() => setMaxxEnabled(!maxxEnabled)}
                    className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${maxxEnabled ? "bg-accent" : "bg-layer/20"}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-black transition-transform ${maxxEnabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    Select Model
                  </span>
                  <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Cpu className="w-4 h-4 text-muted" />
                      <span className="text-sm font-semibold text-ink">{selectedModel}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Select MCP Tools
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F4D96B] text-black">
                      New
                    </span>
                  </div>
                  <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Paperclip className="w-4 h-4 text-muted" />
                      <span className="text-sm font-semibold text-ink">Select MCP Tools</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    GitHub
                  </span>
                  <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Github className="w-4 h-4 text-muted" />
                      <span className="text-sm font-semibold text-ink">Connect to GitHub</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    Select Template
                  </span>
                  <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <span className="text-sm font-semibold text-ink">Full Stack Template</span>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Keyframe animations for continuous 360-degree border orbiting highlight */}
      <style jsx>{`
        @keyframes borderOrbit {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        .animate-orbit-border {
          animation: borderOrbit 2s linear infinite;
        }
        @media (max-width: 767px) {
          .animate-orbit-border {
            animation-duration: 7s;
          }
        }
      `}</style>
    </div>
    </ProjectsProvider>
  );
}
