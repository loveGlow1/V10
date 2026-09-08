/* What a tool returned, in two pieces: the part a model needs and the part a
 * person needs.
 *
 * QA measurements, render output, asset provider responses. Each of them is
 * hundreds of lines of structure with a handful of facts in it, and the
 * ordinary thing to do — append the result to the conversation so the next call
 * can see it — spends the window on JSON. Do it twice in a build and the page
 * being discussed no longer fits beside the discussion of it.
 *
 * So a result is ABSORBED rather than appended: the findings and the
 * identifiers go into the prompt, the whole thing is stored under an id, and
 * anything that turns out to be needed later is fetched by that id. The
 * identifiers are what makes that work — a summary that says "three elements
 * overflow" is unactionable, and one that says "#pricing, #faq and .cta-row
 * overflow" is the same length and is a repair instruction. */

import { estimateTokens } from "./budget";

export type ToolResult = {
  /** "qa", "render", "assets", "publish". */
  tool: string;
  /** What goes in the prompt. */
  summary: string;
  /** Exact names the summary refers to. Never paraphrased, never truncated. */
  identifiers: string[];
  /** Everything, for storage. Never sent unless asked for by id. */
  raw: unknown;
  /** What the summary costs, so a caller can budget it. */
  tokens: number;
};

/* The ceiling on a summary. Four or five lines: past that it stops being a
   summary and becomes the thing it was summarising. */
const MAX_SUMMARY_TOKENS = 400;
const MAX_IDENTIFIERS = 24;

/** Anything that looks like a name somebody could act on. */
const IDENTIFIER = /(?:^|[\s"'(])([#.][a-zA-Z][\w-]{2,}|[a-zA-Z][\w-]*\.(?:tsx?|jsx?|css|html)|[A-Z][a-zA-Z0-9]{2,}(?:Section|Button|Card|Panel|Modal|Grid|Row))/g;

function identifiersIn(text: string): string[] {
  const found: string[] = [];
  IDENTIFIER.lastIndex = 0;
  for (let match = IDENTIFIER.exec(text); match; match = IDENTIFIER.exec(text)) {
    found.push(match[1]);
  }
  return [...new Set(found)].slice(0, MAX_IDENTIFIERS);
}

/** Lines from a raw result, whatever shape it arrived in. */
function linesOf(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split("\n").filter((line) => line.trim());
  if (Array.isArray(raw)) return raw.map((entry) => describeEntry(entry)).filter(Boolean);
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${describeEntry(value)}`)
      .filter(Boolean);
  }
  return raw === undefined || raw === null ? [] : [String(raw)];
}

function describeEntry(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.slice(0, 8).map((entry) => describeEntry(entry)).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    /* The fields a finding actually carries. Named rather than serialised
       whole, because a rule id and a selector are the finding and the other
       twenty fields are its provenance. */
    for (const field of ["message", "detail", "rule", "issue", "name", "id", "selector", "path"]) {
      if (typeof record[field] === "string") {
        const extra = typeof record.selector === "string" && field !== "selector" ? ` (${record.selector})` : "";
        return `${record[field] as string}${extra}`;
      }
    }
    return Object.keys(record).slice(0, 4).join(", ");
  }
  return "";
}

/**
 * One tool result, reduced to what the next model call should see.
 *
 * Lines are kept in the order they arrived and are never cut mid-line: a
 * finding half-said is a finding a model will complete from imagination.
 */
export function absorbToolResult(input: {
  tool: string;
  raw: unknown;
  /** Overrides the derived summary when the caller already has a good one. */
  summary?: string;
  /** Extra identifiers the caller knows are important. */
  identifiers?: string[];
}): ToolResult {
  const lines = linesOf(input.raw);
  const derived = input.summary ?? lines.join("\n");

  let summary = derived;
  if (estimateTokens(summary) > MAX_SUMMARY_TOKENS) {
    const kept: string[] = [];
    let spent = 0;
    for (const line of lines) {
      const cost = estimateTokens(line);
      if (spent + cost > MAX_SUMMARY_TOKENS) break;
      kept.push(line);
      spent += cost;
    }
    const dropped = lines.length - kept.length;
    summary = [
      ...kept,
      dropped > 0
        ? `(${dropped} further ${dropped === 1 ? "line" : "lines"} of ${input.tool} output stored and available on request)`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const identifiers = [
    ...new Set([...(input.identifiers ?? []), ...identifiersIn(derived)]),
  ].slice(0, MAX_IDENTIFIERS);

  return {
    tool: input.tool,
    summary,
    identifiers,
    raw: input.raw,
    tokens: estimateTokens(summary),
  };
}

/** The result as a block for a prompt, identifiers spelled out exactly. */
export function describeToolResult(result: ToolResult): string {
  if (!result.summary) return "";
  const named =
    result.identifiers.length > 0
      ? `\nThe parts of the page this refers to, exactly as they are named: ${result.identifiers.join(", ")}`
      : "";
  return `What the ${result.tool} step found:\n${result.summary}${named}`;
}
