"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Bot, Building2, CalendarDays, Check, Coins, CreditCard, ExternalLink, Eye, EyeOff, Info, KeyRound, Loader2, Pencil, Plus, Server, SlidersHorizontal, Sparkles, Trash2, UserPlus, Users, X } from "lucide-react";

import { maskEmail } from "../account";
import { ComingSoonBadge } from "./ComingSoon";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { MCP_SERVERS, type McpServer } from "../mcpServers";
import { useProjects } from "../ProjectsContext";
import { MODELS } from "../models";
import { useModel } from "../useModel";
import { requestSupportChat } from "../supportChat";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useTheme } from "./ThemeProvider";
import { PaymentMethod } from "./billing/CardWelcome";
import { useCredits } from "../useCredits";
import { PLANS, formatCredits } from "../credits";

interface AccountSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  credits: string;
  /** Which pane opens. The project switcher asks for its own; the account menu
      takes the default. Read each time the panel is opened, so the pane you
      asked for is the pane you get. */
  initialSection?: SectionId;
  /** Which tab of the Agents pane opens — Home's "Select MCP Tools" asks for
      "mcp". Absent leaves the tab where it was. */
  initialAgentTab?: AgentTab;
  /** How an MCP sign-in that just returned went — see MCP_NOTICES. */
  mcpNotice?: { reason: string; serverId: string | null } | null;
}

export type AgentTab = "main" | "sub" | "mcp";

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

/* One line of the account's credit ledger, as the owner may read it (RLS:
   "Owners read their ledger"). Payments and grants arrive positive; spending,
   and a refunded top-up taken back, are negative. */
type LedgerLine = {
  id: string;
  action: string;
  credits: number;
  description: string | null;
  created_at: string;
  project_id: string | null;
  paid_amount: number | null;
  paid_currency: string | null;
  dedupe_key: string | null;
  source: string | null;
};

/* How a credit line came in, for the history: paid by card (with Stripe's
   receipt), in crypto (receipted by email), given, or the welcome credit. */
function sourceOf(line: LedgerLine): { label: string; receipt: boolean } {
  if (line.credits < 0) return { label: "Refunded", receipt: false };
  if (line.dedupe_key?.startsWith("stripe:")) return { label: "Card", receipt: true };
  if (line.dedupe_key?.startsWith("paystack:")) return { label: "Card", receipt: false };
  if (line.dedupe_key === "signup-bonus") return { label: "Free credit", receipt: false };
  if (line.source === "admin") return { label: "Gift", receipt: false };
  if (/paid in /i.test(line.description ?? "")) return { label: "Crypto", receipt: false };
  return { label: "Credit", receipt: false };
}

const SPEND_ACTIONS = ["chat", "generate", "publish", "runtime"];
const HISTORY_LIMIT = 200;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function money(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

/* The account's ledger and paid-through date, read when the panel opens on a
   pane that shows them. */
function useAccountRecords(active: boolean) {
  const [lines, setLines] = useState<LedgerLine[] | null>(null);
  const [paidThrough, setPaidThrough] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !isSupabaseConfigured) return;
    let live = true;
    const client = createSupabaseBrowserClient();
    void Promise.all([
      client
        .from("credit_ledger")
        .select("id, action, credits, description, created_at, project_id, paid_amount, paid_currency, dedupe_key, source")
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      client.from("credit_balances").select("paid_through").maybeSingle(),
    ]).then(([ledger, balance]) => {
      if (!live) return;
      if (ledger.error) {
        setFailed(true);
        setLines([]);
      } else {
        setFailed(false);
        setLines(
          (ledger.data ?? []).map((row) => ({
            ...(row as LedgerLine),
            credits: Number((row as LedgerLine).credits),
            paid_amount: (row as LedgerLine).paid_amount === null ? null : Number((row as LedgerLine).paid_amount),
          })),
        );
      }
      setPaidThrough((balance.data as { paid_through?: string | null } | null)?.paid_through ?? null);
    });
    return () => {
      live = false;
    };
  }, [active]);
  return { lines, paidThrough, failed };
}

/* A custom server is a name and an address. There is no key field: connecting
   means signing in on the server's own page — see src/lib/mcp/oauth.ts. */
type McpDraft = { name: string; url: string };

type McpFormProps = {
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
  onCancel: () => void;
  onConnect: () => void;
  busy: boolean;
};

const FIELD =
  "mt-1.5 h-10 w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink placeholder:text-faint outline-none focus-visible:border-line/25";

function McpForm({ draft, onChange, onCancel, onConnect, busy }: McpFormProps) {
  return (
    <div className="rounded-xl border border-line/[0.1] bg-layer/[0.03] p-4">
      <p className="text-sm font-semibold text-ink">Add custom connector</p>
      <p className="mt-0.5 text-[12.5px] text-muted">Connect a remote MCP server by its address.</p>
      <label className="mt-3 block text-[13px] text-soft">
        Name
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="My connector"
          maxLength={60}
          className={FIELD}
        />
      </label>
      <label className="mt-3 block text-[13px] text-soft">
        Remote MCP server URL
        <input
          type="url"
          inputMode="url"
          value={draft.url}
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
          placeholder="https://example.com/mcp"
          autoComplete="off"
          className={FIELD}
        />
      </label>
      <div className="mt-3 flex gap-2 rounded-lg bg-warn/[0.08] px-3 py-2 text-[12px] leading-relaxed text-soft">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
        <span>
          Only use connectors from developers you trust. QuickStark doesn&apos;t review custom connectors. You&apos;ll sign in on
          the server&apos;s own page — no key is pasted or stored in your browser.
        </span>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-9 rounded-lg px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={onConnect}
          disabled={busy || !draft.name.trim() || !draft.url.trim()}
          className="h-9 rounded-lg bg-solid px-4 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

/* A connector's mark: its logo on its tint, or a server glyph. */
function ConnectorLogo({ server, size = "md" }: { server: McpServer; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 rounded-xl" : "h-9 w-9 rounded-lg";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${server.tint}`}>
      {server.path ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`h-[18px] w-[18px] ${server.color}`}>
          <path d={server.path} />
        </svg>
      ) : (
        <Server className={`h-4 w-4 ${server.color}`} />
      )}
    </span>
  );
}

