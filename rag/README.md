# Customer-support knowledge base

`quickstark-support-kb.jsonl` is the retrieval corpus behind customer support:
28 chunks covering what QuickStark.Ai is, what it builds, what it connects to,
what every plan costs, how credits work, and the two sign-in failures support
gets asked about most.

## Where the content came from

From this repository, not from a crawl of the live site. `quickstark.tech` is
blocked by the egress policy of the environment this was built in, and the
landing page is `src/app/page.tsx` anyway — so the copy was read from source,
which is the same text the page renders and is exact rather than scraped.

Prices are the one place the page is not the source of truth. Every figure in
the corpus comes from `src/app/dashboard/credits.ts`, which is what the billing
code actually charges and what the pricing cards render.

Do not re-scrape from `src/components/marketing/*`. Those files are an
unused early scaffold — nothing imports them — and they carry a different
product name ("Emergent V10") and different prices.

## Defects found while building this, and where they stand

1. **The FAQ quoted the wrong Standard price — now fixed.** `src/app/page.tsx`
   answered "How does pricing work?" with "Standard is $15 a month" while the
   plan data and the pricing card both said **$25**; a visitor saw both numbers
   on one page. The corpus was written with $25 only, and the page has since
   been corrected to read its figures from `PLANS` rather than restate them.
   Some customers will have read $15 before the fix — expect a few to arrive
   believing it.
2. **`/pricing` used different plan names — now fixed.** The standalone pricing
   page offered "Hobbyist / Professional / Enterprise" while every other
   surface said Free / Standard / Pro. Its names now come from `PLANS` too.
3. **Placeholder links — still open.** The Company and Social footer links and
   the "Workflow" nav item have no real destination. The `qs-nav-001` chunk
   says so explicitly so support does not promise a working link. Re-check this
   chunk once those links land.

## Chunk format

One JSON object per line:

```json
{"id": "qs-price-002", "content": "...", "metadata": {"source": "...", "source_url": "...", "section": "pricing", "title": "...", "doc_type": "pricing", "last_verified": "2026-08-30"}}
```

Chunks are written to stand alone, because retrieval hands one back without its
neighbours: each restates the question it answers instead of leaning on a
heading above it. `metadata.section` and `metadata.doc_type` are the filter
keys — `match_documents(..., filter => '{"section":"pricing"}')` narrows a
pricing question to pricing chunks.

## Loading it

1. Pick an embedding provider and confirm its output width. **Anthropic's API
   does not produce embeddings**, so this is a separate choice from the model
   the product uses. `supabase/rag-schema.sql` defaults to `vector(1536)`;
   change every `1536` in that file if your provider differs. The width cannot
   be changed later without re-embedding every row.
2. Run `supabase/rag-schema.sql` in the SQL editor. Safe to run repeatedly.
3. Embed each line's `content` and upsert on `chunk_id` — the unique
   constraint is what makes a re-ingest update in place instead of doubling the
   corpus.
4. Query with `match_documents(query_embedding, match_count, filter)`.

Ingestion runs server-side with the `service_role` key. RLS is enabled on
`support_documents` with no policy, so the anon key cannot read or write it.

## Keeping it current

`last_verified` is `2026-08-30`. Re-check after any change to
`src/app/page.tsx` or `src/app/dashboard/credits.ts` — a stale price in a
support answer is worse than no answer.
