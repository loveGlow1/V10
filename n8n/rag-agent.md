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
Both run `text-embedding-3-small`, which is the node's own default rather than a
setting written into the workflow: n8n strips any parameter left at its default, so
naming the model explicitly does not survive a save. The coupling to
`vector(1536)` is therefore a convention held by this note, not something the file
enforces.

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

Two things need a human; neither can be done through the API.

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

## Already wired

- `Anthropic account` on **Anthropic Chat Model** (`claude-sonnet-5`), which replaced
  the OpenAI Chat Model. Verified with a live run: the agent answered through it.
- `Supabase account` on **Company Knowledge Base** and **Insert Into Supabase Vector
  Store**. Confirmed to resolve to `esuatccbicekcohzgcvd` — it lists that project's
  tables, `documents` and `n8n_chat_histories` among them.
- `Google Drive account` on **New File in Drive Folder** and **Download File**, and
  the trigger now watches a real folder: **n8n Knowledge Base**
  (`1o5XNAG80jnLl7zlf3eo16Aoj-YQdQBYx`). This was the third human blocker and it is
  cleared.
- The workflow validates clean (an empty `builtInTools` on the old OpenAI Chat Model
  had been raising a warning; that node is gone).

Check that the `Supabase account` credential holds the **service_role** secret and
not the publishable key. Listing tables does not distinguish them, but every read
will come back empty with the wrong one — RLS is on with no policies by design.

The workflow is inactive. Activating it is what puts the Drive trigger on its
one-minute poll; the chat trigger works from the editor either way.

## The Drive trigger's Watch For setting

Leave **New File in Drive Folder** on **File Updated** (`fileUpdated`). It was
briefly set to **Watch Folder Updated** (`watchFolderUpdated`), which breaks the
ingestion branch outright, and the reason is not visible from the editor. Reading
the node's poll query:

- Under `watchFolderUpdated` the node drops the `'<folder>' in parents` clause,
  filters to `mimeType = application/vnd.google-apps.folder`, and then keeps only
  the row whose id is the watched folder. So the item it emits is **the folder
  itself**, never a file in it. **Download File** reads `{{ $json.id }}`, so it
  would be handed the folder's ID and fail — a folder has no binary content.
- Under `fileUpdated` the query is `'<folder>' in parents AND mimeType != folder
  AND modifiedTime > lastPoll`. A brand-new file's `modifiedTime` equals its
  `createdTime`, so this catches creations as well as edits — it is a strict
  superset of `fileCreated`, which is what the node was on before and which misses
  edits to an already-indexed file.

`fileUpdated` is therefore both the correct setting and the one that closes the
old "edits are never picked up" gap. Fixed in the live workflow.

## Known gaps

- **Duplicate chunks on re-index.** Nothing dedupes, and under `fileUpdated` this
  is now certain rather than hypothetical: every edit re-inserts the whole file
  alongside its old chunks. `file_id` is written to metadata but nothing deletes
  by it.

  The obvious fix — a Supabase **Delete** node in front of the insert — does not
  work as drawn, for two reasons found by reading the node:

  - `supabaseApiRequest` always sends `Prefer: return=representation`, and the
    delete branch returns `returnJsonArray(rows)`. A delete that matches nothing
    returns `[]`, so the node emits **zero items** and the branch stalls — on
    every first-time ingest, which is the common case. It needs *Always Output
    Data* switched on.
  - the node rebuilds items from JSON only, so it drops binary. It cannot sit
    between **Download File** and the insert, where the binary is still needed.
    It has to go ahead of **Download File**, which then needs
    `{{ $('New File in Drive Folder').item.json.id }}` in place of
    `{{ $json.id }}`.

  The filter itself is fine: field `metadata->>file_id`, condition Equals.
  PostgREST takes the JSON path, and n8n only quotes key names containing one of
  `,.():"&?=\`, none of which appear in it.

  Left undone deliberately: the branch cannot be run end to end while the
  embeddings are blocked on OpenAI credit, so this would be an unverifiable
  structural change to a live workflow.

- **No backfill.** The query is `modifiedTime > lastPoll`, so files already in the
  folder before the first poll are invisible. Touch each one, or run the branch
  manually once.
- **Subfolders are never watched.** The node says so itself; the query only matches
  direct children of the watched folder.
- **The splitter is character-based.** For line-oriented files such as `.jsonl`,
  chunks cut across record boundaries, which hurts retrieval. Worth revisiting if
  the knowledge base turns out to be mostly JSONL.
