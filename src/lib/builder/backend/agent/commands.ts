/* The database agent's chat commands, recognised before anything else reads
 * the message as SQL or as an edit to the page.
 *
 *   "Analyze my database"                         → analyze
 *   "Connect the app to my existing tables"       → wire
 *   "Why can't users see their bookings?"         → diagnose (RLS, policies, logs)
 *   "Make orders only visible to the person who placed them" → owner_only
 *   "Start fresh in a new project"                → new_project
 *   "Undo the last database change"               → undo
 *   "Add a phone number to customers", and every other change → plan (a surgery)
 *
 * Narrow on purpose: a message that is not one of these falls through to the
 * existing paths unchanged. Pure.
 */

export type AgentCommand =
  | { kind: "analyze" }
  | { kind: "wire" }
  | { kind: "diagnose"; subject: string | null }
  | { kind: "owner_only"; table: string }
  | { kind: "new_project" }
  | { kind: "undo" }
  | { kind: "health" };

export function agentCommand(message: string): AgentCommand | null {
  const m = message.trim().replace(/\s+/g, " ");
  if (m.length > 240) return null;

  if (/^(?:please\s+)?(?:analy[sz]e|scan|re-?scan|inspect|audit|map|look at)\b.*\b(?:my\s+|the\s+|our\s+)?(?:database|db|supabase|tables|schema)\b/i.test(m)) return { kind: "analyze" };
  if (/\bwhat(?:'s| is) in my (?:database|db|supabase)\b/i.test(m)) return { kind: "analyze" };
  if (/\b(?:database|db) (?:health|advisors|security check)\b|\bis my (?:database|db) (?:safe|secure|healthy)\b/i.test(m)) return { kind: "health" };

  if (/\b(?:connect|wire|hook up|link|point)\b.*\b(?:app|site|pages?)\b.*\b(?:to|with|at)\b.*\b(?:my |the |our )?(?:existing |current )?(?:tables|database|db|supabase)\b/i.test(m)) return { kind: "wire" };
  if (/\buse (?:my |the )?existing (?:tables|database)\b/i.test(m)) return { kind: "wire" };

  if (/\b(?:undo|revert|roll ?back|reverse)\b.*\b(?:last|previous|latest)\b.*\b(?:database|db|schema|migration|surgery)\b.*\b(?:change|migration|surgery)?/i.test(m) || /^roll ?back the (?:last )?migration$/i.test(m)) return { kind: "undo" };

  if (/\b(?:start (?:fresh|over|again)|new|fresh|separate|clean)\b.*\b(?:supabase )?project\b/i.test(m) && /\b(?:database|db|supabase|fresh|start)\b/i.test(m)) return { kind: "new_project" };

  const diag = m.match(/^why (?:can(?:'|no)t|cannot|don't|doesn't|do not|does not|aren't|isn't)\b.*?\b(?:see|read|load|view|access|find|save|write|update|get)\b(?:\s+(?:their|my|the|any|all))?\s+([a-z_][a-z0-9_ ]*?)\??$/i);
  if (diag) return { kind: "diagnose", subject: diag[1].trim().replace(/\s+/g, "_") };
  if (/\b(?:permission denied|row[- ]level security|rls)\b.*\b(?:error|blocking|denied|why)\b/i.test(m)) return { kind: "diagnose", subject: null };

  const owner = m.match(/^make (?:the )?([a-z_][a-z0-9_]*) (?:only )?(?:visible|readable|private|accessible) (?:only )?to (?:the )?(?:person|user|customer|owner|one|people) who (?:placed|created|made|owns|wrote|submitted|booked)/i);
  if (owner) return { kind: "owner_only", table: owner[1].toLowerCase() };

  return null;
}
