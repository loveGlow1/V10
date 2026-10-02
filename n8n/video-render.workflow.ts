import { workflow, node, trigger, newCredential, switchCase, expr } from '@n8n/workflow-sdk';

/* QuickStark.Ai — Video Render (bZejkBTNs4XRn1FF). A mirror of the live
 * workflow, like build-orchestrator.workflow.ts: change it in n8n, then bring
 * the change back here. When the two disagree, the workflow is right.
 *
 * ONE JOB PER EXECUTION. The instance stops any run at 180 seconds, and a 4s
 * MiniMax-H3 clip took 126s in testing, so the app (src/lib/video/render.ts)
 * sends each scene's clip and each voice line as its own request. Each
 * reports back on its own to /api/video/{id}/render/callback.
 *
 *   Read Job       normalise the request; clips capped at 6s
 *   Clip Or Voice  route by job.kind
 *   Generate Clip  MiniMax-H3 text-to-video at the plan's aspect ratio (768P)
 *   Generate Voice MiniMax speech-2.8-hd
 *   Job Result     the URL, or the error, out of whatever came back
 *   Report To App  POST to the app with X-QuickStark-Token + the app's signature
 *
 * Both MiniMax nodes run on n8n Gateway credits (no key of our own) and
 * continue on error, so a failed job is reported as failed rather than lost. */

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Render Job Webhook',
    position: [0, 300],
    parameters: { httpMethod: 'POST', path: 'api/v1/video-render', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    credentials: { httpHeaderAuth: { id: '8mazybFPHaUQeSwd', name: 'Header Auth account' } },
  },
});

const prepare = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Read Job',
    position: [220, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        'const body = $input.first().json.body ?? $input.first().json;\n' +
        'const job = body.job ?? {};\n' +
        "const ratios = { '9:16': '9:16', '1:1': '1:1', '16:9': '16:9', '4:5': '3:4' };\n" +
        '// A 4s H3 clip took ~126s; the instance stops a run at 180s. Clips are capped\n' +
        '// at 6s and the app holds the last frame for a longer scene.\n' +
        'return [{ json: {\n' +
        '  callbackUrl: String(body.callbackUrl || ""),\n' +
        '  videoId: String(body.videoId || ""),\n' +
        '  version: Number(body.version) || 0,\n' +
        '  signature: String(body.signature || ""),\n' +
        "  kind: job.kind === 'voice' ? 'voice' : 'clip',\n" +
        '  n: Number(job.n) || 0,\n' +
        '  duration: Math.min(6, Math.max(4, Math.round(Number(job.duration) || 5))),\n' +
        "  prompt: String(job.prompt || '').slice(0, 2000),\n" +
        "  text: String(job.text || '').slice(0, 2000),\n" +
        "  ratio: ratios[body.aspect] ?? '16:9',\n" +
        "  voiceId: String(job.voiceId || 'English_Graceful_Lady'),\n" +
        "  language: String(job.language || 'auto'),\n" +
        '} }];',
    },
  },
});

const route = switchCase({
  version: 3.2,
  config: {
    name: 'Clip Or Voice',
    position: [440, 300],
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), rightValue: 'clip', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'clip' },
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), rightValue: 'voice', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'voice' },
        ],
      },
      options: {},
    },
  },
});

const clip = node({
  type: '@n8n/n8n-nodes-langchain.minimax',
  version: 1.2,
  config: {
    name: 'Generate Clip',
    position: [660, 200],
    onError: 'continueRegularOutput',
    parameters: { resource: 'video', operation: 'textToVideo', modelId: 'MiniMax-H3', prompt: expr('{{ $json.prompt }}'), h3Duration: expr('{{ $json.duration }}'), h3Resolution: '768P', ratio: expr('{{ $json.ratio }}'), downloadVideo: false },
    credentials: { minimaxApi: newCredential('MiniMax') },
  },
});

const voice = node({
  type: '@n8n/n8n-nodes-langchain.minimax',
  version: 1.2,
  config: {
    name: 'Generate Voice',
    position: [660, 400],
    onError: 'continueRegularOutput',
    parameters: { resource: 'audio', operation: 'textToSpeech', modelId: 'speech-2.8-hd', text: expr('{{ $json.text }}'), voiceId: expr('{{ $json.voiceId }}'), downloadAudio: false, options: { audioFormat: 'mp3', languageBoost: expr('{{ $json.language }}') } },
    credentials: { minimaxApi: newCredential('MiniMax') },
  },
});

const resultCode =
  "const job = $('Read Job').first().json;\n" +
  'function firstUrl(value, depth = 0) {\n' +
  '  if (depth > 6 || value == null) return null;\n' +
  "  if (typeof value === 'string') return /^https?:\\/\\//.test(value) ? value : null;\n" +
  '  if (Array.isArray(value)) { for (const v of value) { const u = firstUrl(v, depth + 1); if (u) return u; } return null; }\n' +
  "  if (typeof value === 'object') {\n" +
  '    const keys = Object.keys(value).sort((a, b) => (/url/i.test(b) ? 1 : 0) - (/url/i.test(a) ? 1 : 0));\n' +
  '    for (const k of keys) { const u = firstUrl(value[k], depth + 1); if (u) return u; }\n' +
  '  }\n' +
  '  return null;\n' +
  '}\n' +
  'const out = $input.first().json;\n' +
  'const url = firstUrl(out);\n' +
  "const error = url ? null : String(out.error?.message ?? out.error ?? out.message ?? 'nothing returned').slice(0, 500);\n" +
  'return [{ json: { videoId: job.videoId, version: job.version, signature: job.signature, callbackUrl: job.callbackUrl, job: { kind: job.kind, n: job.n }, url, error } }];';

const result = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Job Result', position: [880, 300], parameters: { mode: 'runOnceForAllItems', jsCode: resultCode } },
});

const callback = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Report To App',
    position: [1100, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr('{{ $json.callbackUrl }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ videoId: $json.videoId, version: $json.version, signature: $json.signature, job: $json.job, url: $json.url, error: $json.error }) }}'),
      options: { timeout: 60000 },
    },
    credentials: { httpHeaderAuth: { id: '8mazybFPHaUQeSwd', name: 'Header Auth account' } },
  },
});

export default workflow('quickstark-video-render', 'QuickStark.Ai — Video Render')
  .add(webhook)
  .to(prepare)
  .to(route.onCase(0, clip.to(result)).onCase(1, voice.to(result)))
  .add(result)
  .to(callback)
  .group('Generate', [route, clip, voice, result], { description: 'One scene clip (MiniMax-H3, plan aspect ratio) or one voice line (MiniMax speech) per execution — the instance caps a run at 180s. Gateway credits.' });
