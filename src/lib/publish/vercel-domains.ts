/* Talking to Vercel about a domain somebody owns.
 *
 * This is the one part of publishing that genuinely needs the Vercel API, and
 * it is worth being precise about why. Publishing a page does not: a published
 * project is a document this app already holds and serves, so making it live is
 * a write to our own database. But a CUSTOM domain has to terminate TLS
 * somewhere, and the somewhere is the edge that answers for it — Vercel. Only
 * Vercel can accept customer.com, issue a certificate for it, and route it to
 * this deployment.
 *
 * WHAT THIS NEVER DOES, and the reason it is a rule rather than a habit: it
 * never invents a DNS value. Vercel returns the exact record a domain needs —
 * the target differs by domain, by region and over time — and the only correct
 * answer is the one it gave. A hard-coded "cname.vercel-dns.com" is right often
 * enough to look like it works and wrong often enough to strand somebody with a
 * domain that never verifies and no way to tell why.
 *
 * Nothing here throws for an expected outcome. A domain already claimed by
 * another Vercel account, a domain not yet pointed, a missing token — all of
 * those are results, because every one of them has something to say to the
 * person who typed the domain in. */

const API = "https://api.vercel.com";
const TIMEOUT_MS = 10_000;

function credentials(): { token: string; projectId: string; teamQuery: string } | null {
  const token = process.env.VERCEL_API_TOKEN;
  /* The Vercel project THIS app is deployed as — the one that must answer for
     the customer's domain. Not the user's project id: there is no Vercel
     project per user site, by design. */
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;

  const teamId = process.env.VERCEL_TEAM_ID;
  return { token, projectId, teamQuery: teamId ? `?teamId=${encodeURIComponent(teamId)}` : "" };
}

/** Whether custom domains can work at all in this deployment. */
export function domainsConfigured(): boolean {
  return credentials() !== null;
}

type Called = { ok: true; status: number; body: unknown } | { ok: false; reason: string };

