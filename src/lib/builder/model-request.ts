import type { Model, Provider } from "@/app/dashboard/models";

/* One build, three wire formats.
 *
 * Anthropic, OpenAI and Google all take a system prompt, a user message and some
 * images, and all three spell it differently enough that a single request body
 * cannot serve them. This is where that difference lives, and it is the only
 * place it lives: everything upstream — the classifier, the blueprints, the
 * asset manifest, the composed prompt — is provider-agnostic and stays that way.
 *
 * ── Why the app shapes the request and n8n sends it ───────────────────────
 *
 * The orchestrator is one HTTP node per provider and no logic. It could instead
 * have held three sets of expressions building three bodies on a canvas, which
 * is how the old single Anthropic body was written — and that is precisely the
 * arrangement that let one node's prompt drift away from the app's for weeks
 * without anybody seeing a diff. A body built here is reviewed here.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * Keys. Every provider's credential stays in n8n's credential store and is
 * attached by the node at send time. This module never reads one, never
 * receives one, and never returns one, so a request shaped here can be logged
 * whole without leaking anything. The endpoint and the wire model id are
 * published documentation, not secrets.
 */

export type ImageRef = { url: string };

/**
 * The user half of the request — the brief, in the frame the model reads it in.
 *
 * This used to be built by the orchestrator's "Compose Page Prompt" node. It
 * moves here for the same reason the system prompt did: the app now shapes the
 * whole request body, and a user message assembled on a canvas out of node
 * expressions is one more thing that can quietly stop matching what this app
 * believes it asked for. The wording is carried over unchanged.
 */
export function userMessage(
  projectName: string,
  brief: string,
  attachedText: string,
  imageCount: number,
): string {
  const parts = [`Build this, for a project called "${projectName}":\n\n${brief}`];
  if (attachedText) parts.push(attachedText);
  if (imageCount > 0) {
    /* Said only when there are images. The asset manifest in the system prompt
       governs the pictures that end up IN the page; these are references —
       a screenshot to match, a logo, a mockup — and the distinction is the
       whole reason attachments stopped being redrawn. */
    parts.push(
      "Images are attached above. Use them as the reference for look, layout and branding, and recreate what they show in HTML and CSS rather than linking to them.",
    );
  }
  return parts.join("\n\n");
}

export type GenerationRequest = {
  /** Which credential the orchestrator should attach. */
  provider: Provider;
  /** Where to POST. */
  url: string;
  /** Everything except authorisation, which the node adds. */
  headers: Record<string, string>;
  /** The body, ready to serialise. */
  body: unknown;
  /** Where the finished HTML sits in the answer — see `textFromResponse`. */
  shape: "anthropic" | "openai" | "google";
};

export const ENDPOINTS: Record<Exclude<Provider, "auto">, string> = {
  claude: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
};

/**
 * The request that builds a page, in the shape the chosen model's API expects.
 *
 * `system` is the composed blueprint; `user` is the brief; `images` are the
 * signed reference URLs somebody attached, which are art direction rather than
 * assets — the asset pipeline handles the pictures that end up in the page.
 */
export function generationRequest(
  model: Model,
  system: string,
  user: string,
  images: ImageRef[] = [],
): GenerationRequest {
  const apiId = model.apiId;
  const maxOutput = model.maxOutput;
  if (!apiId || !maxOutput) {
    throw new Error(`model ${model.id} has no API facts — see src/app/dashboard/models.ts`);
  }

  if (model.provider === "claude") {
    return {
      provider: "claude",
      url: ENDPOINTS.claude,
      headers: { "anthropic-version": "2023-06-01" },
      shape: "anthropic",
      body: {
        model: apiId,
        max_tokens: maxOutput,
        /* Adaptive rather than a fixed budget: a one-section edit and an
           eleven-section storefront are the same call with very different
           amounts of thinking worth doing. */
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        /* Top-level, not a message. Anthropic is the only one of the three
           that puts it here. */
        system,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image",
                source: { type: "url", url: image.url },
              })),
              { type: "text", text: user },
            ],
          },
        ],
      },
    };
  }

  if (model.provider === "openai") {
    return {
      provider: "openai",
      url: ENDPOINTS.openai,
      headers: {},
      shape: "openai",
      body: {
        model: apiId,
        /* `max_completion_tokens`, not `max_tokens`: the GPT-5 family rejects
           the older name outright rather than ignoring it, which surfaces as a
           400 that reads like a malformed request. */
        max_completion_tokens: maxOutput,
        messages: [
          /* A message with role "system", where Anthropic had a field. Same
             text, different place — this is the whole reason this module
             exists rather than one body with a few swapped keys. */
          { role: "system", content: system },
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image_url",
                image_url: { url: image.url },
              })),
              { type: "text", text: user },
            ],
          },
        ],
      },
    };
  }

  /* Google. The model id rides in the PATH rather than the body, and the whole
     vocabulary is different: contents/parts rather than messages/content,
     systemInstruction rather than system, maxOutputTokens rather than either
     of the other two spellings. */
  return {
    provider: "google",
    url: `${ENDPOINTS.google}/${encodeURIComponent(apiId)}:generateContent`,
    headers: {},
    shape: "google",
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: "user",
          parts: [
            ...images.map((image) => ({
              /* Google takes a URI reference rather than an https URL in a
                 string field, and needs the type declared beside it. The
                 signed URLs the app mints are JPEG or PNG; jpeg is the safe
                 declaration for both, since it only steers the decoder. */
              fileData: { mimeType: "image/jpeg", fileUri: image.url },
            })),
            { text: user },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: maxOutput, temperature: 1 },
    },
  };
}

/**
 * The generated document, pulled out of whichever answer came back.
 *
 * Every one of the three buries the text at a different depth, and two of them
 * can return several blocks where only some are the page — Anthropic puts
 * thinking in the first block when thinking is on, which is why this joins the
 * text blocks rather than taking `[0]`. Returns null when the answer carries no
 * text at all, which is a refusal or a truncation and must not be stored as a
 * page.
 */
export function textFromResponse(shape: GenerationRequest["shape"], body: unknown): string | null {
  const answer = body as Record<string, unknown>;

  if (shape === "anthropic") {
    const content = answer?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((block) => (block as { type?: string })?.type === "text")
      .map((block) => (block as { text?: string }).text ?? "")
      .join("");
    return text || null;
  }

  if (shape === "openai") {
    const choices = answer?.choices;
    if (!Array.isArray(choices)) return null;
    const message = (choices[0] as { message?: { content?: unknown } })?.message;
    const content = message?.content;
    if (typeof content === "string") return content || null;
    /* The array form, when the answer came back as parts. */
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (part as { text?: string })?.text ?? "")
        .join("");
      return text || null;
    }
    return null;
  }

  const candidates = answer?.candidates;
  if (!Array.isArray(candidates)) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => (part as { text?: string })?.text ?? "").join("");
  return text || null;
}

/**
 * Whether this provider can be called at all right now.
 *
 * Read from the environment on the server. A provider with no key is not an
 * error to throw at somebody mid-build — it is a model that should not have
 * been offered, and the route answers accordingly.
 */
export function providerConfigured(provider: Provider): boolean {
  if (provider === "claude") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (provider === "google") return Boolean(process.env.GOOGLE_API_KEY);
  return false;
}
