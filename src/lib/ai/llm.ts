/* One way to ask any model a question — Claude, ChatGPT or Gemini — so a
 * model picked in the workspace handles a request the same way whichever
 * company made it.
 *
 *   in    a system prompt, the turns so far, each turn's text and its
 *         pictures or PDFs, how much it may write, and optionally a callback
 *         for the text as it streams and a deadline
 *   out   the text, how it stopped (finished / ran out of room / refused /
 *         ran out of time), and the tokens it used
 *
 * Errors come back as one kind of error with one of five reasons — the key
 * was refused, rate limited, the request was refused, the model is unknown,
 * or the service could not be reached — so a caller says the same sentence
 * whatever the provider.
 *
 * Claude goes through the Anthropic SDK exactly as before. OpenAI is the
 * Chat Completions API (streamed); Gemini is generateContent (streamed),
 * with pictures sent inline because Gemini does not fetch arbitrary links.
 *
 * Keys come from the server's environment: ANTHROPIC_API_KEY,
 * OPENAI_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY). Never sent anywhere
 * but to their own provider.
 *
 * Server-only. */

import Anthropic from "@anthropic-ai/sdk";

import { MODELS, type Model, type Provider } from "@/app/dashboard/models";
import { googleKey } from "@/lib/keys";

export type LlmPart =
  | { type: "text"; text: string }
  /** A picture by link (fetched for providers that need the bytes). */
  | { type: "image"; url: string }
  /** A picture or PDF already in hand. */
  | { type: "file"; mediaType: string; base64: string };

export type LlmTurn = { role: "user" | "assistant"; parts: LlmPart[] };

export type LlmRequest = {
  /** The provider's own model id (Model.apiId), or a catalogue id. */
  model: string;
  system: string;
  turns: LlmTurn[];
  maxTokens: number;
  /** Called with each piece of text as it is written. */
  onText?: (delta: string) => void;
  /** Stop by then (epoch ms); what was written so far comes back with stop "deadline". */
  deadlineAt?: number;
};

export type LlmResult = {
  text: string;
  stop: "end" | "max_tokens" | "refusal" | "deadline";
  inputTokens: number;
  outputTokens: number;
  /** The provider's id for the model that answered. */
  model: string;
  provider: Exclude<Provider, "auto">;
};

export type LlmErrorKind = "auth" | "rate" | "bad_request" | "not_found" | "unreachable" | "not_configured";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status = 0,
    readonly provider: Exclude<Provider, "auto"> = "claude",
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const NAMES: Record<Exclude<Provider, "auto">, string> = { claude: "Claude", openai: "OpenAI", google: "Gemini" };

/** The catalogue entry for a model id or provider id, if there is one. */
export function modelFor(id: string): Model | undefined {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.apiId === id);
}

/** Which company's API answers this model. Unknown ids are read by their shape. Pure. */
export function providerFor(id: string): Exclude<Provider, "auto"> {
  const known = modelFor(id);
  if (known && known.provider !== "auto") return known.provider;
  if (/^(gpt-|o\d|chatgpt)/i.test(id)) return "openai";
  if (/^gemini/i.test(id)) return "google";
  return "claude";
}

/** The id to send to the provider: the catalogue's apiId, overridable per model in the environment. */
export function wireId(id: string, env: Record<string, string | undefined> = process.env): string {
  const known = modelFor(id);
  const apiId = known?.apiId ?? id;
  /* e.g. MODEL_ID_GEMINI_3_PRO=gemini-3-pro-preview, for when a provider's
     published name differs from the catalogue's. */
  const override = known ? env[`MODEL_ID_${known.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`]?.trim() : undefined;
  return override || apiId;
}

/** Whether this deployment holds a key for the provider. */
export function providerReady(provider: Exclude<Provider, "auto">, env: Record<string, string | undefined> = process.env): boolean {
  if (provider === "claude") return Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  return Boolean(googleKey(env));
}

/* ── Shared helpers ─────────────────────────────────────────────────────── */

function timeLeft(deadlineAt?: number): AbortSignal | undefined {
  if (!deadlineAt) return undefined;
  return AbortSignal.timeout(Math.max(1000, deadlineAt - Date.now()));
}

const isAbort = (error: unknown) => error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

function fromStatus(status: number, said: string, provider: Exclude<Provider, "auto">): LlmError {
  const kind: LlmErrorKind = status === 401 || status === 403 ? "auth" : status === 429 ? "rate" : status === 404 ? "not_found" : status >= 400 && status < 500 ? "bad_request" : "unreachable";
  return new LlmError(kind, `${NAMES[provider]}: ${said || `HTTP ${status}`}`.slice(0, 600), status, provider);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    /* Not JSON. */
  }
  return text.slice(0, 300);
}

