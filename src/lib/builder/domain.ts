/* The business a project is for — decided from the brief, alongside the kind.
 *
 * The kind says what SHAPE the project is (a store, a web app, a portfolio);
 * the person chooses it. The domain says what BUSINESS it is (real estate,
 * banking, a salon, a freight company), and the brief already says it. They
 * are separate questions, and treating them as one is how every web app came
 * out as the same dashboard: "a portal for my estate agency" and "an app for
 * my bank's customers" are both web apps, and a real-estate customer area
 * (saved properties, viewings, enquiries) has nothing in common with a banking
 * one (accounts, transactions, transfers) except a sidebar.
 *
 * So each domain carries what a designer and a developer who knew that
 * business would bring to it:
 *
 *   dashboard   the navigation of its signed-in area, when it has one — in
 *               its own words, in the order that business works
 *   modules     the parts of the product that business always needs
 *   imagery     what its photographs are, and what they are never
 *   rules       the conventions that, when missing, give a site away as
 *               generated
 *
 * These are handed to the model as a section of the build prompt (domainBrief),
 * beside the design system, and change nothing when no domain is recognised:
 * the blueprint alone decides, exactly as it did before.
 *
 * Pure on purpose, like kinds.ts and design.ts: no SDK import, so it can be
 * compiled and tested on its own (tools/check-domain.mjs). */

import type { BuildKind } from "./kinds";

export type Domain = {
  id: string;
  label: string;
  /** Matched against the brief. Ordered most specific first in DOMAINS. */
  match: RegExp;
  /** The signed-in area's navigation, in this business's words. */
  dashboard: string[];
  /** The parts this business's product always has. */
  modules: string[];
  /** What the photographs are. */
  imagery: string[];
  /** What the photographs never are. */
  avoid: string;
  /** Conventions that give a generated site away when they are missing. */
  rules: string[];
  /* The data this business usually keeps — what the database architect
     starts from (app-schema.ts), as candidates for THIS brief, never a list
     to create whole. */
  data: string[];
};

