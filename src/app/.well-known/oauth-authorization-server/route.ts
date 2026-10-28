import { NextResponse } from "next/server";

import { CORS_HEADERS, authorizationServerMetadataUrl } from "@/lib/quickstark-mcp/discovery";

/* Supabase Auth's OAuth metadata, repeated on this host.
 *
 * The current MCP spec finds the authorization server through
 * /.well-known/oauth-protected-resource, which names Supabase directly. Clients
 * built against the 2025-03-26 revision skip that and ask the MCP server's own
 * host for this document instead, so it is passed through unchanged — every
 * endpoint in it is still Supabase's. */

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: CORS_HEADERS });

  const upstream = await fetch(authorizationServerMetadataUrl(supabaseUrl), { next: { revalidate: 3600 } }).catch(() => null);
  if (!upstream?.ok) {
    /* Most often: the OAuth 2.1 server is not switched on in the Supabase
       dashboard yet (Authentication → OAuth Server). See docs/MCP.md. */
    return NextResponse.json({ error: "authorization_server_unavailable" }, { status: 503, headers: CORS_HEADERS });
  }
  return NextResponse.json(await upstream.json(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