/** Server-sent events, as the JSON of each `data:` line. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* A partial or non-JSON line: skipped. */
      }
    }
  }
}

/** A picture's bytes, for providers that take them inline. Null when it cannot be read. */
async function bytesOf(url: string): Promise<{ mediaType: string; base64: string } | null> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.*)$/);
    return match ? { mediaType: match[1], base64: match[2] } : null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) return null;
    const mediaType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    return { mediaType, base64: buffer.toString("base64") };
  } catch {
    return null;
  }
}

/* ── OpenAI (Chat Completions, streamed) ────────────────────────────────── */

function openaiContent(parts: LlmPart[]) {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : part.type === "image"
        ? { type: "image_url", image_url: { url: part.url } }
        : part.mediaType.startsWith("image/")
          ? { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.base64}` } }
          : { type: "file", file: { filename: "attachment.pdf", file_data: `data:${part.mediaType};base64,${part.base64}` } },
  );
}

async function askOpenAI(request: LlmRequest, apiId: string): Promise<LlmResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new LlmError("not_configured", "OpenAI is not set up on this server (OPENAI_API_KEY).", 0, "openai");
  const messages = [
    { role: "system", content: request.system },
    ...request.turns.map((turn) =>
      turn.role === "assistant"
        ? { role: "assistant", content: turn.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n") }
        : { role: "user", content: openaiContent(turn.parts) },
    ),
  ];
  let text = "";
  let stop: LlmResult["stop"] = "end";
  let inputTokens = 0;
  let outputTokens = 0;
  let model = apiId;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      /* max_completion_tokens: the GPT-5 family refuses the older max_tokens. */
      body: JSON.stringify({ model: apiId, messages, max_completion_tokens: request.maxTokens, stream: true, stream_options: { include_usage: true } }),
      signal: timeLeft(request.deadlineAt),
    });
    if (!response.ok || !response.body) throw fromStatus(response.status, await readError(response), "openai");
    for await (const event of sse(response.body)) {
      const e = event as { model?: string; choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (e.model) model = e.model;
      const choice = e.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        request.onText?.(delta);
      }
      if (choice?.delta?.refusal) stop = "refusal";
      if (choice?.finish_reason === "length") stop = "max_tokens";
      if (choice?.finish_reason === "content_filter") stop = "refusal";
      if (e.usage) {
        inputTokens = e.usage.prompt_tokens ?? inputTokens;
        outputTokens = e.usage.completion_tokens ?? outputTokens;
      }
    }
  } catch (error) {
    if (isAbort(error)) return { text, stop: "deadline", inputTokens, outputTokens: outputTokens || Math.ceil(text.length / 4), model, provider: "openai" };
    if (error instanceof LlmError) throw error;
    throw new LlmError("unreachable", "OpenAI could not be reached.", 0, "openai");
  }
  return { text, stop, inputTokens, outputTokens: outputTokens || Math.ceil(text.length / 4), model, provider: "openai" };
}

/* ── Gemini (generateContent, streamed) ─────────────────────────────────── */

async function geminiParts(parts: LlmPart[]) {
  const out: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.type === "text") out.push({ text: part.text });
    else if (part.type === "file") out.push({ inlineData: { mimeType: part.mediaType, data: part.base64 } });
    else {
      const bytes = await bytesOf(part.url);
      if (bytes) out.push({ inlineData: { mimeType: bytes.mediaType, data: bytes.base64 } });
    }
  }
  return out.length ? out : [{ text: "" }];
}

async function askGemini(request: LlmRequest, apiId: string): Promise<LlmResult> {
  const key = googleKey();
  if (!key) throw new LlmError("not_configured", "Gemini is not set up on this server (GEMINI_API_KEY).", 0, "google");
  const contents = [];
  for (const turn of request.turns) contents.push({ role: turn.role === "assistant" ? "model" : "user", parts: await geminiParts(turn.parts) });
  let text = "";
  let stop: LlmResult["stop"] = "end";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiId)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] }, contents, generationConfig: { maxOutputTokens: request.maxTokens } }),
      signal: timeLeft(request.deadlineAt),
    });
    if (!response.ok || !response.body) throw fromStatus(response.status, await readError(response), "google");
    for await (const event of sse(response.body)) {
      const e = event as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      };
      if (e.promptFeedback?.blockReason) stop = "refusal";
      const candidate = e.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        /* Gemini's own reasoning, when it shares it, is not the answer. */
        if (part.thought || !part.text) continue;
        text += part.text;
        request.onText?.(part.text);
      }
      if (candidate?.finishReason === "MAX_TOKENS") stop = "max_tokens";
      if (candidate?.finishReason && /SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/.test(candidate.finishReason)) stop = "refusal";
      if (e.usageMetadata) {
        inputTokens = e.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = (e.usageMetadata.candidatesTokenCount ?? 0) + (e.usageMetadata.thoughtsTokenCount ?? 0) || outputTokens;
      }
    }
  } catch (error) {
    if (isAbort(error)) return { text, stop: "deadline", inputTokens, outputTokens: outputTokens || Math.ceil(text.length / 4), model: apiId, provider: "google" };
    if (error instanceof LlmError) throw error;
    throw new LlmError("unreachable", "Gemini could not be reached.", 0, "google");
  }
  return { text, stop, inputTokens, outputTokens: outputTokens || Math.ceil(text.length / 4), model: apiId, provider: "google" };
}

/* ── Claude (Anthropic SDK) ─────────────────────────────────────────────── */

function claudeContent(parts: LlmPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : part.type === "image"
        ? { type: "image" as const, source: { type: "url" as const, url: part.url } }
        : part.mediaType === "application/pdf"
          ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.base64 } }
          : { type: "image" as const, source: { type: "base64" as const, media_type: part.mediaType as "image/png", data: part.base64 } },
  );
}

async function askClaude(request: LlmRequest, apiId: string): Promise<LlmResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new LlmError("not_configured", "Claude is not set up on this server (ANTHROPIC_API_KEY).");
  try {
    const stream = new Anthropic().messages.stream(
      { model: apiId, max_tokens: request.maxTokens, system: request.system, messages: request.turns.map((t) => ({ role: t.role, content: claudeContent(t.parts) })) },
      { signal: timeLeft(request.deadlineAt) },
    );
    let text = "";
    stream.on("text", (delta) => {
      text += delta;
      request.onText?.(delta);
    });
    try {
      const final = await stream.finalMessage();
      const answer = final.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      return {
        text: answer,
        stop: final.stop_reason === "max_tokens" ? "max_tokens" : final.stop_reason === "refusal" ? "refusal" : "end",
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        model: final.model,
        provider: "claude",
      };
    } catch (error) {
      if (isAbort(error) || error instanceof Anthropic.APIUserAbortError) return { text, stop: "deadline", inputTokens: 0, outputTokens: Math.ceil(text.length / 4), model: apiId, provider: "claude" };
      throw error;
    }
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof Anthropic.APIError) throw fromStatus(error.status ?? 0, error.message, "claude");
    throw new LlmError("unreachable", "Claude could not be reached.");
  }
}

/** Asks the model. Throws LlmError; never anything else. */
export async function generate(request: LlmRequest): Promise<LlmResult> {
  const provider = providerFor(request.model);
  const apiId = wireId(request.model);
  if (provider === "openai") return askOpenAI(request, apiId);
  if (provider === "google") return askGemini(request, apiId);
  return askClaude(request, apiId);
}

/** One sentence for the person, whatever went wrong and whoever made the model. Pure. */
export function sayLlmError(error: LlmError): string {
  const who = NAMES[error.provider];
  switch (error.kind) {
    case "not_configured":
      return `${who} isn't set up on this workspace yet. Pick another model.`;
    case "auth":
      return `The ${who} API key this workspace uses was rejected — it needs replacing. Pick another model for now.`;
    case "rate":
      return `${who} is rate limiting us at the moment. Send that again in a few seconds.`;
    case "not_found":
      return `${who} doesn't recognise this model's name. Pick another model.`;
    case "bad_request":
      return `${who} refused that request, so nothing was changed. ${error.message.replace(/^[A-Za-z]+: /, "")}`;
    default:
      return `I couldn't reach ${who}. Nothing was changed — try that again.`;
  }
}

/** One question, one answer: the text and what it cost. Throws LlmError. */
export async function complete(model: string, system: string, parts: LlmPart[], maxTokens: number): Promise<{ text: string; outputTokens: number; stop: LlmResult["stop"] }> {
  const answer = await generate({ model, system, turns: [{ role: "user", parts }], maxTokens });
  return { text: answer.text, outputTokens: answer.outputTokens, stop: answer.stop };
}

/** Pictures as data: URIs, for Gemini, which takes bytes rather than links. One that cannot be read stays a link. */
export async function inlineImages(urls: string[]): Promise<{ url: string }[]> {
  return Promise.all(
    urls.map(async (url) => {
      const bytes = await bytesOf(url);
      return { url: bytes ? `data:${bytes.mediaType};base64,${bytes.base64}` : url };
    }),
  );
}