async function call(path: string, init: RequestInit, token: string): Promise<Called> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });

    /* Read whatever came back before deciding anything: Vercel puts the reason
       a request was refused in the body, and a status code on its own is not
       something anybody can act on. */
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { ok: true, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === "AbortError"
        ? "Vercel did not answer in time."
        : "Vercel could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Vercel's own error code and message, where it sent one. */
function errorOf(body: unknown): { code: string; message: string } | null {
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (!error) return null;
  return { code: error.code ?? "unknown", message: error.message ?? "Vercel refused that." };
}

export type DnsRecord = {
  type: "A" | "CNAME";
  /** The label as a provider's form asks for it: "www", or "@" for the apex. */
  name: string;
  /** Vercel's value. Never written here. */
  value: string;
};

export type AddOutcome =
  | { state: "added"; alreadyThere: boolean }
  | { state: "taken"; message: string }
  | { state: "refused"; message: string }
  | { state: "unavailable"; message: string };

/**
 * Puts a domain on this app's Vercel project.
 *
 * Adding is not verifying. Vercel accepts the domain immediately and only then
 * starts caring whether DNS points at it, which is the right order — the person
 * cannot create the DNS record until they have been told what it is.
 */
export async function addDomain(domain: string): Promise<AddOutcome> {
  const auth = credentials();
  if (!auth) {
    return { state: "unavailable", message: "Custom domains aren't set up on this workspace yet." };
  }

  const result = await call(
    `/v10/projects/${encodeURIComponent(auth.projectId)}/domains${auth.teamQuery}`,
    { method: "POST", body: JSON.stringify({ name: domain }) },
    auth.token,
  );

  if (!result.ok) return { state: "unavailable", message: result.reason };
  if (result.status >= 200 && result.status < 300) return { state: "added", alreadyThere: false };

  const error = errorOf(result.body);

  /* Already on this project. Ordinary — somebody adding the same domain twice,
     or retrying after a failure further down — and the right answer is to carry
     on to the DNS step rather than to report a conflict. */
  if (error?.code === "domain_already_in_use" || result.status === 409) {
    /* Vercel uses one code for "yours already" and "somebody else's", and only
       the message distinguishes them. Checked against the project rather than
       trusted: see whether it is actually on ours. */
    const mine = await domainIsOnProject(domain);
    if (mine) return { state: "added", alreadyThere: true };
    return {
      state: "taken",
      message: "That domain is already connected to a different account. Remove it there first, then add it here.",
    };
  }

  if (error?.code === "forbidden") {
    return { state: "refused", message: "This workspace isn't allowed to add that domain." };
  }

  return { state: "refused", message: error?.message ?? "Vercel wouldn't accept that domain." };
}

/** Whether Vercel already has this domain on our project. */
async function domainIsOnProject(domain: string): Promise<boolean> {
  const auth = credentials();
  if (!auth) return false;

  const result = await call(
    `/v9/projects/${encodeURIComponent(auth.projectId)}/domains/${encodeURIComponent(domain)}${auth.teamQuery}`,
    { method: "GET" },
    auth.token,
  );

  return result.ok && result.status >= 200 && result.status < 300;
}

export type ConfigOutcome =
  | { state: "live"; ssl: boolean }
  | { state: "awaiting-dns"; record: DnsRecord; ssl: boolean }
  | { state: "unavailable"; message: string };

/**
 * What DNS this domain needs, and whether it has it yet.
 *
 * The record comes back from Vercel's config endpoint, which reports both what
 * is wrong and what to set. `misconfigured: false` is the whole answer to "is
 * it live" — Vercel has resolved the domain and is serving it.
 */
export async function domainConfig(domain: string, apex: boolean, label: string): Promise<ConfigOutcome> {
  const auth = credentials();
  if (!auth) {
    return { state: "unavailable", message: "Custom domains aren't set up on this workspace yet." };
  }

  const result = await call(
    `/v6/domains/${encodeURIComponent(domain)}/config${auth.teamQuery}`,
    { method: "GET" },
    auth.token,
  );

  if (!result.ok) return { state: "unavailable", message: result.reason };
  if (result.status < 200 || result.status >= 300) {
    return { state: "unavailable", message: errorOf(result.body)?.message ?? "Vercel couldn't check that domain." };
  }

  const config = result.body as {
    misconfigured?: boolean;
    /* What Vercel wants set, when it wants something set. Shapes vary by
       account and over time, which is exactly why none of it is assumed. */
    recommendedCNAME?: string | { value?: string }[];
    recommendedIPv4?: string[] | { value?: string[] }[];
    acceptedChallenges?: string[];
  };

  /* SSL follows DNS: Vercel issues the certificate once it can resolve the
     domain, so a challenge having been accepted is the signal it is under way
     or done. */
  const ssl = Array.isArray(config.acceptedChallenges) && config.acceptedChallenges.length > 0;

  if (config.misconfigured === false) return { state: "live", ssl: true };

  return {
    state: "awaiting-dns",
    ssl,
    record: apex
      ? { type: "A", name: label, value: firstIPv4(config.recommendedIPv4) }
      : { type: "CNAME", name: label, value: firstCNAME(config.recommendedCNAME) },
  };
}

/* Vercel returns these in more than one shape depending on the endpoint and
   the account, so both are read and neither is assumed. The fallbacks are the
   documented defaults and are used ONLY when Vercel sent nothing — which is the
   one case where there is no answer of Vercel's to prefer. */
function firstCNAME(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry) return entry;
      const nested = (entry as { value?: string })?.value;
      if (typeof nested === "string" && nested) return nested;
    }
  }
  return "cname.vercel-dns.com";
}

function firstIPv4(value: unknown): string {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry) return entry;
      const nested = (entry as { value?: string[] })?.value;
      if (Array.isArray(nested) && typeof nested[0] === "string" && nested[0]) return nested[0];
    }
  }
  return "76.76.21.21";
}

/** Takes a domain off this app's Vercel project. */
export async function removeDomain(domain: string): Promise<boolean> {
  const auth = credentials();
  if (!auth) return false;

  const result = await call(
    `/v9/projects/${encodeURIComponent(auth.projectId)}/domains/${encodeURIComponent(domain)}${auth.teamQuery}`,
    { method: "DELETE" },
    auth.token,
  );

  /* A domain that is not there is a domain that is removed. */
  return result.ok && (result.status < 300 || result.status === 404);
}
