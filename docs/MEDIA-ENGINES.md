# Media engines: video clips, voices and flier art

Every engine turns on when its key is set on the deployment. Nothing else is
needed: the routers below pick the best connected engine per job and fall
through to the next one when an engine refuses or fails.

## Keys

| Variable | Turns on |
|---|---|
| `MINIMAX_API_KEY` | MiniMax Hailuo 2.3 clips and MiniMax speech, direct (the free MiniMax credit). With this key alone, a video renders clips and voices without n8n. |
| `HF_API_KEY_ID` + `HF_API_KEY_SECRET` | Higgsfield: Seedance 2.0 (text- and image-to-video, up to 1080p, every aspect ratio) and Kling 2.5 Turbo Pro |
| `FAL_KEY` | Seedance 1.5 Pro on fal (text-to-video), plus lip sync, the clone avatar, music and the final MP4, as before |
| `N8N_WEBHOOK_URL` + `N8N_WEBHOOK_TOKEN` | MiniMax through the n8n render workflow, now the last resort |
| `IDEOGRAM_API_KEY` | Ideogram 3: graphic flier art, and the UGC creator keyframe (photoreal, exact aspect) |
| `OPENAI_API_KEY` | gpt-image-2: photographic flier art, keyframe fallback (`OPENAI_IMAGE_MODEL` overrides the model) |
| `GEMINI_API_KEY` | Gemini image (Nano Banana Pro): fallback for both |
| `UNSPLASH_ACCESS_KEY` | Unsplash photographs: the last resort behind every flier art chain |
| `VIDEO_QUALITY=economy` | Puts the free MiniMax credit first by default. Each video's own **Quality** answer overrides it. |
| `FLIER_ART=stock` | Keeps fliers on Unsplash only |
| `MINIMAX_SPEECH_MODEL` | Overrides the speech model (default `speech-2.6-hd`) |

## Video: `lib/video/clip-engines.ts`

Each scene's clip goes to the first engine in its chain that is connected and
can make it at its aspect ratio. No engine is ever asked to crop a vertical
scene out of landscape. MiniMax and Kling text-to-video are landscape-only,
so for a 9:16 or 1:1 scene they are used only when the scene starts from a
frame.

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