export const DOMAINS: Domain[] = [
  {
    id: "real-estate",
    label: "Real estate",
    match: /\b(real estate|realtors?|estate agen\w*|propert(y|ies)|homes? for (sale|rent)|apartments? for (sale|rent)|letting agen\w*|rentals? listings?|short[- ]lets?|landlords?|tenants?)\b/i,
    dashboard: ["Overview", "Saved properties", "Viewings", "Recently viewed", "Enquiries", "Profile", "Settings"],
    modules: ["Property listings with search and filters (location, price, bedrooms, type)", "Property detail with gallery, key facts, floor area and location", "Book a viewing", "Enquiry to the agent", "Saved properties"],
    imagery: ["luxury homes and modern architecture", "interiors in daylight", "property exteriors", "neighbourhood and lifestyle"],
    avoid: "never keys in a hand, miniature houses or handshake stock",
    rules: ["Prices with currency and period (per month / sale) on every card.", "Every listing card shows bedrooms, bathrooms and area the same way."],
    data: ["properties (title, price numeric, listing type sale/rent, bedrooms, bathrooms, area, address, status)", "property_images (property, storage path, position)", "agents", "favorites (user, property — unique together)", "inquiries (property, sender, message, status)", "viewings (property, user, scheduled_at, status)", "saved_searches (user, criteria)"],
  },
  {
    id: "banking",
    label: "Banking and finance",
    match: /\b(bank(ing)?|neobank|digital wallet|wallets?|payments? app|money transfer|remittance|loans?|lending|savings|microfinance|credit union|investments?|trading|brokerage|wealth management)\b/i,
    dashboard: ["Overview", "Accounts", "Transactions", "Transfers", "Cards", "Statements", "Settings"],
    modules: ["Account overview with balances", "Transaction history with search and filters", "Transfers and payments through secure server-side logic", "Cards", "Statements", "Security and verification"],
    imagery: ["product interface screenshots", "professional financial illustration", "calm abstract imagery", "real customers in everyday settings"],
    avoid: "never piles of coins, gold bars, handshakes or skyline stock",
    rules: ["Every amount uses the same currency format and tabular figures.", "A demonstration or simulated transaction is labelled as one; nothing implies money really moved."],
    data: ["accounts (owner, type, currency, balance numeric — changed only by server-side logic)", "transactions (account, amount numeric, direction, status, reference, posted_at)", "transfers (from account, to account, amount numeric, status)", "cards (account, last4, status — never full numbers)", "statements (account, period, storage path)"],
  },
  {
    id: "logistics",
    label: "Logistics and delivery",
    match: /\b(logistics|freight|shipping|shipments?|cargo|haulage|trucking|couriers?|delivery company|dispatch|fleet|warehous\w*|supply chain|last[- ]mile)\b/i,
    dashboard: ["Overview", "Shipments", "Tracking", "Deliveries", "Quotes", "Shipment history", "Settings"],
    modules: ["Shipment tracking by tracking number, prominent on the home page", "Shipment status timeline", "Request a quote", "Services and coverage", "Customer shipment history"],
    imagery: ["freight transportation", "warehouses", "shipping containers", "delivery vehicles and crews"],
    avoid: "never a glowing globe, a world map made of dots or a handshake",
    rules: ["Tracking numbers in a consistent monospace format.", "Status names are a fixed set (Booked, Picked up, In transit, Out for delivery, Delivered) used everywhere."],
    data: ["shipments (tracking_number unique, customer, origin, destination, status, eta)", "shipment_events (shipment, status, location, occurred_at)", "quotes (customer, origin, destination, weight, price numeric, status)", "addresses (owner, label, address)"],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    match: /\b(clinics?|hospitals?|medical|dental|dentists?|doctors?|pharmac\w*|physio\w*|healthcare|patients?|telehealth|diagnostics?|therap(y|ist))\b/i,
    dashboard: ["Overview", "Appointments", "Prescriptions", "Results", "Messages", "Profile", "Settings"],
    modules: ["Services and specialists", "Appointment booking", "Patient information and preparation", "Contact and emergency details"],
    imagery: ["real rooms and equipment", "practitioners at work", "calm reception spaces"],
    avoid: "never stethoscope stock or models posing in lab coats",
    rules: ["No medical claims the brief does not supply.", "Emergency contact information is clear where relevant."],
    data: ["patients or profiles", "practitioners", "services (name, duration, price numeric)", "appointments (patient, practitioner, starts_at, status)", "messages"],
  },
  {
    id: "booking",
    label: "Bookings and appointments",
    match: /\b(salons?|barbers?|barbershop|nail (bar|studio)|beauty (salon|studio)|spa|appointments?|bookings?|book a (table|session|class|slot)|reservations?|tutors?|tutoring|consultations?|clinic booking)\b/i,
    dashboard: ["Overview", "Upcoming bookings", "Past bookings", "Services", "Profile", "Settings"],
    modules: ["Services with duration and price", "A working availability calendar with real slots", "Booking that can be made, seen and cancelled", "Staff or practitioner choice where relevant", "Confirmation and reminders"],
    imagery: ["the space itself", "the service being done", "the team at work", "results where appropriate"],
    avoid: "never generic smiling stock models",
    rules: ["Every service shows duration and price.", "A slot that is taken cannot be booked twice."],
    data: ["services (name, duration_minutes, price numeric)", "staff", "availability (staff, weekday, start, end)", "bookings (customer, service, staff, starts_at, status — no double booking)"],
  },
  {
    id: "restaurant",
    label: "Restaurant and food",
    match: /\b(restaurants?|caf[eé]s?|coffee shop|bakery|bakeries|food (delivery|ordering|truck)|takeaway|catering|menus?|chefs?|bistro|eatery|chop bar|bar and grill)\b/i,
    dashboard: ["Overview", "Orders", "Reservations", "Favourites", "Addresses", "Settings"],
    modules: ["Menu with categories, prices and dietary labels", "Online ordering or reservations, as the brief asks", "Opening hours and location", "Order status"],
    imagery: ["food photography", "the dining room", "the chef and kitchen", "guests enjoying the experience"],
    avoid: "never a burger in a studio void or stock cutlery",
    rules: ["Every dish has a price and a one-line description.", "Opening hours and address are visible without hunting."],
    data: ["menu_categories", "menu_items (category, name, price numeric, dietary tags, available)", "orders (customer, status, total numeric)", "order_items (order, menu item, quantity, unit_price numeric)", "reservations (customer, party_size, reserved_at, status)"],
  },
  {
    id: "education",
    label: "Education and courses",
    match: /\b(schools?|academy|courses?|lms|e-?learning|online learning|students?|lessons?|curriculum|bootcamp|training (centre|center|platform)|university|college)\b/i,
    dashboard: ["Overview", "My courses", "Lessons", "Progress", "Certificates", "Profile", "Settings"],
    modules: ["Course catalogue", "Course page with curriculum", "Lesson player with progress", "Enrolment", "Progress tracking"],
    imagery: ["learners at work", "teachers and classrooms", "the subject being taught"],
    avoid: "never graduation-cap clip art",
    rules: ["Every course shows length, level and what you will learn."],
    data: ["courses (title, level, price numeric, published)", "lessons (course, position, content)", "enrollments (user, course — unique together)", "lesson_progress (enrollment, lesson, completed_at)", "certificates"],
  },
  {
    id: "crm",
    label: "CRM and sales",
    match: /\b(crm|sales pipeline|lead management|deal pipeline|client management|customer management|contact management)\b/i,
    dashboard: ["Overview", "Contacts", "Companies", "Deals", "Tasks", "Reports", "Settings"],
    modules: ["Contacts and companies", "Deal pipeline board", "Activities and notes", "Tasks and reminders", "Reports"],
    imagery: [],
    avoid: "no photography inside the app",
    rules: ["Pipeline stages are a fixed, named set.", "Deal values use one currency format."],
    data: ["companies (organization)", "contacts (organization, company)", "deals (organization, contact, stage, value numeric)", "activities (deal or contact, kind, note, due_at)", "tasks (organization, assignee, due_at, status)"],
  },
  {
    id: "project-management",
    label: "Project management",
    match: /\b(project management|task manager|to-?do|kanban|team workspace|issue tracker|sprints?)\b/i,
    dashboard: ["Overview", "Projects", "My tasks", "Board", "Calendar", "Team", "Settings"],
    modules: ["Projects", "Tasks with assignees, due dates and status", "Board and list views", "Comments", "Team"],
    imagery: [],
    avoid: "no photography inside the app",
    rules: ["Task statuses are one fixed set used in every view."],
    data: ["organizations and memberships (role)", "projects (organization)", "tasks (project, assignee, status, due_at, position)", "comments (task, author)"],
  },
  {
    id: "nonprofit",
    label: "Church, NGO and nonprofit",
    match: /\b(church|ministry|mosque|charity|charities|ngo|non-?profit|foundation|donations?|donate|volunteers?|fundrais\w*)\b/i,
    dashboard: ["Overview", "My giving", "Events", "Groups", "Profile", "Settings"],
    modules: ["Mission and programmes", "Donations, one-off and recurring", "Events", "Volunteer sign-up", "Impact and reports"],
    imagery: ["the community and its people", "programmes in action", "gatherings"],
    avoid: "never pity imagery or stock hands holding a heart",
    rules: ["Where money goes is stated plainly.", "Impact figures only as the brief supplies them."],
    data: ["campaigns (title, goal numeric)", "donations (donor, campaign, amount numeric, recurring, status)", "events", "volunteers (user, skills, availability)"],
  },
  {
    id: "events",
    label: "Events and ticketing",
    match: /\b(events?|tickets?|ticketing|concerts?|festivals?|conferences?|summits?|weddings?|rsvp|gala|meetups?)\b/i,
    dashboard: ["Overview", "My tickets", "Upcoming events", "Past events", "Settings"],
    modules: ["Event page with date, venue and lineup", "Ticket types and checkout", "Ticket with QR code", "Schedule"],
    imagery: ["the venue", "crowds and atmosphere", "performers and speakers"],
    avoid: "never confetti stock",
    rules: ["Date, time, venue and price are visible at the top of every event."],
    data: ["events (title, starts_at, venue, capacity)", "ticket_types (event, name, price numeric, quantity)", "orders (buyer, total numeric, status)", "tickets (order, ticket type, code unique, checked_in_at)"],
  },
  {
    id: "fashion",
    label: "Fashion and beauty",
    match: /\b(fashion|clothing|apparel|boutique|streetwear|jewel(le)?ry|accessories|cosmetics|skincare|beauty products?|perfumes?|shoes|sneakers)\b/i,
    dashboard: ["Overview", "Orders", "Wishlist", "Addresses", "Account", "Settings"],
    modules: ["Collections", "Product pages with sizes, colours and fit", "Cart and checkout", "Wishlist", "Size guide"],
    imagery: ["professional product photography", "editorial fashion imagery", "lifestyle photography"],
    avoid: "never mismatched stock models across products",
    rules: ["One consistent product image ratio across the catalogue.", "Sizes and colours are selectable and change the product shown."],
    data: ["products", "product_variants (product, size, colour, sku unique, price numeric, stock)", "product_images", "carts and cart_items", "orders and order_items (unit_price numeric)", "wishlists (user, product — unique together)"],
  },
  {
    id: "saas",
    label: "Software product",
    match: /\b(saas|software product|app for teams|subscription software|developer tools?|ai tool|automation tool|b2b software)\b/i,
    dashboard: ["Overview", "Workspace", "Projects", "Team", "Billing", "Integrations", "Settings"],
    modules: ["Product features shown working", "Pricing plans", "Sign-up and onboarding", "Workspace", "Team and billing"],
    imagery: ["the real product interface", "diagrams drawn in code"],
    avoid: "never robots, glowing brains or circuit-board stock",
    rules: ["Pricing is clear with what each plan includes.", "The product is shown, not described."],
    data: ["organizations (workspaces)", "memberships (organization, user, role — unique together)", "plans", "subscriptions (organization, plan, status, current_period_end)", "usage (organization, metric, quantity, period)", "projects (organization)", "activity_logs (organization, actor, action)", "notifications (user)"],
  },
  {
    id: "retail",
    label: "Retail and online store",
    match: /\b(shop|store|ecommerce|e-commerce|marketplace|products?|furniture|electronics|gadgets?|groceries|supermarket)\b/i,
    dashboard: ["Overview", "Orders", "Wishlist", "Addresses", "Account", "Settings"],
    modules: ["Catalogue with categories and filters", "Product detail", "Cart and checkout", "Customer account and order history", "Order tracking"],
    imagery: ["product photography", "products in use", "lifestyle settings"],
    avoid: "never unrelated stock",
    rules: ["Prices and stock status on every card.", "The cart total adds up, with delivery shown before payment."],
    data: ["categories", "products (category, price numeric, stock, active)", "product_images", "carts and cart_items", "orders (customer, status, total numeric)", "order_items (order, product, quantity, unit_price numeric)", "addresses"],
  },
  {
    id: "construction",
    label: "Construction and trades",
    match: /\b(construction|contractors?|builders?|roofing|plumb\w*|electricians?|renovations?|architects?|interior design|engineering)\b/i,
    dashboard: ["Overview", "Projects", "Quotes", "Invoices", "Documents", "Settings"],
    modules: ["Services", "Completed projects with before and after", "Request a quote", "Areas served", "Certifications"],
    imagery: ["completed projects", "crews and sites at work", "materials and detail"],
    avoid: "never hard-hat stock portraits",
    rules: ["Areas served and how to get a quote are clear."],
    data: ["services", "projects (title, location, before/after images)", "quotes (customer, service, details, status)", "invoices (customer, amount numeric, status)"],
  },
];

