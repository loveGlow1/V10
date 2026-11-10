# Video Studio map

Where each part of the video studio lives, for anyone extending it. The
upgrade plan's phases refer to these pieces.

## Pages and components

- `src/app/dashboard/video/page.tsx`: the list of videos and the type picker
  (`src/app/dashboard/components/video/VideoTypeGrid.tsx`).
- `src/app/dashboard/video/[id]/page.tsx`: the studio. Reference upload,
  plan, scenes, render, preview and export are all on this page. The upload
  (`upload()`) goes straight from the browser to the private `video-assets`
  bucket and adds a `video_assets` row. The file input accepts `image/*`
  only, at most 3 files.

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

## The Runware client

`src/lib/runware.ts`. One endpoint and one key. Clips, lip sync, avatars and
music are queued with `deliveryMethod: "async"` and a `webhookURL`, and are
then read back with `getResponse`. Stills and speech are synchronous.

## Attachments and intent

Uploads are `video_assets` rows (`kind`: `product`, `person`, `photo`,
`reference`, or `render` for a finished cut) with a `storage_path` in
`video-assets`. Which kind is asked for comes from the pipeline
(`PIPELINES[id].needsReference` in `lib/video/pipelines.ts`), not from an
intent classifier. The workspace's chat edits a video in words through
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
