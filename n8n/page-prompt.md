# The build prompt

There is no longer one of these, and that is the point of this file.

The prompt a page was generated from used to live on the `Compose Page Prompt`
node in n8n: one prompt, describing "a page" in general terms, used for a
landing page, a storefront, a publication and an application alike. A prompt
that has to describe all four describes none of them, and what came back was
the average of them — a hero, three feature cards, a pricing table and a
footer, whatever had been asked for. A demo of a website rather than the
website.

It also meant the prompt could only be changed in a browser, by hand, with no
diff and no review.

## Where the prompt lives now

In the app, in code, one per kind:

```
src/lib/builder/kinds.ts               which of the four this brief is
src/lib/builder/classify-kind.ts       the model fallback, when the rules decline
src/lib/builder/blueprints/base.ts     the contract, the shared rules, the bar
src/lib/builder/blueprints/landing.ts  one page, one audience, one action
src/lib/builder/blueprints/ecommerce.ts  catalogue, cart, a checkout that adds up
src/lib/builder/blueprints/blog.ts     a publication with something to read in it
src/lib/builder/blueprints/webapp.ts   the product asked for, and only the
                                       architecture it actually needs
src/lib/builder/blueprints/index.ts    assembles one system prompt per build
```

Each blueprint fills in the same nine-field contract — `identity`,
`requirements`, `optionalFeatures`, `depth`, `interactions`,
`conditionalRequirements`, `exclusions`, `qualityRules`, `completionRules` —
and the prompt is assembled additively rather than by branching:

```
BASE RULES  +  BLUEPRINT  +  USER BRIEF  +  PROJECT CONTEXT  =  systemPrompt
```

Nothing in the composer branches on the contents of a brief. What varies
between kinds varies because the blueprint file is different; what varies
within a kind is a `conditionalRequirement`, which the model applies because it
can read the brief. That is what keeps a calculator from being handed a CRM's
sign-in, three tables and a SQL schema.

`/api/build` classifies the brief, composes the prompt for that kind, and sends
**both** with the build request:

```jsonc
{
  "prompt": "…the brief, in their words…",
  "buildKind": "landing",      // landing | ecommerce | blog | webapp
  "systemPrompt": "…the whole system prompt for that kind…"
}
```

## What the workflow does

**This is wired.** Verified against the live workflow `pIJ3Fu5QpGTotf2m` on
2026-09-02: `Normalize Build Request` carries both fields, a new
`Kind Decided By App` IF node routes straight to the build branch when
`buildKind` is present — skipping the classifier and its model call entirely —
and `Generate Page` sends `systemPrompt || $json.system`, so the app's composed
prompt is what runs and the node's own text is only a fallback.

For reference, that is:

**`Normalize Build Request`** carries the two new fields through, the same way it
carries `prompt`:

```
buildKind     {{ $json.body?.buildKind ?? $json.buildKind ?? "landing" }}
systemPrompt  {{ $json.body?.systemPrompt ?? $json.systemPrompt ?? "" }}
```

**`Compose Page Prompt`** uses what it was given, and only falls back to its own
text when the field is empty — which now only happens for a caller that is not
this app:

```
{{ $("Normalize Build Request").item.json.systemPrompt || $json.fallbackPrompt }}
```

**`Sync Project Row`** writes `intent` from `buildKind` rather than from the
workflow's own classifier. The app writes the same value to the row before the
call, so a workflow that overwrites it with something else makes the row
disagree with the prompt the page was actually built from.

The classifier node inside the workflow is now redundant for builds that come
from this app. It stays for the moment because it is also the route's "none of
these fit" fallback, but it must not overrule `buildKind` — and the IF node in
front of it means a build with a kind never reaches it at all. That was worth
doing for its own sake: the classifier was the one node every build passed
through, so an Anthropic outage took down every build in order to re-decide
something the app had already decided.

### Two fallbacks that are now stale

Both only run for a caller that sends no `buildKind`, which the app never does.
Neither is urgent; both are wrong if they ever fire.

- **`Compose Page Prompt`'s own system text** is the original single prompt,
  including "no external images: use inline SVG … for artwork" — the rule that
  produced the clip-art look. A build that fell back to it would come out in the
  old style, with no blueprint, no locale and no asset manifest.
- **`Intent Classifier`'s categories** describe one category and say a blog, a
  WordPress site or a store "is not this". The app now routes four kinds.

The honest fix for both is to delete them rather than maintain a second copy:
if `buildKind` is absent the caller is not this app, and answering it with a
five-year-old prompt is worse than answering it with "send a buildKind".

## How a kind is decided

A ladder, in `src/lib/builder/kinds.ts`, and the order is the whole of it:

1. **The target chip.** Chosen on Home, it decides outright — a choice is not a
   reading of a sentence, and nothing below is allowed to talk someone out of
   it.
2. **The brief names its kind.** "Build me a landing page for my fashion brand"
   is a landing page. The rest of the sentence is the subject, not the answer.
3. **…unless it demands another kind's machinery.** "A landing page with
   products, a cart and checkout" is a store: a cart cannot live on a landing
   page. Both machinery sets are deliberately narrow — they overrule a person's
   own word, so they hold only what genuinely cannot live elsewhere. Not
   "payments", which is a button; not "sign up", which is an email field on
   every landing page ever built.
4. **Weighing.** No label, so the signals are scored and a winner has to clear a
   floor and beat the runner-up by a margin.
5. **The model.** Only for what rungs 2–4 declined — about one brief in ten.

`npm run check:blueprint` measures rungs 2–4 against a labelled corpus, offline
and free, with a set per rung.

## Keeping the two in step

The blueprints are the source of truth and this file is the map to them. When a
prompt changes, it changes in `src/lib/builder/blueprints/` — that is what gets
reviewed, and what `npm run check:blueprint` checks: that every blueprint still
meets its own contract (no emptied field, every conditional requirement stating
both its condition and its requirement), and that the composed prompt still
carries the brief, the depth floors and, above all, the exclusions.

The exclusions are the half that fixes the original complaint. A landing page's
blueprint forbids a cart, a checkout, a product grid, a sign-in and a blog
index by name; a storefront's forbids a sign-in wall and an admin area; a
publication's forbids prices and pricing tiers; an application's forbids the
marketing hero. Kinds stopped bleeding into each other when the prompts started
saying what each one is *not*.

To read a prompt exactly as it will be sent:

```js
import { composeBuildPrompt } from "@/lib/builder/blueprints";
composeBuildPrompt("landing", "a landing page for my gym", { projectName: "Ironworks" });
```
