import { NextResponse } from "next/server";

import { DOMAIN_PROBLEM, isApex, normaliseDomain, recordName } from "@/lib/publish/naming";
import { addDomain, domainConfig, domainsConfigured, removeDomain } from "@/lib/publish/vercel-domains";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Connecting a domain somebody owns, and checking whether it works yet.
 *
 * Three steps, and they are separate because the person has to do something in
 * the middle. Collapsing them into one button is the commonest way this is
 * built badly: "Connect" appears to fail, because DNS cannot possibly be right
 * one second after the domain was added.
 *
 *   POST   adds the domain here and at Vercel, and answers with the DNS record
 *          to go and create. This is expected to end in "awaiting DNS" — that
 *          is success, not failure.
 *   GET    re-checks. Called when they press Verify, and safe to call as often
 *          as they like.
 *   DELETE disconnects.
 *
 * The DNS values always come from Vercel. Not one of them is written in this
 * codebase — see vercel-domains.ts for why that is a rule. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Row = {
  id: string;
  domain: string;
  status: string;
  dns_record: { type: string; name: string; value: string } | null;
  ssl_status: string;
  last_error: string | null;
  verified_at: string | null;
};

function said(row: Row) {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    record: row.dns_record,
    ssl: row.ssl_status,
    error: row.last_error,
    verifiedAt: row.verified_at,
  };
}

async function owner(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NextResponse.json({ error: "Domains are unavailable." }, { status: 503 }) };

  const { data } = await supabase.auth.getUser();
  if (!data?.user) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };

  const service = createSupabaseServiceClient();
  if (!service) return { error: NextResponse.json({ error: "Domains are unavailable." }, { status: 503 }) };

  return { user: data.user, supabase, service };
}

/** The domains on a project, with their current state. */
export async function GET(request: Request) {
  const auth = await owner(request);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "No project was named." }, { status: 400 });

  /* Under the caller's session: RLS is what makes another account's domains
     invisible rather than a check written here. */
  const { data } = await auth.supabase
    .from("project_domains")
    .select("id, domain, status, dns_record, ssl_status, last_error, verified_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as Row[];

  /* Re-checking is the point of this call, not a side effect: it is what the
     Verify button does. Only domains that are not already live are asked
     about — a live one is settled, and asking Vercel about it on every render
     is a round trip for an answer that will not change. */
  const checked = await Promise.all(
    rows.map(async (row) => {
      if (row.status === "live" || row.status === "failed") return said(row);

      const config = await domainConfig(row.domain, isApex(row.domain), recordName(row.domain));

      if (config.state === "unavailable") {
        /* Vercel is unreachable. The domain's stored state is not changed —
           an outage on our side is not evidence about somebody's DNS. */
        return { ...said(row), error: config.message };
      }

      const next =
        config.state === "live"
          ? { status: "live", ssl_status: "active", last_error: null, verified_at: new Date().toISOString() }
          : {
              status: "awaiting_dns",
              ssl_status: config.ssl ? "issuing" : "pending",
              dns_record: config.record,
              last_error: null,
            };

      const { data: updated } = await auth.service
        .from("project_domains")
        .update({ ...next, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("user_id", auth.user.id)
        .select("id, domain, status, dns_record, ssl_status, last_error, verified_at")
        .single();

      return said((updated as Row) ?? { ...row, ...next } as Row);
    }),
  );

  return NextResponse.json({ domains: checked, configured: domainsConfigured() });
}

/** Connects a domain. Ends in "add this DNS record", which is success. */
export async function POST(request: Request) {
  const auth = await owner(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown; domain?: unknown };
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const typed = typeof body.domain === "string" ? body.domain : "";
  if (!projectId) return NextResponse.json({ error: "No project was named." }, { status: 400 });

  const parsed = normaliseDomain(typed);
  if ("problem" in parsed) {
    return NextResponse.json({ error: DOMAIN_PROBLEM[parsed.problem] }, { status: 400 });
  }
  const domain = parsed.domain;

  /* The project must be the caller's, and it must be published. Connecting a
     domain to a project with nothing live would point a customer's domain at a
     page that does not exist — and the failure would look like DNS. */
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, published_version_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "That project could not be found." }, { status: 404 });
  if (!project.published_version_id) {
    return NextResponse.json(
      { error: "Publish the project first — a domain needs something to point at." },
      { status: 422 },
    );
  }

  if (!domainsConfigured()) {
    return NextResponse.json({ error: "Custom domains aren't set up on this workspace yet." }, { status: 503 });
  }

  /* Claimed here before Vercel is asked, because the unique index is what
     settles two accounts adding the same domain — and losing that race after
     Vercel has accepted it would leave the domain on our Vercel project with no
     row saying whose it is. */
  const { data: claimed, error: claimError } = await auth.service
    .from("project_domains")
    .insert({ project_id: projectId, user_id: auth.user.id, domain, status: "pending" })
    .select("id, domain, status, dns_record, ssl_status, last_error, verified_at")
    .single();

  if (claimError || !claimed) {
    if (claimError?.code === "23505") {
      return NextResponse.json(
        { error: "That domain is already connected to a project." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "That domain couldn't be saved. Try again." }, { status: 502 });
  }

  const added = await addDomain(domain);

  if (added.state !== "added") {
    /* Vercel would not take it. The claim is released rather than left behind
       as a row that can never become live and that blocks anybody — including
       this person — from trying the same domain again. */
    await auth.service.from("project_domains").delete().eq("id", claimed.id).eq("user_id", auth.user.id);
    return NextResponse.json({ error: added.message }, { status: added.state === "taken" ? 409 : 502 });
  }

  /* What DNS this domain needs, from Vercel. Asked immediately: the person is
     looking at the screen now, and this is the whole reason they pressed the
     button. */
  const config = await domainConfig(domain, isApex(domain), recordName(domain));

  const next =
    config.state === "live"
      ? { status: "live", ssl_status: "active", verified_at: new Date().toISOString(), dns_record: null }
      : config.state === "awaiting-dns"
        ? { status: "awaiting_dns", ssl_status: config.ssl ? "issuing" : "pending", dns_record: config.record }
        : { status: "awaiting_dns", ssl_status: "pending", last_error: config.message };

  const { data: updated } = await auth.service
    .from("project_domains")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("id", claimed.id)
    .eq("user_id", auth.user.id)
    .select("id, domain, status, dns_record, ssl_status, last_error, verified_at")
    .single();

  return NextResponse.json({ domain: said((updated as Row) ?? (claimed as Row)) });
}

/** Disconnects a domain, here and at Vercel. */
export async function DELETE(request: Request) {
  const auth = await owner(request);
  if ("error" in auth) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No domain was named." }, { status: 400 });

  const { data: row } = await auth.supabase
    .from("project_domains")
    .select("id, domain")
    .eq("id", id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "That domain could not be found." }, { status: 404 });

  /* Ours goes first. If Vercel's call fails the row is already gone, which is
     the right way round: a domain left on the Vercel project serves nothing
     once no row claims it, whereas a row left behind would keep the hostname
     reserved against its owner. */
  await auth.service.from("project_domains").delete().eq("id", id).eq("user_id", auth.user.id);
  await removeDomain(row.domain as string);

  return NextResponse.json({ removed: true });
}
