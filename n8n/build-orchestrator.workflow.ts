/* QuickStark.Ai — Build Orchestrator, as deployed.

   This file is a MIRROR of the workflow running on n8n Cloud
   (`pIJ3Fu5QpGTotf2m`), regenerated from it on 2026-09-03. It is documentation
   in the shape of code: nothing imports it, `n8n` is excluded from tsconfig,
   and `@n8n/workflow-sdk` is not a dependency of this repo — so it is never
   compiled and never type-checked. Read it to learn what the workflow does;
   change the workflow in n8n, then bring the change back here.

   It had drifted badly before this regeneration. The version it replaces
   described an Intent Classifier and WordPress / e-commerce provisioning
   branches that no longer exist, and did not describe the multi-provider
   generation branch that does. Ten of twenty-three nodes matched. If you find
   yourself reading this file and the workflow disagreeing again, the workflow
   is right.

   Re-read against the live workflow on 2026-09-06, and this is where it had
   drifted: the extra `Generate With Claude` → `Save Page` connection that the
   two files above this line spent a paragraph each on IS NOT THERE. Claude's
   success output goes to `Collect Generation` and nowhere else, exactly like
   OpenAI's and Gemini's. It was removed in the canvas at some point and the
   mirror was never told, so this file went on describing a defect that had been
   fixed — and the app grew two defences against it. Read the second paragraph
   of this file again: when the two disagree, the workflow is right, and that
   rule is worth nothing unless somebody actually looks.

   Changed in the canvas on 2026-09-06 and recorded here in the same hour, which
   is the habit this file needed: `Sync Project Row` no longer writes
   `last_build_at` (see the note on that node), and the generation nodes now
   allow fifteen minutes rather than ten.

   Still wrong in the deployment, and reproduced rather than corrected: several
   `notes` on live nodes describe the deleted classifier, and the note on
   `Generate With Claude` still says "ten-minute timeout".

   Changed in the canvas on 2026-09-12 and recorded here in the same hour:
   `Say What Failed` and `Tell The Customer` now sit between the four error
   outputs and `Flag Build Failure`, which until then wrote status Failed and a
   timestamp and no reason at all. Three builds that day ended as "Your build is
   underway" followed by silence, and this workflow reported SUCCESS for each of
   them, because flagging the failure HAD worked — there was simply nothing in
   the flag. Published as version 2fc79ff4; the version before it is 3a40141a.

   The shape, in one line: the app decides everything, this workflow answers the
   chat immediately, and then generates the page after the answer has already
   gone out. No model runs before generation. */

import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  merge,
  expr,
} from '@n8n/workflow-sdk';

/* ── 1. Entry ──────────────────────────────────────────────────────────────
   Only NEW BUILDS arrive here. The app classifies every message first — edit,
   new_project, question or revert — and handles three of the four itself. */

const buildWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Build Request Webhook',
    position: [-1120, 384],
    parameters: {
      httpMethod: 'POST',
      path: 'api/v1/build',
      /* Required, not optional. Sync Project Row writes with the service_role
         key, which bypasses RLS, and the body carries the projectId it writes
         to — so an open webhook here is a way to overwrite anyone's project.
         The credential's value is the app's N8N_WEBHOOK_TOKEN. */
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      /* Only the app's server calls this; a browser never should. */
      options: { allowedOrigins: 'https://www.quickstark.tech' },
    },
    credentials: { httpHeaderAuth: newCredential('Header Auth account 2') },
  },
  output: [
    {
      body: {
        requestId: 'req_01HZY',
        userId: '5e9f1a2c-1111-4c3a-9c11-8f2b6d4a7e10',
        projectId: '',
        projectName: 'Aurora Storefront',
        prompt: 'Build me a storefront that sells handmade ceramics.',
        buildKind: 'ecommerce',
        systemPrompt: '<composed by the app for that kind>',
        signature: '<hmac over requestId|projectId|userId>',
        provider: 'claude',
        model: 'claude-opus-5',
        generationUrl: 'https://api.anthropic.com/v1/messages',
        responseShape: 'anthropic',
      },
    },
  ],
});

/* Everything the rest of the workflow reads, normalized off both `body.*` and
   the top level so a browser call and a test run behave the same.

   The last six fields are the interesting ones: the app does not send a prompt
   for n8n to shape into a request, it sends THE REQUEST — url, headers and body
   already built for whichever vendor was picked. See generationRequest() in
   src/lib/builder/model-request.ts. Nothing in this workflow knows what a system
   prompt is, which is why adding a model is a change in the app and not here. */
const normalizeRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalize Build Request',
    position: [-896, 384],
    parameters: {
      assignments: {
        assignments: [
          { id: 'request-id', name: 'requestId', type: 'string',
            value: expr('{{ $json.body?.requestId ?? $json.requestId ?? $execution.id }}') },
          { id: 'user-id', name: 'userId', type: 'string',
            value: expr('{{ $json.body?.userId ?? $json.userId ?? "" }}') },
          { id: 'project-id', name: 'projectId', type: 'string',
            value: expr('{{ $json.body?.projectId ?? $json.projectId ?? "" }}') },
          { id: 'project-name', name: 'projectName', type: 'string',
            value: expr('{{ $json.body?.projectName ?? $json.projectName ?? "Untitled Build" }}') },
          { id: 'prompt', name: 'prompt', type: 'string',
            value: expr('{{ $json.body?.prompt ?? $json.prompt ?? $json.body?.message ?? $json.message ?? "" }}') },
          /* No default. An empty buildKind is what Kind Decided By App turns
             away — see the note there; defaulting it would build the wrong
             thing rather than ask. */
          { id: 'build-kind', name: 'buildKind', type: 'string',
            value: expr('{{ $json.body?.buildKind ?? $json.buildKind ?? "" }}') },
          { id: 'system-prompt', name: 'systemPrompt', type: 'string',
            value: expr('{{ $json.body?.systemPrompt ?? $json.systemPrompt ?? "" }}') },
          { id: 'signature', name: 'signature', type: 'string',
            value: expr('{{ $json.body?.signature ?? $json.signature ?? "" }}') },
          /* Images arrive as signed URLs rather than base64: pushing megabytes
             through a webhook to say the same thing costs a timeout. */
          { id: 'attachment-urls', name: 'attachmentUrls', type: 'array',
            value: expr('{{ $json.body?.attachmentUrls ?? $json.attachmentUrls ?? [] }}') },
          { id: 'attachment-text', name: 'attachmentText', type: 'string',
            value: expr('{{ $json.body?.attachmentText ?? $json.attachmentText ?? "" }}') },
          { id: 'requested-at', name: 'requestedAt', type: 'string',
            value: expr('{{ $now.toISO() }}') },
          /* Which vendor, and therefore which credential. Claude when absent. */
          { id: 'provider', name: 'provider', type: 'string',
            value: expr('{{ $json.body?.provider ?? $json.provider ?? "claude" }}') },
          { id: 'model', name: 'model', type: 'string',
            value: expr('{{ $json.body?.model ?? $json.model ?? "" }}') },
          { id: 'model-name', name: 'modelName', type: 'string',
            value: expr('{{ $json.body?.modelName ?? $json.modelName ?? "" }}') },
          { id: 'generation-url', name: 'generationUrl', type: 'string',
            value: expr('{{ $json.body?.generationUrl ?? $json.generationUrl ?? "" }}') },
          { id: 'generation-headers', name: 'generationHeaders', type: 'object',
            value: expr('{{ $json.body?.generationHeaders ?? $json.generationHeaders ?? {} }}') },
          { id: 'generation-body', name: 'generationBody', type: 'object',
            value: expr('{{ $json.body?.generationBody ?? $json.generationBody ?? {} }}') },
          { id: 'response-shape', name: 'responseShape', type: 'string',
            value: expr('{{ $json.body?.responseShape ?? $json.responseShape ?? "anthropic" }}') },
          /* ── What to build, and what it is made of ─────────────────────────
           *
           * These three were the bug. This node has no `includeOtherFields`, so
           * it emits ONLY what it names — and it did not name these, while two
           * nodes downstream read `$("Normalize Build Request").item.json.stack`
           * and got undefined every time. The save route therefore never learned
           * that a build was a Next.js project, and scaffolded every one of them
           * as a page with no database client.
           *
           * Named here rather than solved with includeOtherFields, because the
           * point of this node is that the rest of the workflow reads a known
           * shape rather than whatever a caller happened to post. */
          { id: 'stack', name: 'stack', type: 'string',
            value: expr('{{ $json.body?.stack ?? $json.stack ?? "standalone-html" }}') },
          { id: 'backend', name: 'backend', type: 'boolean',
            value: expr('{{ ($json.body?.backend ?? $json.backend) === true }}') },
          /* Which layers the project has — see src/lib/builder/architecture.ts.
             Carried whole and never modified: it is the record of what the
             prompt was written against and what the schema was created from. */
          { id: 'architecture', name: 'architecture', type: 'object',
            value: expr('{{ $json.body?.architecture ?? $json.architecture ?? {} }}') },
          /* Which of the six design systems, by name — see
             src/lib/builder/design.ts. A name rather than the palette: every
             value in one is a constant the app already holds, so sending the
             whole thing would push a palette down a wire to arrive at something
             already on the other end. */
          { id: 'design-system', name: 'designSystem', type: 'string',
            value: expr('{{ $json.body?.designSystem ?? $json.designSystem ?? "" }}') },
        ],
      },
      options: {},
    },
  },
});

/* ── 2. The kind, decided by the app ───────────────────────────────────────

   NO MODEL RUNS IN THIS WORKFLOW BEFORE GENERATION, and that is the whole point
   of this node.

   A Text Classifier used to sit here and re-decide what the app had already
   decided. It was the one node every build passed through, so an Anthropic
   outage — or a key out of credit — took down every build in the product to
   answer a question nobody had asked. It was deleted. A routing call must never
   be able to fail a build that needs no routing.

   Both fields are required because the prompt is composed FOR the kind: one
   without the other is half an instruction. */
const kindDecidedByApp = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'Kind Decided By App',
    position: [-688, 384],
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { id: 'has-build-kind', leftValue: expr('{{ $json.buildKind }}'), rightValue: '',
            operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
          { id: 'has-system-prompt', leftValue: expr('{{ $json.systemPrompt }}'), rightValue: '',
            operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
        ],
      },
      options: {},
    },
  },
});

/* ── 3. The build branch ───────────────────────────────────────────────────
   One branch, not four. landing / ecommerce / blog / webapp all run through it,
   because what differs between them is the system prompt the app composed, not
   the plumbing here.

   The old WordPress and E-Commerce branches were removed. Restore them from the
   workflow's version history rather than rebuilding by hand. */

