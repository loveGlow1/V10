import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A portfolio: a person's or an agency's work, and a way to hire them.
 *
 * The work is the page. A portfolio fails when it describes the person and
 * shows a grid of thumbnails with nothing behind them, so the case studies
 * here are real case studies — the brief, what was done, and what changed —
 * and the rest of the page (services, process, testimonials) is evidence that
 * the next project will go as well as these did.
 *
 * Built on the landing family (kinds.ts). Projects and inquiries are its two
 * tables when it has a database — see the portfolio preset in presets.ts. */

export const portfolio: Blueprint = {
  kind: "portfolio",

  identity:
    "A portfolio for a person or an agency: the best work shown large, each piece with the story of what was done and what it achieved, and a clear way to start a project together.",

  requirements: [
    "Navigation — the name or wordmark, links to Work, Services, Process, About and Contact, and a 'Start a project' button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — who this is and what they make, in one confident line (at most twelve words), a short line on who they make it for, and the call to action. Either one signature piece of work shown large, or the statement alone set in large display type.",
    "Case-study grid — six projects, each with a large cover image, the client, the discipline and the year, and a one-line result. A filter by discipline that really filters.",
    "Case-study detail — opening any project shows its full story in place (a dialog or an expanded panel): the brief, the approach, three or more images of the work, and the outcome with a number where there is one.",
    "Services — three to five things they are hired for, each with what is included and who it is for.",
    "Process — four or five numbered stages from first call to launch, with what the client gets at each.",
    "Testimonials — three quotes from named clients with role, company and the project they refer to.",
    "About — the person or team, how they work, and where they are.",
    "Contact — a project inquiry form (name, email, company, budget range, timeline, message) that validates inline and confirms what happens next, plus an email address and, where the brief gives one, a booking link.",
    "Footer — name, socials as text links, location and a copyright line with a real year.",
  ],

  optionalFeatures: [
    "A client logo row set as styled wordmarks.",
    "Awards or press, named specifically.",
    "Availability ('Booking projects from March') stated plainly.",
  ],

  depth: {
    minimumSections: 8,
    floors: [
      "Six case studies, each with its own client, discipline, year and result — never six copies of one card.",
      "Each case study's detail has at least three paragraphs of story and three images.",
      "At least three named testimonials.",
    ],
  },

  interactions: [
    "Every nav link scrolls to a section that exists.",
    "The discipline filter shows and hides case studies, and says when none match.",
    "A case study opens to its full story and closes again, with the keyboard as well as the mouse.",
    "The inquiry form validates inline and shows a success state naming what happens next. It never posts anywhere.",
  ],

  conditionalRequirements: [
    {
      when: "the brief names Cal.com, Calendly or booking a call",
      require: "a 'Book a call' action in the contact section and the hero, linking to the booking page the brief gives, or declared as a socket when it gives none",
    },
    {
      when: "the person is a photographer, illustrator, architect or other visual maker",
      require: "the case-study grid as a full-bleed gallery with a lightbox that steps through the images with the arrow keys, and captions naming the project and year",
    },
    {
      when: "the brief asks for inquiries to be emailed",
      require: "the inquiry form declared as emailing the owner through Resend once connected — every inquiry is still kept today",
    },
  ],

  exclusions: [
    "No cart, checkout or product grid for buying.",
    "No sign-in, accounts or dashboard.",
    "No blog archive on the home page; a 'Writing' link out is the most it may carry.",
    "No invented clients presented as famous brands; clients are plausible and specific to the field.",
  ],

  qualityRules: [
    "The work is the largest thing on the page. Type and layout step back so the images can lead.",
    "A quiet palette, square or barely-rounded corners, generous space, hairline rules rather than shadows.",
    "Each case study reads as a different project: different client, problem and result.",
    "Copy is in the first person (or 'we' for an agency) and specific about the craft.",
  ],

  completionRules: [
    "Every nav link resolves to a section that exists.",
    "Every case study opens to a full story.",
    "The inquiry form works from start to success.",
  ],

  assets: {
    photographs: ["hero", "gallery", "portrait"],
    drawn: ["logo", "icon", "avatar", "decorative"],
    note:
      "The case-study covers ARE the work, so they are the pictures that matter — one consistent treatment across all of them, shot large. One portrait of the person or team. Testimonial avatars are monograms.",
  },
};
