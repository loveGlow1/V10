# Media engines: video clips, voices and flier art

Every engine turns on when its key is set on the deployment. Nothing else is
needed: the routers below pick the best connected engine per job and fall
through to the next one when an engine refuses or fails.

## Keys

| Variable | Turns on |
|---|---|
| `MINIMAX_API_KEY` | MiniMax Hailuo 2.3 clips and MiniMax speech, direct (the free MiniMax credit). With this key alone, a video renders clips and voices without n8n. |
| `HF_API_KEY_ID` + `HF_API_KEY_SECRET` | Higgsfield: Seedance 2.0 (text- and image-to-video, up to 1080p, every aspect ratio) and Kling 2.5 Turbo Pro |
| `RUNWARE_API_KEY` | MiniMax H3 clips and MiniMax speech, **and the production line**: lip sync (`sync:lipsync-2-pro@1`), the clone's talking portrait (`klingai:avatar@2.0-pro`) and the music bed (`runware:ace-step@v1.5-turbo`). Takes the production line over from fal when both are set. |
| `FAL_KEY` | Seedance 1.5 Pro on fal (text-to-video); lip sync, the clone avatar, music and fal's compose when Runware is not connected |
| `VIDEO_PRODUCTION_ENGINE` | `fal` or `runware`: pins the production line where both keys are set |
| `N8N_WEBHOOK_URL` + `N8N_WEBHOOK_TOKEN` | MiniMax-H3 clips and MiniMax speech through the n8n render workflow, on the MiniMax usage credit. This is tried **first** by default. |
| `IDEOGRAM_API_KEY` | Ideogram 3: graphic flier art, and the UGC creator keyframe (photoreal, exact aspect) |
| `OPENAI_API_KEY` | gpt-image-2: photographic flier art, keyframe fallback (`OPENAI_IMAGE_MODEL` overrides the model) |
| `GEMINI_API_KEY` | Gemini image (Nano Banana Pro): fallback for both |
| `UNSPLASH_ACCESS_KEY` | Unsplash photographs: the last resort behind every flier art chain |
| `VIDEO_QUALITY` | The default tier: unset or `credit` puts n8n (the usage credit) first, `best` ranks by quality, `economy` puts direct MiniMax first. Each video's own **Quality** answer ("MiniMax credit" or "Best") overrides it. |
| `FLIER_ART=stock` | Keeps fliers on Unsplash only |
| `MINIMAX_SPEECH_MODEL` | Overrides the speech model (default `speech-2.6-hd`) |

## Video: `lib/video/clip-engines.ts`

Each scene's clip goes to the first engine in its chain that is connected and
can make it at its aspect ratio. No engine is ever asked to crop a vertical
scene out of landscape. MiniMax and Kling text-to-video are landscape-only,
so for a 9:16 or 1:1 scene they are used only when the scene starts from a
frame.

**MiniMax credit (the default):** every clip and voice line goes to n8n
first, so the usage credit is spent before anything paid for. A paid engine
is only reached when n8n refuses a job at dispatch, fails it, or never
reports back. That job then continues down the "Best" chain below. A voice
line n8n can't make is voiced by MiniMax directly when `MINIMAX_API_KEY` is
set.

**When the usage credit runs out, the switch is immediate.** The first n8n
reply that says the credit is spent does three things (`lib/video/credit.ts`):

- It pauses n8n for the whole deployment, recorded in `video_engine_state`.
- It hands that render's other n8n jobs on straight away, without waiting
  for each to fail. Clips go to the main MiniMax API, which is next in line
  after n8n, and voices go to MiniMax speech.
- Every new render skips n8n until the pause ends, after
  `N8N_CREDIT_PAUSE_HOURS` (default 24). Then n8n is tried again, in case the
  credit was topped up or reset.

A rate limit is not an empty account and pauses nothing. A late n8n reply for
a job that has already been handed on is ignored.

| Video | Best | Economy |
|---|---|---|
| UGC, ads, cinematic, trailers, social | Seedance 2.0 → Seedance 1.5 (fal) → Kling → MiniMax | MiniMax (when it can) → Seedance 2.0 → … |
| Photo → Video, product showcase (from a frame) | MiniMax Hailuo 2.3 → Seedance 2.0 → Kling | the same |
| Explainers, animated graphics | Seedance 2.0 → MiniMax → Kling → Seedance 1.5 | MiniMax first |