const webappSpec = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'WebApp Build Spec',
    position: [-400, -16],
    parameters: {
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string',
            value: expr('{{ $("Normalize Build Request").item.json.buildKind || "webapp" }}') },
          /* Read from the request rather than pinned. The app decides this —
             see lib/builder/stack.ts, which asks whether the thing can exist
             as one page and answers no the moment somebody signs in. It was a
             constant here while there was only one answer; defaulting to that
             same constant keeps every caller that does not send one working. */
          { id: 'stack', name: 'stack', type: 'string',
            value: expr('{{ $("Normalize Build Request").item.json.stack || "standalone-html" }}') },
          { id: 'backend', name: 'backend', type: 'boolean',
            value: expr('{{ $("Normalize Build Request").item.json.backend === true }}') },
          /* The whole answer, where the two above are the old shape of it: they
             cannot express an admin, a storage bucket or a checkout. Passed
             through rather than branched on — nothing in this workflow reads
             it, and the save route needs it intact. */
          { id: 'architecture', name: 'architecture', type: 'object',
            value: expr('{{ $("Normalize Build Request").item.json.architecture || {} }}') },
        ],
      },
      includeOtherFields: true,
      options: {},
    },
  },
});

/* The branch's result in the shape Assemble Build Result expects. The URLs are
   empty on purpose: nothing has been generated yet at this point in the run —
   the page is made after the chat has been answered, further down. */
const collectWebappResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Collect WebApp Result',
    position: [320, -16],
    parameters: {
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string',
            value: expr('{{ $("Normalize Build Request").item.json.buildKind || "webapp" }}') },
          { id: 'preview-url', name: 'previewUrl', type: 'string', value: '' },
          { id: 'repo-url', name: 'repoUrl', type: 'string', value: '' },
          { id: 'admin-url', name: 'adminUrl', type: 'string', value: '' },
          { id: 'config-keys', name: 'configKeys', type: 'object', value: expr('{{ {} }}') },
          { id: 'artifacts', name: 'artifacts', type: 'object',
            value: expr('{{ { "stack": $("Normalize Build Request").item.json.stack === "nextjs" ? "Next.js project" : "Standalone HTML page", "filesTouched": 0 } }}') },
          { id: 'branch-status', name: 'branchStatus', type: 'string', value: 'provisioned' },
        ],
      },
      options: {},
    },
  },
});

/* The false side of Kind Decided By App. A caller sending neither field is not
   the app, and is told so plainly rather than having something guessed for it. */
const flagForManualReview = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Flag For Manual Review',
    position: [320, 240],
    parameters: {
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'unclassified' },
          { id: 'preview-url', name: 'previewUrl', type: 'string', value: '' },
          { id: 'repo-url', name: 'repoUrl', type: 'string', value: '' },
          { id: 'admin-url', name: 'adminUrl', type: 'string', value: '' },
          { id: 'config-keys', name: 'configKeys', type: 'object', value: expr('{{ {} }}') },
          { id: 'artifacts', name: 'artifacts', type: 'object',
            value: expr(
              '{{ { "reason": "This request arrived without a buildKind and a systemPrompt, so there is nothing to build it from. ' +
              'The app decides the kind and composes the prompt before calling this workflow; a caller that sends neither is not the app.", ' +
              '"buildKind": $("Normalize Build Request").item.json.buildKind, ' +
              '"prompt": $("Normalize Build Request").item.json.prompt } }}',
            ) },
          { id: 'branch-status', name: 'branchStatus', type: 'string', value: 'needs_clarification' },
        ],
      },
      options: {},
    },
  },
});

/* ── 4. Status sync and response ───────────────────────────────────────────
   Two inputs, not five: the build branch, and the request that arrived without
   a kind. The three extra inputs went with the classifier and its branches. */

const collectBuildOutcome = merge({
  version: 3.2,
  config: {
    name: 'Collect Build Outcome',
    position: [592, 384],
    parameters: { numberInputs: 2 },
  },
});

const assembleBuildResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Build Result',
    position: [800, 384],
    parameters: {
      jsCode:
        'const request = $("Normalize Build Request").first().json;\n' +
        'const branch = $input.first().json;\n' +
        'const failed = branch.branchStatus === "failed";\n' +
        'const needsClarification = branch.branchStatus === "needs_clarification";\n' +
        'const status = failed ? "Failed" : needsClarification ? "Needs Clarification" : "Building";\n' +
        'return [{\n' +
        '  json: {\n' +
        '    requestId: request.requestId,\n' +
        '    userId: request.userId,\n' +
        '    projectId: request.projectId,\n' +
        '    projectName: request.projectName,\n' +
        '    prompt: request.prompt,\n' +
        '    intent: branch.intent,\n' +
        '    status,\n' +
        '    previewUrl: branch.previewUrl || "",\n' +
        '    repoUrl: branch.repoUrl || "",\n' +
        '    adminUrl: branch.adminUrl || "",\n' +
        '    configKeys: branch.configKeys || {},\n' +
        '    artifacts: branch.artifacts || {},\n' +
        '    requestedAt: request.requestedAt,\n' +
        '    completedAt: new Date().toISOString(),\n' +
        '  },\n' +
        '}];',
    },
  },
});

