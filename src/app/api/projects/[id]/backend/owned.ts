import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Ownership, settled once, under the caller's own session so that RLS answers
   rather than being asked to trust an id from a request body. Every caller
   addresses rows by the id this returned.

   Lives beside the routes rather than inside one of them because both the
   backend route and the schema route beneath it ask the same question, and two
   copies of an authorisation check is one copy too many: the day one of them
   gains a condition, the other is the hole. */
export async function ownedProject(projectId: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: NextResponse.json({ error: "Sessions are unavailable." }, { status: 503 }) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  /* 404 rather than 403 for a project belonging to somebody else: a 403 confirms
     the project exists, which is one bit more than a stranger should learn. */
  if (!project) {
    return { error: NextResponse.json({ error: "No such project." }, { status: 404 }) };
  }

  return { userId: user.id, projectId: project.id as string };
}
