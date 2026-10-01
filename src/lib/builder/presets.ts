/* Ready-made databases for the kinds of website people actually build.
 *
 * dataModelFor knows a store, a blog and a newsroom, because those kinds ARE
 * their tables. Everything else — an estate agency, a salon, a gym, a hotel —
 * was "webapp" or "landing", and got either a schema a model designed on the
 * spot (app-schema.ts) or, when that design failed, nothing but `profiles`.
 * Aurelia Estates is the second case: a property site whose dashboard read
 * `favorites` and `viewing_requests` from a database that had neither.
 *
 * A developer who has built twenty estate-agency sites does not design the
 * twenty-first from nothing. They reach for the schema that works — listings,
 * agents, saved homes, viewing requests, enquiries — and adjust it. That is
 * what this is: a schema per domain, chosen from the brief before any model is
 * asked, written in the same Table shape dataModelFor uses so it goes through
 * the same toSql, the same provisioning and the same type generation.
 *
 * When no preset fits, nothing changes: a web app still has its schema
 * designed by app-schema.ts, and anything the generated code then uses that
 * still is not there is created from its own SQL by authored-sql.ts.
 *
 * ── The security model, the same in every preset ─────────────────────────
 *
 *   CATALOGUE   what the site shows (properties, menu items, classes, jobs):
 *               anybody reads what is published, only the owner writes.
 *   PERSONAL    what belongs to one signed-in person (favourites, bookings,
 *               enrolments): they read and change their own rows, the owner
 *               reads everybody's, nobody reads anybody else's.
 *   SUBMITTED   what a visitor sends (enquiries, sign-ups, donations): anybody
 *               may add one, only the owner reads them.
 *
 * Every policy says why. Every preset needs accounts — the owner signs in to
 * manage it — so choosing one switches authentication on; that is also what
 * creates is_admin(), which the owner policies call. */

import type { BuildKind } from "./kinds";
import type { Column, Policy, Table } from "./schema";

/* ── Columns ──────────────────────────────────────────────────────────────── */

function base(): Column[] {
  return [
    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
    { name: "created_at", type: "timestamptz", default: "now()" },
    { name: "updated_at", type: "timestamptz", default: "now()" },
  ];
}

const owner = (nullable = false): Column => ({
  name: "user_id",
  type: "uuid",
  nullable,
  references: { table: "auth.users", column: "id", onDelete: nullable ? "set null" : "cascade" },
});

const ref = (name: string, table: string, nullable = false): Column => ({
  name,
  type: "uuid",
  nullable,
  references: { table, onDelete: nullable ? "set null" : "cascade" },
});

const text = (name: string, nullable = false): Column => ({ name, type: "text", nullable });
const money = (name: string, nullable = false): Column => ({ name, type: "numeric", nullable, check: `${name} is null or ${name} >= 0` });
const count = (name: string, fallback = "0"): Column => ({ name, type: "integer", default: fallback, check: `${name} >= 0` });
const when = (name: string, nullable = false): Column => ({ name, type: "timestamptz", nullable });
const flag = (name: string, fallback: boolean): Column => ({ name, type: "boolean", default: String(fallback) });
const status = (values: string[], fallback: string): Column => ({
  name: "status",
  type: "text",
  default: `'${fallback}'`,
  check: `status in (${values.map((value) => `'${value}'`).join(", ")})`,
});
const slug = (): Column => ({ name: "slug", type: "text", unique: true });
const published = (): Column => flag("published", true);

/* ── Policies ─────────────────────────────────────────────────────────────── */

const ownerManages = (table: string): Policy => ({
  name: `${table}_owner_all`,
  for: "all",
  to: ["authenticated"],
  using: "is_admin()",
  check: "is_admin()",
  why: "The site owner manages these from the admin; nobody else can add, change or remove one.",
});

const publicReads = (table: string, using = "true"): Policy => ({
  name: `${table}_public_read`,
  for: "select",
  to: ["anon", "authenticated"],
  using,
  why: using === "true" ? "This is on the public site, so anybody may read it." : "Anybody may read what is published; drafts stay with the owner.",
});

/* PERSONAL: one person's rows. */
function personal(table: string, actions: ("insert" | "update" | "delete")[] = ["insert", "update", "delete"]): Policy[] {
  const policies: Policy[] = [
    {
      name: `${table}_read_own`,
      for: "select",
      to: ["authenticated"],
      using: "user_id = auth.uid() or is_admin()",
      why: "A person sees their own rows; the owner sees everybody's to run the business. Nobody sees anybody else's.",
    },
  ];
  if (actions.includes("insert")) {
    policies.push({
      name: `${table}_insert_own`,
      for: "insert",
      to: ["authenticated"],
      check: "user_id = auth.uid()",
      why: "A signed-in person adds rows for themselves only — never in somebody else's name.",
    });
  }
  if (actions.includes("update")) {
    policies.push({
      name: `${table}_update_own`,
      for: "update",
      to: ["authenticated"],
      using: "user_id = auth.uid() or is_admin()",
      check: "user_id = auth.uid() or is_admin()",
      why: "A person may change their own rows, and cannot move one to somebody else; the owner may update any, to confirm or cancel.",
    });
  }
  if (actions.includes("delete")) {
    policies.push({
      name: `${table}_delete_own`,
      for: "delete",
      to: ["authenticated"],
      using: "user_id = auth.uid() or is_admin()",
      why: "A person may remove their own rows; the owner may remove any.",
    });
  }
  return policies;
}

/* SUBMITTED: anybody sends, only the owner reads. */
function submitted(table: string): Policy[] {
  return [
    {
      name: `${table}_anyone_submits`,
      for: "insert",
      to: ["anon", "authenticated"],
      check: "user_id is null or user_id = auth.uid()",
      why: "Anybody may send one, signed in or not — and a signed-in sender can only attach their own account to it.",
    },
    {
      name: `${table}_read_own_or_owner`,
      for: "select",
      to: ["authenticated"],
      using: "user_id = auth.uid() or is_admin()",
      why: "The owner reads every submission; a signed-in sender can see what they sent. Nobody else can read them.",
    },
    {
      name: `${table}_owner_updates`,
      for: "update",
      to: ["authenticated"],
      using: "is_admin()",
      check: "is_admin()",
      why: "Only the owner changes a submission — marking it handled, adding a note.",
    },
    {
      name: `${table}_owner_deletes`,
      for: "delete",
      to: ["authenticated"],
      using: "is_admin()",
      why: "Only the owner removes a submission.",
    },
  ];
}

