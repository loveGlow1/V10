import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A logistics company: courier, freight, delivery or shipping.
 *
 * The one thing a visitor to a courier's site came to do is type a tracking
 * number, so the tracking input is in the hero and it WORKS: a number returns
 * the shipment, its status and a timeline of events. Everything else —
 * services, coverage, a quote — is the case for sending the next parcel with
 * them.
 *
 * The public site plus a signed-in area for customers who ship regularly.
 * Shipments, their tracking events and quote requests are the tables in the
 * logistics preset (presets.ts), each owned by a user behind row-level
 * security. */

export const logistics: Blueprint = {
  kind: "logistics",

  identity:
    "The site of a courier, freight, delivery or shipping company: a tracking number gets a shipment's real status and timeline, the services and coverage are clear, and a quote request reaches the company.",

  requirements: [
    "Navigation — the wordmark, links to Track, Services, Coverage, Business and Contact, a 'Log in' link, and 'Get a quote' as the primary button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — the promise in plain words (speed, reach, reliability — at most ten words), and a tracking input front and centre: a field for the tracking number and a Track button. Under it, 'Get a quote' and a line on coverage.",
    "Tracking result — entering a known tracking number shows the shipment: its number, status, origin and destination, estimated delivery, and a vertical timeline of events (picked up, at hub, in transit, out for delivery, delivered) with places and times. An unknown number shows a clear 'not found' with what to check. Seed at least four shipments in different states and print two of their numbers as examples under the field.",
    "Services — four to six services (same-day, express, freight, international, warehousing, last-mile — whatever the brief offers), each with what it is, how fast and who it is for.",
    "Coverage — the cities, states or countries served, as a drawn map or a clear list grouped by region, with delivery times.",
    "How it works — book, collect, track, deliver, in four steps.",
    "Business band — volume pricing, an API or bulk upload, and account management for companies that ship often.",
    "Quote form — origin, destination, package type, weight, dimensions and pickup date, validated inline, with a calculated indicative price that responds to the inputs and a submit that confirms what happens next.",
    "Proof — on-time rate, parcels delivered, and two or three named customer quotes.",
    "Footer — contact, support hours, coverage, terms and a copyright with a real year.",
  ],

  optionalFeatures: [
    "A live-updating 'parcels delivered today' figure from seeded data.",
    "A restricted-items list.",
    "Driver or rider recruitment band, when the brief mentions riders.",
  ],

  depth: {
    minimumSections: 8,
    floors: [
      "At least four seeded shipments in different states, each with a full timeline of events.",
      "The quote's indicative price changes with origin, destination and weight.",
      "Places, times and prices are local to the market.",
    ],
  },

  interactions: [
    "Tracking works: a seeded number shows its shipment and timeline; anything else shows 'not found'.",
    "The quote form validates inline and computes an indicative price as it is filled in.",
    "Every nav link resolves to a section or a page that exists.",
  ],

  conditionalRequirements: [
    {
      when: "the project has accounts (it does by default)",
      require:
        "sign-up, sign-in and sign-out that work, and a signed-in area listing the customer's OWN shipments with status and their quote requests, each shipment opening to its timeline. Tracking by number stays public; a customer's list of shipments does not",
    },
    {
      when: "the brief names maps, a route or live location",
      require: "the route drawn as inline SVG between origin and destination with the current position marked — never an embedded map with an invented API key",
    },
    {
      when: "the brief asks for email or SMS updates",
      require: "a 'Notify me' option on the tracking result declared as sending updates through Resend once connected, pending until then",
    },
  ],

  exclusions: [
    "No cart or product grid.",
    "No fake live GPS and no invented map API keys.",
    "No stock photos of a globe with glowing lines; no gradients or emoji as decoration.",
  ],

  frontendOnlyExclusions: ["No admin back office."],

  admin: {
    identity: "The dispatch console for the people who move the parcels: shipments, their tracking events, and quote requests.",
    requirements: [
      "A shipment list with search by tracking number and filter by status, and a shipment detail where staff add a tracking event (status, place, time, note) that the public tracking result shows immediately.",
      "A quote request inbox with a reply and a status.",
      "Only staff can reach it; a customer who opens /admin is refused.",
    ],
  },

  qualityRules: [
    "Functional and confident: industrial neutrals with one high-visibility accent, comfortable density, hairline borders, tabular figures for numbers and times.",
    "The tracking input is the first thing anyone sees and the thing that works best.",
    "Copy is specific about speed, coverage and price.",
  ],

  completionRules: [
    "Tracking returns a timeline for a seeded number and 'not found' for anything else.",
    "The quote form works from start to success.",
    "Every nav link resolves.",
  ],

  assets: {
    photographs: ["hero", "editorial", "lifestyle"],
    drawn: ["logo", "brand-mark", "icon", "illustration", "avatar", "decorative"],
    note:
      "Real vans, riders, depots and parcels in transit, in daylight. The tracking timeline, the map and the route are drawn in code. Avatars are monograms.",
  },
};
