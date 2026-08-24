"use client";

import React, { useState, useRef, useEffect } from "react";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import BillingModal from "./components/billing/BillingModal";
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
  MonitorSmartphone,
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

const projectTypes = [
  { id: "web", label: "Web App", icon: MonitorSmartphone },
  { id: "mobile", label: "Mobile App", icon: Smartphone },
  { id: "landing", label: "Website", icon: AppWindow },
];

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [activeType, setActiveType] = useState("web");
  const [composerFocused, setComposerFocused] = useState(false);

  // Agent Selector State & Data
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("E-1");

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

  const agents = [
    { id: "E-1", title: "E-1", subtitle: "Stable & thorough" },
    { id: "E-2", title: "E-2", subtitle: "Thorough & Relentless" },
    { id: "Prototype", title: "Prototype", subtitle: "Experimental Agent" },
    { id: "Mobile", title: "Mobile", subtitle: "Agent for mobile apps" },
  ];

  return (
    <div className="w-full min-h-[100dvh] h-[100dvh] flex flex-col justify-between overflow-x-hidden relative pt-[env(safe-area-inset-top)] pb-[max(16px,env(safe-area-inset-bottom))] px-[12px] md:px-[24px] py-[32px]">
      <TopBar
        onMenuClick={() => setSidebarOpen(true)}
        onUpgradeClick={() => setBillingOpen(true)}
      />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onUpgradeClick={() => setBillingOpen(true)}
      />
      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
      <SupportChat />

      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-[900px] min-w-[320px] mx-auto">
        <h1 className="text-3xl md:text-[38px] font-semibold text-white text-center leading-tight max-w-2xl tracking-tight mb-2">
          What will you build today?
        </h1>

        <div className="mt-6" />

        {/* Ambient atmospheric background bloom beneath container */}
        <div className="relative w-full max-w-[900px]" ref={popoverRef}>
          <div className="pointer-events-none absolute -inset-2 rounded-[32px] bg-gradient-to-r from-emerald-500/10 to-teal-500/10 blur-2xl transition-all duration-500" />

          {/* Target tabs, fused to the canvas below them */}
          <div className="relative z-40 flex items-center gap-0.5 overflow-x-auto px-2 sm:gap-1 sm:px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {projectTypes.map((type) => {
              const Icon = type.icon;
              const active = activeType === type.id;
              return (
                <button
                  key={type.id}
                  onClick={() => setActiveType(type.id)}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-[14px] border px-3 py-2 text-[13px] font-medium transition-all sm:gap-2 sm:px-5 sm:py-2.5 sm:text-sm ${
                    active
                      ? "border-[rgba(255,255,255,0.08)] border-b-transparent bg-[#26252A] text-white"
                      : "border-transparent bg-white/[0.03] text-[#8F939A] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-white" : "text-[#8F939A]"}`} />
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
          <div className="relative w-full rounded-2xl p-[1px] overflow-visible group shadow-[0_12px_40px_rgba(0,0,0,0.35),0_0_50px_rgba(34,197,94,0.12)] min-h-[120px] md:min-h-[140px]">
            {/* Continuously moving 360-degree white highlight orbiter */}
            <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden z-25">
              <div className="absolute -inset-[150%] animate-orbit-border bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_310deg,rgba(232,232,232,0.4)_340deg,#FFFFFF_355deg,transparent_360deg)]" />
            </div>

            {/* Inner Graphite Glass Box matching #26252A */}
            <div className="relative z-30 flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] border-t-white/20 bg-[#26252A] p-3.5 backdrop-blur-2xl sm:p-5 ">
              <textarea
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder="Build me a clone of netflix..."
                rows={3}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="w-full bg-transparent text-white text-base placeholder:text-[#8F939A] resize-none outline-none"
              />

              <div className="relative mt-3 flex items-center justify-between gap-2 sm:mt-4">
                <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
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
                        : "bg-white/[0.03] border-[rgba(255,255,255,0.08)] hover:bg-white/[0.06] hover:border-white/[0.12] text-[#8F939A] hover:text-white"
                    }`}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  {/* Source control, as in the reference toolbar */}
                  <button
                    title="Connect a repository"
                    aria-label="Connect a repository"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-[#8F939A] transition-all hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white active:scale-[0.98] sm:h-10 sm:w-10"
                  >
                    <Github className="h-4 w-4" />
                  </button>

                  {/* Model selector, as in the reference toolbar */}
                  <button
                    onClick={() => setIsAdvancedModalOpen(true)}
                    className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-2 text-[12px] text-white/90 transition-all hover:border-white/[0.12] hover:bg-white/[0.06] active:scale-[0.98] sm:h-10 sm:gap-2 sm:px-3.5 sm:text-sm"
                  >
                    <Sparkles className="h-4 w-4 text-[#34F5A0]" />
                    <span className="font-medium tracking-tight">{selectedModel}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-[#8F939A]" />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                  <button
                    onClick={() => setIsPrivacyModalOpen(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-sm text-[#8F939A] transition-all hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white active:scale-[0.98] sm:h-10 sm:w-auto sm:px-3.5"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="hidden font-medium capitalize tracking-tight sm:inline">{selectedPrivacy}</span>
                  </button>
                  <button
                    onClick={() => setIsAgentModalOpen(true)}
                    title={`Agent: ${selectedAgent}`}
                    aria-label="Choose an agent"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-[#8F939A] transition-all hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white active:scale-[0.98] sm:h-10 sm:w-10"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>

                  {/* Interactive Voice Recording Button */}
                  <button
                    onClick={toggleRecording}
                    title={isRecording ? "Stop Recording" : "Start Recording"}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all active:scale-[0.98] ${
                      isRecording
                        ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                        : "bg-white/[0.03] border-[rgba(255,255,255,0.08)] hover:bg-white/[0.06] hover:border-white/[0.12] text-[#8F939A] hover:text-white"
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
                        : "border-transparent bg-[#35343B] text-[#7C818A]"
                    }`}
                  >
                    <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
                {agents.map((agent) => {
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
      `}</style>
    </div>
  );
}
