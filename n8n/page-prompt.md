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
src/lib/builder/blueprints/base.ts     craft rules and the quality bar, shared
src/lib/builder/blueprints/landing.ts  one page, one audience, one action
src/lib/builder/blueprints/ecommerce.ts  catalogue, cart, a checkout that adds up
src/lib/builder/blueprints/blog.ts     a publication with something to read in it
src/lib/builder/blueprints/webapp.ts   sign-in, views, data, and a back end
src/lib/builder/blueprints/index.ts    composes one system prompt per kind
```

`/api/build` classifies the brief, composes the prompt for that kind, and sends
**both** with the build request:

```jsonc
{
  "prompt": "…the brief, in their words…",
  "buildKind": "landing",      // landing | ecommerce | blog | webapp
  "systemPrompt": "…the whole system prompt for that kind…"
}
```

## What the workflow has to do

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
these fit" fallback, but it must not overrule `buildKind`.

## Keeping the two in step

The blueprints are the source of truth and this file is the map to them. When a
prompt changes, it changes in `src/lib/builder/blueprints/` — that is what gets
reviewed, and what `npm run check:blueprint` checks: that every kind still
composes a prompt with its sections, its behaviour, its depth and, above all,
its exclusions intact.

The exclusions are the half that fixes the original complaint. A landing page's
blueprint forbids a cart, a checkout, a product grid, a sign-in and a blog
index by name; a storefront's forbids a sign-in wall and an admin area; a
publication's forbids prices and pricing tiers; an application's forbids the
marketing hero. Kinds stopped bleeding into each other when the prompts started
saying what each one is *not*.

To read a prompt exactly as it will be sent:

```js
import { composeBuildPrompt } from "@/lib/builder/blueprints";
composeBuildPrompt("landing");
```
