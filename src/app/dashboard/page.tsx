"use client";

import Link from "next/link";
import React, { useState, useRef, useEffect, useMemo } from "react";
import TopNav from "./components/TopNav";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import BillingModal from "./components/billing/BillingModal";
import AccountSettingsModal, {
  type AgentTab as SettingsAgentTab,
  type SectionId as SettingsSection,
} from "./components/AccountSettingsModal";
import {
  MODELS,
  isModelAvailable,
  modelById,
  shortModelName,
} from "./models";
import { AGENTS, agentForModel } from "./agents";
import { useModel } from "./useModel";
import { useCredits } from "./useCredits";
import ProjectSwitcher from "./components/ProjectSwitcher";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { MicMark } from "./components/marks";
import ProjectList from "./components/ProjectList";
import KeepBuilding from "./components/KeepBuilding";
import StartBuildButton, { type StartBuildHandle } from "./components/StartBuildButton";
import DashboardFooter from "./components/DashboardFooter";
import ScrollToEnds from "./components/ScrollToEnds";
import { ProjectsProvider } from "./ProjectsContext";
import SupportChat from "./components/SupportChat";
import ImportFromGitHub from "./components/ImportFromGitHub";
import { CardWelcomeBanner } from "./components/billing/CardWelcome";
import PhoneField from "./components/PhoneField";
import { ComingSoonModal } from "./components/ComingSoon";
import ChoiceSheet, { type ChoiceRow } from "./components/ChoiceSheet";
import Popover from "./components/workspace/Popover";
import { ProviderMark } from "./components/workspace/modelMarks";
import type { LucideIcon } from "lucide-react";
import type { BuildKind } from "@/lib/builder/kinds";
import { fitComposer } from "@/lib/composer-height";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  CATEGORY_LABEL,
  CATEGORY_NOTE,
  SUBTYPES,
  categoryFor,
  isComingSoon,
  formatTarget,
  inferSubtype,
  type Category,
} from "@/lib/builder/targets";
import { ACCEPT, MAX_ATTACHMENTS } from "@/lib/project-attachments";
import { PIPELINES, answersFor, type PipelineId } from "@/lib/video/pipelines";
import VideoTypeGrid from "./components/video/VideoTypeGrid";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Paperclip,
  ChevronDown,
  Globe,
  Settings,
  Clapperboard,
  Smartphone,
  Mic,
  MicOff,
  Layers,
  FileText,
  ShoppingBag,
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
  Newspaper,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { GITHUB_RETURNED } from "@/lib/github/connect-link";

/* The advanced-controls mark, Google's way: two rails, a ring on the left
   of the top one and on the right of the bottom one. */
function TuneMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden>
      <circle cx="7" cy="8" r="2.6" />
      <path d="M9.6 8H20" />
      <path d="M4 16h10.4" />
      <circle cx="17" cy="16" r="2.6" />
    </svg>
  );
}

/* What a new account holds — the one-time signup credit, which on Free is the
   whole of it — read from the credit economy rather than written out here, so
   this figure and the one signup actually grants cannot differ. */

/* The row under the composer, one per tab. Each chip is a way into a build
   rather than a label: tapping one drops its prompt into the bar and puts the
   caret at the end, so the next thing a visitor does is edit a real sentence
   instead of facing an empty box. Every chip is the tab's own kind of project,
   so a website idea never sits under Web App or the other way round. */
type Starter = { label: string; icon: LucideIcon; prompt: string; beta?: boolean };
const STARTERS: Record<Category, Starter[]> = {
  website: [
    { label: "Landing page", icon: AppWindow, prompt: "Build a landing page for my bakery with a hero, our best sellers, opening hours and a contact form." },
    { label: "Portfolio", icon: ImageIcon, prompt: "Build a portfolio website showing my work, a short bio and a way to get in touch." },
    { label: "Blog", icon: FileText, prompt: "Build a blog website with an article list, article pages and an about page." },
    { label: "Restaurant menu", icon: Newspaper, prompt: "Build a restaurant website with our menu, prices, opening hours and location." },
    { label: "Event page", icon: Sparkles, prompt: "Build an event website with the date, schedule, speakers and a sign-up form." },
  ],
  web_app: [
    /* The blue pill says what beta says: you can use this, and it may break.
       It belongs on the one starter that builds the most of an app for you. */
    { label: "Online store", icon: ShoppingBag, beta: true, prompt: "Build an online store with a product catalogue, cart and Stripe checkout." },
    { label: "Client dashboard", icon: Layers, prompt: "Build a dashboard with sign-in, a customer table and charts for revenue and usage." },
    { label: "Booking system", icon: Clock, prompt: "Build a booking app where customers log in, pick a time slot and get a confirmation." },
    { label: "AI agent", icon: Bot, prompt: "Build an AI assistant app that answers questions about my business from a chat window." },
    { label: "Internal tool", icon: Settings, prompt: "Build an internal tool where my team signs in and tracks requests in a shared table." },
  ],
  mobile_app: [
    { label: "Fitness tracker", icon: Smartphone, prompt: "Build a fitness tracker mobile app for iOS and Android that logs workouts and shows weekly progress." },
    { label: "Delivery app", icon: ShoppingBag, prompt: "Build a delivery mobile app where customers order, pay and track their delivery." },
    { label: "Social feed", icon: ImageIcon, prompt: "Build a social mobile app with a photo feed, likes, comments and profiles." },
    { label: "Habit tracker", icon: Check, prompt: "Build a habit tracker mobile app with daily check-ins, streaks and reminders." },
  ],
  fliers: [
    { label: "Sale promo", icon: Sparkles, prompt: "Design a flier for a summer sale, 30% off everything this weekend." },
    { label: "Event", icon: Clock, prompt: "Design a flier for our community event with the date, time and place." },
    { label: "Grand opening", icon: Sparkles, prompt: "Design a flier announcing the grand opening of our new shop." },
    { label: "Menu", icon: FileText, prompt: "Design a flier with our cafe menu and prices." },
  ],
  video: [
    { label: "Product promo", icon: Clapperboard, prompt: "Create a 30-second promo video for my product." },
    { label: "Explainer", icon: Video, prompt: "Create a short explainer video showing how my service works." },
    { label: "Social ad", icon: Video, prompt: "Create a 15-second social ad video for my brand." },
  ],
};