/* Writes status and intent — and nothing else. NOTHING IN THIS WORKFLOW
   CHARGES CREDITS. Billing happens in the app, in /api/builder/webapp/save,
   priced from the document that arrives there. A build that never reaches save
   is never billed.

   NOT last_build_at, and that is the point of this paragraph.
   It used to write it from `completedAt`, which Assemble Build Result stamps
   when the CHAT is answered — before generation starts. So every build claimed
   a page had landed three seconds after somebody pressed send. The workspace
   polls that field to know its preview is ready: it saw the stamp, found no
   page under it, said "this one's taking a while" and stopped watching, so the
   page arrived minutes later with nothing left to notice it and it took a
   reload to appear. Removed from this node on 2026-09-06. The field now belongs
   to the two steps that know a run ended — the save route on success, Flag
   Build Failure on failure — and the app separately requires the row to have
   stopped saying "Building", so neither half depends on the other being right.

   NOT slug, published_version_id or published_at either, and that boundary is
   load-bearing rather than an oversight. A build is a PREVIEW event: it changes
   what the owner sees at /preview and must not touch what the public is being
   served. Production is a snapshot taken by /api/publish, so a build cannot
   move it — which is the whole of "changes in preview do not change
   production", enforced by this node not knowing those columns exist.

   Note that `status` is one this node DOES write, and that is why nothing
   decides publication from it: a published project rebuilt here goes back to
   "Building" and then "Built" while its site keeps serving. published_at is the
   authority instead. See src/lib/project-status.ts, which explains it at
   length, and do not be tempted to write "Published" from here to fix the
   label — the label is not the fact.

   onError continues: the chat is answered from Assemble Build Result, not from
   this node, so a Supabase failure must not swallow the reply. */
const syncProjectRow = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Sync Project Row',
    position: [1024, 384],
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    parameters: {
      operation: 'update',
      tableId: 'projects',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.projectId }}') },
          /* Both, always. The service_role key bypasses RLS, so user_id here is
             the only thing stopping one account's projectId reaching another's
             row. */
          { keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.userId }}') },
        ],
      },
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: expr('{{ $json.status }}') },
          { fieldId: 'intent', fieldValue: expr('{{ $json.intent }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase account') },
  },
});

const buildChatPayload = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Chat Payload',
    position: [1248, 384],
    parameters: {
      assignments: {
        assignments: [
          { id: 'ok', name: 'ok', type: 'boolean',
            value: expr('{{ $("Assemble Build Result").first().json.status !== "Failed" }}') },
          { id: 'request-id', name: 'requestId', type: 'string',
            value: expr('{{ $("Assemble Build Result").first().json.requestId }}') },
          { id: 'project-id', name: 'projectId', type: 'string',
            value: expr('{{ $("Assemble Build Result").first().json.projectId }}') },
          { id: 'intent', name: 'intent', type: 'string',
            value: expr('{{ $("Assemble Build Result").first().json.intent }}') },
          { id: 'status', name: 'status', type: 'string',
            value: expr('{{ $("Assemble Build Result").first().json.status }}') },
          { id: 'links', name: 'links', type: 'object',
            value: expr(
              '{{ { "preview": $("Assemble Build Result").first().json.previewUrl, ' +
              '"repo": $("Assemble Build Result").first().json.repoUrl, ' +
              '"admin": $("Assemble Build Result").first().json.adminUrl } }}',
            ) },
          { id: 'config-keys', name: 'configKeys', type: 'object',
            value: expr('{{ $("Assemble Build Result").first().json.configKeys }}') },
          { id: 'artifacts', name: 'artifacts', type: 'object',
            value: expr('{{ $("Assemble Build Result").first().json.artifacts }}') },
          /* Three outcomes, three sentences. The Needs Clarification one says
             "Nothing has been charged", which is true precisely because billing
             lives in the save route and this request will never reach it. */
          { id: 'message', name: 'message', type: 'string',
            value: expr(
              '{{ $("Assemble Build Result").first().json.status === "Failed" ' +
              '? "The build could not be completed - " + ($("Assemble Build Result").first().json.artifacts?.reason ?? "a step in the build failed.") ' +
              ': $("Assemble Build Result").first().json.status === "Needs Clarification" ' +
              '? "That request reached the builder without a build kind, so there was nothing to build it from. Nothing has been charged. Try again from the app." ' +
              ': "Your build is underway - the preview link updates as it finishes." }}',
            ) },
        ],
      },
      options: {},
    },
  },
});

/* The chat is answered HERE, and generation happens after this point. Everything
   below this node runs with nobody waiting on it. */
const respondToChatUi = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return Payload to Chat UI',
    position: [1472, 384],
    parameters: { options: { responseCode: 200 } },
  },
});

/* ── 5. Generation, after the answer ───────────────────────────────────────
   Only a build that is actually underway has anything left to do. A request
   that arrived without a buildKind was already answered in full. */

const ifPageIsToBeBuilt = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'If A Page Is To Be Built',
    position: [1696, 384],
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { id: 'is-building', leftValue: expr('{{ $json.status }}'), rightValue: 'Building',
            operator: { type: 'string', operation: 'equals' } },
        ],
      },
      options: {},
    },
  },
});

/* Three outputs rather than one node with an expression for the credential,
   because a credential is not a parameter in n8n — it is bound to the node.
   Three nodes is the only way to have three keys.

   The fallback is Claude: a request arriving with no provider is a request from
   an older app version, and Claude is what every build ran on before this
   existed. */
const routeByProvider = node({
  type: 'n8n-nodes-base.switch',
  version: 3.2,
  config: {
    name: 'Route By Provider',
    position: [1920, 384],
    parameters: {
      rules: {
        values: ['claude', 'openai', 'google'].map((key) => ({
          outputKey: key,
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              { leftValue: expr('{{ $json.provider }}'), rightValue: key,
                operator: { type: 'string', operation: 'equals' } },
            ],
            combinator: 'and',
          },
        })),
      },
      options: { fallbackOutput: '0' },
    },
  },
});

