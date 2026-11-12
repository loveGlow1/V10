/* The Creative Director's production plan — Steps 3 and 4, and every
 * revision after.
 *
 *   {}               plan it (first time) or plan it again
 *   { note }         revise the current plan: "make the hook funnier"
 *   { plan }         a person's own edits to the scenes, checked and kept
 *
 * Every result is a new numbered version; nothing is overwritten. A model
 * plan costs one credit, charged after it is delivered; saving your own edits
 * is free. Each plan passes the shared QA and repair (lib/video/plan.ts)
 * before it is stored. */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { direct, planChapterCount } from "@/lib/video/director";
import { readiness } from "@/lib/video/engines";
import { isPipelineId } from "@/lib/video/pipelines";
import { normalizePlan, qaAndRepair, secondsFrom, unfilledPlaceholders, type ProductionPlan } from "@/lib/video/plan";
import type { StudioAsset } from "@/lib/video/assets";
import { stitchPlan } from "@/lib/video/timeline";
import type { PlanCharacter } from "@/lib/video/cast";
import { agentCost, videoAgentFor } from "@/lib/video/agent";
import { STITCH_COST, creditsLabel } from "@/lib/video/pricing";

/** A video's uploads as the planner sees them. */
export async function loadStudioAssets(supabase: SupabaseClient, videoId: string): Promise<(StudioAsset & { storage_path: string; poster_path: string | null })[]> {
  const { data } = await supabase
    .from("video_assets")
    .select("id, kind, name, mime, status, duration_s, width, height, has_audio, storage_path, poster_path")
    .eq("video_id", videoId)
    .neq("kind", "render")
    .order("created_at");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    name: (row.name as string) || "",
    mime: (row.mime as string) || "",
    status: ((row.status as string) || "ready") as StudioAsset["status"],
    durationS: row.duration_s === null || row.duration_s === undefined ? null : Number(row.duration_s),
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    hasAudio: (row.has_audio as boolean | null) ?? null,
    storage_path: row.storage_path as string,
    poster_path: (row.poster_path as string | null) ?? null,
  }));
}

/** The video's cast as the plan holds it: its chosen characters that are ready, owner's only. */
export async function loadCast(supabase: SupabaseClient, video: { user_id: string; character_ids?: string[] | null }): Promise<PlanCharacter[]> {
  const ids = (video.character_ids ?? []).filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supabase.from("video_characters").select("id, name, descriptor, voice_id, status").eq("user_id", video.user_id).in("id", ids);
  const rows = (data ?? []).filter((row) => row.status === "ready");
  return ids
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ id: row.id as string, name: row.name as string, descriptor: row.descriptor as string, ...(row.voice_id ? { voiceId: row.voice_id as string } : {}) }));
}

/** A plan's cast kept to characters the video's owner has; scenes keep only those. Pure. */
export function keepKnownCast(plan: ProductionPlan, cast: PlanCharacter[]): ProductionPlan {
  const owned = new Map(cast.map((c) => [c.id, c]));
  /* The plan's own words for a known character are kept (a finished plan's
     scenes were made with them); unknown ids are dropped. */
  const characters = (plan.characters ?? []).filter((c) => owned.has(c.id));
  for (const c of cast) if (!characters.some((x) => x.id === c.id)) characters.push(c);
  const ids = new Set(characters.map((c) => c.id));
  return {
    ...plan,
    ...(characters.length ? { characters } : { characters: undefined }),
    scenes: plan.scenes.map((scene) => (scene.characters?.length ? { ...scene, characters: scene.characters.filter((id) => ids.has(id)) } : scene)),
  };
}

