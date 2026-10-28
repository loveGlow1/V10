/* The MCP wire protocol, and nothing about QuickStark.
 *
 * JSON-RPC 2.0 over the Streamable HTTP transport, answered statelessly: every
 * POST carries one message and gets one JSON reply, no session id is issued and
 * no event stream is opened. The specification allows exactly this, and it is
 * what a serverless function can do honestly — there is no process left to hold
 * a session open between requests.
 *
 * Kept free of Next and Supabase so check:mcp can run it offline. */

export const SERVER_INFO = { name: "QuickStark", version: "1.0.0" } as const;

/* Newest first. A client asking for one of these gets it back; anything else
   gets the newest, and the client decides whether it can work with that. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const INSTRUCTIONS =
  "QuickStark builds web and mobile apps from a plain-English description and publishes them. " +
  "Use create_app for a new app and edit_app to change one; both can take a minute or more, and a build " +
  "still running when the call returns carries on — check it with get_project. Building and publishing " +
  "spend the person's QuickStark credits, so confirm with them before starting a build or publishing. " +
  "When a tool answers with a question and options, ask the person and call the tool again with their answer.";

export type JsonSchema = Record<string, unknown>;

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type Tool<Context> = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  run: (args: Record<string, unknown>, context: Context) => Promise<ToolResult>;
};

type Id = string | number | null;
type Message = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: unknown };

export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

/** One reply, or null for a notification, which is answered with 202 and no body. */
export async function dispatch<Context>(
  message: unknown,
  tools: Tool<Context>[],
  context: Context,
): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return failure(null, ERRORS.invalidRequest, "Expected one JSON-RPC message.");
  }

  const { jsonrpc, id, method, params } = message as Message;
  const isNotification = !("id" in (message as object));

  /* A response from the client (to a request this server never sends) or a
     notification: nothing to answer. */
  if (typeof method !== "string") {
    const isResponse = "result" in (message as object) || "error" in (message as object);
    return isNotification || isResponse ? null : failure(id ?? null, ERRORS.invalidRequest, "Missing method.");
  }
  if (jsonrpc !== "2.0") return isNotification ? null : failure(id ?? null, ERRORS.invalidRequest, "jsonrpc must be \"2.0\".");
  if (isNotification) return null;

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
  const args = params && typeof params === "object" ? (params as Record<string, unknown>) : {};

  switch (method) {
    case "initialize": {
      const asked = typeof args.protocolVersion === "string" ? args.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return reply({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return reply({});

    case "tools/list":
      return reply({
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { title, ...annotations },
        })),
      });

    case "tools/call": {
      const name = typeof args.name === "string" ? args.name : "";
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return failure(id ?? null, ERRORS.invalidParams, `Unknown tool: ${name || "(none)"}.`);

      const input =
        args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
          ? (args.arguments as Record<string, unknown>)
          : {};
      const missing = requiredMissing(tool.inputSchema, input);
      if (missing.length > 0) {
        return reply(errorResult(`Missing ${missing.join(", ")}.`));
      }

      /* A tool that throws is reported as a failed tool call the model can read
         and recover from, not as a protocol error the client may hide. */
      try {
        return reply(await tool.run(input, context));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`mcp: ${name} failed:`, error);
        return reply(errorResult("Something went wrong on QuickStark's side. Try that again in a moment."));
      }
    }

    default:
      return failure(id ?? null, ERRORS.methodNotFound, `Method not found: ${method}.`);
  }
}

export function failure(id: Id, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function requiredMissing(schema: JsonSchema, input: Record<string, unknown>): string[] {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return required.filter((key) => {
    const value = input[key];
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  });
}
