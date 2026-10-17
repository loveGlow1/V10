/* Fliers in the workspace — the same screen a website is built in.
 *
 * A flier is a project like any other: the chat on one side, the preview
 * iframe on the other, versions in the thread. What differs is the engine
 * behind a message. Where a website's message goes to the page builder, a
 * flier's goes here:
 *
 *   first message      the brief, read into a flier spec (brief.ts), and four
 *                      versions made (run.ts)
 *   every message after the current spec with that change applied
 *                      (reviseRequest), and four new versions of it
 *
 * The job runs after the response, the way a website build runs in the
 * orchestrator: the project row says Building, the chat waits on it, and when
 * the images land the row is stamped Built and the preview reloads.
 *
 * The preview is a document made fresh on every load (flierBoardHtml) from the
 * project's flier jobs, with newly signed image URLs — interactive inside the
 * iframe: tap a version to see it full size, save it as a PNG.
 *
 * A project is a flier when its intent says so ("flier"), set by the first
 * message sent from the Fliers tab. */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBalance } from "@/lib/credits-server";
import { recordMessage } from "@/lib/thread-server";

import { requestFromBrief, reviseRequest } from "./brief";
import { providerChain } from "./router";
import { flyerJobCost, runFlyerJob } from "./run";
import { liveOutputs, type Output } from "./trash";
import type { FlyerRequest } from "./types";

export const FLIER_INTENT = "flier";

