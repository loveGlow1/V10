import Link from "next/link";

import { LEGAL, isDraft, missingDetails, type LegalKey } from "@/lib/legal";

/* A value from LEGAL, or a visible marker naming what is still missing. The
   marker is deliberately loud: it is meant to be impossible to ship past. */
export function Fill({ value, name }: { value: string; name: string }) {
  if (value.trim()) return <>{value}</>;

  return (
    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-300">
      [{name}]
    </span>
  );
}

/** Shorthand for a value that lives in LEGAL. */
export function L({ k, name }: { k: LegalKey; name: string }) {
  return <Fill value={LEGAL[k]} name={name} />;
}

/* Both documents share this shell: the wordmark home, the title, the date line,
   and the draft banner. Styling comes from the brand tokens the rest of the site
   already uses, so nothing new is added to the stylesheet. */
export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  const missing = missingDetails();

  return (
    <div className="min-h-[100dvh] bg-brandBg text-white antialiased">
      <header className="border-b border-brandBorder px-6">
        <div className="page-shell flex h-20 items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40"
            aria-label="QuickStark.Ai home"
          >
            <span className="wordmark-quickstart">QuickStark</span>
            <span className="wordmark-ai">.Ai</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-brandTextSec transition-colors hover:text-brandGreen focus:outline-none focus-visible:ring-2 focus-visible:ring-brandGreen/40"
          >
            Back to site
          </Link>
        </div>
      </header>

      <main className="px-6 py-14 sm:py-20">
        {/* Not .page-shell here: that class is defined after Tailwind's utilities
            in globals.css, so its max-width beats max-w-3xl and the measure ends
            up around 150 characters — unreadable for running prose. The header and
            footer bars still use it, so the wordmark stays aligned with the rest of
            the site. */}
        <div className="mx-auto max-w-2xl">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-brandTextSec">
            Effective <L k="effectiveDate" name="effective date" /> · QuickStark.Ai
          </p>
          <p className="mt-6 text-base leading-relaxed text-brandTextSec">{intro}</p>

          {isDraft && (
            <div className="mt-8 rounded-premium border border-amber-500/40 bg-amber-500/10 px-5 py-4">
              <p className="text-sm font-semibold text-amber-200">
                This document is not final and has not been reviewed by a lawyer.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
                {missing.length} detail{missing.length === 1 ? "" : "s"} still to be filled in, marked
                below. Set them in <span className="font-mono text-[0.9em]">src/lib/legal.ts</span> and
                this notice disappears.
              </p>
            </div>
          )}

          {/* space-y rather than per-element margins, so the rhythm cannot drift
              between the two documents. */}
          <div className="mt-12 space-y-10">{children}</div>
        </div>
      </main>

      <footer className="border-t border-brandBorder px-6 py-10">
        <div className="page-shell flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brandTextSec">
          <Link href="/terms" className="transition-colors hover:text-brandGreen">
            Terms of Service
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-brandGreen">
            Privacy Policy
          </Link>
          <span className="text-white/30">
            © {new Date().getFullYear()} <Fill value={LEGAL.entity} name="legal entity" />
          </span>
        </div>
      </footer>
    </div>
  );
}

/* One numbered clause. Legal sections are referred to by number, so the numbering
   carries meaning rather than decoration — and the id makes each one linkable. */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  const id = `${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="flex items-baseline gap-3 text-lg font-semibold tracking-tight text-white">
        <span className="font-mono text-sm text-brandGreen">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-4 text-[15px] leading-[1.75] text-brandTextSec">{children}</div>
    </section>
  );
}

/** A list inside a clause, matching the prose colour and rhythm. */
export function Points({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-brandGreen" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
