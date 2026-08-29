"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Bot, Building2, CalendarDays, Check, ChevronDown, Coins, CreditCard, Download, Eye, EyeOff, Info, KeyRound, Pencil, Plus, Server, Settings, SlidersHorizontal, Sparkles, Trash2, UserPlus, Users, X } from "lucide-react";

import { maskEmail } from "../account";
import { ComingSoonBadge } from "./ComingSoon";
import { MCP_SERVERS, type McpServer } from "../mcpServers";
import { useProjects } from "../ProjectsContext";
import { requestSupportChat } from "../supportChat";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

interface AccountSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  credits: string;
  /** The same list the composer's picker uses, so the two cannot drift apart. */
  agents: { id: string; title: string; subtitle: string; soon?: boolean }[];
  selectedAgent: string;
  /** Which pane opens. The project switcher asks for its own; the account menu
      takes the default. Read each time the panel is opened, so the pane you
      asked for is the pane you get. */
  initialSection?: SectionId;
}

/* The panel holds two settings that happen to share a window: the project you
   are in, and the account that owns it. The rail keeps them apart under their
   own headings; the ids are flat, since only one pane is ever open. */
export type SectionId =
  | "project"
  | "members"
  | "budget"
  | "usage"
  | "account"
  | "key"
  | "agents"
  | "preferences"
  | "plans"
  | "credits";

const SECTION_META: Record<SectionId, { title: string; subtitle?: string }> = {
  project: {
    title: "Project Settings",
    subtitle: "Projects allow you to collaborate on tasks in real time.",
  },
  members: { title: "Members", subtitle: "Who can see and work on this project" },
  budget: { title: "Project budget", subtitle: "Cap what this project is allowed to spend" },
  usage: { title: "Usage & Billing", subtitle: "What this project has used, and what pays for it" },
  account: { title: "Account settings" },
  key: { title: "Universal Key", subtitle: "Bring your own model key" },
  agents: { title: "Manage Agents", subtitle: "Create, edit and manage your custom agents" },
  preferences: { title: "Preferences", subtitle: "Customize how QuickStark.Ai works for you" },
  plans: { title: "Plans & Invoices", subtitle: "Manage your plan and view transaction history" },
  credits: { title: "Credit Usage", subtitle: "Track your credit usage and history" },
};

type Transaction = {
  id: string;
  plan: string;
  cadence: string;
  date: string;
  amount: string;
  credits: number;
};

/* Billing is not connected, so there are no transactions to list. Rows render
   from this the moment a billing service fills it. */
const TRANSACTIONS: Transaction[] = [];

type McpDraft = { serverId: string; name: string; url: string; apiKey: string };

type McpFormProps = {
  custom: boolean;
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onDisconnect?: () => void;
  busy: boolean;
};

const FIELD =
  "mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-white placeholder:text-[#6F737A] outline-none focus-visible:border-white/25";

