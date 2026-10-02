import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/* The signed-in owner and a client acting as them — every video route starts
   here, and RLS (video_* policies in supabase/schema.sql) does the scoping. */
export async function videoSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NextResponse.json({ error: "Sessions are unavailable." }, { status: 503 }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { supabase, userId: user.id };
}
