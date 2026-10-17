import { workflow, node, trigger, newCredential, switchCase, expr } from '@n8n/workflow-sdk';

/* QuickStark.Ai — Flier Image (ili9dNrgumg2JjXU). A mirror of the live
 * workflow, like the others in this folder: change it in n8n, then bring the
 * change back here. When the two disagree, the workflow is right.
 *
 * Flier images for the Flier Studio on n8n's gateway credits — no key of our
 * own. The app (src/lib/flyers/providers/n8n.ts) calls it with
 * X-QuickStark-Token and waits for the answer, which carries the images.
 *
 *   Read Job            normalise the request
 *   MiniMax Or OpenAI   route by engine
 *   Draft With MiniMax  MiniMax image-01, up to four at the flier's ratio
 *   Final With OpenAI   OpenAI gpt-image (gpt-image-1-mini on the gateway)
 *   Collect …           the image URLs, or base64 out of the binary
 *   Return Images       { ok, images: [{ url } | { b64 }], error }
 *
 * Both image nodes continue on error, so a failure is answered as one. */

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Flier Image Webhook',
    position: [0, 300],
    parameters: { httpMethod: 'POST', path: 'api/v1/flier-image', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: { id: '8eSfR6NoliNUtHDA', name: 'Header Auth account' } },
  },
});

const readJob = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Read Job',
    position: [220, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        "const body = $input.first().json.body ?? $input.first().json;\n" +
        "const ratios = ['1:1', '16:9', '2:3', '3:2', '3:4', '4:3', '9:16', '21:9'];\n" +
        "const sizes = { '2:3': '1024x1536', '9:16': '1024x1536', '3:4': '1024x1536', '1:1': '1024x1024', '3:2': '1536x1024', '16:9': '1536x1024', '4:3': '1536x1024', '21:9': '1536x1024' };\n" +
        "const aspect = ratios.includes(body.aspect) ? body.aspect : '2:3';\n" +
        "return [{ json: {\n" +
        "  engine: body.engine === 'openai' ? 'openai' : 'minimax',\n" +
        "  prompt: String(body.prompt || '').slice(0, 1500),\n" +
        "  aspect,\n" +
        "  size: sizes[aspect],\n" +
        "  n: Math.min(Math.max(Number(body.n) || 1, 1), 4),\n" +
        "  quality: body.quality === 'high' ? 'high' : 'medium',\n" +
        "  model: typeof body.model === 'string' && /^gpt-image/.test(body.model) ? body.model : 'gpt-image-1-mini',\n" +
        "} }];",
    },
  },
});

const route = switchCase({
  version: 3.2,
  config: {
    name: 'MiniMax Or OpenAI',
    position: [440, 300],
    parameters: {
      rules: {
        values: [
          { outputKey: 'minimax', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.engine }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'minimax' }], combinator: 'and' }, renameOutput: true },
          { outputKey: 'openai', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.engine }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'openai' }], combinator: 'and' }, renameOutput: true },
        ],
      },
      options: {},
    },
  },
});

const minimaxImage = node({
  type: '@n8n/n8n-nodes-langchain.minimax',
  version: 1.2,
  config: {
    name: 'Draft With MiniMax',
    position: [660, 200],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'image',
      operation: 'generate',
      modelId: 'image-01',
      prompt: expr('{{ $json.prompt }}'),
      aspectRatio: expr('{{ $json.aspect }}'),
      numberOfImages: expr('{{ $json.n }}'),
      downloadImage: false,
      options: {},
    },
    credentials: { minimaxApi: newCredential('MiniMax') },
  },
});

const openaiImage = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Final With OpenAI',
    position: [660, 420],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'image',
      operation: 'generate',
      modelId: { __rl: true, mode: 'id', value: expr('{{ $json.model }}') },
      prompt: expr('{{ $json.prompt }}'),
      options: { quality: expr('{{ $json.quality }}'), size: expr('{{ $json.size }}'), binaryPropertyOutput: 'data' },
    },
    credentials: { openAiApi: newCredential('OpenAI') },
  },
});

const collectCode =
  "const out = [];\n" +
  "let error = null;\n" +
  "const items = $input.all();\n" +
  "function urls(value, depth = 0) {\n" +
  "  if (depth > 6 || value == null) return [];\n" +
  "  if (typeof value === 'string') return /^https?:\\/\\//.test(value) ? [value] : [];\n" +
  "  if (Array.isArray(value)) return value.flatMap((v) => urls(v, depth + 1));\n" +
  "  if (typeof value === 'object') return Object.values(value).flatMap((v) => urls(v, depth + 1));\n" +
  "  return [];\n" +
  "}\n" +
  "for (let i = 0; i < items.length; i++) {\n" +
  "  const item = items[i];\n" +
  "  if (item.binary && item.binary.data) {\n" +
  "    const buf = await this.helpers.getBinaryDataBuffer(i, 'data');\n" +
  "    out.push({ b64: buf.toString('base64'), type: item.binary.data.mimeType || 'image/png' });\n" +
  "    continue;\n" +
  "  }\n" +
  "  const json = item.json || {};\n" +
  "  if (json.error) { error = String(json.error.message ?? json.error).slice(0, 500); continue; }\n" +
  "  for (const url of urls(json)) out.push({ url });\n" +
  "}\n" +
  "return [{ json: { ok: out.length > 0, images: out, error: out.length ? null : (error || 'nothing returned') } }];";

const collectMiniMax = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Collect MiniMax Images', position: [880, 200], parameters: { mode: 'runOnceForAllItems', jsCode: collectCode } },
});

const collectOpenAI = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Collect OpenAI Image', position: [880, 420], parameters: { mode: 'runOnceForAllItems', jsCode: collectCode } },
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return Images',
    position: [1100, 300],
    parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify($json) }}'), options: { responseCode: 200 } },
  },
});

export default workflow('quickstark-flier-image', 'QuickStark.Ai — Flier Image')
  .add(webhook)
  .to(readJob)
  .to(route
    .onCase(0, minimaxImage.to(collectMiniMax.to(respond)))
    .onCase(1, openaiImage.to(collectOpenAI.to(respond))));
