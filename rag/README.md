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

The table is `public.documents`, and `supabase/schema.sql` creates it along
with its HNSW index and the `match_documents` function. There is no separate
file to run for this — there was one, `supabase/rag-schema.sql`, describing a
`support_documents` table and a second `match_documents` beside it. Nothing was
ever loaded into it, the agent has always read `documents`, and running the
file today would create an unused table and then fail on the function, whose
live version returns a different set of columns. It has been deleted rather
than left as a trap.

1. **The embedding width is already fixed at 1536** and is not a free choice
   here: `documents.embedding` is `extensions.vector(1536)`, and both embedding
   nodes in the n8n workflow are pinned to `text-embedding-3-small` to match.
   A dimension mismatch is rejected at insert time by the column. Changing it
   means re-embedding every row. (**Anthropic's API does not produce
   embeddings** — this is a separate provider from the model the product uses.)
2. Ingest through the workflow's Supabase Vector Store nodes rather than by
   hand. `content`, `metadata` and `embedding` are LangChain's own column
   names; renaming any of them breaks ingestion silently.
3. Re-ingesting appends rather than updating: there is no unique key on the
   chunk id, which lives inside `metadata`. Clear the corpus before a reload if
   you do not want it doubled.
4. Query with `match_documents(query_embedding, match_count, filter)`.

Ingestion runs server-side with the `service_role` key. RLS is enabled on
`documents` with no policy and its API grants are revoked, so nothing in the
browser can read or write it — see the comment on the table.

## Keeping it current

`last_verified` is `2026-08-30`. Re-check after any change to
`src/app/page.tsx` or `src/app/dashboard/credits.ts` — a stale price in a
support answer is worse than no answer.