/* The three generation calls are the same call three times, against three keys.
   URL, headers and body all arrive already shaped by the app, so none of these
   nodes knows anything about models — not the id, not max_tokens, not the
   thinking or effort settings. All of that is in
   src/lib/builder/model-request.ts, which is where to go to change what a build
   costs to run.

   A raw HTTP node rather than an LLM chain node, in all three cases: a generated
   page is full of { and }, and a chain reads those as template variables.

   Fifteen-minute timeout because nothing is waiting — the chat was answered
   before any of this started — and because ten was not enough. On 2026-09-06
   the app's output ceiling went from 32k tokens to 64k so that a large page
   could finish being written, and two builds in a row then died at 600.4
   seconds: the node giving up on the model mid-page, its error output flagging
   the project Failed, and the person told the build did not finish. A ceiling
   that lets a page finish is worth nothing if the node hangs up before it
   does. */

const generateWithClaude = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Generate With Claude',
    position: [2144, 384],
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr('{{ $("Normalize Build Request").item.json.generationUrl }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'anthropicApi',
      sendHeaders: true,
      specifyHeaders: 'json',
      jsonHeaders: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationHeaders) }}'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationBody) }}'),
      options: { timeout: 900000 },
    },
    credentials: { anthropicApi: newCredential('Anthropic account') },
  },
});

/* CREDENTIAL: the shared "n8n free OpenAI API credits" pool, which is
   EXHAUSTED — it returns `400 … used all your free n8n AI credits`. Attach a
   real OpenAI key before offering GPT models to anyone. */
const generateWithOpenAi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Generate With OpenAI',
    position: [2144, 560],
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr('{{ $("Normalize Build Request").item.json.generationUrl }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendHeaders: true,
      specifyHeaders: 'json',
      jsonHeaders: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationHeaders) }}'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationBody) }}'),
      options: { timeout: 900000 },
    },
    credentials: { openAiApi: newCredential('n8n free OpenAI API credits') },
  },
});

/* CREDENTIAL: NONE ATTACHED, and no Google credential exists on the instance.
   A build that picks a Gemini model fails at this node and is flagged — correct
   behaviour, but not a working one. Create a Google Gemini (PaLM) credential
   from an AI Studio key and attach it.

   The wire model id rides in the URL path for Google rather than in the body,
   which is the other reason the URL comes from the app rather than being fixed
   on the node. */
const generateWithGemini = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Generate With Gemini',
    position: [2144, 736],
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: expr('{{ $("Normalize Build Request").item.json.generationUrl }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googlePalmApi',
      sendHeaders: true,
      specifyHeaders: 'json',
      jsonHeaders: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationHeaders) }}'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($("Normalize Build Request").item.json.generationBody) }}'),
      options: { timeout: 900000 },
    },
  },
});

const collectGeneration = merge({
  version: 3.2,
  config: {
    name: 'Collect Generation',
    position: [2368, 560],
    /* Three branches, one path onward. Exactly one of them ran. */
    parameters: { numberInputs: 3, mode: 'append' },
  },
});

/* The page, out of whichever answer came back.

   All three vendors bury the document at a different depth, and Anthropic
   returns the thinking as the FIRST content block when thinking is on — so
   taking content[0] would store the model's reasoning as the web page. That is
   why this joins the text blocks rather than indexing.

   Mirrors textFromResponse() in src/lib/builder/model-request.ts. Two copies,
   deliberately: this one runs in the workflow, that one is what the check tool
   exercises. Change one, change both. */
const extractPage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract Page',
    position: [2592, 560],
    parameters: {
      jsCode:
        "const request = $('Normalize Build Request').first().json;\n" +
        "const shape = request.responseShape || 'anthropic';\n" +
        'const answer = $input.first().json;\n' +
        '\n' +
        "let html = '';\n" +
        '\n' +
        "if (shape === 'anthropic') {\n" +
        '  const content = Array.isArray(answer.content) ? answer.content : [];\n' +
        "  html = content.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('');\n" +
        "} else if (shape === 'openai') {\n" +
        '  const choice = Array.isArray(answer.choices) ? answer.choices[0] : null;\n' +
        '  const content = choice && choice.message ? choice.message.content : null;\n' +
        "  if (typeof content === 'string') html = content;\n" +
        "  else if (Array.isArray(content)) html = content.map((part) => (part && part.text) || '').join('');\n" +
        '} else {\n' +
        '  const candidate = Array.isArray(answer.candidates) ? answer.candidates[0] : null;\n' +
        '  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];\n' +
        "  html = parts.map((part) => (part && part.text) || '').join('');\n" +
        '}\n' +
        '\n' +
        /* ── A file tree, when that is what came back ─────────────────────
         *
         * A build of the nextjs stack answers with a JSON object whose keys are
         * paths and whose values are file contents — see treeBrief in
         * src/lib/builder/scaffold.ts. This node only ever produced `html`, so
         * the `files` key Save Page sends was undefined on every build and no
         * project could ever be stored as one.
         *
         * Detected from the ANSWER rather than from request.stack: the stack is
         * what was asked for and this is what came back, and a generation that
         * ignored its instructions has to be handled as what it is rather than
         * as what it was told to be. */
        'let files = undefined;\n' +
        "const trimmed = (html || '').trim();\n" +
        'const fenced = trimmed.match(/^```(?:json|html)?\\s*\\n([\\s\\S]*?)\\n?```$/i);\n' +
        'const body = (fenced ? fenced[1] : trimmed).trim();\n' +
        '\n' +
        "if (body.startsWith('{')) {\n" +
        '  try {\n' +
        '    const parsed = JSON.parse(body);\n' +
        '    const paths = Object.keys(parsed);\n' +
        /* Every key a path and every value a string. Without it, any JSON the
           model returned — an error object, a refusal — would be stored as a
           project's source. */
        '    const isTree = paths.length > 0 && paths.every(\n' +
        "      (key) => typeof parsed[key] === 'string' && /^[\\w./[\\]()-]+$/.test(key) && key.includes('.')\n" +
        '    );\n' +
        '    if (isTree) {\n' +
        '      files = parsed;\n' +
        /* Cleared on purpose. There is no HTML in a tree of .tsx, and inventing
           one here would be a mock-up of an app nobody can run yet. The save
           route derives the preview from the tree instead — see
           src/lib/builder/project-summary.ts. */
        "      html = '';\n" +
        '    }\n' +
        '  } catch (error) {\n' +
        /* Not JSON, or JSON cut off at the model's ceiling. Either way it is not
           a tree, and the save route refuses an unfinished document with a
           sentence that says so. */
        '  }\n' +
        '}\n' +
        '\n' +
        "return [{ json: { html, files, model: request.model || '', modelName: request.modelName || '', provider: request.provider || '', responseShape: shape } }];",
    },
  },
});

