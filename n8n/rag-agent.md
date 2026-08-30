# n8n — AI Agent with Postgres Memory and Supabase RAG

Workflow `tgLFph6yjJ5q8nDL` on `neauraissystems.app.n8n.cloud`. Separate from the
Build Orchestrator (`n8n/README.md`); the two share nothing but the instance.

A chat agent that answers from a Supabase vector store and keeps its conversation
history in Postgres, plus a Google Drive branch that chunks, embeds and upserts
documents into that same store.

## Shape

    When Chat Message Received ──> RAG Agent ──> (streamed reply)
                                     ├── ai_languageModel  Anthropic Chat Model (claude-sonnet-5)
                                     ├── ai_memory         Postgres Chat Memory (last 10 turns)
                                     └── ai_tool           Company Knowledge Base
                                                             └── ai_embedding  Embeddings for Retrieval

    New File in Drive Folder ──> Download File ──> Insert Into Supabase Vector Store
                                                     ├── ai_embedding     Embeddings for Ingestion
                                                     └── ai_document      Load File Contents
                                                                            └── ai_textSplitter  Chunk Document

Retrieval and ingestion are deliberately two separate embeddings nodes rather than
one shared one — a subnode feeds a single parent, and these have different parents.
Both are pinned to `text-embedding-3-small`.

The split across two vendors is deliberate, not an oversight. Anthropic does not
make an embedding model — their own docs say so and point at Voyage AI — so the
embeddings cannot follow the chat model onto the Anthropic credential. Chunking
needs no provider at all: the Recursive Character Text Splitter is plain string
splitting, kept over the Token Splitter because it breaks on paragraph and
sentence boundaries and so leaves chunks semantically whole.

## Database

Applied to `esuatccbicekcohzgcvd` as migrations `n8n_rag_agent_documents_and_chat_memory`
and `n8n_rag_agent_privilege_tightening`. The same DDL is in `supabase/schema.sql`,
which carries the reasoning; the short version:

| Object | Reached by | How |
| --- | --- | --- |
| `documents` | both Vector Store nodes | PostgREST, `service_role` key |
| `match_documents` | Company Knowledge Base | PostgREST RPC, `service_role` key |
| `n8n_chat_histories` | Postgres Chat Memory | session pooler :5432, `postgres` role |

`vector(1536)` matches `text-embedding-3-small`. Switching embedding model means
changing the column dimension and both embeddings nodes together — a mismatch is
rejected at insert time, so it fails loudly rather than corrupting the store.

Both tables have RLS on with no policies and no `anon`/`authenticated` privileges.
`service_role` and `postgres` carry `BYPASSRLS`, so the agent is unaffected while
the publishable key reads nothing. This matters more than usual: between them the
two tables hold the entire knowledge base and every conversation with the agent.

Verified end to end against the live project — insert, HNSW retrieval, and
`metadata @> filter` all return correctly, before and after the privilege revokes.

## Before this can run for real

Three things need a human; none can be done through the API.

### 1. OpenAI credit — blocks retrieval and ingestion

Both embeddings nodes are still on `n8n free OpenAI API credits`, and **those
credits are spent**:

    400 It looks like you've used all your free n8n AI credits

The chat model no longer depends on this — it runs on Claude — so the agent can
think, but it cannot search the knowledge base or ingest a document until a real
`openAiApi` credential is selected on **Embeddings for Retrieval** and
**Embeddings for Ingestion**. `text-embedding-3-small` is about $0.02 per 1M
tokens, so this is the cheap half of the bill.

### 2. Postgres credential — blocks chat memory

No `postgres` credential exists on the instance. Create one and select it on
**Postgres Chat Memory**:

| Field | Value |
| --- | --- |
| Host | the **Session Pooler** host from Project Settings → Database → Connection string → Session pooler (`aws-N-eu-central-1.pooler.supabase.com`) |
| Database | `postgres` |
| User | `postgres.esuatccbicekcohzgcvd` |
| Port | `5432` |
| Password | the database password (reset it in Project Settings → Database if unknown) |
| SSL | enabled |

Two traps, both of which fail in ways that do not name the real cause:

- `db.esuatccbicekcohzgcvd.supabase.co` is IPv6-only and n8n Cloud cannot reach it.
  Use the pooler host.
- Port `6543` is transaction mode, which does not hold the session state chat
  memory needs. Use `5432`.

### 3. A Drive folder — blocks ingestion

**New File in Drive Folder** has no folder set, and the connected Drive account
currently has no folders at all. Create one, put the documents in it, then pick it
on the trigger.

## Already wired

- `Anthropic account` on **Anthropic Chat Model** (`claude-sonnet-5`), which replaced
  the OpenAI Chat Model. Verified with a live run: the agent answered through it.
- `Supabase account` on **Company Knowledge Base** and **Insert Into Supabase Vector
  Store**. Confirmed to resolve to `esuatccbicekcohzgcvd` — it lists that project's
  tables, `documents` and `n8n_chat_histories` among them.
- `Google Drive account` on **New File in Drive Folder** and **Download File**.
- Both embeddings nodes pinned to `text-embedding-3-small`, so the default moving
  cannot silently desync them from `vector(1536)`.
- The workflow validates clean (an empty `builtInTools` on the old OpenAI Chat Model
  had been raising a warning; that node is gone).

Check that the `Supabase account` credential holds the **service_role** secret and
not the publishable key. Listing tables does not distinguish them, but every read
will come back empty with the wrong one — RLS is on with no policies by design.

The workflow is inactive. Activating it is what puts the Drive trigger on its
one-minute poll; the chat trigger works from the editor either way.

## Known gaps

- Re-adding the same Drive file inserts duplicate chunks. There is no dedupe, and
  `file_id` is written to metadata but nothing deletes by it. A Supabase node
  deleting `metadata->>file_id` ahead of the insert would make ingestion idempotent.
- The Drive trigger fires on `fileCreated` only, so edits to an indexed file are
  never picked up.
- Nothing backfills. Files already in the folder are invisible to a `fileCreated`
  trigger; run the branch manually or swap in a Drive *Search* node once.