/** The business the brief is for, or null when it names none we know. Pure. */
export function detectDomain(brief: string): Domain | null {
  const text = brief ?? "";
  return DOMAINS.find((domain) => domain.match.test(text)) ?? null;
}

/* Kinds with a signed-in area as part of the product: their dashboard is the
   one this domain names. A landing page or a portfolio has none, and is told
   nothing about one — inventing a dashboard is a defect there. */
const HAS_APP: BuildKind[] = ["webapp", "ecommerce", "fintech", "logistics", "saas"];

/** The section of the build prompt that says what this business needs. Pure. */
export function domainBrief(domain: Domain, kind: BuildKind, accounts: boolean): string {
  const lines = [
    `THE BUSINESS — ${domain.label}. Design and build this as the best professional version of a ${domain.label.toLowerCase()} website, not a generic one.`,
    "",
    "WHAT THIS BUSINESS ALWAYS NEEDS (build the ones this brief and this kind of project call for):",
    ...domain.modules.map((module) => `  - ${module}`),
  ];
  if (HAS_APP.includes(kind) && accounts) {
    lines.push(
      "",
      `THE SIGNED-IN AREA — its navigation, in this order and these words: ${domain.dashboard.join(" · ")}.`,
      "  Shaped for this business, not a generic dashboard: its own objects, its own statuses, realistic records, and a designed empty state on every list. Never invent live financial or operational figures.",
    );
  }
  if (domain.imagery.length) {
    lines.push("", `IMAGERY — ${domain.imagery.join("; ")}. ${domain.avoid[0].toUpperCase()}${domain.avoid.slice(1)}. Never the same photograph in two unrelated places.`);
  } else {
    lines.push("", `IMAGERY — ${domain.avoid}.`);
  }
  lines.push("", "CONVENTIONS THAT MATTER HERE:", ...domain.rules.map((rule) => `  - ${rule}`));
  return lines.join("\n");
}

/**
 * What the database architect is told about this business (app-schema.ts):
 * the data it usually keeps, as candidates — the brief decides which apply.
 */
export function dataNeedsBrief(domain: Domain): string {
  return `This is a ${domain.label.toLowerCase()} application. Such applications usually keep — model only the ones this brief needs:\n${domain.data.map((item) => `  - ${item}`).join("\n")}`;
}
