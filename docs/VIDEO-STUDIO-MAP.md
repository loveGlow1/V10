# Video Studio map

Where each part of the video studio lives, for anyone extending it. The
upgrade plan's phases refer to these pieces.

## Pages and components

- `src/app/dashboard/video/page.tsx`: the list of videos and the type picker
  (`src/app/dashboard/components/video/VideoTypeGrid.tsx`).
- `src/app/dashboard/video/[id]/page.tsx`: the studio. Uploads
  (`components/video/MediaPanel.tsx`), the timeline (scenes, with
  `TimelineClip.tsx` for uploaded clips: trim, speed, level, mute, order),
  video settings (`VideoSettings.tsx`), render, preview and export.
- The workspace preview board links to the studio ("Upload clips · timeline
  · video settings").

## Uploads (Phase 1)

1. The browser reads a file's length and size (`lib/video/upload-client.ts`)
   and refuses one over the limits (`lib/video/assets.ts`: clips 400 MB / 3
   min, sound 50 MB, pictures 20 MB).
2. `POST [id]/assets/upload-url` gives a one-time storage address; the file
   goes straight to the private `video-assets` bucket with progress.
3. `POST [id]/assets` registers it: the kind is re-checked from the stored
   object's own MIME type, and `[id]/assets/prepare` (its own 300s function,
   ffmpeg traced in) probes it, makes a working copy (upright, ≤1920, 30 fps,
   H.264, AAC stereo, silence laid in for silent clips) and a poster
   (`lib/video/prepare-asset.ts`).
4. Uploaded clips and pictures become scenes with a `source`
   (`{assetId, trimStart, trimEnd, speed, volume}`); a sound file can be the
   music. A render files them as finished rows (`uploads-render.ts`): nothing
   is generated or charged for them.
5. "Edit my clips" (`clip_edit`) stitches every upload in order at once, free
   (`lib/video/timeline.ts stitchPlan`). With a written brief, the Creative
   Director plans around the uploads from the ATTACHMENTS block.

## Video settings

`lib/video/cut-settings.ts` lists every setting, its options and defaults;
`lib/video/cut-filters.ts` turns them into ffmpeg; `compose-local.ts` runs
it. Saving the timeline or settings (`POST [id]/timeline`) makes a new
version that reuses every clip and line that still fits and re-cuts it,
free.

## API routes (`src/app/api/video/`)

| Route | Does |
|---|---|
| `route.ts` | create and list videos |
| `[id]/route.ts` | one video's whole state (`lib/video/state.ts`), with recovery polling |
| `[id]/plan/route.ts` | the Creative Director's plan, and edits to it |
| `[id]/render/route.ts` | starts a render (`lib/video/start-render.ts`) |
| `[id]/render/callback/route.ts` | n8n's clip and voice results |
| `[id]/render/clip/route.ts` | every clip engine's webhook (Higgsfield, MiniMax, fal Seedance, Runware) |
| `[id]/render/fal/route.ts` | fal's lip sync, avatar, music and compose |
| `[id]/render/line/route.ts` | Runware's lip sync, avatar and music |
| `[id]/render/compose/route.ts` | the cut made on this server (`lib/video/compose-local.ts`) |
| `[id]/file/route.ts` | the final MP4 and its exports |
| `[id]/board/route.ts` | the workspace preview's view |
| `[id]/assets/upload-url/route.ts` | a one-time direct-to-storage upload address |
| `[id]/assets/route.ts` | register an upload (`POST`), remove one (`DELETE`) |
| `[id]/assets/prepare/route.ts` | probe, working copy and poster for an upload |
| `[id]/timeline/route.ts` | save the timeline and settings, re-cut without re-filming |

## The Runware client

`src/lib/runware.ts`. One endpoint and one key. Clips, lip sync, avatars and
music are queued with `deliveryMethod: "async"` and a `webhookURL`, and are
then read back with `getResponse`. Stills and speech are synchronous.

## Attachments and intent

Uploads are `video_assets` rows (`kind`: `video`, `audio`, `image`, or a
picture's role `product`, `person`, `photo`, `reference`; `render` for a
finished cut) with a `storage_path` in `video-assets`, plus their measured
length, size, sound, working copy and poster. The Creative Director and the
chat editor read the ATTACHMENTS block (`attachmentManifest`) before the
person's words; `attachmentIntent` names what a message asks of what is
attached (STITCH, LIPSYNC_VIDEO, EDIT, AVATAR, GENERATE). The workspace's chat edits a video in words through
`lib/video/editor.ts` and `lib/video/apply-edit.ts`.

## Credits

The tables are `credit_plans`, `credit_balances` and `credit_ledger`
(`supabase/schema.sql`). They change only through the `charge_credits()` RPC,
called by `chargeCredits()` in `src/lib/credits-server.ts`, with a dedupe key
per job. A render is checked against the balance before it starts
(`start-render.ts`), and each job is charged when it arrives, never when it
fails. The price of a credit is `topUpPricePerCredit()` in
`src/app/dashboard/credits.ts` (50 for $15).

## Scenes, models and the production line

- **Scene prompts:** `clipPrompt()` in `lib/video/render.ts`, from each
  scene's `motionPrompt` or `visual`. The plan itself comes from
  `lib/video/plan.ts` and `plan-video.ts`.
- **Clip models:** routed per scene in `lib/video/clip-engines.ts`: Runware
  `minimax:h3@0` (`RUNWARE_VIDEO_MODEL`), Higgsfield Seedance 2.0 and Kling,
  MiniMax Hailuo 2.3, fal Seedance 1.5, or n8n.
- **The same face in every shot:** UGC, ad and social on-camera scenes start
  from one creator keyframe per version (`lib/video/frames.ts`).
- **Lip sync, avatar and music:** `lib/video/production.ts`. See
  `docs/MEDIA-ENGINES.md`.
