"use client";

import React, { useState, useRef, useEffect } from "react";
import TopNav from "./components/TopNav";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import BillingModal from "./components/billing/BillingModal";
import AccountSettingsModal from "./components/AccountSettingsModal";
import { AGENTS } from "./agents";
import ProjectSwitcher from "./components/ProjectSwitcher";
import ProjectList from "./components/ProjectList";
import { ProjectsProvider } from "./ProjectsContext";
import SupportChat from "./components/SupportChat";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paperclip,
  ChevronDown,
  Globe,
  Settings,
  SlidersHorizontal,
  Mic,
  MicOff,
  ArrowUp,
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
  Image as ImageIcon,
  Camera,
  FolderOpen,
  Triangle,
} from "lucide-react";

/* No credits service exists yet, so the panel shows the figure the app already
   displayed rather than a number invented for the design. */
const CREDITS = "0.00";

/* The row under the composer. Each chip is a way into a build rather than a
   label: tapping one drops its prompt into the bar and puts the caret at the
   end, so the next thing a visitor does is edit a real sentence instead of
   facing an empty box. */
const STARTERS = [
  {
    label: "Mobile App",
    beta: true,
    icon: Smartphone,
    prompt: "Build a mobile app for iOS and Android with sign-in, a home feed and push notifications.",
  },
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
  { id: "web", label: "Web App", icon: Layers, phoneIcon: Globe },
  { id: "mobile", label: "Mobile App", icon: Smartphone, phoneIcon: Smartphone },
  { id: "landing", label: "Website", icon: AppWindow, phoneIcon: AppWindow },
];

