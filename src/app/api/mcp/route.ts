import { NextResponse } from "next/server";

import { CORS_HEADERS, challenge, originOf } from "@/lib/quickstark-mcp/discovery";
import { ERRORS, dispatch, failure } from "@/lib/quickstark-mcp/protocol";
import { TOOLS, type McpContext } from "@/lib/quickstark-mcp/tools";
import { bearerToken, createSupabaseClientForToken } from "@/lib/supabase-server";

/* QuickStark's MCP server: what Claude, ChatGPT, Cursor and other assistants
 * connect to. See docs/MCP.md for how it fits together and how to switch it on.
 *
 * Every request carries the person's access token, issued by Supabase Auth's
 * OAuth 2.1 server after they approved the assistant on /oauth/consent. The
 * token is checked here, and then handed on unchanged to the routes the tools
 * call, so each of those checks it again and applies its own rules. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* How long a tool call may wait on a build before answering "still running".
   Under the platform's limit for this function, with room to write the reply.
   Raise MCP_WAIT_SECONDS on a plan whose functions may run longer. */
const WAIT_SECONDS = Math.min(280, Math.max(10, Number(process.env.MCP_WAIT_SECONDS) || 50));

export async function POST(request: Request) {
  const origin = originOf(request);
  const token = bearerToken(request.headers.get("authorization"));

  const unauthorised = (invalidToken: boolean) =>
    NextResponse.json(
      { error: invalidToken ? "That sign-in has expired or isn't valid." : "Sign in to QuickStark first." },
      { status: 401, headers: { ...CORS_HEADERS, "WWW-Authenticate": challenge(origin, invalidToken) } },
    );

  if (!token) return unauthorised(false);

  const db = createSupabaseClientForToken(token);
  if (!db) {
    return NextResponse.json({ error: "QuickStark isn't configured on this deployment." }, { status: 503, headers: CORS_HEADERS });
  }
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return unauthorised(true);

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return NextResponse.json(failure(null, ERRORS.parse, "That wasn't valid JSON."), { status: 400, headers: CORS_HEADERS });
  }

  const startedAt = Date.now();
  const context: McpContext = {
    origin,
    userId: user.id,
    db,
    deadline: startedAt + WAIT_SECONDS * 1000,
    route: (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(new URL(path, origin), { ...init, headers, cache: "no-store" });
    },
  };

  /* One message per request. A batch (allowed before 2025-06-18) is answered
     message by message, which is what a batch means. */
  if (Array.isArray(message)) {
    const replies = (await Promise.all(message.map((one) => dispatch(one, TOOLS, context)))).filter(Boolean);
    if (replies.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return NextResponse.json(replies, { headers: CORS_HEADERS });
  }

  const reply = await dispatch(message, TOOLS, context);
  if (!reply) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return NextResponse.json(reply, { headers: CORS_HEADERS });
}

/* No server-initiated stream and no sessions: the transport lets a server say
   so with 405, and clients then work request by request. */
export async function GET() {
  return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