/** Drops any scene source that names an upload this video does not have. Pure. */
export function keepKnownSources(plan: ProductionPlan, assets: Pick<StudioAsset, "id" | "status">[]): ProductionPlan {
  const known = new Set(assets.filter((asset) => asset.status !== "failed").map((asset) => asset.id));
  const referenceClips = (plan.referenceClips ?? []).filter((id) => known.has(id));
  const { referenceClips: _dropped, ...rest } = plan;
  void _dropped;
  return {
    ...rest,
    ...(referenceClips.length ? { referenceClips } : {}),
    scenes: plan.scenes.map((scene) => (scene.source && !known.has(scene.source.assetId) ? { ...scene, source: undefined } : scene)),
  };
}



const PLAN_COST = 1;

/* Heads the person's answers to a template's [BLANKS], kept in the brief. */
const FILLED = "THE [BLANKS] ABOVE, FILLED IN BY THE PERSON (use these wherever a blank appears):";



/** Steps 3 and 4 for one video: plan it, revise it with a note, or keep a person's own edits. The plan route and the workspace both plan here. */
export async function planVideo(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  body: { note?: unknown; plan?: unknown; fill?: unknown; stitch?: unknown; model?: unknown },
): Promise<NextResponse> {
  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video || !isPipelineId(video.pipeline)) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const answers = (video.answers ?? {}) as Record<string, string>;
  const { data: current } = await supabase
    .from("video_versions")
    .select("plan")
    .eq("video_id", id)
    .eq("version", video.current_version)
    .maybeSingle();

  let plan: ProductionPlan;
  let issues;
  let note: string;
  let outputTokens = 0;
  /* A long film is planned in several calls (an outline, then each chapter), each paid for. */
  let calls = 1;
  let stitched = false;

  const uploads = await loadStudioAssets(supabase, id);
  const cast = await loadCast(supabase, video as { user_id: string; character_ids?: string[] | null });
  const agent = await videoAgentFor(createSupabaseServiceClient(), userId, body.model);
  const brief0 = String(video.brief ?? "");
  const fill0 = typeof body.fill === "string" ? body.fill.trim() : "";
  /* "Edit my clips", first time, with nothing asked beyond the template:
     stitched at once from the uploads, in order — no model, no charge. */
  const stitchNow =
    video.pipeline === "clip_edit" && !body.plan && typeof body.note !== "string" && (!brief0.trim() || (unfilledPlaceholders(brief0).length > 0 && !fill0) || body.stitch === true);

  if (body.plan && typeof body.plan === "object") {
    ({ plan, issues } = qaAndRepair(keepKnownCast(keepKnownSources(normalizePlan(body.plan, video.pipeline, answers), uploads), cast)));
    note = "Your edits";
  } else if (stitchNow) {
    if (!uploads.some((asset) => asset.status !== "failed" && (asset.kind === "video" || asset.kind === "image" || asset.kind === "photo"))) {
      return NextResponse.json({ error: "Upload your clips first — they're stitched in the order you add them." }, { status: 400 });
    }
    const purse = createSupabaseServiceClient();
    const balance = purse ? await currentBalance(purse, userId) : null;
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < STITCH_COST) {
      return NextResponse.json({ error: `Laying out your clips needs ${creditsLabel(STITCH_COST)}. Top up to continue.` }, { status: 402 });
    }
    ({ plan, issues } = qaAndRepair(keepKnownCast(stitchPlan({ assets: uploads, answers, title: video.title as string }), cast)));
    note = "Your clips, stitched";
    stitched = true;
  } else {
    /* Before any credit, on a first plan: a template's blanks planned as they
       are would be spoken as "[PRODUCT]". The person's answer is kept with the
       brief, so every later plan reads the blanks filled in. */
    let brief = String(video.brief ?? "");
    const fill = typeof body.fill === "string" ? body.fill.trim().slice(0, 2000) : "";
    const blanks = brief.includes(FILLED) ? [] : unfilledPlaceholders(brief);
    if (blanks.length && fill && !unfilledPlaceholders(fill).length) {
      brief = `${brief}\n\n${FILLED}\n${fill}`;
      await supabase.from("video_projects").update({ brief }).eq("id", id);
    } else if (blanks.length && !video.current_version) {
      return NextResponse.json(
        { error: `Your idea still has blanks to fill: ${blanks.slice(0, 6).join(", ")}. Reply with what each one is (e.g. "${blanks[0]}: …"), and I'll plan it.`, placeholders: blanks },
        { status: 400 },
      );
    }
    const service = createSupabaseServiceClient();
    if (service) {
      const balance = await currentBalance(service, userId);
      if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < agentCost(PLAN_COST, agent) * (1 + (planChapterCount(secondsFrom(answers.length)) > 1 ? planChapterCount(secondsFrom(answers.length)) : 0))) {
        return NextResponse.json({ error: "You are out of credits. Top up to plan this video." }, { status: 402 });
      }
    }

    /* What the director can look at: reference pictures, and a frame from
       each uploaded clip — never a video or a sound file. */
    const images: string[] = [];
    /* The clips marked as the look come first: their frames are what the plan must match. */
    const marked = ((current?.plan as ProductionPlan | undefined)?.referenceClips ?? []);
    const ordered = [...uploads].sort((a, b) => Number(marked.includes(b.id)) - Number(marked.includes(a.id)));
    for (const asset of ordered) {
      if (images.length >= 3 || asset.status === "failed") continue;
      const path = asset.kind === "video" ? asset.poster_path : asset.kind === "audio" ? null : asset.storage_path;
      if (!path) continue;
      const { data } = await supabase.storage.from("video-assets").createSignedUrl(path, 600);
      if (data?.signedUrl) images.push(data.signedUrl);
    }

    const directed = await direct({
      pipeline: video.pipeline,
      brief,
      answers,
      images,
      assets: uploads,
      characters: cast,
      model: agent.apiId,
      note: typeof body.note === "string" ? body.note : undefined,
      previous: typeof body.note === "string" && current ? (current.plan as ProductionPlan) : null,
    });
    if ("error" in directed) return NextResponse.json({ error: directed.error }, { status: 502 });
    ({ plan, issues, outputTokens } = directed);
    calls = directed.calls ?? 1;
    /* The look the person chose stays chosen when the plan is made again. */
    const keptLook = (current?.plan as ProductionPlan | undefined)?.referenceClips;
    if (keptLook?.length) plan = { ...plan, referenceClips: keptLook };
    plan = keepKnownCast(keepKnownSources(plan, uploads), cast);
    note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : video.current_version ? "Planned again" : "First plan";
  }

  /* The newest number, not the one after the version playing: after Undo
     the version playing is an earlier one, and the next plan must not land
     on a number that is already taken. */
  const { data: newestRow } = await supabase.from("video_versions").select("version").eq("video_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = Math.max(video.current_version ?? 0, (newestRow?.version as number | undefined) ?? 0) + 1;
  const { error: saveError } = await supabase.from("video_versions").insert({ video_id: id, user_id: userId, version, plan, issues, note });
  if (saveError) return NextResponse.json({ error: "The plan was made but could not be saved. Try again." }, { status: 500 });
  await supabase.from("video_projects").update({ current_version: version, status: "planned", title: plan.title.slice(0, 160) }).eq("id", id);

  if (stitched) {
    const service = createSupabaseServiceClient();
    if (service) await chargeCredits(service, { userId, action: "generate", cost: STITCH_COST, description: `Clips stitched: ${plan.title}`, dedupeKey: `video-stitch:${id}:${version}` });
  }

  if (outputTokens) {
    const service = createSupabaseServiceClient();
    if (service) {
      await chargeCredits(service, {
        userId,
        action: "generate",
        cost: agentCost(PLAN_COST, agent) * calls,
        description: `Video plan (${agent.name}${calls > 1 ? `, ${calls - 1} chapters` : ""}): ${plan.title}`,
        outputTokens,
        dedupeKey: `video-plan:${id}:${version}`,
      });
    }
  }

  return NextResponse.json({ version, plan, issues, note, readiness: readiness(plan), agent: { id: agent.id, name: agent.name, ...(agent.declined ? { declined: agent.declined } : {}) } });
}
