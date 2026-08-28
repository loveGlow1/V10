"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, LayoutGrid, Sparkles, ChevronDown, Coins, LogOut, PanelLeftClose, Settings } from "lucide-react";
import Q3DCanvas from "../../Q3DCanvas";
import { useMediaQuery } from "@/hooks/use-media-query";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  /** The same figure the rest of the app shows, rather than a second hardcoded one. */
  credits?: string;
  onNewTask?: () => void;
  onAccountSettings?: () => void;
}

export default function Sidebar({
  open,
  onClose,
  onUpgradeClick,
  credits = "0.00",
  onNewTask,
  onAccountSettings,
}: SidebarProps) {
  const router = useRouter();
  /* The drawer is md:hidden, so the lock below must be too — otherwise widening the
     window while it is open leaves the page frozen with no drawer to close. */
  const isDesktop = useMediaQuery("(min-width: 768px)");
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

  /* Hold the page still while the drawer is open.
     `overscroll-contain` alone stops a scroll *inside* the drawer from continuing
     into the page, but it does nothing about a drag that starts on the dim backdrop,
     and iOS Safari will still rubber-band the document underneath. Pinning the body
     is what actually freezes it. The scroll position is saved and restored, because
     `position: fixed` otherwise throws the page back to the top on close. */
  useEffect(() => {
    if (!open || isDesktop) return;

    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open, isDesktop]);

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
            className="fixed inset-0 z-40 touch-none bg-black/60 backdrop-blur-sm md:hidden"
          />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            /* The panel is lit rather than outlined: a hairline down its open edge,
               a pixel of light along the top, and a wide soft shadow thrown onto the
               page behind it. Nothing here reads as a border on its own.

               dvh rather than h-full so the panel tracks Safari's collapsing toolbar
               instead of standing taller than the visible area. The backdrop-blur that
               used to sit here was doing nothing visible behind an opaque panel and
               cost a full-height filter pass on every frame of the page behind it —
               which is what made scrolling feel heavy. */
            className="fixed top-0 left-0 z-50 flex h-[100dvh] w-[min(300px,84vw)] flex-col overflow-hidden overscroll-contain border-r border-white/[0.09] bg-[rgba(10,10,12,0.97)] p-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),18px_0_60px_rgba(0,0,0,0.55)] md:hidden"
          >
            {/* Header: 3D Canvas Logo & QuickStart.Ai Brand */}
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <div className="flex min-w-0 items-center gap-2.5">
                {/* The size has to be given to the canvas itself — the component passes
                    className through to it, so without one the mark had no box and the
                    36px frame clipped it to a sliver. */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                  <Q3DCanvas scale={0.65} className="h-9 w-9" />
                </div>
                <span className="text-lg font-bold tracking-tight text-white">
                  QuickStart<span className="text-[#34F5A0]">.Ai</span>
                </span>
              </div>

              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.09] hover:text-white"
                aria-label="Close menu"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* New Task Button */}
            <button
              onClick={() => {
                onClose();
                onNewTask?.();
              }}
              className="group mb-4 flex shrink-0 items-center gap-3 text-left"
            >
              <span className="w-8 h-8 rounded-full bg-[#34F5A0] flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(52,245,160,0.2)]">
                <Plus className="w-4 h-4 text-black stroke-[2.5]" />
              </span>
              <span className="text-[#34F5A0] font-semibold text-base">New Task</span>
            </button>

            {/* Nav items */}
            {/* min-h-11 keeps each row at a thumb-sized target while the gaps close up. */}
            <nav className="mb-5 shrink-0 space-y-1">
              <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[#8F939A] transition-colors hover:bg-white/[0.04] hover:text-white">
                <LayoutGrid className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">Published Apps</span>
              </button>
              <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[#8F939A] transition-colors hover:bg-white/[0.04] hover:text-white">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">Showcase</span>
              </button>
            </nav>

            {/* Recent Tasks Section */}
            <div className="flex min-h-0 flex-1 flex-col">
              <h3 className="mb-3 shrink-0 px-1 text-xs font-semibold uppercase tracking-wider text-[#8F939A]/70">
                Recent Tasks
              </h3>
              {/* Once there are tasks this is what scrolls; nothing else in the panel
                  does, so a drag anywhere else cannot start a scroll at all. */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <p className="mb-1 text-sm font-medium text-[#8F939A]">No tasks yet</p>
                  <p className="text-xs leading-relaxed text-[#8F939A]/60">
                    Create your first task to start building
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Stack: Credits Card on top, User Profile Dock below */}
            <div className="mt-3 shrink-0 space-y-2 border-t border-white/[0.06] pt-3">
              {/* Credits & Upgrade Card */}
              <div className="rounded-[20px] bg-white/[0.03] border border-white/[0.08] p-3.5 flex items-center justify-between shadow-lg">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#F4D96B]/15 flex items-center justify-center">
                    <Coins className="w-4 h-4 text-[#F4D96B]" />
                  </div>
                  <span className="text-white text-sm font-semibold tracking-wide">{credits}</span>
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
                      {onAccountSettings && (
                        <button
                          onClick={() => {
                            setAccountMenuOpen(false);
                            onClose();
                            onAccountSettings();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[#8F939A] transition-colors hover:bg-white/[0.04] hover:text-white"
                        >
                          <Settings className="h-4 w-4" />
                          <span className="text-sm font-medium">Account Settings</span>
                        </button>
                      )}

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