function McpForm({ custom, draft, onChange, onCancel, onSave, onDisconnect, busy }: McpFormProps) {
  return (
    <div className="mb-1 rounded-xl border border-white/[0.09] bg-white/[0.03] p-4">
      {custom && (
        <>
          <label className="block text-[13px] text-[#C7CAD0]">
            Name
            <input
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="My MCP server"
              className={FIELD}
            />
          </label>
          <label className="mt-3 block text-[13px] text-[#C7CAD0]">
            Server URL
            <input
              value={draft.url}
              onChange={(e) => onChange({ ...draft, url: e.target.value })}
              placeholder="https://example.com/mcp"
              className={FIELD}
            />
          </label>
        </>
      )}
      <label className="mt-3 block text-[13px] text-[#C7CAD0]">
        API key{custom && <span className="text-[#6F737A]"> (optional)</span>}
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
          placeholder="Paste the key"
          autoComplete="off"
          className={FIELD}
        />
      </label>
      {/* The key is write-only in the database, so it cannot be shown back here
          once saved — replacing it means pasting a new one. */}
      <p className="mt-2 text-[12px] text-[#6F737A]">
        Stored against your account and never read back into the browser.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={busy}
          className="rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0d0d0f] transition-colors hover:bg-white/90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/[0.09] px-3.5 py-1.5 text-[13px] text-[#C7CAD0] transition-colors hover:bg-white/[0.05]"
        >
          Cancel
        </button>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="ml-auto rounded-lg px-3 py-1.5 text-[13px] text-[#FF6B6B] transition-colors hover:bg-[#FF6B6B]/10 disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

export default function AccountSettingsModal({ open, onClose, onUpgradeClick, credits, agents, selectedAgent, initialSection }: AccountSettingsModalProps) {
  const [section, setSection] = useState<SectionId>(initialSection ?? "account");
  const { selected: project, rename, remove } = useProjects();
  const [projectDraft, setProjectDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [account, setAccount] = useState<{ id: string; name: string; email: string }>({ id: "", name: "", email: "" });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [supportCode, setSupportCode] = useState<string | null>(null);
  /* Hidden until asked for, and hidden again whenever the panel is reopened. */
  const [emailRevealed, setEmailRevealed] = useState(false);
  const [agentTab, setAgentTab] = useState<"main" | "sub" | "mcp">("main");
  const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);
  const [mcpCustom, setMcpCustom] = useState<{ server_id: string; name: string; url: string }[]>([]);
  const [configuring, setConfiguring] = useState<McpDraft | null>(null);
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setEmailRevealed(false);
  }, [open]);

  /* Each opening starts where the caller asked for and with the project pane
     back at rest — a half-typed rename or an armed delete button left over from
     last time is not what the next opening should inherit. */
  useEffect(() => {
    if (!open) return;
    setSection(initialSection ?? "account");
    setConfirmingDelete(false);
    setProjectError(null);
  }, [open, initialSection]);

  // The field follows the project until it is being edited, so switching
  // projects with the panel open cannot leave another one's name in the box.
  useEffect(() => {
    setProjectDraft(project?.name ?? "");
  }, [project]);

  useEffect(() => {
    if (!open || !isSupabaseConfigured) return;
    let cancelled = false;

    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (cancelled || !user) return;
        const metadata = user.user_metadata ?? {};
        const name = (metadata.full_name as string) || (metadata.name as string) || "";
        setAccount({ id: user.id, name, email: user.email ?? "" });
        setNameDraft(name);
      })
      .catch(() => {
        // Leave the fields blank rather than showing another account's details.
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function saveProjectName() {
    const next = projectDraft.trim();
    if (!project || !next || next === project.name) return;
    setRenaming(true);
    setProjectError(null);
    const ok = await rename(project.id, next);
    setRenaming(false);
    if (!ok) setProjectError("That name could not be saved. Try again.");
  }

  /* Two presses, because there is no undo behind this one: the first arms the
     button and says what it will take with it, the second does it. */
  async function deleteProject() {
    if (!project) return;
    setDeleting(true);
    setProjectError(null);
    const ok = await remove(project.id);
    setDeleting(false);
    if (!ok) {
      setProjectError("That project could not be deleted. Try again.");
      setConfirmingDelete(false);
      return;
    }
    setConfirmingDelete(false);
    onClose();
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (!next || next === account.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const { error } = await createSupabaseBrowserClient().auth.updateUser({ data: { full_name: next } });
      if (error) {
        setNameError(error.message);
        return;
      }
      setAccount((current) => ({ ...current, name: next }));
      setEditingName(false);
    } catch (caught) {
      setNameError(caught instanceof Error ? caught.message : "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  }

  /* One place to turn a Postgres error into something the pane can show, since
     the most likely one by far is the schema not having been run yet. */
  function describeMcpError(error: { code?: string; message: string }) {
    if (error.code === "42P01") {
      return "The mcp_connections table does not exist yet — run supabase/schema.sql in the SQL editor.";
    }
    return error.message;
  }

  const loadMcpConnections = React.useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await createSupabaseBrowserClient()
      .from("mcp_connections")
      .select("server_id, name, url, enabled");

    if (error) {
      setMcpError(describeMcpError(error));
      return;
    }
    const rows = data ?? [];
    setMcpError(null);
    setMcpEnabled(rows.filter((row) => row.enabled).map((row) => row.server_id as string));
    setMcpCustom(
      rows
        .filter((row) => String(row.server_id).startsWith("custom:"))
        .map((row) => ({
          server_id: row.server_id as string,
          name: (row.name as string) || "Custom MCP server",
          url: (row.url as string) || "",
        })),
    );
  }, []);

  useEffect(() => {
    if (!open || section !== "agents" || agentTab !== "mcp") return;
    void loadMcpConnections();
  }, [open, section, agentTab, loadMcpConnections]);

  /* Catalogue first, then whatever the user added by hand, so both render
     through the same row. */
  const mcpRows: { server: McpServer; connected: boolean }[] = [
    ...MCP_SERVERS,
    ...mcpCustom.map((row) => ({
      id: row.server_id,
      name: row.name,
      description: row.url || "Custom MCP server",
      needsKey: true,
      path: null,
      tint: "bg-white/[0.06]",
      color: "text-[#C7CAD0]",
    })),
  ].map((server) => ({ server, connected: mcpEnabled.includes(server.id) }));

  async function saveMcpConnection() {
    if (!configuring || !isSupabaseConfigured) return;
    const isCustom = configuring.serverId === "";

    if (isCustom && (!configuring.name.trim() || !configuring.url.trim())) {
      setMcpError("A custom server needs a name and a URL.");
      return;
    }
    if (!isCustom && !configuring.apiKey.trim()) {
      setMcpError("Paste the key for this server first.");
      return;
    }
    if (!account.id) {
      setMcpError("Your session is still loading — try again in a moment.");
      return;
    }

    const serverId = isCustom ? `custom:${crypto.randomUUID()}` : configuring.serverId;
    setMcpBusy(isCustom ? "new" : serverId);
    setMcpError(null);

    const { error } = await createSupabaseBrowserClient()
      .from("mcp_connections")
      .upsert(
        {
          user_id: account.id,
          server_id: serverId,
          name: isCustom ? configuring.name.trim() : null,
          url: isCustom ? configuring.url.trim() : null,
          api_key: configuring.apiKey.trim() || null,
          enabled: true,
        },
        { onConflict: "user_id,server_id" },
      );

    setMcpBusy(null);
    if (error) {
      setMcpError(describeMcpError(error));
      return;
    }
    setConfiguring(null);
    await loadMcpConnections();
  }

  async function removeMcpConnection(serverId: string) {
    if (!isSupabaseConfigured) return;
    setMcpBusy(serverId);
    setMcpError(null);

    const { error } = await createSupabaseBrowserClient()
      .from("mcp_connections")
      .delete()
      .eq("server_id", serverId);

    setMcpBusy(null);
    if (error) {
      setMcpError(describeMcpError(error));
      return;
    }
    setConfiguring(null);
    await loadMcpConnections();
  }

  /* Servers that need no key are a straight on/off, so enabling one is the
     whole configuration. */
  async function toggleMcpServer(serverId: string, enable: boolean) {
    if (!enable) {
      await removeMcpConnection(serverId);
      return;
    }
    if (!isSupabaseConfigured) return;
    if (!account.id) {
      setMcpError("Your session is still loading — try again in a moment.");
      return;
    }
    setMcpBusy(serverId);
    setMcpError(null);

    const { error } = await createSupabaseBrowserClient()
      .from("mcp_connections")
      .upsert(
        { user_id: account.id, server_id: serverId, enabled: true },
        { onConflict: "user_id,server_id" },
      );

    setMcpBusy(null);
    if (error) {
      setMcpError(describeMcpError(error));
      return;
    }
    await loadMcpConnections();
  }

  const initial = (account.name || account.email || "?").charAt(0).toUpperCase();

  type NavItem = { id: SectionId; label: string; icon?: React.ComponentType<{ className?: string }> };

  /* The project first, since it is what the switcher opens this on, then the
     account that owns it. The key and the meter sit under the project because
     that is what they apply to. */
  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "Project settings",
      items: [
        { id: "project", label: project?.name || "Project", icon: Building2 },
        { id: "members", label: "Members", icon: Users },
        { id: "budget", label: "Project budget", icon: Activity },
        { id: "key", label: "Universal Key", icon: KeyRound },
        { id: "usage", label: "Usage & Billing", icon: CreditCard },
      ],
    },
    {
      label: "Account settings",
      items: [
        { id: "account", label: account.name || "Your account" },
        { id: "agents", label: "Manage Agents", icon: Bot },
        { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
        { id: "plans", label: "Plans & Invoices", icon: CreditCard },
        { id: "credits", label: "Credit Usage", icon: Coins },
      ],
    },
  ];

  /** A labelled row: description on the left, control on the right. */
  const Row = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-white">{title}</p>
        <p className="mt-0.5 text-[13px] text-[#8F939A]">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="flex h-[590px] max-h-[calc(100dvh-48px)] w-full max-w-[880px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f0f11] shadow-[0_30px_90px_rgba(0,0,0,0.75)]"
          >
            {/* Left rail */}
            <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] p-3 sm:flex">
              {navGroups.map((group, index) => (
                <nav
                  key={group.label}
                  aria-label={group.label}
                  className={index > 0 ? "mt-4 border-t border-white/[0.07] pt-4" : ""}
                >
                  <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F939A]">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = section === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSection(item.id)}
                          aria-current={active ? "page" : undefined}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                            active
                              ? "bg-white/[0.07] text-white"
                              : "text-[#C7CAD0] hover:bg-white/[0.04] hover:text-white"
                          }`}
                        >
                          {Icon ? (
                            <Icon className="h-4 w-4 shrink-0 text-[#8F939A]" />
                          ) : (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
                              {initial}
                            </span>
                          )}
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </nav>
              ))}
            </aside>

            {/* Right pane */}
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 py-4">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-white">{SECTION_META[section].title}</h2>
                  {SECTION_META[section].subtitle && (
                    <p className="mt-0.5 text-[13px] text-[#8F939A]">{SECTION_META[section].subtitle}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close settings"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] text-[#8F939A] transition-colors hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2">
                {section === "project" && (
                  <div className="py-6">
                    <p className="text-[13px] text-[#C7CAD0]">Icon</p>
                    {/* A project has no picture of its own yet, so the mark is
                        the same one the rail carries rather than an uploader
                        pointing at nothing. */}
                    <div className="mt-2 flex h-[52px] w-[52px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05]">
                      <Building2 className="h-[22px] w-[22px] text-white" />
                    </div>

                    <label htmlFor="project-name" className="mt-6 block text-[13px] text-[#C7CAD0]">
                      Project Name
                    </label>
                    <div className="mt-2 flex h-11 w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 focus-within:border-white/25">
                      <input
                        id="project-name"
                        value={projectDraft}
                        disabled={!project}
                        onChange={(event) => setProjectDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveProjectName();
                          if (event.key === "Escape") setProjectDraft(project?.name ?? "");
                        }}
                        placeholder={project ? "Project name" : "No project yet"}
                        className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#6F737A]"
                      />
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-[#8F939A]" aria-hidden />
                    </div>
                    {/* Only once it differs from what is stored: a Save that is
                        always there says the name is unsaved when it is not. */}
                    {project && projectDraft.trim() && projectDraft.trim() !== project.name && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          onClick={() => void saveProjectName()}
                          disabled={renaming}
                          className="h-9 rounded-lg bg-white px-4 text-[13px] font-semibold text-[#0d0d0f] transition-all hover:brightness-95 disabled:opacity-50"
                        >
                          {renaming ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => setProjectDraft(project.name)}
                          className="h-9 rounded-lg px-3 text-[13px] text-[#C7CAD0] transition-colors hover:bg-white/[0.05] hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    <div className="mt-8 border-t border-white/[0.06] pt-6">
                      <p className="text-[15px] font-medium text-white">Danger Zone</p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[#8F939A]">
                        Permanently delete {project ? `${project.name}` : "this project"} and all of
                        its data.
                        <br />
                        This action is not reversible!
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {confirmingDelete ? (
                          <>
                            <button
                              onClick={() => void deleteProject()}
                              disabled={deleting}
                              className="flex h-10 items-center gap-2 rounded-lg border border-[#FF6B6B]/40 bg-[#FF6B6B]/15 px-4 text-sm font-semibold text-[#FF8A8A] transition-colors hover:bg-[#FF6B6B]/25 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              {deleting ? "Deleting…" : "Yes, delete permanently"}
                            </button>
                            <button
                              onClick={() => setConfirmingDelete(false)}
                              className="h-10 rounded-lg px-3 text-sm text-[#C7CAD0] transition-colors hover:bg-white/[0.05] hover:text-white"
                            >
                              Keep it
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingDelete(true)}
                            disabled={!project}
                            className="flex h-10 items-center gap-2 rounded-lg border border-[#FF6B6B]/30 bg-[#FF6B6B]/10 px-4 text-sm font-medium text-[#FF8A8A] transition-colors hover:bg-[#FF6B6B]/20 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete Project
                          </button>
                        )}

                        <button
                          onClick={() => {
                            onClose();
                            requestSupportChat();
                          }}
                          className="h-10 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 text-sm text-white transition-colors hover:bg-white/[0.07]"
                        >
                          Contact Support
                        </button>
                      </div>

                      {projectError && (
                        <p className="mt-3 text-[13px] text-[#ef7777]">{projectError}</p>
                      )}
                    </div>
                  </div>
                )}

                {section === "members" && (
                  <div className="py-6">
                    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
                        {initial}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">
                          {account.name || account.email || "You"}
                        </span>
                        <span className="block truncate text-[13px] text-[#8F939A]">
                          {account.email ? maskEmail(account.email) : "Signed in"}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-white/[0.1] px-2.5 py-1 text-[12px] text-[#C7CAD0]">
                        Owner
                      </span>
                    </div>

                    {/* Projects are owner-scoped in the database, so there is no
                        second member to list and no invitation to send. Saying so
                        beats an invite box that drops what is typed into it. */}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        disabled
                        title="Sharing is not connected yet"
                        className="flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-white/55"
                      >
                        <UserPlus className="h-4 w-4" />
                        Invite members
                      </button>
                      <ComingSoonBadge />
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-[#8F939A]">
                      A project belongs to the account that made it. Once sharing is connected,
                      the people you invite will appear here with the access you gave them.
                    </p>
                  </div>
                )}

                {section === "budget" && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-white">No budget set</p>
                    <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-[#8F939A]">
                      A budget caps what a project may spend before it stops asking for more.
                      Nothing meters a build yet, so there is no figure to cap — this is where the
                      cap will be set once there is.
                    </p>
                    <div className="mt-4">
                      <ComingSoonBadge />
                    </div>
                  </div>
                )}

                {section === "usage" && (
                  <div className="py-5">
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-6 py-5">
                      <div className="min-w-0">
                        <p className="text-[13px] text-[#8F939A]">Credits on this account</p>
                        <p className="mt-1 text-[28px] font-bold leading-none text-white">{credits}</p>
                      </div>
                      <button
                        onClick={onUpgradeClick}
                        className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                      >
                        Upgrade Plan <Sparkles className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Credits are held against the account, not the project, and
                        a per-project figure invented here would be fiction. */}
                    <p className="mt-4 max-w-[560px] text-[13px] leading-relaxed text-[#8F939A]">
                      Credits are held against your account and shared by every project on it.
                      When a build starts spending them, what {project?.name ?? "this project"} used
                      will be broken out here.
                    </p>
                    <button
                      onClick={() => setSection("plans")}
                      className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 text-sm text-white transition-colors hover:bg-white/[0.07]"
                    >
                      <CreditCard className="h-4 w-4 text-[#8F939A]" />
                      See plans and invoices
                    </button>
                  </div>
                )}

                {section === "account" && (
                  <>
                    <div className="divide-y divide-white/[0.06]">
                      <Row title="Email" description="The email address linked to your current account">
                        {account.email ? (
                          <span className="flex items-center gap-2">
                            <span className="text-sm text-white">
                              {emailRevealed ? account.email : maskEmail(account.email)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEmailRevealed((shown) => !shown)}
                              aria-label={emailRevealed ? "Hide email address" : "Show email address"}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#8F939A] transition-colors hover:text-white"
                            >
                              {emailRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </span>
                        ) : (
                          <span className="text-sm text-white">—</span>
                        )}
                      </Row>

                      <Row title="Profile picture" description="This image will be displayed publicly">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
                          {initial}
                        </span>
                      </Row>

                      <Row title="Name" description="Your full name, as displayed everywhere">
                        {editingName ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={nameDraft}
                              onChange={(event) => setNameDraft(event.target.value)}
                              onKeyDown={(event) => event.key === "Enter" && saveName()}
                              autoFocus
                              aria-label="Your name"
                              className="h-9 w-[180px] rounded-lg border border-white/[0.14] bg-white/[0.04] px-3 text-sm text-white outline-none"
                            />
                            <button
                              onClick={saveName}
                              disabled={savingName}
                              aria-label="Save name"
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.14] text-[#34F5A0] transition-colors hover:bg-white/[0.06] disabled:opacity-60"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setNameDraft(account.name);
                              setEditingName(true);
                            }}
                            className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-white transition-colors hover:bg-white/[0.07]"
                          >
                            <span className="max-w-[180px] truncate">{account.name || "Add your name"}</span>
                            <Pencil className="h-3.5 w-3.5 text-[#8F939A]" />
                          </button>
                        )}
                      </Row>

                      <Row title="Support code" description="Share this with our support team if they ask for it.">
                        {supportCode ? (
                          <code className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 font-mono text-[13px] text-white">
                            {supportCode}
                          </code>
                        ) : (
                          <button
                            onClick={() => setSupportCode(account.id ? account.id.slice(0, 8).toUpperCase() : null)}
                            disabled={!account.id}
                            className="h-9 rounded-lg bg-white px-4 text-sm font-semibold text-black transition-all hover:brightness-95 disabled:opacity-50"
                          >
                            Generate
                          </button>
                        )}
                      </Row>
                    </div>

                    {nameError && (
                      <p className="pb-2 text-right text-[13px] text-[#ef7777]">{nameError}</p>
                    )}

                    <div className="border-t border-white/[0.06] pb-6 pt-6">
                      <p className="text-[15px] font-medium text-white">Personal Plan</p>
                      <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-6 py-5">
                        {/* No subscription record exists yet, so everyone is on Free. */}
                        <span className="text-[28px] font-bold leading-none text-white">Free</span>
                        <button
                          onClick={onUpgradeClick}
                          className="flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                        >
                          Upgrade Plan <Sparkles className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {section === "plans" && (
                  <div className="py-5">
                    {/* No subscription record exists yet, so everyone is on Free. */}
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-6 py-5">
                      <span className="text-[28px] font-bold leading-none text-white">Free</span>
                      <button
                        onClick={onUpgradeClick}
                        className="flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                      >
                        Upgrade Plan <Sparkles className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-6 flex items-center justify-between">
                      <p className="text-[15px] font-medium text-white">Transactions</p>
                      <span className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] text-[#8F939A]">
                        All <ChevronDown className="h-3.5 w-3.5" />
                      </span>
                    </div>

                    <div className="mt-3 min-h-[220px] rounded-xl border border-white/[0.07] bg-white/[0.02]">
                      {TRANSACTIONS.length === 0 ? (
                        <div className="flex h-[220px] flex-col items-center justify-center px-6 text-center">
                          <CalendarDays className="h-5 w-5 text-[#5B5F66]" />
                          <p className="mt-3 text-sm text-[#C7CAD0]">No transactions yet</p>
                          <p className="mt-1 text-[13px] text-[#8F939A]">
                            Charges and invoices appear here once billing is connected.
                          </p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-white/[0.06]">
                          {TRANSACTIONS.map((transaction) => (
                            <li key={transaction.id} className="flex items-center gap-4 px-4 py-3.5">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                                <CalendarDays className="h-4 w-4 text-[#8F939A]" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-white">
                                  {transaction.plan} · {transaction.cadence}
                                </p>
                                <p className="truncate text-[13px] text-[#8F939A]">{transaction.date}</p>
                              </div>
                              <span className="shrink-0 text-sm text-white">{transaction.amount}</span>
                              <span className="flex shrink-0 items-center gap-1.5 text-sm text-[#F4D96B]">
                                <Coins className="h-3.5 w-3.5" />
                                {transaction.credits}
                              </span>
                              <button className="flex shrink-0 items-center gap-1.5 text-[13px] text-[#8F939A] transition-colors hover:text-white">
                                Download <Download className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {section === "credits" && (
                  <div className="py-5">
                    <p className="text-[15px] font-medium text-white">Available credits</p>

                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
                      {/* The total gets its own column and a rule, so its label cannot
                          collide with the first metric beside it. */}
                      <div className="sm:border-r sm:border-white/[0.07] sm:pr-6">
                        <p className="text-[13px] text-[#8F939A]">Total available credits</p>
                        <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                          <Coins className="h-5 w-5 text-[#F4D96B]" />
                          {credits}
                        </p>
                      </div>
                      {/* The breakdown needs a credits service to come from; the total is
                          the figure the app already displayed. */}
                      {["Plan credits", "Top-up credits", "Free credits"].map((label) => (
                        <div key={label}>
                          <p className="flex items-center gap-1 text-[13px] text-[#8F939A]">
                            {label} <Info className="h-3 w-3" />
                          </p>
                          <p className="mt-2 text-lg text-[#5B5F66]">—</p>
                        </div>
                      ))}
                    </div>

                    <p className="mt-6 text-[15px] font-medium text-white">Usage history</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["Last week", "All projects", "All types"].map((filter) => (
                        <span
                          key={filter}
                          className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] text-[#8F939A]"
                        >
                          {filter} <ChevronDown className="h-3.5 w-3.5" />
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 flex h-[180px] flex-col items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.02] px-6 text-center">
                      <Coins className="h-5 w-5 text-[#5B5F66]" />
                      <p className="mt-3 text-sm text-[#C7CAD0]">No usage yet</p>
                      <p className="mt-1 text-[13px] text-[#8F939A]">
                        Daily refreshes and spend appear here once a credits service is connected.
                      </p>
                    </div>
                  </div>
                )}

                {section === "agents" && (
                  <div className="pb-6">
                    <div className="flex gap-6 border-b border-white/[0.07]">
                      {([["main", "Main agents"], ["sub", "Sub-agents"], ["mcp", "MCP Tools"]] as const).map(
                        ([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setAgentTab(id)}
                            className={`-mb-px border-b-2 pb-3 pt-4 text-sm transition-colors ${
                              agentTab === id
                                ? "border-white text-white"
                                : "border-transparent text-[#8F939A] hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>

                    {agentTab === "main" && (
                      <ul className="mt-4 space-y-2">
                        {/* The agents the composer actually offers, rather than an upsell
                            for agents this application does not have. */}
                        {agents.map((agent) => (
                          <li
                            key={agent.id}
                            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                              agent.soon
                                ? "border-white/[0.04] bg-white/[0.015]"
                                : "border-white/[0.07] bg-white/[0.03]"
                            }`}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                              <Bot className="h-4 w-4 text-[#8F939A]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-white">{agent.title}</p>
                              <p className="truncate text-[13px] text-[#8F939A]">{agent.subtitle}</p>
                            </div>
                            {agent.soon ? (
                              <ComingSoonBadge />
                            ) : (
                              agent.id === selectedAgent && (
                                <span className="shrink-0 rounded-full border border-[#34F5A0]/30 bg-[#34F5A0]/10 px-2.5 py-1 text-[11px] font-medium text-[#34F5A0]">
                                  In use
                                </span>
                              )
                            )}
                          </li>
                        ))}
                        <li className="pt-1 text-[13px] text-[#8F939A]">
                          Custom agents need somewhere to save them before they can be created here.
                        </li>
                      </ul>
                    )}

                    {agentTab === "sub" && (
                      <div className="flex h-[300px] flex-col items-center justify-center px-6 text-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.05]">
                          <Bot className="h-5 w-5 text-[#8F939A]" />
                        </span>
                        <p className="mt-4 text-lg font-semibold text-white">Delegate work to sub-agents</p>
                        <p className="mt-2 max-w-[380px] text-sm text-[#8F939A]">
                          Sub-agents let a main agent hand off parts of a build. Nothing runs them yet.
                        </p>
                      </div>
                    )}

                    {agentTab === "mcp" && (
                      <div className="mt-4 space-y-2">
                        <button
                          onClick={() => {
                            setMcpError(null);
                            setConfiguring({ serverId: "", name: "", url: "", apiKey: "" });
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06]"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                            <Plus className="h-4 w-4 text-[#C7CAD0]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-white">New MCP Server</span>
                            <span className="block truncate text-[13px] text-[#8F939A]">Add a custom MCP server</span>
                          </span>
                        </button>

                        {configuring?.serverId === "" && (
                          <McpForm
                            custom
                            draft={configuring}
                            onChange={setConfiguring}
                            onCancel={() => setConfiguring(null)}
                            onSave={saveMcpConnection}
                            busy={mcpBusy === "new"}
                          />
                        )}

                        {mcpRows.map(({ server, connected }) => (
                          <div key={server.id}>
                            <div className="flex items-center gap-3 px-1 py-2.5">
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${server.tint}`}
                              >
                                {server.path ? (
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    aria-hidden
                                    className={`h-[18px] w-[18px] ${server.color}`}
                                  >
                                    <path d={server.path} />
                                  </svg>
                                ) : (
                                  <Server className={`h-4 w-4 ${server.color}`} />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm text-white">{server.name}</p>
                                  {server.needsKey && !connected && (
                                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-[#C7CAD0]">
                                      <KeyRound className="h-3 w-3" />
                                      Key needed
                                    </span>
                                  )}
                                  {connected && (
                                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-[#34F5A0]/10 px-1.5 py-0.5 text-[11px] text-[#34F5A0]">
                                      <Check className="h-3 w-3" />
                                      Connected
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-[13px] text-[#8F939A]">{server.description}</p>
                              </div>

                              {server.needsKey ? (
                                <button
                                  onClick={() => {
                                    setMcpError(null);
                                    setConfiguring({ serverId: server.id, name: "", url: "", apiKey: "" });
                                  }}
                                  className="flex shrink-0 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.05] px-3 py-1.5 text-[13px] text-[#E6E7EA] transition-colors hover:bg-white/[0.09]"
                                >
                                  <Settings className="h-3.5 w-3.5" />
                                  Configure
                                </button>
                              ) : (
                                <button
                                  onClick={() => toggleMcpServer(server.id, !connected)}
                                  disabled={mcpBusy === server.id}
                                  aria-pressed={connected}
                                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
                                    connected
                                      ? "border-white/[0.09] bg-white/[0.05] text-[#E6E7EA] hover:bg-white/[0.09]"
                                      : "border-transparent bg-white text-[#0d0d0f] hover:bg-white/90"
                                  }`}
                                >
                                  {connected ? "Disable" : "Enable"}
                                </button>
                              )}
                            </div>

                            {configuring?.serverId === server.id && (
                              <McpForm
                                custom={false}
                                draft={configuring}
                                onChange={setConfiguring}
                                onCancel={() => setConfiguring(null)}
                                onSave={saveMcpConnection}
                                onDisconnect={connected ? () => removeMcpConnection(server.id) : undefined}
                                busy={mcpBusy === server.id}
                              />
                            )}
                          </div>
                        ))}

                        {mcpError && <p className="px-1 pt-1 text-[13px] text-[#FF6B6B]">{mcpError}</p>}

                        {/* Saying so beats letting a "Connected" badge imply a build
                            step that has not been written. */}
                        <p className="px-1 pt-2 text-[13px] text-[#6F737A]">
                          Connections are saved to your account. Nothing calls these servers during a
                          build yet.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {section === "preferences" && (
                  <div className="py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F939A]">General</p>
                    <label className="mt-3 block text-sm text-white" htmlFor="language">
                      Language
                    </label>
                    <select
                      id="language"
                      defaultValue="en"
                      className="mt-2 h-10 w-[280px] max-w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-white outline-none"
                    >
                      {/* Only English exists until the app is translated. */}
                      <option value="en">English</option>
                    </select>

                    <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F939A]">
                      Appearance
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {([["light", "Light"], ["dark", "Dark"], ["system", "Follow System"]] as const).map(
                        ([id, label]) => {
                          const active = id === "dark";
                          return (
                            <div key={id} className="w-[104px]">
                              <button
                                disabled={!active}
                                aria-pressed={active}
                                title={active ? undefined : "QuickStark.Ai is dark-only for now"}
                                className={`flex h-[74px] w-full items-center justify-center rounded-lg border-2 transition-colors ${
                                  active
                                    ? "border-[#4A90E2] bg-[#141417]"
                                    : "cursor-not-allowed border-white/[0.08] bg-white/[0.03] opacity-45"
                                }`}
                              >
                                <span
                                  className={`flex h-[46px] w-[76px] flex-col gap-1 rounded p-2 ${
                                    id === "light" ? "bg-white" : id === "dark" ? "bg-[#0d0d0f]" : "bg-gradient-to-r from-white to-[#0d0d0f]"
                                  }`}
                                >
                                  <span className={`h-1 w-8 rounded-full ${id === "light" ? "bg-black/25" : "bg-white/40"}`} />
                                  <span className={`h-1 w-12 rounded-full ${id === "light" ? "bg-black/15" : "bg-white/20"}`} />
                                  <span className={`h-1 w-10 rounded-full ${id === "light" ? "bg-black/15" : "bg-white/20"}`} />
                                </span>
                              </button>
                              <p className={`mt-2 text-center text-[13px] ${active ? "text-white" : "text-[#8F939A]"}`}>
                                {label}
                              </p>
                            </div>
                          );
                        },
                      )}
                    </div>
                    <p className="mt-3 text-[13px] text-[#8F939A]">
                      QuickStark.Ai is dark-only for now, so the other themes are not selectable yet.
                    </p>
                  </div>
                )}

                {section === "key" && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-white">Universal Key</p>
                    <p className="mt-1 text-[13px] text-[#8F939A]">
                      Bring your own model key. Nothing is connected to store one yet.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
