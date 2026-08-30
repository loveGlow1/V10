/* Customer-support retrieval (RAG) — the Supabase side.

   Safe to run more than once, like schema.sql. It creates one table, one index
   and one search function; nothing here touches the tables the app already
   uses.

   BEFORE YOU RUN THIS: pick your embedding dimension.

   The `embedding` column below is vector(1536). That number is not a
   preference — it must equal the output width of whatever embedding model you
   send text through, and it cannot be changed later without re-embedding every
   row. Anthropic's API does not produce embeddings (the Messages API has no
   embeddings endpoint), so this is a separate provider you choose: 1536 is the
   most common width and the reason it is the default here, but confirm it
   against your provider's own documentation before running this file, and
   change every "1536" below if it differs.

   The shape (a `content` text column, a `metadata` jsonb column, a vector
   column, and a `match_documents` function taking a query embedding, a count
   and a metadata filter) is the de-facto standard one that LangChain,
   LlamaIndex and Supabase's own examples expect, so the common client
   libraries work against it with no adapter. */

create extension if not exists vector;

create table if not exists public.support_documents (
  id          bigserial primary key,
  /* The natural key from the JSONL file (e.g. "qs-price-002"). Unique so that
     re-running an ingest updates a chunk in place instead of duplicating it —
     without this, every re-crawl doubles the corpus and retrieval starts
     returning the same passage several times. */
  chunk_id    text not null unique,
  content     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/* HNSW rather than IVFFlat: it does not need a training step, so it behaves
   correctly on an empty or small table — an IVFFlat index built before the rows
   exist silently returns poor results until it is rebuilt. vector_cosine_ops
   pairs with the `<=>` operator used in match_documents below; if you switch to
   inner product or L2 you must change both together or the index is ignored. */
create index if not exists support_documents_embedding_idx
  on public.support_documents
  using hnsw (embedding vector_cosine_ops);

/* Metadata filtering (by section, doc_type, ...) is a jsonb containment test,
   which needs its own index — the vector index cannot serve it. */
create index if not exists support_documents_metadata_idx
  on public.support_documents
  using gin (metadata);

/* Similarity search.

   Returns `similarity` in 0..1 (1 = identical) rather than raw cosine distance,
   because a caller thresholding on "how close is close enough" reads a
   similarity far more reliably than a distance. `filter` is a jsonb object
   matched by containment, so passing '{"section":"pricing"}' narrows the search
   to pricing chunks and '{}' searches everything. */
create or replace function public.match_documents (
  query_embedding vector(1536),
  match_count     int default 5,
  filter          jsonb default '{}'::jsonb
)
returns table (
  id         bigint,
  chunk_id   text,
  content    text,
  metadata   jsonb,
  similarity float
)
language sql stable
/* Pinned search_path: this function is reachable through PostgREST, and without
   the pin a role-controlled search_path could resolve `support_documents` to a
   different table. */
set search_path = public
as $$
  select
    d.id,
    d.chunk_id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.support_documents d
  where d.metadata @> filter
    and d.embedding is not null
  order by d.embedding <=> query_embedding
  limit least(match_count, 50);
$$;

/* RLS on, and deliberately no policy granting the anon key anything.

   This corpus is public marketing copy, so the risk is not disclosure — it is
   that an unauthenticated caller can read the whole knowledge base row by row
   through PostgREST, and that a writable policy would let anyone edit the
   answers a support bot gives out. Retrieval runs server-side with the
   service_role key, which bypasses RLS; the browser should never query this
   table directly. Add a select policy below only if you decide otherwise. */
alter table public.support_documents enable row level security;

/* Keeps updated_at honest on re-ingest. */
create or replace function public.touch_support_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists support_documents_touch on public.support_documents;
create trigger support_documents_touch
  before update on public.support_documents
  for each row execute function public.touch_support_documents();
