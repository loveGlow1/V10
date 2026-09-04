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

   Two things in the deployment are wrong rather than merely surprising, and
   they are reproduced here faithfully because a mirror that quietly corrects
   its subject is not a mirror. Both are marked DEPLOYED DEFECT below:

     1. `Generate With Claude` has TWO success connections — one to `Save Page`
        and one to `Collect Generation`. Only the second is right.
     2. Several `notes` on live nodes still describe the deleted classifier.

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
          { id: 'stack', name: 'stack', type: 'string', value: 'standalone-html' },
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
            value: expr('{{ { "stack": "Standalone HTML page", "filesTouched": 0 } }}') },
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

/* Writes status, intent and last_build_at — and nothing else. NOTHING IN THIS
   WORKFLOW CHARGES CREDITS. Billing happens in the app, in
   /api/builder/webapp/save, priced from the document that arrives there. A
   build that never reaches save is never billed.

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
          { fieldId: 'last_build_at', fieldValue: expr('{{ $json.completedAt }}') },
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

   Ten-minute timeout because nothing is waiting — the chat was answered before
   any of this started. */

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
      options: { timeout: 600000 },
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
      options: { timeout: 600000 },
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
      options: { timeout: 600000 },
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
        "return [{ json: { html, model: request.model || '', modelName: request.modelName || '', provider: request.provider || '', responseShape: shape } }];",
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
        'model: $json.model, html: $json.html }) }}',
      ),
      options: { timeout: 60000 },
    },
  },
});

/* Generation runs after the chat has been answered, so a failure here cannot
   travel in the response. It is written to the project row instead — the same
   row the workspace is polling — so the chat can say the build did not finish
   rather than waiting out its timeout in silence. */
const flagBuildFailure = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Flag Build Failure',
    position: [2368, 608],
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
  /* DEPLOYED DEFECT — reproduced, not corrected.
     Claude's success output fans out to TWO nodes: Collect Generation (right)
     and Save Page (wrong). The direct edge hands Save Page the raw Anthropic
     response, which has no `html` field, so that call posts html: undefined,
     is refused by the save route, and takes its error output to Flag Build
     Failure — marking the project Failed even when the real path through
     Extract Page succeeded moments later. OpenAI and Gemini do not have this
     second edge. Delete the Generate With Claude → Save Page connection in
     n8n; nothing else needs to change. */
  .add(routeByProvider.output(0).to(generateWithClaude))
  .add(generateWithClaude.output(0).to(savePage))
  .add(generateWithClaude.output(0).to(collectGeneration.input(0)))
  .add(generateWithClaude.output(1).to(flagBuildFailure))
  .add(routeByProvider.output(1).to(generateWithOpenAi))
  .add(generateWithOpenAi.output(0).to(collectGeneration.input(1)))
  .add(generateWithOpenAi.output(1).to(flagBuildFailure))
  .add(routeByProvider.output(2).to(generateWithGemini))
  .add(generateWithGemini.output(0).to(collectGeneration.input(2)))
  .add(generateWithGemini.output(1).to(flagBuildFailure))
  .add(collectGeneration.to(extractPage.to(savePage)))
  /* Save Page's success output goes nowhere: the app owns everything after the
     document lands. Only its error output is wired. */
  .add(savePage.output(1).to(flagBuildFailure))
  .add(entryNote)
  .add(kindNote)
  .add(branchNote)
  .add(syncNote);
