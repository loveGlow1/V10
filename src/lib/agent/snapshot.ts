import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appPreviewDocument, canRenderApp } from "@/lib/builder/preview/app-preview";
import { staticEntryOf, staticSiteDocument } from "@/lib/builder/preview/static-preview";
import type { FileTree } from "@/lib/builder/tree";
import { assertPublicHttps } from "@/lib/mcp/oauth";

import { signSnapshot } from "./persist";

/* A screenshot of what the agent built, for the person and for the agent.
 *
 * Taken by headless Chromium behind BROWSERLESS_URL — Browserless's
 * /screenshot API, or a Playwright worker that speaks the same body — so no
 * browser runs inside this function. Two ways in:
 *
 *   url   the session's preview_url (plus an optional path), loaded and left
 *         to settle on network idle. For an address a browser with no
 *         QuickStark session can open: a published site, a sandbox port.
 *   html  the project's CURRENT preview document, rendered directly. The
 *         workspace preview needs the owner's sign-in, which a headless
 *         browser has not got — and this also shows edits the agent has made
 *         in this step before anyone reloads anything.
 *
 * The PNG goes to the private "snapshots" bucket at {sessionId}/{timestamp}.png
 * and comes back as a one-hour signed URL. The path is returned too: a URL
 * lapses, the path is what gets re-signed when the transcript is reloaded. */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const TIMEOUT_MS = 45_000;

export type Shot = { url: string; path: string };
export type SnapshotResult =
  | { ok: true; desktop: Shot; mobile?: Shot }
  | { ok: false; error: string };

export function snapshotsConfigured(): boolean {
  return Boolean(process.env.BROWSERLESS_URL);
}

function endpoint(): string | null {
  const base = process.env.BROWSERLESS_URL?.trim();
  if (!base) return null;
  const url = new URL(/\/screenshot\/?$/.test(base) ? base : `${base.replace(/\/$/, "")}/screenshot`);
  const token = process.env.BROWSERLESS_TOKEN;
  if (token && !url.searchParams.has("token")) url.searchParams.set("token", token);
  return url.toString();
}

/** The document a project shows in its preview, built from its files. */
export function documentFor(tree: FileTree, html: string | null, projectName: string | null): string | null {
  if (tree.length > 0 && canRenderApp(tree)) {
    return appPreviewDocument({ tree, projectName, env: {}, assets: undefined });
  }
  const entry = tree.length > 0 ? staticEntryOf(tree) : null;
  if (entry) return staticSiteDocument(tree, {}, entry);
  const page = tree.find((file) => /\.html?$/i.test(file.path))?.content ?? html;
  return page && /<html|<body|<!doctype/i.test(page) ? page : null;
}

async function capture(target: { url?: string; html?: string }, viewport: { width: number; height: number }): Promise<Buffer | string> {
  const to = endpoint();
  if (!to) return "Screenshots are not set up on this deployment (BROWSERLESS_URL).";
  try {
    const response = await fetch(to, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        ...(target.url ? { url: target.url } : { html: target.html }),
        viewport: { ...viewport, deviceScaleFactor: 1 },
        gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
        options: { type: "png", fullPage: false },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      const said = (await response.text().catch(() => "")).slice(0, 200);
      return `The screenshot service answered ${response.status}${said ? `: ${said}` : ""}.`;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    /* A PNG starts with these eight bytes; anything else is an error page. */
    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return "The screenshot service did not return an image.";
    return bytes;
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError"
      ? "The page took too long to load for a screenshot."
      : "The screenshot service could not be reached.";
  }
}

async function store(service: SupabaseClient, sessionId: string, png: Buffer, suffix: string): Promise<Shot | string> {
  const path = `${sessionId}/${Date.now()}${suffix}.png`;
  const { error } = await service.storage.from("snapshots").upload(path, png, { contentType: "image/png", upsert: false });
  if (error) return `The screenshot could not be stored: ${error.message}`;
  const url = await signSnapshot(service, path);
  return url ? { url, path } : "The screenshot was stored but could not be linked.";
}

/**
 * Takes the screenshot(s) and stores them. `previewUrl` wins when the session
 * has one; otherwise `html` is rendered. Never throws: a failed screenshot is
 * a result the agent and the person both read, not a crashed step.
 */
export async function takeSnapshot(
  service: SupabaseClient,
  input: { sessionId: string; previewUrl?: string | null; path?: string | null; html?: string | null; mobile?: boolean },
): Promise<SnapshotResult> {
  let target: { url?: string; html?: string };
  if (input.previewUrl) {
    let url: URL;
    try {
      url = new URL(input.path ? input.path.replace(/^\/?/, "/") : "", input.previewUrl);
    } catch {
      return { ok: false, error: "The session's preview address is not a valid URL." };
    }
    /* The address is the session's own, so it is held to https on a public
       host: the capture must not become a way to reach internal ones. */
    const safe = await assertPublicHttps(url.toString());
    if (!safe) return { ok: false, error: "The preview address must be https on a public host." };
    target = { url: safe.toString() };
  } else if (input.html) {
    target = { html: input.html };
  } else {
    return { ok: false, error: "There is nothing to capture yet — this session has no preview and no page." };
  }

  const desktop = await capture(target, DESKTOP);
  if (typeof desktop === "string") return { ok: false, error: desktop };
  const storedDesktop = await store(service, input.sessionId, desktop, "");
  if (typeof storedDesktop === "string") return { ok: false, error: storedDesktop };

  if (!input.mobile) return { ok: true, desktop: storedDesktop };
  const mobile = await capture(target, MOBILE);
  const storedMobile = typeof mobile === "string" ? null : await store(service, input.sessionId, mobile, "-mobile");
  return { ok: true, desktop: storedDesktop, ...(storedMobile && typeof storedMobile !== "string" ? { mobile: storedMobile } : {}) };
}
