import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/* "Allow Claude to use your QuickStark account?"
 *
 * Supabase Auth's OAuth 2.1 server sends people here — the Authorization Path
 * set in the Supabase dashboard — with an `authorization_id`, when an AI
 * assistant connects to QuickStark's MCP server (see docs/MCP.md). This page
 * says who is asking and what they will be able to do; the decision itself is
 * posted to /api/oauth/decision, which tells Supabase and sends the person back
 * to the assistant. */

export const metadata: Metadata = {
  title: "QuickStark.Ai | Connect an app",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const CAN = [
  "See your QuickStark projects and their links",
  "Build new apps and change existing ones when you ask it to",
  "Publish an app when you ask it to",
  "See your plan and credit balance",
];

const CANNOT = ["Delete projects or change your database", "See your password or payment details"];

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const authorizationId = (await searchParams).authorization_id?.trim() ?? "";
  if (!authorizationId) return <Shell title="This link is incomplete">Go back to the app you were connecting and try again.</Shell>;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <Shell title="Sign-in is unavailable">QuickStark can't reach its sign-in service right now.</Shell>;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    /* Signed in, they come straight back here — see `next` on the landing page. */
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/?signin=1&next=${encodeURIComponent(next)}`);
  }

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details) {
    return (
      <Shell title="This request has expired">
        {error?.message ?? "Go back to the app you were connecting and start again."}
      </Shell>
    );
  }

  /* Approved before, for the same access: Supabase answers with where to go. */
  if (!("authorization_id" in details)) redirect(details.redirect_url);

  const client = details.client.name || "An app";
  const host = hostOf(details.redirect_uri);

  return (
    <Shell title={`Allow ${client} to use your QuickStark account?`}>
      <p className="text-[13.5px] leading-relaxed text-muted">
        Signed in as <span className="text-ink">{details.user.email || user.email}</span>.
        {host ? <> After you choose, you&apos;ll go back to <span className="text-ink">{host}</span>.</> : null}
      </p>

      <List heading={`${client} will be able to`} items={CAN} tone="yes" />
      <List heading="It won't be able to" items={CANNOT} tone="no" />

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        Building and publishing use your credits, the same as in QuickStark. You can disconnect it at any time from the app you&apos;re connecting.
      </p>

      <form action="/api/oauth/decision" method="POST" className="mt-6 grid grid-cols-2 gap-2.5">
        <input type="hidden" name="authorization_id" value={details.authorization_id} />
        <button
          type="submit"
          name="decision"
          value="deny"
          className="h-11 rounded-xl border border-line/[0.12] text-[14px] font-medium text-ink transition-colors hover:bg-layer/[0.06]"
        >
          Cancel
        </button>
        <button
          type="submit"
          name="decision"
          value="approve"
          className="h-11 rounded-xl bg-ink text-[14px] font-medium text-canvas transition-opacity hover:opacity-90"
        >
          Allow
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-black px-4 py-10 text-ink">
      <div className="w-full max-w-[440px] rounded-2xl border border-line/[0.1] bg-canvas px-6 pb-6 pt-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#050506] text-[13px] font-bold text-[#8EF08A]">Q</span>
          QuickStark.Ai
        </div>
        <h1 className="mt-4 text-[19px] font-semibold leading-snug text-ink">{title}</h1>
        <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </main>
  );
}

function List({ heading, items, tone }: { heading: string; items: string[]; tone: "yes" | "no" }) {
  return (
    <div className="mt-5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{heading}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13.5px] text-ink">
            <span aria-hidden className={tone === "yes" ? "text-[#16a34a] dark:text-[#4ade80]" : "text-muted"}>
              {tone === "yes" ? "✓" : "✕"}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}