/* Where the build is stored AND where it is billed. The app prices it from the
   document that arrives here — see /api/builder/webapp/save — which is why
   nothing this workflow sends decides what anyone is charged.

   It refuses anything unsigned, and refuses a document with no <html>. */
const savePage = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Save Page',
    position: [2368, 384],
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://www.quickstark.tech/api/builder/webapp/save',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ requestId: $("Normalize Build Request").item.json.requestId, ' +
        'projectId: $("Normalize Build Request").item.json.projectId, ' +
        'userId: $("Normalize Build Request").item.json.userId, ' +
        'signature: $("Normalize Build Request").item.json.signature, ' +
        'prompt: $("Normalize Build Request").item.json.prompt, ' +
        'model: $json.model, html: $json.html, ' +
        /* The project as files, when the generator produced one.
         *
         * undefined on every standalone-html build, and JSON.stringify drops
         * undefined keys — so this is inert on the stack that exists today and
         * carries the tree the moment a branch produces one. `html` travels
         * alongside it rather than instead of it: a tree of .tsx cannot be
         * shown to anybody without a build step, so a file-tree build sends its
         * files AND a rendered home page for the preview to serve. */
        'files: $json.files, ' +
        'stack: $("Normalize Build Request").item.json.stack, ' +
        'backend: $("Normalize Build Request").item.json.backend, ' +
        /* Which layers this project is made of — see
         * src/lib/builder/architecture.ts. Carried through untouched, and that
         * matters more than it looks: it is the record of what the prompt was
         * written against and what the schema was created from, so the save
         * route scaffolds a Supabase client for the tables that actually exist.
         * Modify it here and the project is scaffolded for a database it does
         * not have.
         *
         * undefined on any caller that does not send one, and JSON.stringify
         * drops undefined keys, so the save route falls back to `stack` and
         * `backend` above exactly as it did before. */
        'architecture: $("Normalize Build Request").item.json.architecture, ' +
        'designSystem: $("Normalize Build Request").item.json.designSystem }) }}',
      ),
      options: { timeout: 120000 },
    },
  },
});

/* Generation runs after the chat has been answered, so a failure here cannot
   travel in the response. It is written to the project row instead — the same
   row the workspace is polling — so the chat can say the build did not finish
   rather than waiting out its timeout in silence. */
/* The body of Say What Failed, kept here exactly as it runs on the canvas.
   A mirror that paraphrases is a mirror that misleads — this file has
   already caused one wrong diagnosis by describing an edge the canvas did
   not have. */