/* The five tabs above the composer. Each is a CATEGORY; what used to be the
 * tabs — Landing Page, Store, Blog, News — are Website's sub-types now, and
 * keep their own blueprints underneath (src/lib/builder/targets.ts). The tab
 * travels with the first message as ?target=, and the server reads the
 * sub-type from the sentence unless a chip under the composer picked one.
 *
 * Website is selected to begin with, which builds what the old Landing Page
 * default built. Until a tab is clicked it follows what is typed, so
 * "a poster for our launch party" moves it to Fliers. */
/* `phone` is the icon the phone's pills draw. They show the icon alone
   for every tab but the selected one, so it has to say the tab by itself:
   a globe for a web app, a browser window for a website, a video camera. */
const categoryTabs = [
  { id: "website", icon: AppWindow, phone: AppWindow },
  { id: "web_app", icon: Layers, phone: Globe },
  { id: "mobile_app", icon: Smartphone, phone: Smartphone },
  { id: "fliers", icon: ImageIcon, phone: ImageIcon },
  { id: "video", icon: Clapperboard, phone: Video },
] satisfies { id: Category; icon: LucideIcon; phone: LucideIcon }[];

/* The bar's placeholder: one example per tab, of the tab's own kind of
   project, so the hint never suggests what the tab does not build. */
const PLACEHOLDER: Record<Category, string> = {
  website: "Build a landing page for my bakery…",
  web_app: "Build a booking app where customers log in…",
  mobile_app: "Build a fitness tracker app for iOS and Android…",
  fliers: "Design a flier for a summer sale, 30% off…",
  video: "Create a 30-second promo video for…",
};

/* Every category has a tab: the mapped type is exhaustive over Category, so a
   sixth category fails the build here rather than quietly never appearing. */
type TabCategory = (typeof categoryTabs)[number]["id"];
const _everyCategoryHasATab: [Exclude<Category, TabCategory>] extends [never] ? true : ["no tab for:", Exclude<Category, TabCategory>] = true;
void _everyCategoryHasATab;

/* The template in Advanced Controls: whether the first build is one page or a
   full project. Labels a person reads; the ids are the `stack` /api/build
   takes. */
type StackChoice = "auto" | "standalone-html" | "nextjs";
const STACK_CHOICES: Record<StackChoice, { title: string; subtitle: string }> = {
  auto: { title: "Automatic", subtitle: "Decided from what you describe — a page, or a full app when it needs one" },
  "standalone-html": { title: "Single Page Template", subtitle: "One fast page: previews instantly, no sign-in or saved data" },
  nextjs: { title: "Full Stack Template", subtitle: "A Next.js app with routes, sign-in and a database" },
};