/* A catalogue: public reads what is published, the owner writes. */
function catalogue(name: string, what: string, columns: Column[], indexes: string[][] = [], publishedColumn = true): Table {
  return {
    name,
    what,
    columns: [...base(), ...columns, ...(publishedColumn ? [published()] : [])],
    indexes: indexes.map((on) => ({ on })),
    policies: [publicReads(name, publishedColumn ? "published or is_admin()" : "true"), ownerManages(name)],
  };
}

/* ── Pieces most presets share ────────────────────────────────────────────── */

const inquiries = (extra: Column[] = []): Table => ({
  name: "contact_inquiries",
  what: "Messages sent through the site's contact and enquiry forms.",
  columns: [
    ...base(),
    owner(true),
    ...extra,
    text("name"),
    text("email"),
    text("phone", true),
    text("message"),
    status(["new", "replied", "closed"], "new"),
  ],
  indexes: [{ on: ["status"] }, { on: ["created_at"] }],
  policies: submitted("contact_inquiries"),
});

const favorites = (target: string, column: string): Table => ({
  name: "favorites",
  what: `What each signed-in person has saved, to come back to.`,
  columns: [...base(), owner(), ref(column, target)],
  indexes: [{ on: ["user_id"] }, { on: [column] }],
  policies: personal("favorites", ["insert", "delete"]),
});

const reviews = (target: string, column: string): Table => ({
  name: "reviews",
  what: "Ratings and reviews left by signed-in customers.",
  columns: [
    ...base(),
    owner(),
    ref(column, target),
    { name: "rating", type: "integer", check: "rating between 1 and 5" },
    text("body", true),
    flag("approved", false),
  ],
  indexes: [{ on: [column] }],
  policies: [
    publicReads("reviews", "approved or user_id = auth.uid() or is_admin()"),
    ...personal("reviews").filter((policy) => policy.for !== "select"),
  ],
});

/* ── The presets ──────────────────────────────────────────────────────────── */

export type Preset = {
  id: string;
  label: string;
  /** What in a brief means this kind of site. */
  says: RegExp;
  /** Every table this kind of site can have. Not all are created: see `optional`. */
  tables: () => Table[];
  /**
   * The modules a site of this kind has only when the brief asks for them, by
   * table name, with the words that ask. Everything else in `tables` is the
   * core: what this kind of site cannot be without. See modulesFor.
   */
  optional?: Record<string, RegExp>;
};

/* ── The words that switch a module on ────────────────────────────────────── */

/* A place of one's own behind a sign-in. A customer dashboard is made of the
   personal modules — saved homes, viewings, recently viewed — so asking for
   one asks for them. */