const SAY_WHAT_FAILED =
  "/* The sentence a failed build is owed.\n" +
  " *\n" +
  " * Four error outputs arrive here \u2014 the three generation nodes and Save Page \u2014\n" +
  " * and until now all four went straight to Flag Build Failure, which writes\n" +
  " * status Failed and a timestamp and NOTHING ELSE. Three builds on 2026-09-12\n" +
  " * ended that way: \"Your build is underway\", then silence, then a project row\n" +
  " * saying Failed with no reason in the thread and no build to look at. The\n" +
  " * workflow reported SUCCESS for every one of them, because from its point of\n" +
  " * view flagging the failure had worked.\n" +
  " *\n" +
  " * This turns whatever arrived into one sentence a person can read.\n" +
  " */\n" +
  "const request = $('Normalize Build Request').first().json;\n" +
  "const item = $input.first().json || {};\n" +
  "\n" +
  "const details = item.details || {};\n" +
  "const body = details.body || {};\n" +
  "const error = item.error || {};\n" +
  "\n" +
  "/* A stack trace is not a sentence. n8n attaches one to most errors, and it\n" +
  "   names absolute paths inside the n8n container \u2014 so it is cut at the first\n" +
  "   frame, BEFORE the newlines are collapsed away and the frames stop being\n" +
  "   recognisable. What survives is the line a human wrote. */\n" +
  "const sayable = (text) => {\n" +
  "  const lines = String(text == null ? '' : text).split('\\n');\n" +
  "  const upto = lines.findIndex((line) => /^\\s*at\\s/.test(line));\n" +
  "  return (upto === -1 ? lines : lines.slice(0, upto)).join(' ');\n" +
  "};\n" +
  "\n" +
  "/* Trimmed hard. A vendor error can carry a page of JSON, and a chat message\n" +
  "   is not where it belongs. */\n" +
  "const clip = (text, max) => {\n" +
  "  const one = sayable(text).replace(/\\s+/g, ' ').trim();\n" +
  "  return one.length > max ? one.slice(0, max - 1) + '\u2026' : one;\n" +
  "};\n" +
  "\n" +
  "/* The app's own words, when the app is what answered.\n" +
  "   /api/builder/webapp/save replies { message } on every refusal it makes, and\n" +
  "   those sentences are written to be read by the person they happen to \u2014 \"The\n" +
  "   page came out longer than one build allows\", \"The project came back\n" +
  "   unfinished\". When one is here it is already the best answer available and\n" +
  "   nothing this node could add would improve it. */\n" +
  "const fromApp = typeof body.message === 'string' ? body.message.trim() : '';\n" +
  "\n" +
  "/* Otherwise a model API refused, timed out or fell over, and the useful part\n" +
  "   is whatever the vendor said. All three spell it differently. */\n" +
  "const fromVendor =\n" +
  "  (body.error && typeof body.error.message === 'string' && body.error.message) ||\n" +
  "  (typeof body.error === 'string' && body.error) ||\n" +
  "  (typeof details.description === 'string' && details.description) ||\n" +
  "  (typeof error.message === 'string' && error.message) ||\n" +
  "  '';\n" +
  "\n" +
  "const message = fromApp\n" +
  "  ? fromApp\n" +
  "  : fromVendor\n" +
  "    ? 'The build could not be finished: ' + clip(fromVendor, 300)\n" +
  "    : 'The build could not be finished, and the step that stopped it gave no reason. Nothing has been stored. Try again, and if it happens twice the model may be the thing that is down.';\n" +
  "\n" +
  "return [\n" +
  "  {\n" +
  "    json: {\n" +
  "      projectId: request.projectId,\n" +
  "      userId: request.userId,\n" +
  "      message: clip(message, 600),\n" +
  "      /* THE SAME KEY /api/builder/webapp/save USES for its own failure\n" +
  "         message, and that is the entire duplicate-suppression mechanism.\n" +
  "         project_messages carries a UNIQUE index on (project_id, dedupe_key),\n" +
  "         so when the save route already told this customer what went wrong,\n" +
  "         the insert downstream is rejected by the database and the app's\n" +
  "         better sentence stands alone. When it never got the chance \u2014 killed\n" +
  "         mid-request, or never reached \u2014 this one lands instead. No\n" +
  "         coordination between the app and this workflow, and none needed. */\n" +
  "      dedupeKey: 'save-failed:' + (request.requestId || request.projectId),\n" +
  "    },\n" +
  "    /* Kept so Flag Build Failure's existing $('Normalize Build Request').item\n" +
  "       expressions still resolve through this node. */\n" +
  "    pairedItem: { item: 0 },\n" +
  "  },\n" +
  "];\n";

/* ── The reason, before the flag ───────────────────────────────────────────
 *
 * Flag Build Failure writes status Failed and a timestamp and NOTHING ELSE, so
 * any failure that happened outside /api/builder/webapp/save was silent: three
 * builds on 2026-09-12 logged "Your build is underway" and then nothing, while
 * this workflow reported SUCCESS for every one of them — from its point of
 * view, flagging the failure had worked.
 *
 * These two now sit in front of it. */
const sayWhatFailed = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Say What Failed',
    position: [2592, 800],
    notes:
      "One sentence out of whichever error arrived. The save route's own { message } is preferred verbatim when it is there — those sentences are written for the person reading them. Otherwise the vendor's text, cut at the first stack frame so container paths do not reach a chat.",
    parameters: { jsCode: SAY_WHAT_FAILED },
  },
});

/* The insert that the UNIQUE index on (project_id, dedupe_key) polices.
 *
 * Using the same dedupe key the save route uses is the whole duplicate
 * suppression: when the app already reported the reason itself, this insert is
 * rejected by the database and the app's more specific sentence stands alone;
 * when the app never got the chance, this one lands. Nothing coordinates the
 * two, and nothing needs to.
 *
 * A rejected duplicate must not stop Flag Build Failure from marking the row,
 * which is why onError continues rather than stopping. It is the same rule
 * recordMessage() follows in src/lib/thread-server.ts, where 23505 is read as
 * "the message is in the thread", not as a failure. */
const tellTheCustomer = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Tell The Customer',
    position: [2816, 800],
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    parameters: {
      operation: 'create',
      tableId: 'project_messages',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'project_id', fieldValue: expr('{{ $json.projectId }}') },
          { fieldId: 'user_id', fieldValue: expr('{{ $json.userId }}') },
          { fieldId: 'role', fieldValue: 'system' },
          { fieldId: 'body', fieldValue: expr('{{ $json.message }}') },
          { fieldId: 'tone', fieldValue: 'error' },
          { fieldId: 'kind', fieldValue: 'build_failed' },
          { fieldId: 'dedupe_key', fieldValue: expr('{{ $json.dedupeKey }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase account') },
  },
});

const flagBuildFailure = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Flag Build Failure',
    position: [3040, 800],
    parameters: {
      operation: 'update',
      tableId: 'projects',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'id', condition: 'eq',
            keyValue: expr('{{ $("Normalize Build Request").item.json.projectId }}') },
          { keyName: 'user_id', condition: 'eq',
            keyValue: expr('{{ $("Normalize Build Request").item.json.userId }}') },
        ],
      },
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: 'Failed' },
          { fieldId: 'last_build_at', fieldValue: expr('{{ $now.toISO() }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase account') },
  },
});

