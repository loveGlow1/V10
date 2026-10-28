import { NextResponse } from "next/server";

import { CORS_HEADERS, originOf, protectedResourceMetadata } from "@/lib/quickstark-mcp/discovery";

/* RFC 9728 protected-resource metadata for the MCP server at /api/mcp.
 *
 * Served at the root as well as at /.well-known/oauth-protected-resource/api/mcp
 * (the path the 401 names), because clients built against earlier drafts look
 * here first. See src/lib/quickstark-mcp/discovery.ts. */

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: CORS_HEADERS });
  return NextResponse.json(protectedResourceMetadata(originOf(request), supabaseUrl), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