/** A flier image on this app's own file route; with download, saved as a clean PNG. Pure. */
export const imageUrl = (origin: string, jobId: string, path: string, download = false) =>
  `${origin}/api/flyers/${jobId}/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

/** Whether a message from the composer is for a flier: the Fliers tab's target. Pure. */
export const isFlierTarget = (target: unknown) => typeof target === "string" && /^fliers(:|$)/.test(target);

type Job = { id: string; status: string; request: FlyerRequest | null; outputs: Output[] | null; created_at: string; error: string | null };

export type FlierTurn =
  | { ok: true; jobId: string; message: string }
  | { ok: false; status: number; error: string };

/** One chat message on a flier project: four new versions, started. */
export async function startFlierTurn(input: {
  supabase: SupabaseClient;
  service: SupabaseClient | null;
  userId: string;
  project: { id: string; name: string | null };
  prompt: string;
  target: unknown;
  requestId: string;
  /** This app's address, for the image links the thread keeps. */
  origin: string;
}): Promise<FlierTurn> {
  const { supabase, service, userId, project, prompt } = input;

  const { data: latest } = await supabase
    .from("flyer_jobs")
    .select("id, request")
    .eq("site_id", project.id)
    .eq("stage", "preview")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; request: FlyerRequest | null }>();

  const subtype = typeof input.target === "string" ? input.target.split(":")[1] ?? null : null;
  const request = latest?.request ? await reviseRequest(latest.request, prompt) : await requestFromBrief(prompt.slice(0, 3000), subtype);
  request.variants = 4;
  request.stage = "preview";
  request.siteId = project.id;

  if (providerChain(request).length === 0) {
    return { ok: false, status: 503, error: "No image model is connected yet, so nothing could be made. Nothing was charged." };
  }
  const needed = flyerJobCost("preview", 4);
  const balance = service ? await currentBalance(service, userId) : null;
  if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < needed) {
    return { ok: false, status: 402, error: `Four new versions need ${needed} credits. Top up to make them.` };
  }

  const { data: job, error } = await supabase
    .from("flyer_jobs")
    .insert({ user_id: userId, site_id: project.id, stage: "preview", parent_job_id: null, request })
    .select("id")
    .single<{ id: string }>();
  if (error || !job) return { ok: false, status: 500, error: "The flier could not be started. Try again." };

  const writer = service ?? supabase;
  const named = !project.name || /^new project$/i.test(project.name.trim());
  await writer
    .from("projects")
    .update({
      status: "Building",
      intent: FLIER_INTENT,
      prompt: prompt.slice(0, 2000),
      ...(named && request.spec.headline ? { name: `Flier: ${request.spec.headline}`.slice(0, 80) } : {}),
    })
    .eq("id", project.id);

  if (service) {
    await recordMessage(service, { projectId: project.id, userId, role: "you", body: prompt, dedupeKey: `you:${input.requestId}` });
  }

  after(async () => {
    await runFlyerJob(job.id, userId, request);
    const client = service ?? supabase;
    const { data: done } = await client.from("flyer_jobs").select("status, outputs").eq("id", job.id).maybeSingle<{ status: string; outputs: Output[] | null }>();
    const ok = done?.status === "done" && liveOutputs(done.outputs).length > 0;
    await client
      .from("projects")
      .update({ status: ok ? "Built" : "Failed", last_build_at: new Date().toISOString() })
      .eq("id", project.id);
    if (service) {
      await recordMessage(service, {
        projectId: project.id,
        userId,
        role: "system",
        kind: ok ? "build_ready" : "build_failed",
        /* The images themselves, shown in the chat: each an "image:" link to
           this app's file route, which serves it to its owner and saves it as
           a clean PNG (see MessageRow). */
        links: ok ? liveOutputs(done?.outputs).map((output, index) => ({ label: `image:${index + 1}`, href: imageUrl(input.origin, job.id, output.path) })) : undefined,
        tone: ok ? "normal" : "error",
        body: ok
          ? `Here are ${liveOutputs(done?.outputs).length} versions of "${request.spec.headline}". Tap one in the preview to see it full size and save it, or tell me what to change.`
          : "The images could not be made this time. Nothing was charged — try again in a moment.",
        dedupeKey: `flier:${job.id}`,
      });
    }
  });

  return {
    ok: true,
    jobId: job.id,
    message: latest ? "Making four new versions with that change — usually 20–40 seconds…" : "Designing four versions of your flier — usually 20–40 seconds…",
  };
}

/* ── The preview document ─────────────────────────────────────────────── */

export type BoardVersion = {
  jobId: string;
  status: string;
  headline: string;
  format: string;
  images: { url: string; name: string; download: string }[];
};

const RATIO: Record<string, string> = { portrait: "2 / 3", square: "1 / 1", landscape: "3 / 2", story: "9 / 16" };
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fileName = (headline: string, n: number) =>
  `${(headline || "flier").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "flier"}-${n}.png`;

/** The flier's versions, newest first, with freshly signed image URLs. */
export async function loadFlierBoard(supabase: SupabaseClient, projectId: string, origin: string): Promise<BoardVersion[]> {
  const { data: jobs } = await supabase
    .from("flyer_jobs")
    .select("id, status, request, outputs, created_at, error")
    .eq("site_id", projectId)
    .eq("stage", "preview")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(12)
    .returns<Job[]>();
  return Promise.all(
    (jobs ?? []).map(async (job) => {
      const headline = job.request?.spec?.headline ?? "";
      const images = await Promise.all(
        liveOutputs(job.outputs).map(async (output, index) => {
          const { data } = await supabase.storage.from("flyers").createSignedUrl(output.path, 60 * 60 * 6);
          return data?.signedUrl ? { url: data.signedUrl, name: fileName(headline, index + 1), download: imageUrl(origin, job.id, output.path, true) } : null;
        }),
      );
      return {
        jobId: job.id,
        status: job.status,
        headline,
        format: job.request?.spec?.format ?? "portrait",
        images: images.filter((image): image is { url: string; name: string; download: string } => image !== null),
      };
    }),
  );
}

/** The interactive preview: the newest versions large, earlier ones below, a full-size view with Save. Pure. */
export function flierBoardHtml(versions: BoardVersion[]): string {
  const [current, ...earlier] = versions;
  const card = (image: { url: string; name: string; download: string }, ratio: string, alt: string) =>
    `<button class="card" style="aspect-ratio:${ratio}" data-src="${escape(image.url)}" data-name="${escape(image.name)}" data-download="${escape(image.download)}" aria-label="${escape(alt)}"><img src="${escape(image.url)}" alt="${escape(alt)}" loading="lazy"></button>`;
  const working = current && (current.status === "queued" || current.status === "running");
  const body = !current
    ? `<p class="empty">Describe your flier in the chat and four versions appear here.</p>`
    : `
