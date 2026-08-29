"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Gift,
  Github,
  Globe,
  LifeBuoy,
  LogOut,
  Repeat2,
  Settings,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

import Q3DCanvas from "../../Q3DCanvas";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

interface TopNavProps {
  onUpgradeClick: () => void;
  onAccountSettingsClick: () => void;
  projectName: string;
  /** No credits service exists yet; the value the app already displayed is passed in. */
  credits: string;
}

export default function TopNav({ onUpgradeClick, onAccountSettingsClick, projectName, credits }: TopNavProps) {
  const router = useRouter();
  const [account, setAccount] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [panelOpen, setPanelOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (cancelled || !user) return;
        const metadata = user.user_metadata ?? {};
        setAccount({
          name: (metadata.full_name as string) || (metadata.name as string) || "",
          email: user.email ?? "",
        });
      })
      .catch(() => {
        // Leave it blank rather than showing a name that is not the signed-in user's.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Dismiss on an outside press or Escape, the way an application menu behaves.
  useEffect(() => {
    if (!panelOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setPanelOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPanelOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  async function handleSignOut() {
    if (!isSupabaseConfigured) return;
    setSigningOut(true);
    setPanelOpen(false);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      // refresh() re-runs the layout, whose guard sends the visitor to the
      // landing page once the session cookies are gone.
      router.push("/");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  const initial = (account.name || account.email || "?").charAt(0).toUpperCase();

  // Only the first two have somewhere real to go; the rest stay inert rather
  // than pointing at routes this application does not have.
  const menuItems: { icon: typeof Gift; label: string; trailing?: "chevron" | "external"; onClick?: () => void }[] = [
    { icon: Gift, label: "Refer and Earn" },
    { icon: CreditCard, label: "Manage Plan", onClick: () => { setPanelOpen(false); onUpgradeClick(); } },
    { icon: Trophy, label: "Builders Contest", trailing: "chevron" },
    { icon: Settings, label: "Account Settings", onClick: () => { setPanelOpen(false); onAccountSettingsClick(); } },
    { icon: Globe, label: "Language", trailing: "chevron" },
    { icon: Github, label: "Connect to GitHub", trailing: "external" },
    { icon: Users, label: "Community", trailing: "external" },
    { icon: LifeBuoy, label: "Help Center", trailing: "external" },
  ];

  return (
    // From md up. A phone gets TopBar instead: the brand, the home button and the
    // account menu do not fit beside an upgrade pill at 390px, and the drawer
    // already carries them.
    <header className="sticky top-0 z-50 hidden h-14 w-full border-b border-line/[0.06] bg-bar md:block">
      <div className="mx-auto flex h-full w-full items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <a href="/dashboard" className="flex shrink-0 items-center gap-2" aria-label="QuickStark.Ai dashboard">
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden">
              <Q3DCanvas scale={0.55} />
            </span>
            <span className="whitespace-nowrap text-[15px] font-bold tracking-tight text-ink">
              QuickStark<span className="text-accent">.Ai</span>
            </span>
          </a>

          {/* No Home button here. The tab strip below carries Home as a tab —
              one control, in the row where the apps you can switch to already
              are — and the brand beside this is a link to the same place. Two
              Homes a hairline apart is one too many to read. */}
        </div>

        {/* Upgrade + avatar */}
        <div className="relative flex shrink-0 items-center gap-2 sm:gap-3" ref={panelRef}>
          <button
            onClick={onUpgradeClick}
            className="h-[34px] w-[112px] rounded-full bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] text-[13px] font-semibold text-[#3a2e00] transition-all hover:brightness-105 active:scale-[0.98]"
          >
            Upgrade
          </button>

          <button
            onClick={() => setPanelOpen((value) => !value)}
            aria-expanded={panelOpen}
            aria-label="Account menu"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white transition-transform active:scale-[0.97]"
          >
            {initial}
          </button>

          <AnimatePresence>
            {panelOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                role="menu"
                // Right-anchored to the avatar, and never wider than the viewport.
                className="absolute right-0 top-[calc(100%+10px)] z-[70] w-[270px] max-w-[calc(100vw-24px)] overflow-hidden rounded-b-2xl rounded-t-lg border border-line/[0.08] bg-panel shadow-[0_24px_60px_rgba(0,0,0,0.65)]"
              >
                {/* Names the account without printing the address. Settings keeps
                    the address, where showing it is the point. */}
                <p className="truncate px-4 pb-3 pt-3.5 text-sm text-muted">
                  {account.name || account.email || "Signed in"}
                </p>

                {/* Project */}
                <div className="flex items-center gap-2.5 px-4 pb-3">
                  <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-[#34F5A0] to-[#2B6CB0]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight text-ink">{projectName}</p>
                    <p className="truncate text-xs leading-tight text-muted">Owner · 1 member</p>
                  </div>
                  <Repeat2 className="h-4 w-4 shrink-0 text-muted" />
                </div>

                {/* Credits */}
                <div className="mx-3 mb-3 rounded-xl border border-line/[0.06] bg-layer/[0.03] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Credits</span>
                    <span className="text-sm font-semibold text-ink">{credits}</span>
                  </div>
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      onUpgradeClick();
                    }}
                    className="mt-2.5 h-8 w-full rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] text-[13px] font-semibold text-[#3a2e00] transition-all hover:brightness-105 active:scale-[0.99]"
                  >
                    Upgrade
                  </button>
                </div>

                {/* Actions */}
                <div className="px-1.5 pb-1.5">
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        role="menuitem"
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted" />
                        <span className="flex-1 truncate text-[13px]">{item.label}</span>
                        {item.trailing === "chevron" && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                        {item.trailing === "external" && <ArrowUpRight className="h-3.5 w-3.5 text-muted" />}
                      </button>
                    );
                  })}
                </div>

                {/* Logout, set apart from the rest */}
                <div className="border-t border-line/[0.06] px-1.5 py-1.5">
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-danger transition-colors hover:bg-[#ef7777]/[0.08] disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span className="text-[13px]">{signingOut ? "Signing out…" : "Logout"}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