export default function DashboardPage() {
  const [billingOpen, setBillingOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  /* Which pane the settings panel opens on. The account menu wants its own; the
     project switcher wants the project's. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
  const [settingsAgentTab, setSettingsAgentTab] = useState<SettingsAgentTab | undefined>(undefined);
  /* Website until the person says otherwise — and "says" includes the
     prompt: until a tab is clicked, the tab follows what is typed. A clicked
     tab is a choice and stays. The sub-type is null while it is read from the
     sentence; a chip under the composer sets it. */
  const [transcript, setTranscript] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("website");
  const [activeSubtype, setActiveSubtype] = useState<string | null>(null);
  const pickedType = useRef(false);
  /* The Video tab's Step 1 and Step 2 — see VideoTypeGrid. */
  const [videoPipeline, setVideoPipeline] = useState<PipelineId | null>(null);
  const [videoAnswers, setVideoAnswers] = useState<Record<string, string>>({});
  const [videoConsent, setVideoConsent] = useState(false);
  const videoMode = activeCategory === "video";
  /* The sub-type the build will run as: the picked chip, or what the sentence
     reads as. Shown on the Auto chip so the guess is never hidden. */
  const subtype =
    SUBTYPES[activeCategory].find((entry) => entry.id === activeSubtype) ??
    inferSubtype(activeCategory, transcript);
  const activeType: BuildKind = subtype.kind;
  const [composerFocused, setComposerFocused] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);

  // The phone header opens this; from md up the drawer never mounts.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* How a Connect GitHub started from this screen went — ?github= on the way
     back from github.com. Read once and cleared from the address bar, so a
     reload does not announce it again. */
  const [githubNotice, setGithubNotice] = useState<string | null>(null);
  /* Import from GitHub — see ImportFromGitHub. Reopened on the way back from
     a Connect GitHub it started (?import=github), so connecting is one step of
     importing rather than a detour out of it. */
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const returned = url.searchParams.get("github");
    const importing = url.searchParams.get("import") === "github";
    if (!returned && !importing) return;
    if (importing && (!returned || returned === "connected")) setImportOpen(true);
    else setGithubNotice(GITHUB_RETURNED[returned ?? ""] ?? null);
    url.searchParams.delete("github");
    url.searchParams.delete("import");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  /* Back from signing in to an MCP server (?mcp=…&server=…): Settings opens on
     the MCP tab saying how it went, and the parameters leave the address bar so
     a reload does not say it again. */
  const [mcpNotice, setMcpNotice] = useState<{ reason: string; serverId: string | null } | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("mcp");
    if (!reason) return;
    setMcpNotice({ reason, serverId: url.searchParams.get("server") });
    setSettingsSection("agents");
    setSettingsAgentTab("mcp");
    setAccountSettingsOpen(true);
    url.searchParams.delete("mcp");
    url.searchParams.delete("server");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Agent Selector State & Data. The agent list is what a phone chooses from:
  // the sheet has the room for it and the bar has not, so Q1 stays the mobile
  // control while a pointer gets the model picker below.

  /* Model Selector State — the workspace's picker, on Home's bar from md up.
     Same list, same chip, so the model you pick before a build and the one you
     switch to inside it are named the same way in both places. */
  /* Held above both screens rather than here. Home and the workspace composer
     each used to keep their own, so a model chosen in one was discarded by the
     other and neither survived a reload — see useModel. */
  const { model, setModel, chosen: chosenModel, reach } = useModel();
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
  const chosenAgent = agentForModel(model);

  // Privacy Settings Modal State & Data
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [selectedPrivacy, setSelectedPrivacy] = useState("public");

  // Advanced Controls Modal State & Data
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);
  /* The full model list, opened from Advanced Controls. The chip in the
     composer opens the agents; this is every model, the same list and the
     same gates as the workspace's picker. */
  const [isAllModelsOpen, setIsAllModelsOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  /* Maxx is not a setting of its own — it IS the most capable model this
     deployment can call, so whether it is on is read off the model in force
     rather than kept beside it, where the two could disagree. Turning it off
     goes back to whatever was picked before it was turned on. */
  const maxxModel = MODELS.find((option) => option.provider !== "auto" && isModelAvailable(option)) ?? null;
  const maxxOn = Boolean(maxxModel) && model === maxxModel?.id;
  const maxxGate = maxxModel ? reach(maxxModel) : null;
  const beforeMaxx = useRef<string | null>(null);
  function toggleMaxx() {
    if (!maxxModel) return;
    if (maxxOn) {
      const back = beforeMaxx.current && beforeMaxx.current !== maxxModel.id ? beforeMaxx.current : "auto";
      setModel(back);
      beforeMaxx.current = null;
      return;
    }
    if (!maxxGate?.ok) return;
    beforeMaxx.current = model;
    setModel(maxxModel.id);
  }
  /* What the first build is made as. "auto" leaves it to the brief — see
     src/lib/builder/stack.ts — and is what nearly everybody should keep. The
     other two are sent with the first message as `stack`, which /api/build
     already takes as the answer and stops asking. */
  const [stackChoice, setStackChoice] = useState<StackChoice>("auto");
  /* A phone must not scroll the page behind the dialog. */
  useBodyScrollLock(isAdvancedModalOpen);
  useEffect(() => {
    if (!isAdvancedModalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAdvancedModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isAdvancedModalOpen]);

  // File Upload Popover & Hidden Inputs State
  /* Pictures picked on Home, held here until the app they belong to exists;
     StartBuildButton uploads them against it and the first message carries
     them. */
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Picking a video type writes its brief into the composer, with the first
     [PLACEHOLDER] selected so typing replaces it. Never over somebody's own
     words: only an empty box, or one still holding an untouched template, is
     filled. */
  function pickVideoType(id: PipelineId | null) {
    setVideoPipeline(id);
    if (!id) return;
    pickedType.current = true;
    const templates = Object.values(PIPELINES).map((entry) => entry.template);
    const current = transcript.trim();
    if (current && !templates.includes(current)) return;
    const template = PIPELINES[id].template;
    setTranscript(template);
    requestAnimationFrame(() => {
      const box = composerRef.current;
      if (!box) return;
      box.focus();
      const start = template.indexOf("[");
      const end = start >= 0 ? template.indexOf("]", start) + 1 : 0;
      if (start >= 0 && end > start) box.setSelectionRange(start, end);
      box.scrollTop = 0;
    });
  }

  function addFiles(list: FileList) {
    const picked = Array.from(list);
    const images = picked.filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name));
    const room = MAX_ATTACHMENTS - files.length;
    if (images.length < picked.length) setStartError("Only images can be attached — a screenshot, a logo or a photo.");
    else if (images.length > room) setStartError(`Up to ${MAX_ATTACHMENTS} images per message.`);
    else setStartError(null);
    if (room > 0) setFiles((current) => [...current, ...images.slice(0, room)]);
  }

  // Voice Recording State & Refs
  const [isRecording, setIsRecording] = useState(false);
  /* Why a send did not open an app. Held here rather than in the button so it
     can be shown under the composer, where the text that failed still is. */
  const [startError, setStartError] = useState<string | null>(null);
  /* Whether there is any point starting one. Home is where a person commits to
     a whole new project, so it is the worst place to accept a brief that cannot
     be built — they name the thing, describe it, press send, and land in a
     workspace whose only content is a failure. See
     src/lib/builder/availability.ts. */
  const [paused, setPaused] = useState<{ message: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/builder/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!live || !body?.paused) return;
        setPaused({ message: String(body.message ?? "") });
      })
      /* Silence on failure: the build request will give the real reason if it
         comes to that, and greying the composer over a fetch that did not
         answer would be an outage this page invented. */
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  /* The account's own balance rather than a constant. useCredits reads
     credit_balances directly, so it does not need the projects provider this
     page renders below it. */
  const { label: credits, planId } = useCredits();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /* The send button, reachable from the box above it. Home renders the provider
     the button reads from, so it cannot start a build itself — Enter goes
     through this instead. */
  const sendRef = useRef<StartBuildHandle>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);


  /* Home's model list closed itself the same way the workspace's did: the
     handler here asked whether the press landed inside the composer box, and
     the list is portalled into the body, so pressing a model in it was a press
     outside the composer. It closed on mousedown and the row never saw a
     click. AnchoredPanel's own handler, reached now that Popover passes
     onClose through, excludes the card and the chip both. */

  /* The box grows with what is in it, up to a point, so a full template can
     be read and edited without scrolling a three-line window. */
  useEffect(() => {
    const fit = () => fitComposer(composerRef.current, Boolean(transcript));
    fit();
    /* And again when the keyboard opens or closes, which changes the room. */
    window.visualViewport?.addEventListener("resize", fit);
    return () => window.visualViewport?.removeEventListener("resize", fit);
  }, [transcript]);

  /* The tab follows the prompt until somebody clicks one. Only a confident
     read moves it — a half-typed sentence should not flick the tabs about. */
  useEffect(() => {
    if (pickedType.current || !transcript.trim()) return;
    const id = window.setTimeout(() => {
      if (pickedType.current) return;
      const category = categoryFor(transcript);
      if (category) setActiveCategory(category);
    }, 350);
    return () => window.clearTimeout(id);
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
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-canvas">
      {githubNotice && (
        <button
          onClick={() => setGithubNotice(null)}
          className="fixed bottom-4 left-1/2 z-[80] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-line/[0.09] bg-panel px-4 py-2.5 text-[13px] text-ink shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          {githubNotice}
        </button>
      )}
      {/* Shared with the project workspace, so a phone sees the same light on
          both screens. */}
      <PhoneField />

      <TopNav
        tabs={<WorkspaceTabs />}
        onUpgradeClick={() => setBillingOpen(true)}
        onAccountSettingsClick={() => {
          setSettingsSection("account");
          setAccountSettingsOpen(true);
        }}
        projectName={projectName ?? "No project yet"}
        credits={credits}
      />

      {/* Home is a tab in the same strip the workspaces are in, so leaving an
          app for the composer and coming back is one row of switching rather
          than a navigation. */}

      <TopBar
        onMenuClick={() => setSidebarOpen(true)}
        onUpgradeClick={() => setBillingOpen(true)}
        credits={credits}
      />

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
        onClose={() => {
          setAccountSettingsOpen(false);
          setSettingsAgentTab(undefined);
          setMcpNotice(null);
        }}
        onUpgradeClick={() => {
          setAccountSettingsOpen(false);
          setBillingOpen(true);
        }}
        credits={credits}
        initialSection={settingsSection}
        initialAgentTab={settingsAgentTab}
        mcpNotice={mcpNotice}
      />
      <SupportChat />
      <ImportFromGitHub open={importOpen} onClose={() => setImportOpen(false)} onUpgrade={() => setBillingOpen(true)} />

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

        {/* On a phone the Video tab drops the heading, so the composer rises
            and the gallery under it is on the first screen. */}
        <h1 className={`hero-offset text-center ${videoMode ? "hidden md:block" : ""} text-[clamp(18px,4.9vw,22px)] font-normal leading-[26px] tracking-normal text-ink sm:text-[32px] sm:font-semibold sm:leading-tight sm:tracking-tight`}>
          What will you build today?
        </h1>

        {/* Tabs and composer share this column, so they stay aligned. */}
        <div className={`relative w-[min(750px,calc(100vw-32px))] md:mt-7 md:w-[min(750px,calc(100vw-40px))] ${videoMode ? "mt-3" : "mt-14"}`} ref={popoverRef}>
          {/* Target tabs. From md up they are fused to the canvas below them;
              on a phone they are a row of pills standing apart from it, only
              the selected one carrying its name. Both spread edge to edge —
              the first tab as far in from the box's left edge as the last is
              from its right, the gaps between all five equal — and five pills
              fit a 320px phone without scrolling. The
              top padding is room for the New badge, which sits over its
              pill's edge there. */}
          <div className="relative z-40 flex items-end justify-between gap-1.5 overflow-x-auto px-0 pb-3 pt-3.5 [scrollbar-width:none] md:gap-1.5 md:px-3.5 md:pb-0 md:pt-0 [&::-webkit-scrollbar]:hidden">
            {categoryTabs.map((tab) => {
              const Icon = tab.icon;
              const PhoneIcon = tab.phone;
              const active = activeCategory === tab.id;
              /* Shown so people know it is coming, but not pickable: its
                 builder is not ready, and the server refuses it anyway. */
              const soon = isComingSoon(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (soon) return;
                    pickedType.current = true;
                    if (tab.id !== activeCategory) setActiveSubtype(null);
                    setActiveCategory(tab.id);
                  }}
                  aria-pressed={active}
                  aria-disabled={soon || undefined}
                  title={soon ? `${CATEGORY_LABEL[tab.id]} — coming soon` : undefined}
                  /* Emergent's tab strip: rounded-top tabs standing on the
                     box, the selected one a shade lighter. */
                  aria-label={CATEGORY_LABEL[tab.id]}
                  className={`qs-pill relative flex h-8 min-w-[48px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[14px] font-normal tracking-tight transition-colors md:h-auto md:min-w-0 md:justify-start md:gap-1.5 md:font-medium md:tracking-normal md:rounded-b-none md:rounded-t-[12px] md:border-0 md:px-4 md:py-2.5 md:text-sm ${
                    active
                      ? "border-line/[0.16] bg-layer/[0.05] text-ink md:bg-layer/[0.13] md:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "border-transparent bg-layer/[0.09] text-muted hover:bg-layer/[0.07] hover:text-soft md:bg-layer/[0.045]"
                  } ${soon ? "cursor-not-allowed opacity-80 hover:bg-layer/[0.09] hover:text-muted md:hover:bg-layer/[0.045]" : ""}`}
                >
                  {/* Thin and a size down on a phone, as Emergent draws them. */}
                  <PhoneIcon className={`h-[17px] w-[17px] shrink-0 md:hidden ${active ? "text-ink" : "text-muted"}`} strokeWidth={1.5} />
                  <Icon className={`hidden h-4 w-4 shrink-0 md:block ${active ? "text-ink" : "text-muted"}`} strokeWidth={1.75} />
                  {/* A phone names only the selected tab — a coming-soon tab
                      too is its icon there, under its Soon badge, which is
                      what lets all five fit the box's width. Its name is in
                      its label and title, and from md up on the tab. */}
                  <span className={active ? "" : "hidden md:inline"}>{CATEGORY_LABEL[tab.id]}</span>
                  {soon && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 -rotate-[4deg] rounded-[6px] bg-layer/[0.22] px-1.5 py-[1px] text-[10px] font-bold uppercase leading-[14px] tracking-wide text-ink ring-1 ring-line/[0.25] md:static md:translate-x-0 md:rotate-0 md:ring-0">
                      Soon
                    </span>
                  )}
                  {(tab.id === "video" || tab.id === "fliers") && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 -rotate-[4deg] rounded-[6px] bg-[#e5243b] qs-new px-1.5 py-[1px] text-[10px] font-bold uppercase leading-[14px] tracking-wide text-white ring-1 ring-white/80 md:static md:translate-x-0 md:rotate-0 md:ring-0">
                      New
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Premium AI Chat Input Container with Exact Graphite Background & Continuous Orbiting Highlight */}
          <div className="qs-composer-shell group relative w-full overflow-visible rounded-[26px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.35)] md:rounded-[14px]">
            {/* The edge light: a thin streak running round the border, and its
                halo. Drawn over the box, on the border itself. See globals.css. */}
            <div aria-hidden className="qs-edge-halo rounded-[26px] md:rounded-[14px]">
              <div className="qs-edge-glow" />
            </div>
            <div aria-hidden className="qs-edge-glow rounded-[26px] md:rounded-[14px]" />

            {/* Inner Graphite Glass Box matching #26252A */}
            <div className="qs-composer relative z-30 flex min-h-[154px] w-full flex-col justify-between overflow-hidden rounded-[26px] border-[1.5px] border-line/[0.11] bg-sunken bg-clip-padding p-3.5 sm:p-[18px] md:min-h-[159px] md:rounded-[14px] md:border-[3px] md:border-line/[0.1] md:bg-panel md:bg-clip-border">
              {/* The prompt is drawn over the box rather than as a placeholder
                  attribute, so it keeps the box's own type. It sits behind the caret and ignores the pointer, so typing and
                  clicking still land in the textarea. */}
              <div className="relative">
                <textarea
                  ref={composerRef}
                  onFocus={() => {
                    setComposerFocused(true);
                    setIsModelPopoverOpen(false);
                  }}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={(event) => {
                    // Enter sends, Shift+Enter breaks the line — the same
                    // convention the workspace composer follows, so the box that
                    // starts an app and the box that changes it behave alike.
                    // isComposing is why an IME's Enter does not send: confirming
                    // a candidate would otherwise name an app mid-word.
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      sendRef.current?.start();
                    }
                  }}
                  aria-label="Describe what you want to build"
                  rows={3}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="relative z-10 h-[70px] w-full resize-none bg-transparent text-base text-ink outline-none md:h-auto"
                />
                {!transcript && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 select-none text-base text-faint md:text-faint"
                  >
                    {PLACEHOLDER[activeCategory]}
                  </span>
                )}
              </div>

              {files.length > 0 && (
                <div className="relative z-10 mt-2 flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="group/att relative h-14 w-14 overflow-hidden rounded-[10px] border border-line/[0.1] bg-layer/[0.06]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previews[index]} alt={file.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        aria-label={`Remove ${file.name}`}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-100 transition-opacity md:opacity-0 md:group-hover/att:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative mt-3 flex min-w-0 items-center justify-between gap-2 sm:mt-4">
                {/* The left side gives way, never the right: a long agent name
                    truncates rather than pushing send out of the box. */}
                <div className="relative flex min-w-0 shrink items-center gap-[3px] sm:gap-2">
                  {/* One input, opened straight away: the device's own picker
                      is the picker. A desktop gets its file dialog; a phone
                      gets its native sheet — Photo Library, Take Photo, Choose
                      File — which `image/*` without `capture` asks for. */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    accept={ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      /* Cleared so picking the same file again still fires. */
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach images"
                    title="Attach images"
                    className="qs-control flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.06] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.08] active:scale-[0.98] sm:h-10 sm:w-10 md:bg-layer/[0.03]"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>

                  {/* Import from GitHub: a new project from a repository —
                      connecting GitHub first when it is not. */}
                  <button
                    onClick={() => setImportOpen(true)}
                    title="Import from GitHub"
                    aria-label="Import from GitHub"
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] md:flex md:h-10 md:w-10"
                  >
                    <Github className="h-4 w-4" />
                  </button>

                  {/* ONE CONTROL, at every width.
                   *
                      There were two. A phone got an "agent" chip opening a
                      sheet of Q1 / Q2 / Prototype, and from md up the same spot
                      held the model chip — two names for one decision, and only
                      one of them connected to anything: picking an agent set a
                      label and nothing else, while the workspace was hardcoded
                      to Q1 regardless. So a person who chose on a phone had
                      chosen nothing, and a person who chose on a laptop found
                      their answer gone on the next screen.
                   *
                      The model chip is that control now. Popover already
                      becomes a titled sheet on a phone, which is the shape the
                      agent sheet had, so nothing is lost by the phone reading
                      the same list as the desktop. */}
                  <button
                    onClick={() => {
                      setIsModelPopoverOpen((open) => !open);
                    }}
                    aria-expanded={isModelPopoverOpen}
                    aria-label="Choose an agent"
                    className="qs-control flex h-8 min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-full border border-line/[0.08] bg-layer/[0.03] px-2.5 text-[13px] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] md:h-10 md:gap-2 md:px-3.5 md:text-sm"
                  >
                    <span className="flex shrink-0">
                      <ProviderMark provider={chosenModel.provider} />
                    </span>
                    {/* The agent's name when the chosen model is one, and the
                        model's own when it is not — a model picked in the
                        workspace's fuller list has no agent, and naming it
                        anyway is better than naming nothing or naming the
                        wrong thing. */}
                    <span className="min-w-0 truncate font-medium tracking-tight">
                      {chosenAgent?.title ?? shortModelName(chosenModel)}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-ink transition-transform ${
                        isModelPopoverOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-[3px] sm:gap-2">
                  <button
                    onClick={() => setIsPrivacyModalOpen(true)}
                    title={selectedPrivacy === "public" ? "Anyone with the link can view" : "Only you can view"}
                    className="qs-control flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-line/[0.08] bg-layer/[0.06] text-sm text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] md:bg-layer/[0.03] active:scale-[0.98] sm:h-10 sm:w-auto sm:px-3.5"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="hidden font-medium capitalize tracking-tight sm:inline">{selectedPrivacy}</span>
                  </button>
                  <button
                    onClick={() => setIsAdvancedModalOpen(true)}
                    title="Advanced controls"
                    aria-label="Advanced controls"
                    className="qs-control flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.06] text-ink transition-all hover:border-line/[0.12] hover:bg-layer/[0.06] active:scale-[0.98] sm:h-10 sm:w-10 md:bg-layer/[0.03]"
                  >
                    <TuneMark className="h-[18px] w-[18px]" />
                  </button>

                  {/* Interactive Voice Recording Button */}
                  <button
                    onClick={toggleRecording}
                    title={isRecording ? "Stop Recording" : "Start Recording"}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] sm:h-10 sm:w-10 ${
                      isRecording
                        ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                        : "qs-control bg-layer/[0.06] border-line/[0.08] hover:bg-layer/[0.06] hover:border-line/[0.12] text-ink md:bg-layer/[0.03]"
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
                  <StartBuildButton
                    ref={sendRef}
                    prompt={transcript}
                    kind={activeSubtype ? activeType : null}
                    target={formatTarget({ category: activeCategory, subtype: activeCategory === "fliers" ? subtype.id : activeSubtype })}
                    video={
                      videoMode && videoPipeline
                        ? { pipeline: videoPipeline, answers: answersFor(PIPELINES[videoPipeline], videoAnswers), consent: videoConsent }
                        : null
                    }
                    files={files}
                    /* Fliers and videos are not built as a page or a project,
                       so the template only travels with a site or an app. */
                    stack={stackChoice === "auto" || videoMode || activeCategory === "fliers" ? null : stackChoice}
                    blockedReason={
                      !videoMode
                        ? null
                        : !videoPipeline
                          ? "Pick a video type below first — Commercial Ad, Product Showcase and so on."
                          : PIPELINES[videoPipeline].needsConsent && !videoConsent
                            ? "Tick the permission box under Create Your Clone first."
                            : null
                    }
                    onError={setStartError}
                    disabled={paused !== null}
                  />
                </div>
              </div>
            </div>

            {startError && (
              <p role="alert" className="mt-2 px-1 text-[12px] leading-relaxed text-danger">
                {startError}
              </p>
            )}

            {/* Under the composer, where the brief they just wrote still is —
                not over it, and not instead of it. Someone who has typed three
                paragraphs should be told it cannot run right now without having
                those three paragraphs taken off the screen to say so. */}
            {paused && (
              <div className="mt-2 flex items-start gap-2.5 rounded-[10px] border border-warn/[0.22] bg-warn/[0.07] px-3 py-2.5">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                <p className="text-[12.5px] leading-relaxed text-soft">{paused.message}</p>
              </div>
            )}

            {/* Hung off the whole composer rather than off the chip, and for the
                same reason the upload menu is: the graphite box clips what grows
                out of it, and the tabs above it would paint over a panel drawn
                inside. Opening upward keeps a list this tall on screen — the
                composer sits low enough that the room is above it.
              *
                Anchored on a phone too, rather than a sheet, because this is
                the same control the workspace composer opens and it should not
                be a different object depending on which screen it was reached
                from. AnchoredPanel flips and clamps it into whatever room the
                viewport has. */}
            <ChoiceSheet
              open={isModelPopoverOpen}
              onClose={() => setIsModelPopoverOpen(false)}
              title="Select agent"
              rows={AGENTS.map((agent): ChoiceRow => {
                const runs = agent.model ? modelById(agent.model) : null;
                /* "Not yet" and "not on your plan or balance" are both
                   unselectable and are not the same sentence: the badge says
                   which. See useModel's reach. */
                const gate = runs ? reach(runs) : null;
                const ready = !agent.soon && Boolean(runs) && (gate?.ok ?? false);
                return {
                  id: agent.id,
                  title: agent.title,
                  /* The model named, not hidden: it is what each build is
                     billed on. */
                  subtitle: runs ? `${agent.subtitle} · Runs on ${runs.name}` : agent.subtitle,
                  badge: agent.soon ? "Coming soon" : gate && !gate.ok ? gate.label : undefined,
                  hint: agent.soon ? "Coming soon" : gate && !gate.ok ? gate.label : undefined,
                  selected: Boolean(agent.model) && agent.model === model,
                  disabled: !ready,
                  onSelect: () => {
                    if (!agent.model) return;
                    setModel(agent.model);
                    setIsModelPopoverOpen(false);
                  },
                };
              })}
              note="Agent changes apply from your next message."
            />
          </div>

          {/* Free credit waits for a card on file — see CardWelcome. Shown only
              to an account that has not had its welcome yet. */}
          <CardWelcomeBanner className="mt-3" />

          {/* Starters, centred under the composer: one row, the selected tab's
              own. The row scrolls sideways rather than wrapping, so the chips
              keep the size they have on a desktop. Desktop only: a phone goes
              straight from the composer to the list of projects. */}
          <div className="mt-3 hidden overflow-x-auto pb-1 [scrollbar-width:none] md:block [&::-webkit-scrollbar]:hidden">
            {/* w-max + mx-auto centres the row under the composer while it fits, and lets
                it start at the left edge once it is wider than the column — centring the
                flex line itself would push the first chip out of reach when it scrolls. */}
            <div className="mx-auto flex w-max gap-2">
            {STARTERS[activeCategory].map((starter) => {
              const Icon = starter.icon;
              return (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => {
                    /* The chip is the tab's own, so it keeps the tab: the
                       prompt it drops in should not move the tabs about. */
                    pickedType.current = true;
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
                  {starter.beta ? (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-[#2F6BFF] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white">
                      Beta
                    </span>
                  ) : null}
                </button>
              );
            })}
            </div>
          </div>
          {/* Where the fliers made here are kept — the Video tab has its own. */}
          {activeCategory === "fliers" && (
            <Link href="/dashboard/fliers" className="mt-3 block text-center text-[12.5px] text-muted hover:text-ink">
              Your fliers →
            </Link>
          )}
          {CATEGORY_NOTE[activeCategory] && (
            <p className="mt-2 hidden px-2 text-center text-[12px] text-[#6e6e76] md:block">{CATEGORY_NOTE[activeCategory]}</p>
          )}

          {videoMode && (
            <VideoTypeGrid
              selected={videoPipeline}
              onSelect={pickVideoType}
              answers={videoAnswers}
              onAnswer={(question, value) => setVideoAnswers((current) => ({ ...current, [question]: value }))}
              consent={videoConsent}
              onConsent={setVideoConsent}
            />
          )}
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

      {/* Above SupportChat's button rather than beside it — one corner, one
          column. This page runs composer → chips → projects → footer, which is
          a long way back up to the box you actually came here to type in. */}
      <ScrollToEnds className="fixed bottom-[calc(86px+env(safe-area-inset-bottom)+var(--keyboard-inset,0px))] right-[max(18px,env(safe-area-inset-right))]" />

      {/* The Select Agent sheet stood here. It listed Q1, Q2, Prototype and
          Mobile, and choosing one set a label: nothing read it, the workspace
          ran on a hardcoded "Q1" whatever it said, and it was only ever
          reachable on a phone. The model picker above is the one control
          now, at every width and with a choice that is actually sent. */}

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
          <div
            className="fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-black/70 backdrop-blur-xl sm:p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsAdvancedModalOpen(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Advanced controls"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              /* A sheet from the foot of the screen on a phone, like the model
                 and template sheets it opens; a centred card from sm up. */
              className="mt-auto w-full max-w-md space-y-5 rounded-t-[24px] border border-b-0 border-line/[0.08] bg-panel p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:my-auto sm:rounded-[24px] sm:border-b sm:pb-5"
            >
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-base font-semibold text-ink tracking-tight">Advanced Controls</h3>
                <button
                  onClick={() => setIsAdvancedModalOpen(false)}
                  aria-label="Close"
                  className="h-10 w-10 sm:h-8 sm:w-8 rounded-full bg-layer/[0.04] border border-line/[0.06] flex items-center justify-center text-ink/70 hover:text-ink hover:bg-layer/[0.08] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="w-7 h-7 shrink-0 rounded-full bg-layer/[0.05] flex items-center justify-center text-ink">
                      <Bot className="w-4 h-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <span id="maxx-label" className="text-sm font-semibold text-ink flex items-center gap-1">
                        Maxx <Sparkles className="w-3.5 h-3.5 text-accent" />
                      </span>
                      <span className="block text-xs text-muted">
                        {!maxxModel
                          ? "No model is available right now"
                          : maxxGate && !maxxGate.ok && !maxxOn
                            ? `${shortModelName(maxxModel)} · ${maxxGate.label}`
                            : `Runs on ${shortModelName(maxxModel)}${maxxModel.note ? ` · ${maxxModel.note}` : ""}`}
                      </span>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={maxxOn}
                    aria-labelledby="maxx-label"
                    onClick={toggleMaxx}
                    disabled={!maxxModel || (!maxxOn && !maxxGate?.ok)}
                    title={!maxxOn && maxxGate && !maxxGate.ok ? maxxGate.label : undefined}
                    /* 24px tall to look at, 44px to hit: the ::after widens the target. */
                    className={`w-11 h-6 shrink-0 rounded-full transition-colors relative p-0.5 after:absolute after:-inset-x-2 after:-inset-y-[10px] after:content-[''] disabled:cursor-not-allowed disabled:opacity-45 ${maxxOn ? "bg-accent" : "bg-layer/20"}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-black transition-transform ${maxxOn ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    Select Model
                  </span>
                  <button
                    onClick={() => {
                      setIsAdvancedModalOpen(false);
                      setIsAllModelsOpen(true);
                    }}
                    className="w-full p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] flex items-center justify-between text-left transition-all"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Cpu className="w-4 h-4 shrink-0 text-muted" />
                      <span className="truncate text-sm font-semibold text-ink">{shortModelName(chosenModel)}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted" />
                  </button>
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
                  {/* MCP connections belong to the account, and are kept in
                      Account Settings → Agents → MCP. This opens that tab
                      rather than a second, disagreeing list here. */}
                  <button
                    onClick={() => {
                      setIsAdvancedModalOpen(false);
                      setSettingsSection("agents");
                      setSettingsAgentTab("mcp");
                      setAccountSettingsOpen(true);
                    }}
                    className="w-full p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] flex items-center justify-between text-left transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Paperclip className="w-4 h-4 text-muted" />
                      <span className="text-sm font-semibold text-ink">Select MCP Tools</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    GitHub
                  </span>
                  <button
                    onClick={() => {
                      setIsAdvancedModalOpen(false);
                      setImportOpen(true);
                    }}
                    className="w-full p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] flex items-center justify-between text-left transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Github className="w-4 h-4 text-muted" />
                      <span className="text-sm font-semibold text-ink">Import from GitHub</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                    Select Template
                  </span>
                  <button
                    onClick={() => {
                      setIsAdvancedModalOpen(false);
                      setIsTemplateOpen(true);
                    }}
                    className="w-full p-4 rounded-[18px] bg-layer/[0.035] border border-line/[0.05] hover:border-line/[0.1] flex items-center justify-between text-left transition-all"
                  >
                    <span className="text-sm font-semibold text-ink">{STACK_CHOICES[stackChoice].title}</span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Every model, with the same gates as the workspace's picker: a model
          that cannot be picked says why on its badge. */}
      <ChoiceSheet
        open={isAllModelsOpen}
        onClose={() => setIsAllModelsOpen(false)}
        onBack={() => {
          setIsAllModelsOpen(false);
          setIsAdvancedModalOpen(true);
        }}
        title="Select model"
        rows={MODELS.map((option): ChoiceRow => {
          const gate = reach(option);
          return {
            id: option.id,
            title: shortModelName(option),
            subtitle: option.note ? `${option.blurb} · ${option.note}` : option.blurb,
            badge: gate.ok ? option.badge : gate.label,
            hint: gate.ok ? undefined : gate.label,
            selected: model === option.id,
            disabled: !gate.ok,
            onSelect: () => {
              setModel(option.id);
              setIsAllModelsOpen(false);
              setIsAdvancedModalOpen(true);
            },
          };
        })}
        note="Model changes apply from your next message."
      />

      <ChoiceSheet
        open={isTemplateOpen}
        onClose={() => setIsTemplateOpen(false)}
        onBack={() => {
          setIsTemplateOpen(false);
          setIsAdvancedModalOpen(true);
        }}
        title="Select template"
        rows={(Object.keys(STACK_CHOICES) as StackChoice[]).map((id): ChoiceRow => ({
          id,
          title: STACK_CHOICES[id].title,
          subtitle: STACK_CHOICES[id].subtitle,
          selected: stackChoice === id,
          onSelect: () => {
            setStackChoice(id);
            setIsTemplateOpen(false);
            setIsAdvancedModalOpen(true);
          },
        }))}
        note="Applies to the next Website or Web App you start here."
      />

    </div>
    </ProjectsProvider>
  );
}