const MEMBER = /\b(dashboard|my account|accounts?|portal|members?(?:'s)? area|sign[- ]?(?:in|up)|log[- ]?in|register|profiles?)\b/i;
/* "Everything a site like this has." */
const COMPLETE = /\b(full[- ]?(?:featured|stack|web ?app|platform)|production[- ]ready|complete (?:platform|app|site|solution)|all (?:the )?(?:standard |usual )?features|platform)\b/i;
const either = (...patterns: RegExp[]) => new RegExp(patterns.map((pattern) => pattern.source).join("|"), "i");

const CONTACT = /\b(contact|enquir(?:y|ies|e)|inquir(?:y|ies|e)|get in touch|message (?:us|the|an?)|leads?|lead capture|quote requests?|callback)\b/i;
const SAVED = /\b(sav(?:e|ed|ing)|favou?rites?|wish ?lists?|shortlists?|bookmarks?|hearts?)\b/i;
const RECENT = /\b(recently viewed|recent(?:ly)?|viewing history|browsing history)\b/i;
const REVIEWS = /\b(reviews?|ratings?|rated|stars?)\b/i;

const or = (pattern: RegExp) => either(pattern, COMPLETE);
const orMember = (pattern: RegExp) => either(pattern, MEMBER, COMPLETE);

/* Ordered most specific first: the first preset whose words match wins, so
   "hotel bookings" is a hotel before it is an appointment business, and an
   estate agency is not a general directory. */
export const PRESETS: Preset[] = [
  {
    id: "real-estate",
    label: "real estate",
    says: /\b(real[- ]?estate|realty|realtors?|estate agen(?:t|cy|ts)|brokerage|propert(?:y|ies) (?:listings?|for (?:sale|rent)|management|search)|homes? for (?:sale|rent)|apartments? for rent|luxury (?:homes|properties|estates)|\bestates\b)/i,
    tables: () => [
      catalogue("agents", "The people who represent the properties, shown on listings and the team page.", [
        text("full_name"), text("title", true), text("email"), text("phone", true), text("bio", true), text("photo_url", true),
      ], [], false),
      catalogue("locations", "The cities, neighbourhoods and areas properties are grouped by, each with its own page.", [
        text("name"), slug(), text("region", true), text("description", true), text("image_url", true), count("position"),
      ], [], false),
      catalogue("properties", "Every property listed for sale or rent.", [
        text("name"), slug(), text("description"), text("address_line"), text("city"), text("region", true), text("postal_code", true),
        ref("location_id", "locations", true),
        money("price"), { name: "listing_type", type: "text", default: "'sale'", check: "listing_type in ('sale', 'rent')" },
        text("property_type"), count("bedrooms"), count("bathrooms"), count("square_feet"),
        { name: "amenities", type: "jsonb", default: "'[]'::jsonb" }, ref("agent_id", "agents", true),
        { name: "featured", type: "boolean", default: "false" }, count("popularity"),
        status(["available", "under_offer", "sold", "let"], "available"),
      ], [["city"], ["listing_type"], ["price"], ["status"]]),
      {
        name: "property_images",
        what: "The photographs of each property, in order.",
        columns: [...base(), ref("property_id", "properties"), text("url"), text("alt", true), count("position")],
        indexes: [{ on: ["property_id"] }],
        policies: [publicReads("property_images"), ownerManages("property_images")],
      },
      favorites("properties", "property_id"),
      {
        name: "viewing_requests",
        what: "Requests from signed-in people to view a property, and where each one stands.",
        columns: [
          ...base(), owner(), ref("property_id", "properties"), ref("agent_id", "agents", true),
          { name: "preferred_date", type: "text" }, text("preferred_time", true), text("contact_name"), text("contact_email"),
          text("contact_phone", true), text("message", true), status(["pending", "confirmed", "completed", "cancelled"], "pending"),
        ],
        indexes: [{ on: ["user_id"] }, { on: ["property_id"] }, { on: ["status"] }],
        policies: personal("viewing_requests", ["insert", "update"]),
      },
      {
        name: "recently_viewed",
        what: "The properties each signed-in person has opened, most recent first.",
        columns: [...base(), owner(), ref("property_id", "properties"), when("viewed_at")],
        indexes: [{ on: ["user_id"] }],
        policies: personal("recently_viewed"),
      },
      {
        name: "saved_searches",
        what: "Searches a signed-in person saved, to run again or be told about new matches.",
        columns: [
          ...base(), owner(), text("name"), { name: "filters", type: "jsonb", default: "'{}'::jsonb" }, flag("alerts", false),
        ],
        indexes: [{ on: ["user_id"] }],
        policies: personal("saved_searches"),
      },
      inquiries([ref("property_id", "properties", true)]),
    ],
    optional: {
      locations: or(/\b(locations?|neighbou?rhoods?|areas?|districts?|communities|cities|regions?)\b/i),
      favorites: orMember(SAVED),
      saved_searches: orMember(/\b(saved searches|search alerts?|property alerts?|alerts?)\b/i),
      recently_viewed: orMember(RECENT),
      viewing_requests: orMember(/\b(viewings?|book(?:ing)? a (?:viewing|tour|visit)|schedul\w* (?:a )?(?:viewing|tour|visit)|tours?|visits?|appointments?)\b/i),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "hospitality",
    label: "hotel and rentals",
    says: /\b(hotels?|resorts?|inns?|guest ?houses?|b&b|bed (?:and|&) breakfast|vacation rentals?|holiday (?:lets?|rentals?|homes?)|airbnb|lodges?|hostels?|villa rentals?|serviced apartments?|motels?|glamping)\b/i,
    tables: () => [
      catalogue("rooms", "The rooms or units guests can book.", [
        text("name"), slug(), text("description"), count("capacity", "2"), count("beds", "1"), money("nightly_rate"),
        { name: "amenities", type: "jsonb", default: "'[]'::jsonb" }, text("image_url", true),
      ]),
      {
        name: "room_bookings",
        what: "Stays booked by signed-in guests.",
        columns: [
          ...base(), owner(), ref("room_id", "rooms"), { name: "check_in", type: "text" }, { name: "check_out", type: "text" },
          count("guests", "1"), money("total", true), text("notes", true), status(["requested", "confirmed", "cancelled", "completed"], "requested"),
        ],
        indexes: [{ on: ["user_id"] }, { on: ["room_id"] }],
        policies: personal("room_bookings", ["insert", "update"]),
      },
      reviews("rooms", "room_id"),
      inquiries(),
    ],
    optional: {
      reviews: or(REVIEWS),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "tours",
    label: "tours and travel",
    says: /\b(tours?|travel agency|tour operator|safaris?|excursions?|guided (?:trips?|walks?)|itinerar(?:y|ies)|holiday packages?|adventure travel)\b/i,
    tables: () => [
      catalogue("tours", "The tours on offer.", [
        text("name"), slug(), text("description"), text("destination"), count("duration_days", "1"), money("price"),
        count("max_group_size", "12"), text("image_url", true),
      ], [["destination"]]),
      {
        name: "tour_dates",
        what: "When each tour departs, and how many places are left.",
        columns: [...base(), ref("tour_id", "tours"), { name: "starts_on", type: "text" }, count("seats_left")],
        indexes: [{ on: ["tour_id"] }],
        policies: [publicReads("tour_dates"), ownerManages("tour_dates")],
      },
      {
        name: "tour_bookings",
        what: "Places booked on a departure by signed-in travellers.",
        columns: [...base(), owner(), ref("tour_date_id", "tour_dates"), count("travellers", "1"), text("notes", true), status(["requested", "confirmed", "cancelled"], "requested")],
        indexes: [{ on: ["user_id"] }],
        policies: personal("tour_bookings", ["insert", "update"]),
      },
      reviews("tours", "tour_id"),
      inquiries(),
    ],
    optional: {
      reviews: or(REVIEWS),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "fitness",
    label: "gym and studio",
    says: /\b(gyms?|fitness|yoga|pilates|crossfit|martial arts|boxing (?:club|gym)|dance (?:studio|school)|fitness studio|personal train(?:er|ing)|bootcamp classes|spin (?:studio|classes))\b/i,
    tables: () => [
      catalogue("membership_plans", "The memberships people can buy.", [text("name"), text("description", true), money("price"), text("billing_period")], [], false),
      catalogue("trainers", "The instructors and coaches.", [text("full_name"), text("specialty", true), text("bio", true), text("photo_url", true)], [], false),
      catalogue("classes", "The kinds of class on the timetable.", [text("name"), slug(), text("description"), count("duration_minutes", "60"), text("level", true)]),
      {
        name: "class_sessions",
        what: "Each scheduled occurrence of a class, with its spaces.",
        columns: [...base(), ref("class_id", "classes"), ref("trainer_id", "trainers", true), when("starts_at"), count("capacity", "20"), count("booked")],
        indexes: [{ on: ["class_id"] }, { on: ["starts_at"] }],
        policies: [publicReads("class_sessions"), ownerManages("class_sessions")],
      },
      {
        name: "class_bookings",
        what: "Places booked in a session by signed-in members.",
        columns: [...base(), owner(), ref("session_id", "class_sessions"), status(["booked", "attended", "cancelled", "no_show"], "booked")],
        indexes: [{ on: ["user_id"] }, { on: ["session_id"] }],
        policies: personal("class_bookings", ["insert", "update"]),
      },
      {
        name: "memberships",
        what: "Which plan each member is on, and until when.",
        columns: [...base(), owner(), ref("plan_id", "membership_plans"), when("starts_at"), when("ends_at", true), status(["active", "paused", "cancelled", "expired"], "active")],
        indexes: [{ on: ["user_id"] }],
        policies: personal("memberships", ["insert", "update"]),
      },
      inquiries(),
    ],
    optional: {
      memberships: orMember(/\b(memberships?|plans?|subscriptions?|join)\b/i),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "events",
    label: "events and tickets",
    says: /\b(events? (?:platform|site|website|listings?|calendar)|conferences?|summits?|festivals?|concerts?|meetups?|event tickets|ticket sales|ticketing|buy tickets|webinars?|workshops?|expo|trade show|weddings?|galas?)\b/i,
    tables: () => [
      catalogue("events", "Every event, with where and when.", [
        text("name"), slug(), text("description"), text("venue"), text("city", true), when("starts_at"), when("ends_at", true), text("image_url", true),
      ], [["starts_at"]]),
      {
        name: "ticket_types",
        what: "The kinds of ticket for each event and how many remain.",
        columns: [...base(), ref("event_id", "events"), text("name"), money("price"), count("quantity", "100"), count("sold")],
        indexes: [{ on: ["event_id"] }],
        policies: [publicReads("ticket_types"), ownerManages("ticket_types")],
      },
      {
        name: "registrations",
        what: "Tickets and RSVPs taken by signed-in attendees.",
        columns: [...base(), owner(), ref("event_id", "events"), ref("ticket_type_id", "ticket_types", true), count("quantity", "1"), text("attendee_name"), text("attendee_email"), status(["reserved", "confirmed", "cancelled", "checked_in"], "reserved")],
        indexes: [{ on: ["user_id"] }, { on: ["event_id"] }],
        policies: personal("registrations", ["insert", "update"]),
      },
      inquiries(),
    ],
    optional: {
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "restaurant",
    label: "restaurant",
    says: /\b(restaurants?|caf[eé]s?|coffee (?:shop|house)|bistros?|brasserie|bakery|bakeries|pizzerias?|diners?|eatery|catering|food truck|steakhouse|sushi|tapas|wine bar|cocktail bar|food menu|our menu|menu items|table reservations?)\b/i,
    tables: () => [
      catalogue("menu_sections", "How the menu is divided — starters, mains, drinks.", [text("name"), count("position")], [], false),
      catalogue("menu_items", "Every dish and drink on the menu.", [
        ref("section_id", "menu_sections", true), text("name"), text("description", true), money("price"),
        { name: "dietary", type: "jsonb", default: "'[]'::jsonb" }, text("image_url", true), count("position"),
      ], [["section_id"]]),
      {
        name: "reservations",
        what: "Table bookings — from guests with or without an account — and where each one stands.",
        columns: [
          ...base(), owner(true), text("guest_name"), text("guest_email"), text("guest_phone", true), { name: "reserved_for", type: "text" },
          text("time_slot"), count("party_size", "2"), text("notes", true), status(["requested", "confirmed", "seated", "cancelled", "no_show"], "requested"),
        ],
        indexes: [{ on: ["reserved_for"] }, { on: ["status"] }],
        policies: submitted("reservations"),
      },
      inquiries(),
    ],
    optional: {
      reservations: orMember(/\b(reserv\w*|book(?:ing)?s? (?:a )?table|table bookings?|bookings?)\b/i),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "appointments",
    label: "appointments",
    says: /\b(salons?|spas?|barbers?|barbershops?|clinics?|dental|dentists?|doctors?|medical practice|therap(?:y|ist|ists)|physio(?:therapy)?|chiropract\w*|massage|beauty|nail (?:bar|salon|studio)|lash|tattoo|veterinar\w*|vets?|groom(?:ing|er)|lawyers?|law firm|accountants?|consultants?|coach(?:ing)?|tutors?|tutoring|photograph(?:er|y) (?:studio|sessions?)|appointments?|book(?:ing)? (?:a |an )?(?:appointment|session|consultation))\b/i,
    tables: () => [
      catalogue("services", "What clients can book, with how long it takes and what it costs.", [text("name"), slug(), text("description", true), count("duration_minutes", "60"), money("price", true)]),
      catalogue("staff_members", "The people clients can book with.", [text("full_name"), text("role", true), text("bio", true), text("photo_url", true)], [], false),
      {
        name: "business_hours",
        what: "When the business is open, by day of the week.",
        columns: [...base(), { name: "weekday", type: "integer", check: "weekday between 0 and 6" }, text("opens_at"), text("closes_at"), flag("closed", false)],
        policies: [publicReads("business_hours"), ownerManages("business_hours")],
      },
      {
        name: "appointments",
        what: "Appointments booked by signed-in clients, and where each one stands.",
        columns: [
          ...base(), owner(), ref("service_id", "services"), ref("staff_member_id", "staff_members", true), when("starts_at"),
          text("notes", true), status(["requested", "confirmed", "completed", "cancelled", "no_show"], "requested"),
        ],
        indexes: [{ on: ["user_id"] }, { on: ["starts_at"] }],
        policies: personal("appointments", ["insert", "update"]),
      },
      reviews("services", "service_id"),
      inquiries(),
    ],
    optional: {
      reviews: or(REVIEWS),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "courses",
    label: "courses and learning",
    says: /\b(online courses?|(?<!of )courses|academy|e-?learning|lms|learning platform|lessons? platform|curriculum|bootcamp|online school|masterclass(?:es)?|training platform)\b/i,
    tables: () => [
      catalogue("courses", "The courses on offer.", [text("title"), slug(), text("summary"), text("level", true), money("price", true), text("image_url", true)]),
      {
        name: "lessons",
        what: "The lessons inside each course, in order.",
        columns: [...base(), ref("course_id", "courses"), text("title"), text("body", true), text("video_url", true), count("position"), count("duration_minutes")],
        indexes: [{ on: ["course_id"] }],
        policies: [publicReads("lessons"), ownerManages("lessons")],
      },
      {
        name: "enrollments",
        what: "Which signed-in learners are enrolled on which course.",
        columns: [...base(), owner(), ref("course_id", "courses"), status(["active", "completed", "cancelled"], "active")],
        indexes: [{ on: ["user_id"] }, { on: ["course_id"] }],
        policies: personal("enrollments", ["insert", "update"]),
      },
      {
        name: "lesson_progress",
        what: "Which lessons each learner has finished.",
        columns: [...base(), owner(), ref("lesson_id", "lessons"), when("completed_at", true)],
        indexes: [{ on: ["user_id"] }],
        policies: personal("lesson_progress"),
      },
      reviews("courses", "course_id"),
    ],
    optional: {
      lesson_progress: orMember(/\b(progress|track(?:ing)?|complet\w*|resume)\b/i),
      reviews: or(REVIEWS),
    },
  },

  {
    id: "jobs",
    label: "job board",
    says: /\b(job (?:board|site|portal|listings?)|jobs board|careers? (?:site|portal|page)|recruit(?:ment|ing)|hiring platform|vacanc(?:y|ies)|talent (?:platform|marketplace))\b/i,
    tables: () => [
      catalogue("companies", "The employers posting jobs.", [text("name"), slug(), text("description", true), text("website", true), text("logo_url", true)], [], false),
      catalogue("jobs", "Every open position.", [
        ref("company_id", "companies", true), text("title"), slug(), text("description"), text("location"),
        { name: "employment_type", type: "text", default: "'full_time'", check: "employment_type in ('full_time', 'part_time', 'contract', 'internship', 'temporary')" },
        flag("remote", false), money("salary_min", true), money("salary_max", true), when("closes_at", true),
      ], [["company_id"], ["location"]]),
      {
        name: "job_applications",
        what: "Applications sent by signed-in candidates, and where each stands.",
        columns: [...base(), owner(), ref("job_id", "jobs"), text("cover_letter", true), text("resume_url", true), status(["submitted", "reviewing", "interview", "offer", "rejected", "withdrawn"], "submitted")],
        indexes: [{ on: ["user_id"] }, { on: ["job_id"] }],
        policies: personal("job_applications", ["insert", "update"]),
      },
      {
        name: "saved_jobs",
        what: "Jobs each signed-in candidate has saved.",
        columns: [...base(), owner(), ref("job_id", "jobs")],
        indexes: [{ on: ["user_id"] }],
        policies: personal("saved_jobs", ["insert", "delete"]),
      },
    ],
    optional: {
      saved_jobs: orMember(SAVED),
    },
  },

  {
    id: "crm",
    label: "CRM",
    says: /\b(crm|customer relationship|sales pipeline|lead (?:management|tracking)|deal (?:tracking|pipeline)|client management)\b/i,
    tables: () => [
      {
        name: "companies",
        what: "The organisations each user deals with.",
        columns: [...base(), owner(), text("name"), text("website", true), text("industry", true), text("notes", true)],
        indexes: [{ on: ["user_id"] }],
        policies: personal("companies"),
      },
      {
        name: "contacts",
        what: "The people each user deals with.",
        columns: [...base(), owner(), ref("company_id", "companies", true), text("full_name"), text("email", true), text("phone", true), text("title", true), status(["lead", "prospect", "customer", "inactive"], "lead")],
        indexes: [{ on: ["user_id"] }, { on: ["company_id"] }],
        policies: personal("contacts"),
      },
      {
        name: "deals",
        what: "Opportunities moving through each user's pipeline.",
        columns: [...base(), owner(), ref("contact_id", "contacts", true), text("title"), money("value", true), { name: "stage", type: "text", default: "'new'", check: "stage in ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')" }, when("expected_close", true)],
        indexes: [{ on: ["user_id"] }, { on: ["stage"] }],
        policies: personal("deals"),
      },
      {
        name: "activities",
        what: "Calls, emails, meetings and notes against a contact or deal.",
        columns: [...base(), owner(), ref("contact_id", "contacts", true), ref("deal_id", "deals", true), { name: "kind", type: "text", default: "'note'", check: "kind in ('note', 'call', 'email', 'meeting', 'task')" }, text("body"), when("due_at", true), flag("done", false)],
        indexes: [{ on: ["user_id"] }],
        policies: personal("activities"),
      },
    ],
  },

  {
    id: "projects",
    label: "project and task management",
    says: /\b(project management|task (?:manager|management|tracker|app)|to-?do (?:app|list app)|kanban|productivity app|issue tracker|work tracker)\b/i,
    tables: () => [
      {
        name: "projects",
        what: "Each user's projects.",
        columns: [...base(), owner(), text("name"), text("description", true), text("color", true), status(["active", "on_hold", "completed", "archived"], "active")],
        indexes: [{ on: ["user_id"] }],
        policies: personal("projects"),
      },
      {
        name: "tasks",
        what: "The work inside each project.",
        columns: [
          ...base(), owner(), ref("project_id", "projects"), text("title"), text("description", true),
          { name: "priority", type: "text", default: "'medium'", check: "priority in ('low', 'medium', 'high', 'urgent')" },
          status(["todo", "in_progress", "review", "done"], "todo"), when("due_at", true), count("position"),
        ],
        indexes: [{ on: ["user_id"] }, { on: ["project_id"] }, { on: ["status"] }],
        policies: personal("tasks"),
      },
      {
        name: "task_comments",
        what: "Discussion on each task.",
        columns: [...base(), owner(), ref("task_id", "tasks"), text("body")],
        indexes: [{ on: ["task_id"] }],
        policies: personal("task_comments"),
      },
    ],
  },

  {
    id: "nonprofit",
    label: "nonprofit",
    says: /\b(charit(?:y|ies)|non-?profits?|ngos?|charitable foundation|donat(?:e|ions?|ors?)|fundrais\w*|churche?s?|mosques?|ministr(?:y|ies)|volunteers?)\b/i,
    tables: () => [
      catalogue("campaigns", "The causes and appeals people can give to.", [text("title"), slug(), text("story"), money("goal", true), money("raised"), text("image_url", true), when("ends_at", true)]),
      {
        name: "donations",
        what: "Gifts pledged to a campaign — from donors with or without an account.",
        columns: [...base(), owner(true), ref("campaign_id", "campaigns", true), text("donor_name"), text("donor_email"), money("amount"), flag("anonymous", false), text("message", true), status(["pledged", "paid", "refunded"], "pledged")],
        indexes: [{ on: ["campaign_id"] }],
        policies: submitted("donations"),
      },
      {
        name: "volunteer_signups",
        what: "People offering to volunteer.",
        columns: [...base(), owner(true), text("full_name"), text("email"), text("phone", true), text("interests", true), text("availability", true), status(["new", "contacted", "active"], "new")],
        policies: submitted("volunteer_signups"),
      },
      inquiries(),
    ],
    optional: {
      donations: or(/\b(donat\w*|give|giving|gifts?|fundrais\w*|campaigns?|appeals?)\b/i),
      volunteer_signups: or(/\bvolunteer\w*/i),
      contact_inquiries: or(CONTACT),
    },
  },

  {
    id: "directory",
    label: "directory and marketplace",
    says: /\b(directory|marketplace|classifieds|listings? (?:site|platform)|car dealership|dealerships?|vehicles? for sale|cars? for sale|used cars|auto (?:sales|dealer)|rental listings?)\b/i,
    tables: () => [
      catalogue("listings", "Everything listed on the site.", [
        text("title"), slug(), text("description"), text("category", true), text("location", true), money("price", true),
        { name: "attributes", type: "jsonb", default: "'{}'::jsonb" }, text("image_url", true), ref("seller_id", "auth.users", true),
        status(["active", "pending", "sold", "expired"], "active"),
      ], [["category"], ["location"]]),
      {
        name: "listing_images",
        what: "The photographs of each listing, in order.",
        columns: [...base(), ref("listing_id", "listings"), text("url"), text("alt", true), count("position")],
        indexes: [{ on: ["listing_id"] }],
        policies: [publicReads("listing_images"), ownerManages("listing_images")],
      },
      favorites("listings", "listing_id"),
      inquiries([ref("listing_id", "listings", true)]),
      reviews("listings", "listing_id"),
    ],
    optional: {
      favorites: orMember(SAVED),
      contact_inquiries: or(either(CONTACT, /\b(message (?:the )?sellers?|contact (?:the )?sellers?)\b/i)),
      reviews: or(REVIEWS),
    },
  },

  {
    id: "community",
    label: "community forum",
    says: /\b(forums?|community (?:site|platform|board)|discussion board|message board|q&a (?:site|platform))\b/i,
    tables: () => [
      catalogue("topics", "The areas discussion is organised into.", [text("name"), slug(), text("description", true), count("position")], [], false),
      {
        name: "threads",
        what: "Discussions started by signed-in members.",
        columns: [...base(), owner(), ref("topic_id", "topics", true), text("title"), text("body"), flag("pinned", false), flag("locked", false)],
        indexes: [{ on: ["topic_id"] }, { on: ["created_at"] }],
        policies: [publicReads("threads"), ...personal("threads").filter((policy) => policy.for !== "select")],
      },
      {
        name: "replies",
        what: "Replies in each discussion.",
        columns: [...base(), owner(), ref("thread_id", "threads"), text("body")],
        indexes: [{ on: ["thread_id"] }],
        policies: [publicReads("replies"), ...personal("replies").filter((policy) => policy.for !== "select")],
      },
    ],
  },

  {
    id: "business",
    label: "business website",
    /* Never matched from words: it is the fallback for a business or landing
       site that has a database and no more specific match. See presetFor. */
    says: /$^/,
    tables: () => [
      inquiries(),
      {
        name: "newsletter_subscribers",
        what: "People who signed up for updates.",
        columns: [...base(), owner(true), { name: "email", type: "text", unique: true }, text("source", true), flag("confirmed", false)],
        policies: submitted("newsletter_subscribers"),
      },
      {
        name: "waitlist_signups",
        what: "People waiting for launch or early access, in the order they joined.",
        columns: [...base(), owner(true), { name: "email", type: "text", unique: true }, text("full_name", true), text("referral_source", true)],
        indexes: [{ on: ["created_at"] }],
        policies: submitted("waitlist_signups"),
      },
      catalogue("testimonials", "What customers say, shown on the site once approved.", [text("author_name"), text("author_title", true), text("quote"), { name: "rating", type: "integer", nullable: true, check: "rating is null or rating between 1 and 5" }]),
      catalogue("case_studies", "Past work, shown on the site.", [text("title"), slug(), text("client", true), text("summary"), text("body", true), text("image_url", true)]),
    ],
    optional: {
      contact_inquiries: or(either(CONTACT, /\b(forms?|book a call|consultation)\b/i)),
      newsletter_subscribers: or(/\b(newsletter|subscribe|subscribers?|mailing list|email (?:list|updates|signups?)|updates)\b/i),
      waitlist_signups: or(/\b(wait[- ]?list|early access|pre[- ]?launch|launch list|join the list|coming soon|beta (?:access|list|signups?))\b/i),
      testimonials: or(/\b(testimonials?|reviews?|what (?:our )?(?:clients|customers) say)\b/i),
      case_studies: or(/\b(case stud(?:y|ies)|portfolio|our work|past (?:work|projects))\b/i),
    },
  },
];

/**
 * The preset for this project, or null when none fits and the schema should
 * be designed for it instead.
 *
 * Stores, blogs and newsrooms are left alone — their tables are dataModelFor's.
 * A landing or business site with a database and no specific match gets the
 * general business preset; a web app with no match gets a designed schema.
 */
export function presetFor(text: string, kind: BuildKind): Preset | null {
  if (kind === "ecommerce" || kind === "blog" || kind === "news") return null;
  const match = PRESETS.find((preset) => preset.says.test(text));
  if (match) return match;
  return kind === "landing" ? (PRESETS.find((preset) => preset.id === "business") ?? null) : null;
}

export type Modules = {
  /** The tables to create, core first, in the preset's own order. */
  tables: Table[];
  /** The optional modules the brief switched on. */
  chosen: string[];
  /** The optional modules it did not, kept out on purpose. */
  left: string[];
};

/**
 * The modules this brief needs from a preset — never more.
 *
 * The core is always there: an estate agency without properties is not one.
 * Each optional module joins only when the brief asks for it, in its own words
 * or by asking for what it is part of (a dashboard asks for saved homes and
 * viewings; "a complete platform" asks for everything). Then the references
 * are settled: a kept table that cannot exist without a left-out one brings it
 * back, and an optional link to a left-out one is dropped with its index, so
 * no table points at something that was never created.
 *
 * A preset whose modules are all optional (the business site) and a brief
 * that names none of them still asked for a database, and the one thing such
 * a site does with one is take enquiries, so that is what it gets.
 */
export function modulesFor(preset: Preset, text: string): Modules {
  const all = preset.tables();
  const optional = preset.optional ?? {};
  const keep = new Set(
    all.filter((table) => !(table.name in optional) || optional[table.name].test(text)).map((table) => table.name),
  );
  if (keep.size === 0 && all.some((table) => table.name === "contact_inquiries")) keep.add("contact_inquiries");

  const names = new Set(all.map((table) => table.name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const table of all) {
      if (!keep.has(table.name)) continue;
      for (const column of table.columns) {
        const target = column.references?.table;
        if (target && names.has(target) && !keep.has(target) && !column.nullable) {
          keep.add(target);
          changed = true;
        }
      }
    }
  }

  const tables = all
    .filter((table) => keep.has(table.name))
    .map((table) => {
      const dropped = new Set(
        table.columns
          .filter((column) => column.references && names.has(column.references.table) && !keep.has(column.references.table))
          .map((column) => column.name),
      );
      if (dropped.size === 0) return table;
      return {
        ...table,
        columns: table.columns.filter((column) => !dropped.has(column.name)),
        indexes: table.indexes?.filter((index) => !index.on.some((column) => dropped.has(column))),
      };
    });

  return {
    tables,
    chosen: Object.keys(optional).filter((name) => keep.has(name)),
    left: Object.keys(optional).filter((name) => !keep.has(name)),
  };
}

/* ── Publications: what a blog or newsroom adds to its own tables ───────────
 *
 * A blog and a newsroom already have posts, pages, categories, tags and media
 * from dataModelFor, with authors and editors held apart by role. What varies
 * by brief is the rest: public author pages and reader comments. A newsroom
 * has bylines, so its authors are core; a personal blog's are not. */

const authors = (): Table => ({
  name: "authors",
  what: "The public face of each writer — name, bio and photo for bylines and author pages.",
  columns: [
    ...base(),
    { name: "user_id", type: "uuid", nullable: true, unique: true, references: { table: "auth.users", column: "id", onDelete: "set null" } },
    text("display_name"), slug(), text("role_title", true), text("bio", true), text("avatar_url", true),
  ],
  indexes: [{ on: ["user_id"] }],
  policies: [
    publicReads("authors"),
    {
      name: "authors_own_write",
      for: "all",
      to: ["authenticated"],
      using: "is_admin() or (user_id = auth.uid() and is_author())",
      check: "is_admin() or (user_id = auth.uid() and is_author())",
      why: "A writer keeps their own author page up to date; an editor manages everyone's.",
    },
  ],
});

const comments = (): Table => ({
  name: "comments",
  what: "What signed-in readers say under a post, shown unless an editor hides it.",
  columns: [...base(), owner(), ref("post_id", "posts"), ref("parent_id", "comments", true), text("body"), flag("hidden", false)],
  indexes: [{ on: ["post_id"] }, { on: ["user_id"] }],
  policies: [
    publicReads("comments", "(not hidden and exists (select 1 from posts p where p.id = post_id and p.status = 'published')) or user_id = auth.uid() or is_admin()"),
    { name: "comments_insert_own", for: "insert", to: ["authenticated"], check: "user_id = auth.uid() and hidden = false", why: "A reader comments as themselves, and cannot un-hide." },
    { name: "comments_delete_own", for: "delete", to: ["authenticated"], using: "user_id = auth.uid() or is_admin()", why: "A reader may delete their comment; an editor may remove any." },
    { name: "comments_admin_update", for: "update", to: ["authenticated"], using: "is_admin()", check: "is_admin()", why: "Hiding and editing comments is moderation, and that is the editor's." },
  ],
});

const PUBLICATION_MODULES: Record<"blog" | "news", Preset> = {
  blog: {
    id: "blog",
    label: "blog",
    says: /$^/,
    tables: () => [authors(), comments()],
    optional: {
      authors: or(/\b(authors?|writers?|contributors?|bylines?|team|multi[- ]author|guest posts?)\b/i),
      comments: or(/\b(comments?|discussions?|replies|reader (?:feedback|responses?))\b/i),
    },
  },
  news: {
    id: "news",
    label: "newsroom",
    says: /$^/,
    tables: () => [authors(), comments()],
    optional: {
      comments: or(/\b(comments?|discussions?|replies|reader (?:feedback|responses?))\b/i),
    },
  },
};

/**
 * The tables a blog or newsroom adds to dataModelFor's, from its brief. Needs
 * accounts: authors are writers who sign in, and comments are signed readers'.
 */
export function publicationModulesFor(kind: BuildKind, text: string): Modules | null {
  if (kind !== "blog" && kind !== "news") return null;
  const modules = modulesFor(PUBLICATION_MODULES[kind], text);
  return modules.tables.length > 0 || modules.left.length > 0 ? modules : null;
}

/* ── Staff: the people who work in the business ─────────────────────────────
 *
 * An estate agency has agents, a gym trainers, a clinic receptionists. Until
 * now a web app had two kinds of person — a customer and the owner — so an
 * agent who needed to see viewing requests had to be made an owner, and could
 * then delete the catalogue. A staff role sits between: it reads and answers
 * what customers send (their requests, bookings, enquiries) and leaves the
 * catalogue to the owner. Only when the brief has people working in the
 * product; a site its owner runs alone has no staff. */

const STAFF_WORDS =
  /\b(agents?|staff|employees?|team members?|managers?|trainers?|instructors?|teachers?|tutors?|coaches|moderators?|receptionists?|stylists?|therapists?|doctors?|nurses?|guides?|coordinators?|operators?)\b[^.\n]{0,60}\b(log ?in|sign ?in|portal|dashboards?|panel|accounts?|access|manage|respond|handle|confirm|see (?:the|their|all))\b|\b(staff|agent|employee|team|manager|trainer|instructor|moderator|teacher|coach) (?:portal|dashboard|area|panel|login|accounts?|view|roles?)\b|\brole[- ]based\b|\b(?:user )?roles? (?:and|&) permissions\b/i;

const STAFF_ROLE: Record<string, string> = {
  "real-estate": "agent",
  fitness: "trainer",
  courses: "instructor",
  community: "moderator",
  tours: "guide",
};

/** The staff role this brief asks for, or null when nobody works in it but the owner. */
export function staffFor(preset: Preset, text: string): string | null {
  if (preset.id === "business" || preset.id === "crm" || preset.id === "projects") return null;
  return STAFF_WORDS.test(text) ? (STAFF_ROLE[preset.id] ?? "staff") : null;
}

/* Tables staff answer: each holds one person's rows (a user_id) and is not
   public writing like a forum post. Notifications are the exception the other
   way — staff write them for customers but do not read anyone's. */
const isPersonal = (table: Table) =>
  table.columns.some((column) => column.name === "user_id") &&
  table.policies.some((policy) => /user_id = auth\.uid\(\)/.test(`${policy.using ?? ""} ${policy.check ?? ""}`)) &&
  !["threads", "replies", "comments", "reviews", "notifications"].includes(table.name);

/** The model with a staff role: in profiles' allowed roles, and on every table staff answer. */
export function withStaff<M extends { tables: Table[]; staffRole?: string }>(model: M, role: string): M {
  const tables = model.tables.map((table): Table => {
    if (table.name === "profiles") {
      return {
        ...table,
        columns: table.columns.map((column) =>
          column.name === "role" && column.check && !column.check.includes(`'${role}'`)
            ? { ...column, check: column.check.replace(/\)\s*$/, `, '${role}')`) }
            : column,
        ),
        policies: [
          ...table.policies,
          { name: "profiles_staff_read", for: "select", to: ["authenticated"], using: "is_staff()", why: "Staff see who they are answering — a name and contact details on each request." },
        ],
      };
    }
    if (table.name === "notifications") {
      return {
        ...table,
        policies: [
          ...table.policies,
          { name: "notifications_staff_send", for: "insert", to: ["authenticated"], check: "is_staff()", why: "Staff tell a customer when something of theirs changes." },
        ],
      };
    }
    if (!isPersonal(table)) return table;
    return {
      ...table,
      policies: [
        ...table.policies,
        { name: `${table.name}_staff_read`, for: "select", to: ["authenticated"], using: "is_staff()", why: "Staff see every customer's, because answering them is the job." },
        { name: `${table.name}_staff_update`, for: "update", to: ["authenticated"], using: "is_staff()", check: "is_staff()", why: "Staff confirm, reschedule and close them. They cannot delete one, and cannot touch the catalogue." },
      ],
    };
  });
  return { ...model, tables, staffRole: role };
}

/* ── Modules any signed-in web app can have ───────────────────────────────── */

const NOTIFY = /\b(notifications?|notify|notified|alerts?|bell|inbox|reminders?)\b/i;
const UPLOADS = /\b(upload\w*|attach(?:ment|ments|ed)?|documents?|files?|avatars?|profile (?:photos?|pictures?|images?)|resumes?|cvs?)\b/i;

const notifications = (): Table => ({
  name: "notifications",
  what: "Messages to one signed-in person — a viewing confirmed, a booking changed. Shown as a bell with an unread count in the dashboard header and a list in the dashboard; opening one sets read_at. When the owner or staff change the status of something a customer sent, insert a notification for that customer in the same action.",
  columns: [...base(), owner(), text("title"), text("body", true), text("link", true), when("read_at", true)],
  indexes: [{ on: ["user_id", "read_at"] }],
  policies: [
    { name: "notifications_read_own", for: "select", to: ["authenticated"], using: "user_id = auth.uid()", why: "A person reads their own notifications and nobody else's." },
    { name: "notifications_mark_own", for: "update", to: ["authenticated"], using: "user_id = auth.uid()", check: "user_id = auth.uid()", why: "Marking one read is the reader's." },
    { name: "notifications_delete_own", for: "delete", to: ["authenticated"], using: "user_id = auth.uid()", why: "A person may clear their own." },
    { name: "notifications_owner_send", for: "insert", to: ["authenticated"], check: "is_admin()", why: "The owner sends them; a customer cannot write into anyone's inbox." },
  ],
});

/**
 * What a signed-in web app gets on top of its domain's tables, when its brief
 * asks: notifications as a table, uploads as a private bucket. Neither is
 * anybody's default.
 */
export function commonModulesFor(text: string): { tables: Table[]; uploads: boolean } {
  return { tables: NOTIFY.test(text) ? [notifications()] : [], uploads: UPLOADS.test(text) };
}

/** The private bucket each person uploads their own files to. */
export function uploadsBucket(name: string) {
  return {
    name,
    public: false,
    perUser: true,
    what: `Files people upload — avatars, documents. Private: upload to \`\${user.id}/<file name>\` with supabase.storage.from("${name}").upload(...), and show one with createSignedUrl. Only that person and the owner can read it; a path outside their own folder is refused.`,
  };
}
