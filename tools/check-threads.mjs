/* Checks that each workspace session is a chat of its own (project_threads):
 * a new visit opens fresh, earlier chats are listed and can be reopened or
 * deleted, everything the server writes lands in the chat being talked in,
 * and the AI remembers only that chat (the app itself carries on).
 *
 *   node tools/check-threads.mjs   (static; the trigger was tested live in a rolled-back transaction) */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
let failed = 0, passed = 0;
const has = (cond, t) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}`); } };

const sql = read("supabase/migrations/20261113160000_project_threads.sql");
has(/create table if not exists public\.project_threads/.test(sql) && /enable row level security/.test(sql) && /auth\.uid\(\) = user_id/.test(sql), "a table of chats, each its owner's alone");
has(/add column if not exists thread_id uuid references public\.project_threads/.test(sql), "every message belongs to a chat");
has(/order by last_message_at desc/.test(sql) && /before insert on public\.project_messages/.test(sql), "a message written without a chat lands in the one being talked in");
has(/'Earlier conversation'/.test(sql), "everything said before chats existed is kept, as one earlier chat");

const pm = read("src/lib/project-messages.ts");
has(["loadThreads", "startThread", "touchThread", "deleteThread", "renameThread"].every((f) => pm.includes(`export async function ${f}`)), "chats can be listed, started, marked current, renamed and deleted");
has(/if \(threadId\) query = query\.eq\("thread_id", threadId\)/.test(pm) && /thread_id: threadId/.test(pm), "a chat is read and written on its own");

const cp = read("src/app/dashboard/components/workspace/ChatPanel.tsx");
has(/project\?\.status === "Building" \? list\[0\]\?\.id \?\? null : null/.test(cp) && /quickstark:thread:/.test(cp), "a new visit opens a fresh chat (a reload keeps this tab's; a running build shows its chat)");
has(/startThread\(projectId, userId, firstText/.test(cp), "a fresh chat is made when its first message is sent, titled by it");
has(/await ensureThread\(text\);\s*\n\s*const reply = await build\(/.test(cp), "the chat is marked current before each request, so the server's replies land in it");
has(/Chats in this project/.test(cp) && /function newChat\(\)/.test(cp) && /async function openChat\(/.test(cp) && /async function removeChat\(/.test(cp), "Chats lists earlier chats to reopen or delete; New chat starts clean");

const br = read("src/app/api/build/route.ts");
has(/from\("project_threads"\)[\s\S]{0,200}order\("last_message_at", \{ ascending: false \}\)/.test(br) && /recentQuery\.eq\("thread_id", currentThread\.id\)/.test(br), "the AI remembers this chat only; the app itself carries on");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
