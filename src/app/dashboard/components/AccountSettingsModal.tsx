"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Coins, CreditCard, KeyRound, Pencil, Check, SlidersHorizontal, Sparkles, X } from "lucide-react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

interface AccountSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  credits: string;
}

type SectionId = "account" | "key" | "agents" | "preferences" | "plans" | "credits";

export default function AccountSettingsModal({ open, onClose, onUpgradeClick, credits }: AccountSettingsModalProps) {
  const [section, setSection] = useState<SectionId>("account");
  const [account, setAccount] = useState<{ id: string; name: string; email: string }>({ id: "", name: "", email: "" });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [supportCode, setSupportCode] = useState<string | null>(null);

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

  const initial = (account.name || account.email || "?").charAt(0).toUpperCase();

  const navItems: { id: SectionId; label: string; icon?: typeof KeyRound }[] = [
    { id: "account", label: account.name || "Your account" },
    { id: "key", label: "Universal Key", icon: KeyRound },
    { id: "agents", label: "Manage Agents", icon: Bot },
    { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
    { id: "plans", label: "Plans & Invoices", icon: CreditCard },
    { id: "credits", label: "Credit Usage", icon: Coins },
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
            aria-label="Account settings"
            className="flex h-[590px] max-h-[calc(100vh-48px)] w-full max-w-[880px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f0f11] shadow-[0_30px_90px_rgba(0,0,0,0.75)]"
          >
            {/* Left rail */}
            <aside className="hidden w-[220px] shrink-0 flex-col border-r border-white/[0.07] p-3 sm:flex">
              <p className="px-3 pb-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F939A]">
                Account settings
              </p>
              <nav className="space-y-0.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSection(item.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                        active ? "bg-white/[0.07] text-white" : "text-[#C7CAD0] hover:bg-white/[0.04] hover:text-white"
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
              </nav>
            </aside>

            {/* Right pane */}
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
                <h2 className="text-[17px] font-semibold text-white">Account settings</h2>
                <button
                  onClick={onClose}
                  aria-label="Close account settings"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] text-[#8F939A] transition-colors hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
                {section === "account" && (
                  <>
                    <div className="divide-y divide-white/[0.06]">
                      <Row title="Email" description="The email address linked to your current account">
                        <span className="text-sm text-white">{account.email || "—"}</span>
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
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-white">Plans & Invoices</p>
                    <p className="mt-1 text-[13px] text-[#8F939A]">
                      You are on Free. Invoices appear here once billing is connected.
                    </p>
                    <button
                      onClick={onUpgradeClick}
                      className="mt-4 h-10 rounded-lg bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-4 text-sm font-semibold text-[#3a2e00] transition-all hover:brightness-105"
                    >
                      See plans
                    </button>
                  </div>
                )}

                {section === "credits" && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-white">Credit Usage</p>
                    <div className="mt-3 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-5 py-4">
                      <span className="text-sm text-[#8F939A]">Balance</span>
                      <span className="text-lg font-semibold text-white">{credits}</span>
                    </div>
                    <p className="mt-3 text-[13px] text-[#8F939A]">
                      Usage history appears here once a credits service is connected.
                    </p>
                  </div>
                )}

                {(section === "key" || section === "agents" || section === "preferences") && (
                  <div className="py-6">
                    <p className="text-[15px] font-medium text-white">
                      {section === "key" ? "Universal Key" : section === "agents" ? "Manage Agents" : "Preferences"}
                    </p>
                    <p className="mt-1 text-[13px] text-[#8F939A]">
                      {section === "key"
                        ? "Bring your own model key. Nothing is connected to store one yet."
                        : section === "agents"
                          ? "Agents are chosen per prompt from the composer. Managing them here needs a place to save them first."
                          : "Model and visibility are set per prompt from the composer for now."}
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
