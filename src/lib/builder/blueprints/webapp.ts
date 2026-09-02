import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A web application: both halves of one.
 *
 * The instruction this file is written to is that a web app is a full front end
 * AND a full back end — not a screenshot of an app, and not a front end that
 * pretends there is something behind it.
 *
 * One HTML file has no server, and no amount of prompting changes that. What it
 * can carry, and what this blueprint requires, is the back end designed rather
 * than implied: every read and write in the interface goes through one data
 * layer that behaves like a real API — asynchronous, validating, failing where
 * a real one would fail — over tables that are declared in one place; and the
 * document ends with the schema and the endpoint list written out, so what the
 * preview demonstrates is a design somebody could go and build.
 *
 * That is the difference between an app and a mockup of one, and it is why the
 * data layer section below is not optional decoration: it is the half of the
 * product the old prompt never produced. */

export const webapp: Blueprint = {
  purpose:
    "A working application in two halves: an interface people sign into and use, and the back end it runs on — a data layer with real tables and a real API surface, declared and used rather than implied.",

  sections: [
    "Data layer — FIRST, at the top of the script, before any interface code. Declare the tables this app needs as ordinary arrays of records with explicit ids, foreign keys, timestamps and enums, seeded with realistic rows. Then one `api` object whose methods are the only way the interface touches data: list with filtering, sorting and pagination; get by id; create; update; delete; plus sign-in, sign-up and sign-out. Every method is async, validates its input, enforces who may do it, and returns either data or a typed error. No interface code reads a table directly.",
    "Authentication — sign-in, sign-up and sign-out that work against that data layer. Validate properly: required fields, a plausible email shape, a minimum password length, a password confirmation on sign-up, and errors shown inline beside the field rather than in an alert. SEED ONE DEMO ACCOUNT AND PRINT ITS EMAIL AND PASSWORD ON THE SIGN-IN SCREEN — a preview nobody can get into is a locked door, and nobody guesses a password you invented.",
    "App shell — a persistent sidebar with the product's real navigation, a top bar with search, notifications and a user menu that signs out, and a content area the views render into. It collapses sensibly on a phone.",
    "Overview — the landing view once signed in. Four KPI tiles with real figures and a period-on-period change, two charts drawn as inline SVG from the seeded data (never a charting library), and a recent-activity feed with names, actions and relative times.",
    "The primary record view — the app's main table: columns that matter for this product, sortable headers, a search field, filters by status or owner, pagination with a real count, per-row actions, and bulk selection with an action on the selection.",
    "Record detail — opened from a row: the record's fields, its status, its history, and any related records, all read through the api layer.",
    "Create and edit — a dialog with a properly labelled form, field-level validation with inline errors, a busy state while the api call is in flight, a success toast, and the table updated from the returned record rather than optimistically faked.",
    "Delete — with a confirmation naming what is being deleted, and an undo affordance.",
    "A second working view specific to this product — a pipeline, a calendar, a queue, a report, whatever this app is actually for — reading the same data through the same api.",
    "Settings — profile, team members with roles, notification preferences, and a danger zone. The forms save through the api and reflect the result.",
    "Empty, loading and error states for every list and every form. An app is judged on these, and a demo never has them.",
    "Back-end appendix — an HTML comment at the end of the document containing the SQL schema (tables, columns, types, primary and foreign keys, indexes, and row-level security policies in Postgres/Supabase form) and the REST endpoint list the api object stands in for, one line each with method, path and what it returns.",
  ],

  optional: [
    "A command palette on ctrl/cmd-K over content already in the page.",
    "A dark-mode toggle.",
    "An onboarding checklist on first sign-in.",
  ],

  behaviour: [
    "Views are sections of the same document, shown and hidden by script. Never navigate away, never use a router, never open a second page.",
    "A protected view must not render until someone is signed in, and signing out must return to the sign-in screen with the session cleared.",
    "Every mutation goes through the api layer and the interface re-renders from what it returns. A row edited in a dialog changes in the table, in the detail panel, and in any KPI derived from it.",
    "The api layer behaves like a network: a short delay, a busy state in the interface while it runs, and at least one path that returns a real error the interface shows properly.",
    "Permissions are enforced in the api layer, not hidden in the interface: a viewer role that cannot delete gets an error from the call, not merely a missing button.",
    "Sorting, filtering, searching and pagination all operate on records the HTML already contains.",
  ],

  excludes: [
    "Not a marketing page for an app. There is no hero, no pricing table and no testimonials; the first screen is sign-in and everything after it is the product.",
    "No cart or checkout unless the brief asks for billing, and then it is a settings screen, not a storefront.",
    "No blog or article archive.",
    "No fetch to any URL, no real network calls, no server to post to. The api layer is the back end.",
    "No storage APIs — the session lives in a variable. Say once, quietly, that data resets when the tab closes.",
  ],

  depth: [
    "At least four working views reachable from the sidebar, all built. A sidebar of six links where four do nothing is the tell.",
    "At least three tables in the data layer, related to each other by id, and at least twenty rows in the main one.",
    "At least eight columns worth having on the primary table.",
    "Seeded data that reads like a real account: varied names, dates spread over months, several statuses, realistic amounts.",
    "The back-end appendix is required, not optional. A build without it is half a product.",
  ],
};