<header><p class="eyebrow">Flier · ${current.images.length || 4} versions</p><h1>${escape(current.headline || "Your flier")}</h1>
<p class="hint">${working ? "Designing four versions — usually 20–40 seconds…" : current.status === "failed" ? "These could not be made. Try again from the chat." : "Tap a version to see it full size and save it. Ask in the chat for any change."}</p></header>
<section class="grid">${
        current.images.length
          ? current.images.map((image, i) => card(image, RATIO[current.format] ?? "2 / 3", `Version ${i + 1}`)).join("")
          : Array.from({ length: 4 }, () => `<div class="card ghost" style="aspect-ratio:${RATIO[current.format] ?? "2 / 3"}"></div>`).join("")
      }</section>
${
  earlier.some((version) => version.images.length)
    ? `<h2>Earlier versions</h2>${earlier
        .filter((version) => version.images.length)
        .map(
          (version) =>
            `<p class="sub">${escape(version.headline)}</p><section class="grid small">${version.images
              .map((image, i) => card(image, RATIO[version.format] ?? "2 / 3", `Earlier version ${i + 1}`))
              .join("")}</section>`,
        )
        .join("")}`
    : ""
}`;

  return `<!doctype html><html lang="en" data-qs-flier-board><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(current?.headline || "Flier")}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#f4f4f5;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px 16px 48px}
header{max-width:1100px;margin:0 auto 16px}.eyebrow{margin:0;color:#a1a1aa;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
h1{margin:4px 0 6px;font-size:22px;line-height:1.25}.hint{margin:0;color:#a1a1aa;font-size:13.5px}
h2{max-width:1100px;margin:32px auto 6px;font-size:15px}.sub{max-width:1100px;margin:0 auto 8px;color:#a1a1aa;font-size:12.5px}
.grid{max-width:1100px;margin:0 auto;display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}@media(min-width:760px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.grid.small{grid-template-columns:repeat(6,minmax(0,1fr))}}
.card{position:relative;display:block;width:100%;padding:0;border:1px solid #27272a;border-radius:16px;overflow:hidden;background:#18181b;cursor:zoom-in;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-2px);border-color:#52525b}.card img{width:100%;height:100%;object-fit:cover;display:block}
.ghost{animation:pulse 1.4s ease-in-out infinite;cursor:default}@keyframes pulse{50%{opacity:.45}}
.empty{max-width:420px;margin:80px auto;text-align:center;color:#a1a1aa}
#view{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(0,0,0,.92);padding:16px;z-index:10}
#view.open{display:flex}#view img{max-width:100%;max-height:78vh;border-radius:14px}
.row{display:flex;gap:10px}.btn{display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:999px;border:0;font:600 14px system-ui;cursor:pointer;text-decoration:none}
.save{background:#f97316;color:#111}.close{background:rgba(255,255,255,.12);color:#fff}#note{color:#a1a1aa;font-size:13px;min-height:18px;margin:0}
</style></head><body>
${body}
<div id="view" role="dialog" aria-modal="true" aria-label="Flier, full size"><img alt="Flier, full size"><div class="row"><a class="btn save" id="save" target="_blank" rel="noopener" download>Download</a><button class="btn close" id="close">Close</button></div><p id="note"></p></div>
<script>
(function(){
  var view=document.getElementById('view'),img=view.querySelector('img'),note=document.getElementById('note'),current=null;
  document.querySelectorAll('.card[data-src]').forEach(function(card){card.addEventListener('click',function(){current={src:card.dataset.src,name:card.dataset.name};img.src=current.src;var save=document.getElementById('save');save.href=card.dataset.download;save.setAttribute('download',card.dataset.name);note.textContent='';view.classList.add('open');});});
  function close(){view.classList.remove('open');}
  document.getElementById('close').addEventListener('click',close);
  view.addEventListener('click',function(e){if(e.target===view)close();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
  /* Download is a link to the app's own file route, which answers with the
     image as an attachment: the browser saves a clean PNG, nothing else. It
     opens in a new tab because this preview is sandboxed; the tab is the
     download and closes itself. */
})();
</script></body></html>`;
}