/* ── Sticky notes, as they read on the canvas ──────────────────────────────
   Reproduced verbatim. Note that note 3 still describes "Compose Page Prompt"
   and "Generate Page", which are not the names of any node in the deployed
   workflow — the generation branch was rebuilt as Route By Provider plus the
   three Generate With … nodes and the sticky was not updated. */

const entryNote = sticky(
  '## 1 - Chat UI entry point\n\nThe app POSTs to /webhook/api/v1/build with { prompt, projectName, userId, projectId, requestId, signature, attachmentUrls, attachmentText }.\n\nONLY NEW BUILDS ARRIVE HERE. The app classifies every message first — edit, new_project, question or revert — and handles three of the four itself: an edit is a search/replace patch applied in the app in seconds, and questions and reverts never leave it. A build that would replace an existing page is confirmed with the person before it is sent.\n\nATTACHMENTS. Images come as signed URLs and become image blocks in the request to the model — URLs rather than base64, because pushing megabytes through a webhook to say the same thing costs a timeout.',
  [buildWebhook, normalizeRequest],
  { color: 4 },
);

const kindNote = sticky(
  '## 2 - The kind, decided by the app\n\nThe app classifies every message before it calls this workflow and sends the kind as buildKind with the whole system prompt composed for it. Kind Decided By App checks BOTH are present and routes straight to the build branch.\n\nNO MODEL RUNS IN THIS WORKFLOW BEFORE GENERATION. The Text Classifier that used to sit here was deleted, and that is the fix for every build failing with "the intent classifier could not be reached": it re-decided something the app had already decided, and it was the one node every build passed through, so an Anthropic outage or a key out of credit was a total outage. A routing call must never be able to fail a build that needs no routing.',
  [kindDecidedByApp],
  { color: 3 },
);

const branchNote = sticky(
  '## 3 - The build branch\n\nOne branch. It writes its spec, then normalizes to: intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts, branchStatus.\n\nintent comes from the app\'s buildKind - landing, ecommerce, blog or webapp. All four are built from the same branch, because what differs between them is the SYSTEM PROMPT the app composed, not the plumbing here. The old WordPress and E-Commerce branches were removed; restore them from version history rather than rebuilding by hand.\n\nThe page itself is generated after the chat has been answered: Compose Page Prompt builds only the user message, Generate Page calls Anthropic directly with the app\'s system prompt, and Save Page posts the document back to the app.',
  [webappSpec, collectWebappResult],
  { color: 5 },
);

const syncNote = sticky(
  '## 4 - Status sync and response\n\nTwo inputs fan into one Merge: the build branch, and a request that arrived without a buildKind and a systemPrompt. They are assembled into a single result, written to the projects table in Supabase, and returned to the chat UI as preview links, config keys and artifacts.\n\nBuild Chat Payload reads from Assemble Build Result rather than from Sync Project Row, so the chat still gets an answer when the Supabase step fails.',
  [collectBuildOutcome, respondToChatUi],
  { color: 6 },
);

export default workflow('quickstark-build-orchestrator', 'QuickStark.Ai — Build Orchestrator')
  .add(buildWebhook)
  .to(normalizeRequest)
  .to(kindDecidedByApp)
  /* True: the app said what to build and gave the prompt for it. */
  .add(kindDecidedByApp.output(0).to(webappSpec.to(collectWebappResult.to(collectBuildOutcome.input(0)))))
  /* False: it did not, and gets told so. */
  .add(kindDecidedByApp.output(1).to(flagForManualReview.to(collectBuildOutcome.input(1))))
  .add(collectBuildOutcome)
  .to(assembleBuildResult)
  .to(syncProjectRow)
  .to(buildChatPayload)
  .to(respondToChatUi)
  /* Everything past the response runs with nobody waiting on it. */
  .to(ifPageIsToBeBuilt)
  .add(ifPageIsToBeBuilt.output(0).to(routeByProvider))
  /* One success edge, like the other two providers. An earlier version of this
     file described a second one straight to Save Page, which would have handed
     it the raw Anthropic response with no `html` field in it; the canvas does
     not have that edge and, on the evidence of the executions, has not had it
     for some time. */
  .add(routeByProvider.output(0).to(generateWithClaude))
  .add(generateWithClaude.output(0).to(collectGeneration.input(0)))
  .add(generateWithClaude.output(1).to(sayWhatFailed))
  .add(routeByProvider.output(1).to(generateWithOpenAi))
  .add(generateWithOpenAi.output(0).to(collectGeneration.input(1)))
  .add(generateWithOpenAi.output(1).to(sayWhatFailed))
  .add(routeByProvider.output(2).to(generateWithGemini))
  .add(generateWithGemini.output(0).to(collectGeneration.input(2)))
  .add(generateWithGemini.output(1).to(sayWhatFailed))
  .add(collectGeneration.to(extractPage.to(savePage)))
  /* Save Page's success output goes nowhere: the app owns everything after the
     document lands. Only its error output is wired. */
  .add(savePage.output(1).to(sayWhatFailed))
  /* One chain for all four error outputs: say why, tell the customer, then
     mark the row. The message is written BEFORE the status flips, because the
     workspace watches last_build_at to know the run is over — so by the time
     it reads Failed, the reason is already in the thread. */
  .add(sayWhatFailed.to(tellTheCustomer.to(flagBuildFailure)))
  .add(entryNote)
  .add(kindNote)
  .add(branchNote)
  .add(syncNote);
