import { NextResponse } from "next/server";

import { builderAvailability } from "@/lib/builder/availability";

/* Whether the builder is taking work, for the browser to ask before it offers
 * somebody a composer.
 *
 * A route rather than a NEXT_PUBLIC_ constant so the answer can change without
 * a rebuild: an outage is exactly when nobody wants to wait for a deploy to
 * finish before the app can stop lying about it.
 *
 * Deliberately says nothing about WHY. The message is written by whoever set
 * the flag and is meant for the person reading it; the cause — a key, a
 * balance, a vendor — is not the public's business and naming providers in a
 * status page is how an outage becomes a headline.
 *
 * Unauthenticated on purpose. It reveals one boolean and a sentence that is
 * about to be shown to everyone anyway, and gating it would mean the signed-out
 * home page cannot tell somebody not to bother signing in. */

export const runtime = "nodejs";
/* Read per request. Cached, this would keep announcing an outage that ended. */
export const dynamic = "force-dynamic";

export async function GET() {
  const availability = builderAvailability();
  return NextResponse.json(availability, {
    headers: { "Cache-Control": "no-store" },
  });
}
