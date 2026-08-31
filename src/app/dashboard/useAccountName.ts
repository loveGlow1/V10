"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

/* The signed-in person's own name, for the places that address them by it.

   The header, the drawer and the account panel each read this off the session
   already; this is the same read, given a name so the greeting in the workspace
   does not become a fourth copy of it.

   Empty is a real answer, not a failure — an account created with an email and
   nothing else has no name to show, and a greeting has to work without one. */
export function useAccountName(): { name: string; firstName: string } {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (cancelled || !user) return;
        const metadata = user.user_metadata ?? {};
        setName((metadata.full_name as string) || (metadata.name as string) || "");
      })
      .catch(() => {
        // Leave it blank rather than greeting someone who is not signed in.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { name, firstName: name.trim().split(/\s+/)[0] ?? "" };
}

/* Morning, afternoon or evening by the reader's own clock rather than the
   server's — this renders in the browser, and a greeting that disagrees with
   the window is worse than no greeting. */
export function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
