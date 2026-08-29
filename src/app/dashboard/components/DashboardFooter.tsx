"use client";

import React from "react";
import { Github, Instagram, Linkedin, Youtube } from "lucide-react";

import { requestSupportChat } from "../supportChat";

/* The foot of Home: what the product is, where the rest of it lives, and who
   made it.

   Every entry is either a page this application actually has or plainly not a
   link yet. A footer of href="#" teaches people their clicks do nothing, which
   is worse than a line of grey text that never asked to be clicked — so the
   ones with somewhere to go are links and the rest are stated, dimmer, with the
   reason on hover. */
type FooterLink = { label: string; href?: string; onClick?: () => void };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Build", href: "/dashboard" },
      { label: "Pricing", href: "/pricing" },
      { label: "Analytics", href: "/dashboard/analytics" },
      { label: "Integrations" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs" },
      { label: "Tutorials" },
      { label: "Support", onClick: requestSupportChat },
      { label: "Blog" },
    ],
  },
  {
    title: "Company",
    links: [{ label: "About" }, { label: "Careers" }, { label: "Community" }],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Cookie Policy" },
    ],
  },
];

const SOCIALS = [
  { label: "LinkedIn", icon: Linkedin },
  { label: "GitHub", icon: Github },
  { label: "YouTube", icon: Youtube },
  { label: "Instagram", icon: Instagram },
];

export default function DashboardFooter() {
  // Rendered on both passes from the same clock, so the year cannot differ
  // between the server's copy and the browser's.
  const year = new Date().getFullYear();

  const linkClass =
    "text-[14px] text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none";

  return (
    <footer className="relative z-10 w-full border-t border-line/[0.06] px-5 pb-10 pt-14 md:px-8">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]">
          <div className="max-w-[360px]">
            <a
              href="/dashboard"
              className="text-[22px] font-bold tracking-tight text-ink"
              aria-label="QuickStark.Ai home"
            >
              QuickStark<span className="text-accent">.Ai</span>
            </a>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Describe the app you want and watch it get built — the interface, the data behind
              it, and the deploy that puts it online, from one conversation.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-[15px] font-semibold text-ink">{column.title}</h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <a href={link.href} className={linkClass}>
                        {link.label}
                      </a>
                    ) : link.onClick ? (
                      <button onClick={link.onClick} className={linkClass}>
                        {link.label}
                      </button>
                    ) : (
                      <span
                        title="Not published yet"
                        className="text-[14px] text-[#5C6068]"
                      >
                        {link.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center gap-6 border-t border-line/[0.06] pt-6 md:flex-row md:justify-between">
          <p className="text-[12px] uppercase tracking-[0.14em] text-faint">
            Copyright © QuickStark.Ai {year}
          </p>

          <p className="text-center text-[12px] uppercase leading-relaxed tracking-[0.14em] text-faint">
            Designed and built by
            <br className="sm:hidden" /> the QuickStark.Ai team
          </p>

          <div className="flex items-center gap-2">
            {SOCIALS.map((social) => {
              const Icon = social.icon;
              return (
                <span
                  key={social.label}
                  title={`${social.label} — not connected yet`}
                  aria-label={social.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.07] text-faint"
                >
                  <Icon className="h-4 w-4" />
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}