/* What the sign-in round trip came back with, in words. */
const MCP_NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Connected." },
  cancelled: { tone: "error", text: "Sign-in was cancelled. Nothing was connected." },
  expired: { tone: "error", text: "That sign-in took too long or was started elsewhere. Try again." },
  failed: { tone: "error", text: "The server did not issue a token. Try again." },
  unreachable: { tone: "error", text: "That server could not be reached, or did not say where to sign in." },
  "no-oauth": { tone: "error", text: "That server does not let apps sign in to it automatically." },
  unavailable: { tone: "error", text: "Sign-in for this server is not set up on this deployment yet." },
  invalid: { tone: "error", text: "That server is not one you have added." },
};

export default function AccountSettingsModal({
  open,
  onClose,
  onUpgradeClick,
  credits,
  initialSection,
  initialAgentTab,
  mcpNotice = null,
}: AccountSettingsModalProps) {
  /* Read here rather than passed in, and that is the point of the change.
   *
     This list used to be the four "agents" — Q1, Q2, Prototype, Mobile — with
     one marked "In use", and the mark was decided by a prop that Home held at
     its own default and the workspace passed as the literal string "Q1". So
     the panel confidently named something in use that nothing was using, while
     the thing actually doing the work — the model the composer is set to — was
     not named anywhere in settings at all.
   *
     It is the models now, from the same provider the two pickers read, which
     is what makes "in use" a fact rather than a claim. */
  const { model, reach } = useModel();
  const { balance, planId } = useCredits();
  const plan = PLANS[planId];
  const { choice: themeChoice, resolved: resolvedTheme, setChoice: setThemeChoice } = useTheme();
  const [section, setSection] = useState<SectionId>(initialSection ?? "account");
  const { selected: project, projects, rename, remove } = useProjects();
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
  const [agentTab, setAgentTab] = useState<AgentTab>(initialAgentTab ?? "main");
  const [mcpEnabled, setMcpEnabled] = useState<string[]>([]);
  const [mcpCustom, setMcpCustom] = useState<{ server_id: string; name: string; url: string }[]>([]);
  /* Signed in, per server id: an OAuth row with tokens behind it. Separate from
     `mcpEnabled` because a row can exist without being signed in — a custom
     server saved and then abandoned on the provider's page. */
  const [mcpSignedIn, setMcpSignedIn] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState<McpDraft | null>(null);
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  /* The MCP tab, as Claude's Connectors page: your connectors, or the
     directory to browse; the search over the directory. */
  const [mcpView, setMcpView] = useState<"yours" | "browse">("yours");
  const [mcpQuery, setMcpQuery] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const records = useAccountRecords(open && (section === "plans" || section === "credits" || section === "usage"));
  const purchases = (records.lines ?? []).filter((line) => !SPEND_ACTIONS.includes(line.action) && line.credits !== 0);
  const spending = (records.lines ?? []).filter((line) => SPEND_ACTIONS.includes(line.action));
  const projectUsed = project
    ? spending.filter((line) => line.project_id === project.id).reduce((sum, line) => sum - line.credits, 0)
    : 0;
  const projectNames = new Map(projects.map((item) => [item.id, item.name]));

  /* Receipts, invoices and the plan itself live with Stripe: the billing
     portal on the account's own customer. */
  async function openPortal() {
    setPortalBusy(true);
    setPortalError(null);
    const response = await fetch("/api/payments/stripe/portal", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (body?.url) {
      window.location.assign(body.url);
      return;
    }
    setPortalError(body?.error ?? "Billing could not be opened. Try again.");
    setPortalBusy(false);
  }

  useEffect(() => {
    if (!open) setEmailRevealed(false);
  }, [open]);

  /* The page behind stays put while settings are open — on a phone a drag
     past the end of a pane otherwise scrolls Home underneath. */
  useBodyScrollLock(open);

  /* Each opening starts where the caller asked for and with the project pane
     back at rest — a half-typed rename or an armed delete button left over from
     last time is not what the next opening should inherit. */
  useEffect(() => {
    if (!open) return;
    setSection(initialSection ?? "account");
    if (initialAgentTab) setAgentTab(initialAgentTab);
    setConfirmingDelete(false);
    setProjectError(null);
  }, [open, initialSection, initialAgentTab]);

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
      .select("server_id, name, url, enabled, auth");

    if (error) {
      setMcpError(describeMcpError(error));
      return;
    }
    const rows = data ?? [];
    setMcpError(null);
    setMcpEnabled(rows.filter((row) => row.enabled).map((row) => row.server_id as string));
    setMcpSignedIn(rows.filter((row) => row.enabled && row.auth === "oauth").map((row) => row.server_id as string));
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
     through the same row. A custom server is connected once the connect route
     has signed it in or found it open — never because a row exists. */
  const mcpRows: { server: McpServer; connected: boolean }[] = [
    ...MCP_SERVERS,
    ...mcpCustom.map(
      (row): McpServer => ({
        id: row.server_id,
        name: row.name,
        description: row.url || "Custom MCP server",
        auth: "oauth",
        url: row.url,
        path: null,
        tint: "bg-layer/[0.06]",
        color: "text-soft",
      }),
    ),
  ].map((server) => ({
    server,
    connected:
      server.auth === "none" || server.id.startsWith("custom:")
        ? mcpEnabled.includes(server.id)
        : mcpSignedIn.includes(server.id),
  }));

  /* The word on a sign-in that just came back, named for the server it was. */
  const notice = (() => {
    if (!mcpNotice) return null;
    const said = MCP_NOTICES[mcpNotice.reason] ?? { tone: "error" as const, text: "Something went wrong. Try again." };
    const row = mcpRows.find(({ server }) => server.id === mcpNotice.serverId);
    return { ...said, server: row?.server.name ?? null };
  })();

  /* Signing in is a page of the provider's, so this is a navigation, not a
     fetch: the authorize route discovers the server's sign-in, registers with
     it and redirects. It comes back to Home with this tab open. */
  function signInToMcp(serverId: string) {
    setMcpBusy(serverId);
    setMcpError(null);
    window.location.assign(`/api/integrations/mcp/authorize?server=${encodeURIComponent(serverId)}`);
  }

  async function connectCustomServer() {
    if (!configuring || !isSupabaseConfigured) return;
    const name = configuring.name.trim();
    const url = configuring.url.trim();
    if (!name || !url) {
      setMcpError("A custom server needs a name and a URL.");
      return;
    }
    if (!/^https:\/\/[^\s/]+/i.test(url)) {
      setMcpError("The server URL must start with https://.");
      return;
    }
    if (!account.id) {
      setMcpError("Your session is still loading — try again in a moment.");
      return;
    }

    /* Saved switched off: it becomes connected only when the sign-in (or the
       server's own answer that it needs none) comes back. */
    const serverId = `custom:${crypto.randomUUID()}`;
    setMcpBusy("new");
    setMcpError(null);
    const { error } = await createSupabaseBrowserClient()
      .from("mcp_connections")
      .insert({ user_id: account.id, server_id: serverId, name, url, enabled: false });
    if (error) {
      setMcpBusy(null);
      setMcpError(describeMcpError(error));
      return;
    }
    signInToMcp(serverId);
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
    await loadMcpConnections();
  }

  /* A server with nothing to sign in to is a straight on/off. */
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

    /* Insert, and on a row that is already there switch it on. Not an upsert:
       PostgREST's ON CONFLICT sets every column it was given, user_id and
       server_id included, and the browser is deliberately not allowed to
       update those — so an upsert here was refused every time ("permission
       denied"), measured against the live grants. */
    const client = createSupabaseBrowserClient();
    let { error } = await client
      .from("mcp_connections")
      .insert({ user_id: account.id, server_id: serverId, enabled: true });
    if (error?.code === "23505") {
      ({ error } = await client.from("mcp_connections").update({ enabled: true }).eq("server_id", serverId));
    }

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
        <p className="text-[15px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted">{description}</p>
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
            className="flex h-[590px] max-h-[calc(100dvh-48px)] w-full max-w-[880px] overflow-hidden rounded-2xl border border-line/[0.08] bg-panel shadow-[0_30px_90px_rgba(0,0,0,0.75)]"
          >
            {/* Left rail */}
            <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-line/[0.07] p-3 sm:flex">
              {navGroups.map((group, index) => (
                <nav
                  key={group.label}
                  aria-label={group.label}
                  className={index > 0 ? "mt-4 border-t border-line/[0.07] pt-4" : ""}
                >
                  <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
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
                              ? "bg-layer/[0.07] text-ink"
                              : "text-soft hover:bg-layer/[0.04] hover:text-ink"
                          }`}
                        >
                          {Icon ? (
                            <Icon className="h-4 w-4 shrink-0 text-muted" />
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
              <header className="flex items-start justify-between gap-4 border-b border-line/[0.07] px-6 py-4">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-ink">{SECTION_META[section].title}</h2>
                  {SECTION_META[section].subtitle && (
                    <p className="mt-0.5 text-[13px] text-muted">{SECTION_META[section].subtitle}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close settings"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-line/[0.1] text-muted transition-colors hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </header>

              {/* The rail is hidden on a phone, so the sections are a menu
                  here instead — without it a phone could only ever see the
                  pane the panel opened on. */}
              <div className="border-b border-line/[0.07] px-6 py-3 sm:hidden">
                <label htmlFor="settings-section" className="sr-only">
                  Section
                </label>
                <select
                  id="settings-section"
                  value={section}
                  onChange={(event) => setSection(event.target.value as SectionId)}
                  className="h-10 w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink outline-none"
                >
                  {navGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id === "account" ? "Account" : item.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2">
                {section === "project" && (
                  <div className="py-6">
                    <p className="text-[13px] text-soft">Icon</p>
                    {/* A project has no picture of its own yet, so the mark is
                        the same one the rail carries rather than an uploader
                        pointing at nothing. */}
                    <div className="mt-2 flex h-[52px] w-[52px] items-center justify-center rounded-xl border border-line/[0.08] bg-layer/[0.05]">
                      <Building2 className="h-[22px] w-[22px] text-ink" />
                    </div>

                    <label htmlFor="project-name" className="mt-6 block text-[13px] text-soft">
                      Project Name
                    </label>
                    <div className="mt-2 flex h-11 w-full items-center gap-2 rounded-xl border border-line/[0.08] bg-layer/[0.03] px-3.5 focus-within:border-line/25">
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
                        className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                      />
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    </div>
                    {/* Only once it differs from what is stored: a Save that is
                        always there says the name is unsaved when it is not. */}
                    {project && projectDraft.trim() && projectDraft.trim() !== project.name && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          onClick={() => void saveProjectName()}
                          disabled={renaming}
                          className="h-9 rounded-lg bg-solid px-4 text-[13px] font-semibold text-onSolid transition-all hover:brightness-95 disabled:opacity-50"
                        >
                          {renaming ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => setProjectDraft(project.name)}
                          className="h-9 rounded-lg px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    <div className="mt-8 border-t border-line/[0.06] pt-6">
                      <p className="text-[15px] font-medium text-ink">Danger Zone</p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
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
                              className="flex h-10 items-center gap-2 rounded-lg border border-danger/40 bg-danger/15 px-4 text-sm font-semibold text-[#FF8A8A] transition-colors hover:bg-danger/25 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              {deleting ? "Deleting…" : "Yes, delete permanently"}
                            </button>
                            <button
                              onClick={() => setConfirmingDelete(false)}
                              className="h-10 rounded-lg px-3 text-sm text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                            >
                              Keep it
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingDelete(true)}
                            disabled={!project}
                            className="flex h-10 items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 text-sm font-medium text-[#FF8A8A] transition-colors hover:bg-danger/20 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete Project
                          </button>
                        )}

                        {/* Hidden on a phone because the only thing it does is
                            open the support widget, and that is desktop-only —
                            see SupportChat. A button that opens nothing is worse
                            than no button. */}
                        <button
                          onClick={() => {
                            onClose();
                            requestSupportChat();
                          }}
                          className="hidden h-10 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-4 text-sm text-ink transition-colors hover:bg-layer/[0.07] md:block"
                        >
                          Contact Support
                        </button>
                      </div>

                      {projectError && (
                        <p className="mt-3 text-[13px] text-danger">{projectError}</p>
                      )}
                    </div>
                  </div>
                )}

                {section === "members" && (
                  <div className="py-6">
                    <div className="flex items-center gap-3 rounded-xl border border-line/[0.07] bg-layer/[0.03] px-4 py-3.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
                        {initial}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {account.name || account.email || "You"}
                        </span>
                        <span className="block truncate text-[13px] text-muted">
                          {account.email ? maskEmail(account.email) : "Signed in"}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-line/[0.1] px-2.5 py-1 text-[12px] text-soft">
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
                        className="flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-line/[0.08] bg-layer/[0.03] px-4 text-sm text-ink/55"
                      >
                        <UserPlus className="h-4 w-4" />
                        Invite members
                      </button>
                      <ComingSoonBadge />
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-muted">
                      A project belongs to the account that made it. Once sharing is connected,
                      the people you invite will appear here with the access you gave them.
                    </p>
                  </div>
                )}

                {section === "budget" && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-ink">No budget set</p>
                    <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-muted">
                      A budget caps what a project may spend before it stops asking for more.
                      Until per-project caps arrive, every project draws on your account&apos;s
                      credits — see Usage &amp; Billing for what this one has used.
                    </p>
                    <div className="mt-4">
                      <ComingSoonBadge />
                    </div>
                  </div>
                )}

                {section === "usage" && (
                  <div className="py-5">
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-line/[0.07] bg-layer/[0.03] px-6 py-5">
                      <div className="min-w-0">
                        <p className="text-[13px] text-muted">Credits on this account</p>
                        <p className="mt-1 text-[28px] font-bold leading-none text-ink">{credits}</p>
                      </div>
                      <button
                        onClick={onUpgradeClick}
                        className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                      >
                        Upgrade Plan <Sparkles className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Credits are held against the account; what this project
                        spent is read off the ledger lines that name it. */}
                    <div className="mt-4 rounded-xl border border-line/[0.07] bg-layer/[0.02] px-6 py-4">
                      <p className="text-[13px] text-muted">Used by {project?.name ?? "this project"}</p>
                      <p className="mt-1 text-lg font-semibold text-ink">
                        {records.lines === null ? "…" : `${formatCredits(projectUsed)} credits`}
                      </p>
                      <p className="mt-1 text-[12px] text-faint">
                        {records.lines !== null && records.lines.length >= HISTORY_LIMIT
                          ? `Across your last ${HISTORY_LIMIT} credit entries.`
                          : "Since the project was made."}{" "}
                        Credits are shared by every project on your account.
                      </p>
                    </div>
                    <button
                      onClick={() => setSection("plans")}
                      className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-4 text-sm text-ink transition-colors hover:bg-layer/[0.07]"
                    >
                      <CreditCard className="h-4 w-4 text-muted" />
                      See plans and invoices
                    </button>
                  </div>
                )}

                {section === "account" && (
                  <>
                    <div className="divide-y divide-line/[0.06]">
                      <Row title="Email" description="The email address linked to your current account">
                        {account.email ? (
                          <span className="flex items-center gap-2">
                            <span className="text-sm text-ink">
                              {emailRevealed ? account.email : maskEmail(account.email)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEmailRevealed((shown) => !shown)}
                              aria-label={emailRevealed ? "Hide email address" : "Show email address"}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/[0.08] bg-layer/[0.04] text-muted transition-colors hover:text-ink"
                            >
                              {emailRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </span>
                        ) : (
                          <span className="text-sm text-ink">—</span>
                        )}
                      </Row>

                      <Row title="Profile picture" description="Your initial, shown in the app. Picture uploads aren't available yet.">
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
                              maxLength={80}
                              aria-label="Your name"
                              className="h-9 w-[180px] rounded-lg border border-line/[0.14] bg-layer/[0.04] px-3 text-sm text-ink outline-none"
                            />
                            <button
                              onClick={saveName}
                              disabled={savingName}
                              aria-label="Save name"
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line/[0.14] text-accent transition-colors hover:bg-layer/[0.06] disabled:opacity-60"
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
                            className="flex h-9 items-center gap-2 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink transition-colors hover:bg-layer/[0.07]"
                          >
                            <span className="max-w-[180px] truncate">{account.name || "Add your name"}</span>
                            <Pencil className="h-3.5 w-3.5 text-muted" />
                          </button>
                        )}
                      </Row>

                      {/* Not a Row: Row is declared inside this component, so it
                          remounts its children on every render, and the code
                          on screen would vanish mid-link. */}
                      <div className="flex items-center justify-between gap-6 py-4">
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium text-ink">WhatsApp</p>
                          <p className="mt-0.5 text-[13px] text-muted">
                            Link your number to ask our WhatsApp assistant about your plan, credits and projects. It can only read them.
                          </p>
                        </div>
                        <div className="shrink-0">
                          <WhatsAppConnect />
                        </div>
                      </div>

                      <Row title="Support code" description="Share this with our support team if they ask for it.">
                        {supportCode ? (
                          <code className="rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 py-2 font-mono text-[13px] text-ink">
                            {supportCode}
                          </code>
                        ) : (
                          <button
                            onClick={() => setSupportCode(account.id ? account.id.slice(0, 8).toUpperCase() : null)}
                            disabled={!account.id}
                            className="h-9 rounded-lg bg-solid px-4 text-sm font-semibold text-onSolid transition-all hover:brightness-95 disabled:opacity-50"
                          >
                            Show
                          </button>
                        )}
                      </Row>
                    </div>

                    {nameError && (
                      <p className="pb-2 text-right text-[13px] text-danger">{nameError}</p>
                    )}

                    <div className="border-t border-line/[0.06] pb-6 pt-6">
                      <p className="text-[15px] font-medium text-ink">Personal Plan</p>
                      <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-line/[0.07] bg-layer/[0.03] px-6 py-5">
                        <span className="text-[28px] font-bold leading-none text-ink">{plan.name}</span>
                        <button
                          onClick={() => setSection("plans")}
                          className="flex h-10 items-center gap-2 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-4 text-sm text-ink transition-colors hover:bg-layer/[0.07]"
                        >
                          Manage plan
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {section === "plans" && (
                  <div className="py-5">
                    {/* The plan the account is on, read with the balance (and
                        when it is paid through, from credit_balances). */}
                    <div className="flex flex-col items-start gap-4 rounded-xl border border-line/[0.07] bg-layer/[0.03] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[28px] font-bold leading-none text-ink">{plan.name}</p>
                        <p className="mt-2 text-[13px] text-muted">
                          {planId === "free"
                            ? "No monthly credits. Upgrade for a monthly allowance and every model."
                            : `$${plan.monthlyPriceUsd}/month · ${plan.monthlyCredits} credits a month${
                                records.paidThrough ? ` · paid through ${shortDate(records.paidThrough)}` : ""
                              }`}
                        </p>
                      </div>
                      <button
                        onClick={onUpgradeClick}
                        className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                      >
                        {planId === "pro" ? "Add credit" : "Upgrade Plan"} <Sparkles className="h-4 w-4" />
                      </button>
                    </div>

                    <PaymentMethod />

                    <div className="mt-6 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-ink">Deposits &amp; purchases</p>
                        <p className="text-[12px] text-muted">Every receipt is also emailed to you.</p>
                      </div>
                      <button
                        onClick={() => void openPortal()}
                        disabled={portalBusy}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-line/[0.08] bg-layer/[0.03] px-3 text-[13px] text-soft transition-colors hover:text-ink disabled:opacity-50"
                      >
                        {portalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                        Receipts &amp; invoices
                      </button>
                    </div>
                    {portalError && <p className="mt-2 text-[13px] text-danger">{portalError}</p>}

                    <div className="mt-3 rounded-xl border border-line/[0.07] bg-layer/[0.02]">
                      {records.lines === null ? (
                        <div className="flex h-[160px] items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-muted" />
                        </div>
                      ) : purchases.length === 0 ? (
                        <div className="flex h-[160px] flex-col items-center justify-center px-6 text-center">
                          <CalendarDays className="h-5 w-5 text-faint" />
                          <p className="mt-3 text-sm text-soft">{records.failed ? "Transactions couldn't be loaded" : "No transactions yet"}</p>
                          <p className="mt-1 text-[13px] text-muted">
                            {records.failed ? "Close and reopen settings to try again." : "Plans, top-ups and credit you receive appear here."}
                          </p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-line/[0.06]">
                          {purchases.map((line) => {
                            const how = sourceOf(line);
                            return (
                            <li key={line.id} className="flex items-center gap-4 px-4 py-3.5">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-layer/[0.05]">
                                <CalendarDays className="h-4 w-4 text-muted" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-ink">{line.description || (line.action === "topup" ? "Top-up" : "Credit")}</p>
                                <p className="truncate text-[13px] text-muted">
                                  {shortDate(line.created_at)} · {how.label}
                                  {money(line.paid_amount, line.paid_currency) ? ` · ${money(line.paid_amount, line.paid_currency)}` : ""}
                                </p>
                              </div>
                              <span className={`flex shrink-0 items-center gap-1.5 text-sm ${line.credits < 0 ? "text-danger" : "text-warn"}`}>
                                <Coins className="h-3.5 w-3.5" />
                                {line.credits > 0 ? "+" : ""}
                                {formatCredits(line.credits)}
                              </span>
                              {how.receipt ? (
                                <a
                                  href={`/api/payments/receipt?line=${line.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex shrink-0 items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
                                >
                                  Receipt <ExternalLink className="h-3 w-3" aria-hidden />
                                </a>
                              ) : null}
                            </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {section === "credits" && (
                  <div className="py-5">
                    <p className="text-[15px] font-medium text-ink">Available credits</p>

                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-line/[0.07] bg-layer/[0.03] px-5 py-4 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
                      {/* The total gets its own column and a rule, so its label cannot
                          collide with the first metric beside it. */}
                      <div className="sm:border-r sm:border-line/[0.07] sm:pr-6">
                        <p className="text-[13px] text-muted">Total available credits</p>
                        <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-ink">
                          <Coins className="h-5 w-5 text-warn" />
                          {credits}
                        </p>
                      </div>
                      {/* The buckets the balance is held in, spent in this order:
                          the plan's month, what rolled over, then top-ups (which
                          include free credit, and never expire). */}
                      {(
                        [
                          ["Plan credits", "This month's allowance from your plan.", balance ? balance.daily + balance.monthly : null],
                          ["Rolled over", "Unused plan credits carried into this cycle.", balance ? balance.rollover : null],
                          ["Top-up credits", "Bought or given credit, including free credit. Never expires.", balance ? balance.topUp : null],
                        ] as const
                      ).map(([label, hint, value]) => (
                        <div key={label}>
                          <p className="flex items-center gap-1 text-[13px] text-muted" title={hint}>
                            {label} <Info className="h-3 w-3" aria-hidden />
                          </p>
                          <p className={`mt-2 text-lg ${value === null ? "text-faint" : "text-ink"}`}>
                            {value === null ? "—" : formatCredits(value)}
                          </p>
                        </div>
                      ))}
                    </div>

                    <p className="mt-6 text-[15px] font-medium text-ink">Usage history</p>
                    <div className="mt-3 rounded-xl border border-line/[0.07] bg-layer/[0.02]">
                      {records.lines === null ? (
                        <div className="flex h-[160px] items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-muted" />
                        </div>
                      ) : spending.length === 0 ? (
                        <div className="flex h-[160px] flex-col items-center justify-center px-6 text-center">
                          <Coins className="h-5 w-5 text-faint" />
                          <p className="mt-3 text-sm text-soft">{records.failed ? "Usage couldn't be loaded" : "No usage yet"}</p>
                          <p className="mt-1 text-[13px] text-muted">
                            {records.failed ? "Close and reopen settings to try again." : "Each build, edit and publish appears here with what it cost."}
                          </p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-line/[0.06]">
                          {spending.map((line) => (
                            <li key={line.id} className="flex items-center gap-4 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-ink">{line.description || line.action}</p>
                                <p className="truncate text-[13px] text-muted">
                                  {shortDate(line.created_at)}
                                  {line.project_id && projectNames.get(line.project_id) ? ` · ${projectNames.get(line.project_id)}` : ""}
                                </p>
                              </div>
                              <span className="shrink-0 text-sm text-soft">{formatCredits(line.credits)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {section === "agents" && (
                  <div className="pb-6">
                    <div className="flex gap-6 border-b border-line/[0.07]">
                      {([["main", "Main agents"], ["sub", "Sub-agents"], ["mcp", "MCP Tools"]] as const).map(
                        ([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setAgentTab(id)}
                            className={`-mb-px border-b-2 pb-3 pt-4 text-sm transition-colors ${
                              agentTab === id
                                ? "border-line text-ink"
                                : "border-transparent text-muted hover:text-ink"
                            }`}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>

                    {agentTab === "main" && (
                      <ul className="mt-4 space-y-2">
                        {/* What the composer actually offers, with the same
                            three reasons a row can be out of reach that the
                            picker itself shows: no credential here, not on
                            this plan, or not affordable on this balance. */}
                        {MODELS.map((option) => {
                          const gate = reach(option);
                          return (
                            <li
                              key={option.id}
                              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                                gate.ok
                                  ? "border-line/[0.07] bg-layer/[0.03]"
                                  : "border-line/[0.04] bg-layer/[0.015]"
                              }`}
                            >
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-layer/[0.05]">
                                <Bot className="h-4 w-4 text-muted" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm ${gate.ok ? "text-ink" : "text-ink/55"}`}>
                                  {option.name}
                                </p>
                                <p className="truncate text-[13px] text-muted">{option.blurb}</p>
                              </div>
                              {option.id === model ? (
                                <span className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                                  In use
                                </span>
                              ) : (
                                !gate.ok && (
                                  <span className="shrink-0 rounded-full border border-line/[0.08] bg-layer/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted">
                                    {gate.label}
                                  </span>
                                )
                              )}
                            </li>
                          );
                        })}
                        <li className="pt-1 text-[13px] text-muted">
                          Change this from the picker beside the message box. It applies from your next
                          message, wherever you are.
                        </li>
                      </ul>
                    )}

                    {agentTab === "sub" && (
                      <div className="flex h-[300px] flex-col items-center justify-center px-6 text-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-layer/[0.05]">
                          <Bot className="h-5 w-5 text-muted" />
                        </span>
                        <p className="mt-4 text-lg font-semibold text-ink">Delegate work to sub-agents</p>
                        <p className="mt-2 max-w-[380px] text-sm text-muted">
                          Sub-agents let a main agent hand off parts of a build. Nothing runs them yet.
                        </p>
                      </div>
                    )}

                    {agentTab === "mcp" && (() => {
                      /* Laid out as Claude's Connectors page: the ones you have, then
                         a directory to browse and a custom connector to add. */
                      const yours = mcpRows.filter(({ server, connected }) => connected || server.id.startsWith("custom:"));
                      const query = mcpQuery.trim().toLowerCase();
                      const directory = mcpRows.filter(
                        ({ server }) =>
                          !server.id.startsWith("custom:") &&
                          (!query || `${server.name} ${server.description}`.toLowerCase().includes(query)),
                      );
                      const action = (server: McpServer, connected: boolean) => {
                        const busy = mcpBusy === server.id;
                        if (connected) {
                          return (
                            <button
                              onClick={() => (server.auth === "none" ? toggleMcpServer(server.id, false) : removeMcpConnection(server.id))}
                              disabled={busy}
                              className="h-8 shrink-0 rounded-lg border border-line/[0.1] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.06] hover:text-ink disabled:opacity-50"
                            >
                              {busy ? "Disconnecting…" : "Disconnect"}
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => (server.auth === "none" ? toggleMcpServer(server.id, true) : signInToMcp(server.id))}
                            disabled={busy}
                            className="h-8 shrink-0 rounded-lg bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 disabled:opacity-50"
                          >
                            {busy ? "Opening…" : "Connect"}
                          </button>
                        );
                      };
                      return (
                        <div className="mt-4">
                          {notice && (
                            <p
                              role="status"
                              className={`mb-3 rounded-lg px-3 py-2 text-[13px] ${
                                notice.tone === "ok" ? "bg-accent/10 text-accent" : "bg-danger/10 text-danger"
                              }`}
                            >
                              {notice.server ? `${notice.server}: ` : ""}
                              {notice.text}
                            </p>
                          )}

                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[15px] font-medium text-ink">Connectors</p>
                              <p className="mt-0.5 text-[13px] text-muted">
                                Let your agents reach other apps and services for more context.
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setMcpError(null);
                                  setMcpView(mcpView === "browse" ? "yours" : "browse");
                                }}
                                className="h-9 rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3.5 text-[13px] text-ink transition-colors hover:bg-layer/[0.07]"
                              >
                                {mcpView === "browse" ? "Your connectors" : "Browse connectors"}
                              </button>
                              <button
                                onClick={() => {
                                  setMcpError(null);
                                  setConfiguring({ name: "", url: "" });
                                }}
                                className="flex h-9 items-center gap-1.5 rounded-lg bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
                              >
                                <Plus className="h-3.5 w-3.5" /> Add custom
                              </button>
                            </div>
                          </div>

                          {configuring && (
                            <div className="mt-4">
                              <McpForm
                                draft={configuring}
                                onChange={setConfiguring}
                                onCancel={() => setConfiguring(null)}
                                onConnect={connectCustomServer}
                                busy={mcpBusy === "new"}
                              />
                            </div>
                          )}

                          {mcpView === "yours" ? (
                            yours.length === 0 ? (
                              <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-line/[0.12] px-6 py-10 text-center">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-layer/[0.05]">
                                  <Server className="h-4 w-4 text-muted" />
                                </span>
                                <p className="mt-3 text-sm font-medium text-ink">No connectors yet</p>
                                <p className="mt-1 max-w-[320px] text-[13px] text-muted">
                                  Browse the directory to connect an app, or add your own MCP server.
                                </p>
                                <button
                                  onClick={() => setMcpView("browse")}
                                  className="mt-4 h-9 rounded-lg bg-solid px-4 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
                                >
                                  Browse connectors
                                </button>
                              </div>
                            ) : (
                              <ul className="mt-4 divide-y divide-line/[0.06] rounded-xl border border-line/[0.07]">
                                {yours.map(({ server, connected }) => (
                                  <li key={server.id} className="flex items-center gap-3 px-4 py-3">
                                    <ConnectorLogo server={server} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-ink">{server.name}</p>
                                      <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-accent" : "bg-faint"}`} aria-hidden />
                                        {connected ? "Connected" : "Not connected — sign in to finish"}
                                        {server.id.startsWith("custom:") ? " · Custom" : ""}
                                      </p>
                                    </div>
                                    {action(server, connected)}
                                    {server.id.startsWith("custom:") && !connected && (
                                      <button
                                        onClick={() => removeMcpConnection(server.id)}
                                        disabled={mcpBusy === server.id}
                                        aria-label={`Remove ${server.name}`}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-layer/[0.06] hover:text-danger disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : (
                            <>
                              <label className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-line/[0.1] bg-layer/[0.03] px-3 focus-within:border-line/25">
                                <span className="sr-only">Search connectors</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="h-4 w-4 text-muted">
                                  <circle cx="11" cy="11" r="7" />
                                  <path d="m20 20-3.5-3.5" />
                                </svg>
                                <input
                                  value={mcpQuery}
                                  onChange={(event) => setMcpQuery(event.target.value)}
                                  placeholder="Search connectors"
                                  className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                                />
                              </label>
                              {directory.length === 0 ? (
                                <p className="mt-6 text-center text-[13px] text-muted">
                                  No connector matches “{mcpQuery}”. You can add it as a custom connector.
                                </p>
                              ) : (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  {directory.map(({ server, connected }) => (
                                    <div key={server.id} className="flex flex-col rounded-xl border border-line/[0.08] bg-layer/[0.02] p-4">
                                      <div className="flex items-start gap-3">
                                        <ConnectorLogo server={server} size="lg" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-medium text-ink">{server.name}</p>
                                          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{server.description}</p>
                                        </div>
                                      </div>
                                      <div className="mt-3 flex items-center justify-between">
                                        <span className="text-[12px] text-faint">{server.auth === "oauth" ? "Sign-in required" : "No sign-in"}</span>
                                        {connected ? (
                                          <span className="flex items-center gap-1 text-[12.5px] font-medium text-accent">
                                            <Check className="h-3.5 w-3.5" /> Connected
                                          </span>
                                        ) : (
                                          action(server, false)
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}

                          {mcpError && <p className="mt-3 text-[13px] text-danger">{mcpError}</p>}

                          {/* Saying so beats letting a "Connected" badge imply a build
                              step that has not been written. */}
                          <p className="mt-4 text-[12.5px] text-faint">
                            Connections are saved to your account. Builds don&apos;t call connectors yet.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {section === "preferences" && (
                  <div className="py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">General</p>
                    <label className="mt-3 block text-sm text-ink" htmlFor="language">
                      Language
                    </label>
                    <select
                      id="language"
                      defaultValue="en"
                      className="mt-2 h-10 w-[280px] max-w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink outline-none"
                    >
                      {/* Only English exists until the app is translated. */}
                      <option value="en">English</option>
                    </select>

                    <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Appearance
                    </p>
                    {/* The same setting as the switch in the sidebar — one
                        ThemeProvider, one stored choice — so changing it here
                        changes it there, and it survives a reload. */}
                    <div role="radiogroup" aria-label="Appearance" className="mt-3 flex flex-wrap gap-3">
                      {([["light", "Light"], ["dark", "Dark"], ["system", "Follow System"]] as const).map(
                        ([id, label]) => {
                          const active = themeChoice === id;
                          return (
                            <div key={id} className="w-[104px]">
                              <button
                                role="radio"
                                aria-checked={active}
                                aria-label={label}
                                onClick={() => setThemeChoice(id)}
                                className={`flex h-[74px] w-full items-center justify-center rounded-lg border-2 transition-colors ${
                                  active
                                    ? "border-[#4A90E2] bg-panel"
                                    : "border-line/[0.08] bg-layer/[0.03] hover:border-line/[0.18]"
                                }`}
                              >
                                {/* Fixed colours on purpose: each card is a
                                    picture of a theme, so it must look the same
                                    whichever theme is drawing it. */}
                                <span
                                  aria-hidden
                                  className={`flex h-[46px] w-[76px] flex-col gap-1 rounded p-2 ${
                                    id === "light"
                                      ? "bg-[#F4F4F5]"
                                      : id === "dark"
                                        ? "bg-[#0d0d0f]"
                                        : "bg-gradient-to-r from-[#F4F4F5] to-[#0d0d0f]"
                                  }`}
                                >
                                  <span className={`h-1 w-8 rounded-full ${id === "dark" ? "bg-white/40" : "bg-black/25"}`} />
                                  <span className={`h-1 w-12 rounded-full ${id === "dark" ? "bg-white/20" : "bg-black/15"}`} />
                                  <span className={`h-1 w-10 rounded-full ${id === "dark" ? "bg-white/20" : "bg-black/15"}`} />
                                </span>
                              </button>
                              <p className={`mt-2 text-center text-[13px] ${active ? "text-ink" : "text-muted"}`}>
                                {label}
                              </p>
                            </div>
                          );
                        },
                      )}
                    </div>
                    <p className="mt-3 text-[13px] text-muted">
                      {themeChoice === "system"
                        ? `Follows your device — ${resolvedTheme} right now, and it changes when your device does.`
                        : "Saved on this device. Applies everywhere in QuickStark.Ai right away."}
                    </p>
                  </div>
                )}

                {section === "key" && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-ink">Universal Key</p>
                    <p className="mt-1 text-[13px] text-muted">
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
