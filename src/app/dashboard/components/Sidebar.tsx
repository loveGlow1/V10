"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, LayoutGrid, Sparkles, ChevronDown, Coins, LogOut } from "lucide-react";
import Q3DCanvas from "../../Q3DCanvas";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
}

export default function Sidebar({ open, onClose, onUpgradeClick }: SidebarProps) {
  const router = useRouter();
  const [account, setAccount] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // The card used to show one hardcoded person, which every visitor would have
  // seen as their own. Read the signed-in user instead.
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
        // Leave the card blank rather than showing someone else's name.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Reopening the drawer should not reopen the menu on top of it.
  useEffect(() => {
    if (!open) setAccountMenuOpen(false);
  }, [open]);

  async function handleSignOut() {
    if (!isSupabaseConfigured) return;
    setSigningOut(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      // refresh() re-runs the layout, which redirects once the cookies are gone.
      router.push("/");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="fixed top-0 left-0 h-full w-[320px] bg-[rgba(10,10,12,0.95)] backdrop-blur-2xl border-r border-white/[0.08] z-50 flex flex-col p-5"
          >
            {/* Header: 3D Canvas Logo & QuickStart.Ai Brand */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 flex items-center justify-center overflow-hidden">
                  <Q3DCanvas scale={0.65} />
                </div>
                <span className="text-lg font-bold tracking-tight text-white">
                  QuickStart<span className="text-[#34F5A0]">.Ai</span>
                </span>
              </div>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/50 hover:text-white transition-colors"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            {/* New Task Button */}
            <button className="flex items-center gap-3 mb-6 group text-left">
              <span className="w-8 h-8 rounded-full bg-[#34F5A0] flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(52,245,160,0.2)]">
                <Plus className="w-4 h-4 text-black stroke-[2.5]" />
              </span>
              <span className="text-[#34F5A0] font-semibold text-base">New Task</span>
            </button>

            {/* Nav items */}
            <nav className="space-y-3 mb-8">
              <button className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-[#8F939A] hover:text-white hover:bg-white/[0.04] transition-colors text-left">
                <LayoutGrid className="w-4 h-4" />
                <span className="text-sm font-medium">Published Apps</span>
              </button>
              <button className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-[#8F939A] hover:text-white hover:bg-white/[0.04] transition-colors text-left">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-medium">Showcase</span>
              </button>
            </nav>

            {/* Recent Tasks Section */}
            <div className="flex-1 flex flex-col">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8F939A]/70 mb-4 px-1">
                Recent Tasks
              </h3>
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <p className="text-[#8F939A] text-sm font-medium mb-1">No tasks yet</p>
                <p className="text-[#8F939A]/60 text-xs leading-relaxed">
                  Create your first task to start building
                </p>
              </div>
            </div>

            {/* Bottom Stack: Credits Card on top, User Profile Dock below */}
            <div className="space-y-2 mt-4 pt-4 border-t border-white/[0.06]">
              {/* Credits & Upgrade Card */}
              <div className="rounded-[20px] bg-white/[0.03] border border-white/[0.08] p-3.5 flex items-center justify-between shadow-lg">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#F4D96B]/15 flex items-center justify-center">
                    <Coins className="w-4 h-4 text-[#F4D96B]" />
                  </div>
                  <span className="text-white text-sm font-semibold tracking-wide">0.00</span>
                </div>
                <button
                  onClick={onUpgradeClick}
                  className="text-xs font-semibold text-black bg-gradient-to-r from-[#F4D96B] to-[#E2C244] px-4 py-2 rounded-full hover:brightness-105 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(244,217,107,0.25)]"
                >
                  <span>Upgrade</span>
                  <span className="w-4 h-4 rounded-full bg-black/15 flex items-center justify-center text-[10px] font-bold">+</span>
                </button>
              </div>

              {/* User Profile Card */}
              <div className="relative">
                {/* The chevron was inert; it now opens the account menu that holds
                    sign-out, which the drawer otherwise had nowhere to live. */}
                <AnimatePresence>
                  {accountMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-full left-0 right-0 mb-2 rounded-[16px] border border-white/[0.08] bg-[rgba(18,18,22,0.98)] p-1.5 shadow-xl backdrop-blur-xl"
                    >
                      <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[#8F939A] transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-60"
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="text-sm font-medium">{signingOut ? "Signing out…" : "Sign out"}</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="rounded-[20px] bg-white/[0.02] border border-white/[0.06] p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-inner">
                      {(account.name || account.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-white text-sm font-medium leading-tight truncate">
                        {account.name || "Your account"}
                      </p>
                      <p className="text-[#8F939A] text-xs leading-tight underline underline-offset-2 truncate">
                        {account.email || "Signed in"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAccountMenuOpen((value) => !value)}
                    aria-expanded={accountMenuOpen}
                    aria-label="Account menu"
                    className="w-7 h-7 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-[#8F939A] hover:text-white transition-all flex-shrink-0"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${accountMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
