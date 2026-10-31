"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleDashed, KeyRound } from "lucide-react";

import type { KeyStatus } from "@/lib/keys";

/* The owner's view of the deployment's keys: what is on, and for what is not,
   the exact names to add in Vercel → Settings → Environment Variables. Names
   only — values never leave Vercel (api/keys). */

type Body = { features?: KeyStatus[]; environment?: string; error?: string; setup?: boolean };

export default function KeysPage() {
  const [body, setBody] = useState<Body | null>(null);

  useEffect(() => {
    void fetch("/api/keys", { cache: "no-store" })
      .then(async (response) => setBody((await response.json().catch(() => ({ error: "Could not load." }))) as Body))
      .catch(() => setBody({ error: "Could not load." }));
  }, []);

  const features = body?.features ?? [];
  const areas = [...new Set(features.map((f) => f.area))];
  const on = features.filter((f) => f.ready).length;
  const blocking = features.filter((f) => f.required && !f.ready);

  return (
    <main className="min-h-[100dvh] bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-[760px]">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
        <h1 className="mt-4 flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <KeyRound className="h-5 w-5 text-muted" /> Keys
        </h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          Add a key in Vercel → Settings → Environment Variables, then redeploy — the feature switches on by itself. Only names are shown here; values never leave Vercel.
        </p>

        {!body ? (
          <p className="mt-8 text-[14px] text-muted">Checking…</p>
        ) : body.error ? (
          <p className="mt-8 rounded-xl border border-line/[0.1] p-4 text-[14px] text-soft">{body.error}</p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              <span>
                <span className="font-semibold text-ink">{on}</span> of {features.length} on
              </span>
              <span>Environment: {body.environment}</span>
            </div>
            {blocking.length ? (
              <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-[13px] text-ink">
                Needed for the site to run: {blocking.map((f) => f.label).join(", ")}.
              </p>
            ) : null}

            {areas.map((area) => (
              <section key={area} className="mt-7">
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{area}</h2>
                <ul className="mt-2 space-y-2">
                  {features
                    .filter((f) => f.area === area)
                    .map((f) => (
                      <li key={f.id} className="rounded-xl border border-line/[0.08] bg-layer/[0.02] p-3.5">
                        <div className="flex items-start gap-2.5">
                          {f.ready ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium">
                              {f.label}
                              {f.required && !f.ready ? <span className="ml-2 text-[12px] font-normal text-danger">required</span> : null}
                            </p>
                            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{f.unlocks}</p>
                            {!f.ready && f.missing.length ? (
                              <p className="mt-1.5 text-[12.5px] text-soft">
                                Add:{" "}
                                {f.missing.map((name, i) => (
                                  <span key={name}>
                                    {i ? ", " : ""}
                                    <code className="rounded bg-layer/[0.07] px-1.5 py-0.5 font-mono text-[12px]">{name}</code>
                                  </span>
                                ))}
                                {f.where ? <span className="text-muted"> — from {f.where}</span> : null}
                              </p>
                            ) : null}
                            {f.also ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{f.also}</p> : null}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