- **Same creator in every shot.** A UGC, ad or social video with on-camera
  scenes and no clone photo gets one creator keyframe, made once per version
  (`lib/video/frames.ts`). Every on-camera scene animates from it. Lip sync is
  then laid on through fal as before.
- **No competing audio.** Clips are generated without their own audio. The
  voice, lip sync and music come from the production line, so nothing talks
  over them.
- **Callbacks are verified twice.** Every engine reports to
  `/api/video/[id]/render/clip` with our HMAC token for that video, version
  and scene. The route then asks the engine itself for the result. fal's
  deliveries are checked against fal's Ed25519 signature instead. MiniMax's
  `challenge` is echoed back.
- **Fallback.** A clip that fails is handed to the next engine in its chain
  before it is called failed. The chain only moves forward.
- **Recovery.** A clip that has been quiet for a minute is asked about
  directly when the studio polls, so a lost webhook never strands a render.
- **Billing.** Each clip is charged at the price of the engine that made it,
  once, and only when it arrives: Seedance 6 credits, Kling 5, MiniMax 4.

## The production line: `lib/video/production.ts`

After the clips and voice lines land, the line lays on lip sync, the clone's
talking portrait and the music, then makes the one-file cut. It runs on
Runware when `RUNWARE_API_KEY` is set, else on fal (`productionEngine()` in
`lib/video/engines.ts`).

- **Lip sync** is sent the scene's clip and **its own** voice line, never the
  music. Both are measured first (`lib/video/probe.ts`): a line that fits the
  clip is synced with `syncMode: "cut_off"`; a line that runs longer loops
  the picture (`"loop"`). Sync's default, `"bounce"`, plays the voice
  backwards and is never used. Speaker and occlusion detection are on.
- **A lip sync that fails** leaves the scene as it was, the clip with the
  voice over it, and is not charged.
- **The clone** is made by Kling Avatar 2.0 from the uploaded photo and each
  line. The economy answer uses the draft models (`lipsync-2`, Avatar
  Standard).
- **Music** is ACE-Step 1.5, instrumental, at least 30s. The cut made on
  this server lays it under the whole video and ducks it whenever the voice
  speaks (sidechain compression), then levels everything to -14 LUFS.
- **Runware jobs** are queued async. They report to
  `/api/video/[id]/render/line`, which checks our HMAC token and then asks
  Runware for the result (`getResponse`) instead of trusting the body. A
  lost webhook is recovered when the studio polls.
- **Billing.** Every Runware task is sent with `includeCost`. A delivered
  production job is quoted by the second at Runware's list price ×2.5, in
  credits at the top-up price, and charged at what Runware actually billed,
  never more than 10% over the quote.

## Fliers: `lib/flyers/art.ts`

A builder flier is an HTML canvas marked `data-qs-flier`. Its words are real
text, spelled exactly and editable. The key visual behind the type is
generated for it from the builder's art direction, and is never asked to
contain lettering:

| Art direction reads as | Chain |
|---|---|
| graphic (illustration, poster art, abstract, pattern, 3D, texture) | Ideogram 3 → gpt-image-2 → Gemini → Unsplash |
| photo (a scene, people, food, product, place) | gpt-image-2 → Gemini → Ideogram 3 → Unsplash |

Each picture is re-encoded to a 1600px JPEG, so it fits the page budget. Art
costs 2 credits per picture made, with at most 3 per flier. An Unsplash
photograph costs nothing extra.

The standalone image API, `/api/flyers` (Nano Banana, gpt-image-2, Ideogram),
now checks the balance first and charges per image delivered: 1 credit per
draft, 3 per final. It stays behind `FLYERS_API_ENABLED=1` until a screen
uses it.

## Checks

- `npm run check:video`: the clip router (aspect safety, tiers, durations,
  provider round-trips), per-engine pricing, and the webhook's three checks.
- `npm run check:flier-art`: art routing, the text-free prompt, the stock
  switch, Unsplash fallback, charging, and the flier rules.
