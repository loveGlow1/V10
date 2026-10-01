/* Connecting a database from the conversation, as one flow rather than three.
 *
 * "Connect my own database" was a reply chip. Pressing it sent the build, the
 * build ran with no database, and a paragraph told the person to go and find
 * the Database panel — after which the tables only arrived on a SECOND build,
 * and nothing in the conversation ever said the connection had worked.
 *
 * So the chip is an action now:
 *
 *   1. it asks for the connect flow (requestConnect), which the Database panel
 *      picks up whether it is already on screen or opens a moment later;
 *   2. the build it was going to send is parked (parkOwnBuild) instead of sent,
 *      so it runs AGAINST the database rather than before it;
 *   3. when the panel links a project it says so (announceConnected), and the
 *      chat confirms it and sends the parked build.
 *
 * Session storage rather than state, because step 1 can leave the page: signing
 * in to Supabase is a full redirect to supabase.com and back, and a build held
 * only in React would not survive it. Session rather than local because a
 * parked build belongs to this tab and this sitting, not to next week.
 *
 * Every storage call is guarded. A browser that refuses storage still gets the
 * events, which cover everything except the redirect. */

const INTENT_KEY = "qs:connect-intent";
const PARKED_KEY = "qs:pending-own-build";

/** Fired when something asks the Database panel to start connecting. */
export const CONNECT_EVENT = "quickstark:connect-database";
/** Fired by the Database panel once a Supabase project is linked. */
export const CONNECTED_EVENT = "quickstark:database-connected";

export type ParkedBuild = {
  projectId: string;
  text: string;
  kind?: string;
  stack?: "standalone-html" | "nextjs";
  at: number;
};

/* A parked build older than this is somebody who walked away, and sending it
   when they come back tomorrow would spend credits on a decision they may not
   remember making. */
const PARKED_FOR_MS = 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* Storage refused. The in-page events still carry the flow. */
  }
}

/** Ask the Database panel for this project to open on the connect flow. */
export function requestConnect(projectId: string): void {
  write(INTENT_KEY, projectId);
  window.dispatchEvent(new CustomEvent(CONNECT_EVENT, { detail: { projectId } }));
}

/** Whether a connect was asked for this project and not yet acted on. Clears it. */
export function takeConnectIntent(projectId: string): boolean {
  if (read(INTENT_KEY) !== projectId) return false;
  write(INTENT_KEY, null);
  return true;
}

/** Said by the Database panel when a project is linked. */
export function announceConnected(projectId: string, name: string): void {
  write(INTENT_KEY, null);
  window.dispatchEvent(new CustomEvent(CONNECTED_EVENT, { detail: { projectId, name } }));
}

export function parkOwnBuild(build: Omit<ParkedBuild, "at">): void {
  write(PARKED_KEY, JSON.stringify({ ...build, at: Date.now() }));
}

/** The build waiting on this project's database, if there is a fresh one. */
export function parkedBuildFor(projectId: string): ParkedBuild | null {
  const raw = read(PARKED_KEY);
  if (!raw) return null;
  try {
    const parked = JSON.parse(raw) as ParkedBuild;
    if (parked.projectId !== projectId || typeof parked.text !== "string") return null;
    if (Date.now() - parked.at > PARKED_FOR_MS) {
      write(PARKED_KEY, null);
      return null;
    }
    return parked;
  } catch {
    write(PARKED_KEY, null);
    return null;
  }
}

export function clearParkedBuild(): void {
  write(PARKED_KEY, null);
}