export default function DashboardPage() {
  const [billingOpen, setBillingOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [activeType, setActiveType] = useState("web");
  const [composerFocused, setComposerFocused] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [projectName, setProjectName] = useState<string | null>(null);

  // The phone header opens this; from md up the drawer never mounts.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Agent Selector State & Data
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("Q1");

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

  return (
    <ProjectsProvider>
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-[#0d0d0f]">
      {/* The phone backdrop: a deep blue field off the top of the screen, two
          diagonal bands of light blurred into it, then a black floor and a
          vignette that closes the edges. It is fixed, so the page scrolls
          through the light rather than dragging it along. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden md:hidden">
        {/* The floor the field sits on — the reference's lower half is this flat,
            with no vignette closing it. */}
        <div className="absolute inset-0 bg-[#040507]" />
        {/* The field: sampled down the reference's own centre, bright blue under
            the status bar and gone by a third of the way down the screen. */}
        <div className="absolute inset-x-0 top-0 h-[45%] bg-[linear-gradient(180deg,#073e80_0%,#073c7a_3%,#072c58_14%,#082243_26%,#071b30_37%,#04111f_49%,#030910_63%,#030407_78%,transparent_100%)]" />
        {/* The streaks: 45 degrees on a 118px pitch, the pitch the reference
            carries, at a little under its contrast. They fade with the field
            rather than crossing into the black. */}
        <div className="absolute inset-x-0 top-0 h-[45%] bg-[repeating-linear-gradient(135deg,rgba(128,192,255,0.17)_0px,rgba(128,192,255,0)_59px,rgba(128,192,255,0.17)_118px)] [-webkit-mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)] [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)]" />
      </div>

      <TopNav
        onUpgradeClick={() => setBillingOpen(true)}
        onAccountSettingsClick={() => setAccountSettingsOpen(true)}
        projectName={projectName ?? "No project yet"}
        credits={CREDITS}
      />

      <TopBar onMenuClick={() => setSidebarOpen(true)} onUpgradeClick={() => setBillingOpen(true)} />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onUpgradeClick={() => {
          setSidebarOpen(false);
          setBillingOpen(true);
        }}
        onAccountSettings={() => setAccountSettingsOpen(true)}
        onNewTask={focusComposer}
        credits={CREDITS}
      />

      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onUpgradeClick={() => {
          setAccountSettingsOpen(false);
          setBillingOpen(true);
        }}
        credits={CREDITS}
        agents={AGENTS}
        selectedAgent={selectedAgent}
      />
      <SupportChat />

      {/* Centred on the viewport: this screen has no sidebar to offset against. */}
      {/* pt-7 on a phone, not pt-10: the phone bar stands 12px taller than the
          header it replaced, and this is the 12px back, so the heading and
          everything under it sit exactly where they did. */}
      <main className="relative z-10 mx-auto flex w-full flex-1 flex-col items-center px-4 pb-16 pt-7 md:px-5 md:pt-10">
        <ProjectSwitcher onSelectedChange={setProjectName} />

        <h1 className="mt-[72px] text-center text-[clamp(18px,4.9vw,22px)] font-normal leading-snug tracking-normal text-[#F5F5F5] sm:text-[32px] sm:font-semibold sm:leading-tight sm:tracking-tight md:mt-7">
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
                  className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[13px] font-normal transition-all sm:gap-2 md:-mb-px md:py-2.5 md:font-medium md:flex-none md:shrink-0 md:justify-start md:rounded-b-none md:rounded-t-[14px] md:px-5 md:py-2.5 md:text-sm ${
                    active
                      ? "border-white/[0.16] bg-white/[0.07] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] md:border-[rgba(255,255,255,0.08)] md:border-b-transparent md:bg-[#171719] md:shadow-none"
                      : "border-white/[0.08] bg-white/[0.03] text-[#9A9A9F] hover:bg-white/[0.06] hover:text-white md:border-transparent md:text-[#8F939A]"
                  }`}
                >
                  <PhoneIcon className={`h-4 w-4 shrink-0 md:hidden ${active ? "text-white" : "text-[#9A9A9F]"}`} />
                  <Icon className={`hidden h-4 w-4 md:block ${active ? "text-white" : "text-[#8F939A]"}`} />
                  {type.label}
                </button>
              );
            })}
          </div>

          {/* Floating Dropdown Overlay Menu - Unclipped & Positioned Above Chat Box */}
          <AnimatePresence>
            {isUploadPopoverOpen && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute left-0 bottom-full mb-3 z-[1000] w-72 bg-[#141416] border border-[#3A3A42] rounded-[20px] p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl space-y-1.5"
              >
                <button
                  onClick={() => {
                    photoLibraryInputRef.current?.click();
                    setIsUploadPopoverOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-white/90 hover:bg-white/[0.06] transition-colors text-left group"
                >
                  <span className="font-medium">Photo Library</span>
                  <ImageIcon className="w-4 h-4 text-[#8F939A] group-hover:text-white transition-colors" />
                </button>
                <button
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setIsUploadPopoverOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-white/90 hover:bg-white/[0.06] transition-colors text-left group"
                >
                  <span className="font-medium">Take Photo or Video</span>
                  <Camera className="w-4 h-4 text-[#8F939A] group-hover:text-white transition-colors" />
                </button>
                <button
                  onClick={() => {
                    chooseFilesInputRef.current?.click();
                    setIsUploadPopoverOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-white/90 hover:bg-white/[0.06] transition-colors text-left group"
                >
                  <span className="font-medium">Choose Files</span>
                  <FolderOpen className="w-4 h-4 text-[#8F939A] group-hover:text-white transition-colors" />
                </button>
                <button
                  onClick={() => {
                    alert("Google Drive integration triggered");
                    setIsUploadPopoverOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm text-white/90 hover:bg-white/[0.06] transition-colors text-left group"
                >
                  <span className="font-medium">Google Drive</span>
                  <Triangle className="w-4 h-4 text-[#8F939A] group-hover:text-white transition-colors" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Premium AI Chat Input Container with Exact Graphite Background & Continuous Orbiting Highlight */}
          <div className="group relative w-full overflow-visible rounded-[26px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.35)] md:rounded-[14px]">
            {/* Continuously moving 360-degree white highlight orbiter */}
            <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden rounded-[26px] md:rounded-[14px]">
              <div className="absolute -inset-[150%] animate-orbit-border bg-[conic-gradient(from_0deg_at_50%_50%,rgba(236,243,255,0.40)_0deg,rgba(236,243,255,0.12)_78deg,rgba(236,243,255,0.04)_128deg,rgba(236,243,255,0.34)_196deg,rgba(236,243,255,0.10)_268deg,rgba(236,243,255,0.04)_310deg,rgba(236,243,255,0.40)_360deg)] md:bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_310deg,rgba(232,232,232,0.4)_340deg,#FFFFFF_355deg,transparent_360deg)]" />
            </div>

            {/* Inner Graphite Glass Box matching #26252A */}
            <div className="relative z-30 flex min-h-[154px] w-full flex-col justify-between overflow-hidden rounded-[26px] border-[1.5px] border-white/[0.11] bg-[#15181D]/80 bg-clip-padding p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-[18px] md:min-h-[159px] md:rounded-[14px] md:border-[3px] md:border-[#292b32] md:bg-[#171719] md:bg-clip-border md:shadow-none md:backdrop-blur-none">
              {/* A real placeholder attribute cannot animate, so the prompt is drawn
                  over the box instead and the whole line fades out and back in.
                  It sits behind the caret and ignores the pointer, so typing and
                  clicking still land in the textarea. */}
              <div className="relative">
                <textarea
                  ref={composerRef}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  aria-label="Describe what you want to build"
                  rows={3}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="relative z-10 h-[70px] w-full resize-none bg-transparent text-base text-white outline-none md:h-auto"
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
                      className="pointer-events-none absolute left-0 top-0 select-none text-base text-[#9A9A9F] md:text-[#85858a]"
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
                    className="hidden"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />
                  <input
                    type="file"
                    ref={cameraInputRef}
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />
                  <input
                    type="file"
                    ref={chooseFilesInputRef}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      console.log(e.target.files);
                    }}
                  />

                  {/* Attachment Clip Button */}
                  <button
                    onClick={() => setIsUploadPopoverOpen(!isUploadPopoverOpen)}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] sm:h-10 sm:w-10 ${
                      isUploadPopoverOpen
                        ? "bg-white/[0.08] border-white/[0.2] text-white"
                        : "bg-white/[0.03] border-[rgba(255,255,255,0.08)] hover:bg-white/[0.06] hover:border-white/[0.12] text-white"
                    }`}
                  >
                    <Paperclip className="h-4 w-4 -rotate-45 md:rotate-0" />
                  </button>

                  {/* Source control, as in the reference toolbar */}
                  <button
                    title="Connect a repository"
                    aria-label="Connect a repository"
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.06] active:scale-[0.98] md:flex md:h-10 md:w-10"
                  >
                    <Github className="h-4 w-4" />
                  </button>

                  {/* Model selector, as in the reference toolbar */}
                  <button
                    onClick={() => setIsAgentModalOpen(true)}
                    aria-label="Choose an agent"
                    className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-2.5 text-[13px] text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.06] active:scale-[0.98] sm:h-10 sm:gap-2 sm:px-3.5 sm:text-sm"
                  >
                    <Bot className="h-4 w-4 text-white" />
                    <span className="font-medium tracking-tight">{selectedAgent}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-[3px] sm:gap-2">
                  <button
                    onClick={() => setIsPrivacyModalOpen(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-sm text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.06] active:scale-[0.98] sm:h-10 sm:w-auto sm:px-3.5"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="hidden font-medium capitalize tracking-tight sm:inline">{selectedPrivacy}</span>
                  </button>
                  <button
                    onClick={() => setIsAdvancedModalOpen(true)}
                    title="Advanced controls"
                    aria-label="Advanced controls"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.06] active:scale-[0.98] sm:h-10 sm:w-10"
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
                        : "bg-white/[0.03] border-[rgba(255,255,255,0.08)] hover:bg-white/[0.06] hover:border-white/[0.12] text-white"
                    }`}
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  {/* Send sits in the bar's own material rather than shouting over it,
                      and only lifts once there is something to send. */}
                  <button
                    disabled={!transcript.trim()}
                    aria-label="Send"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] sm:h-10 sm:w-10 ${
                      transcript.trim()
                        ? "border-transparent bg-[#4A4A54] text-white hover:bg-[#565662]"
                        : "border-transparent bg-[#35343B] text-white"
                    }`}
                  >
                    <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            </div>
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
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[13px] text-[#C7CAD0] transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[#8F939A]" />
                  {starter.label}
                  {"beta" in starter && starter.beta ? (
                    <span className="rounded-full bg-[#2F6BFF] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white">
                      Beta
                    </span>
                  ) : null}
                </button>
              );
            })}
            </div>
          </div>
        </div>

        <ProjectList />
      </main>

      {/* Select Agent Modal Sheet */}
      <AnimatePresence>
        {isAgentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md bg-[#121215] border border-white/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-white tracking-tight">Select Agent</h3>
                <button
                  onClick={() => setIsAgentModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-all"
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
                        setSelectedAgent(agent.id);
                        setIsAgentModalOpen(false);
                      }}
                      className={`p-4 rounded-[18px] cursor-pointer transition-all duration-200 flex items-center justify-between border ${
                        isSelected
                          ? "bg-[rgba(26,26,32,0.9)] border-[#34F5A0]/50 shadow-[0_0_15px_rgba(52,245,160,0.08)]"
                          : "bg-[rgba(18,18,22,0.6)] border-white/[0.05] hover:bg-[rgba(24,24,28,0.8)] hover:border-white/[0.1]"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <h4 className="text-sm font-semibold text-white">{agent.title}</h4>
                        <p className="text-xs text-[#8F939A] font-normal">{agent.subtitle}</p>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[#34F5A0]/15 flex items-center justify-center text-[#34F5A0]">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>
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
              className="w-full max-w-md bg-[#121215] border border-white/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-white tracking-tight">Privacy Settings</h3>
                <button
                  onClick={() => setIsPrivacyModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-all"
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
                      ? "bg-[rgba(26,26,32,0.9)] border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                      : "bg-[rgba(18,18,22,0.6)] border-white/[0.05] hover:bg-[rgba(24,24,28,0.8)] hover:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPrivacy === "public" ? "border-white" : "border-white/40"}`}>
                        {selectedPrivacy === "public" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">Public</h4>
                        <Globe className="w-3.5 h-3.5 text-[#8F939A]" />
                      </div>
                      <p className="text-xs text-[#8F939A] font-normal">Anyone can view and explore</p>
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
                      ? "bg-[rgba(26,26,32,0.9)] border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                      : "bg-[rgba(18,18,22,0.6)] border-white/[0.05] hover:bg-[rgba(24,24,28,0.8)] hover:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPrivacy === "private" ? "border-white" : "border-white/40"}`}>
                        {selectedPrivacy === "private" && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">Private</h4>
                        <Lock className="w-3.5 h-3.5 text-[#8F939A]" />
                      </div>
                      <p className="text-xs text-[#8F939A] font-normal">Only visible to yourself, unless shared</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-[#F4D96B]">
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
              className="w-full max-w-md bg-[#121215] border border-white/[0.08] rounded-[24px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-5"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-white tracking-tight">Advanced Controls</h3>
                <button
                  onClick={() => setIsAdvancedModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-[18px] bg-[rgba(18,18,22,0.6)] border border-white/[0.05] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-white/[0.05] flex items-center justify-center text-white">
                      <Bot className="w-4 h-4 text-[#34F5A0]" />
                    </div>
                    <span className="text-sm font-semibold text-white flex items-center gap-1">
                      Maxx <Sparkles className="w-3.5 h-3.5 text-[#34F5A0]" />
                    </span>
                  </div>
                  <button
                    onClick={() => setMaxxEnabled(!maxxEnabled)}
                    className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${maxxEnabled ? "bg-[#34F5A0]" : "bg-white/20"}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-black transition-transform ${maxxEnabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#8F939A] px-1">
                    Select Model
                  </span>
                  <div className="p-4 rounded-[18px] bg-[rgba(18,18,22,0.6)] border border-white/[0.05] hover:border-white/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Cpu className="w-4 h-4 text-[#8F939A]" />
                      <span className="text-sm font-semibold text-white">{selectedModel}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8F939A]" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#8F939A]">
                      Select MCP Tools
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F4D96B] text-black">
                      New
                    </span>
                  </div>
                  <div className="p-4 rounded-[18px] bg-[rgba(18,18,22,0.6)] border border-white/[0.05] hover:border-white/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Paperclip className="w-4 h-4 text-[#8F939A]" />
                      <span className="text-sm font-semibold text-white">Select MCP Tools</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8F939A]" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#8F939A] px-1">
                    GitHub
                  </span>
                  <div className="p-4 rounded-[18px] bg-[rgba(18,18,22,0.6)] border border-white/[0.05] hover:border-white/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <div className="flex items-center gap-3">
                      <Github className="w-4 h-4 text-[#8F939A]" />
                      <span className="text-sm font-semibold text-white">Connect to GitHub</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8F939A]" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#8F939A] px-1">
                    Select Template
                  </span>
                  <div className="p-4 rounded-[18px] bg-[rgba(18,18,22,0.6)] border border-white/[0.05] hover:border-white/[0.1] cursor-pointer flex items-center justify-between transition-all">
                    <span className="text-sm font-semibold text-white">Full Stack Template</span>
                    <ChevronRight className="w-4 h-4 text-[#8F939A]" />
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
