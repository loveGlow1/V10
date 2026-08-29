/** What the app says about work that is on the roadmap but not here yet.

    One copy of it, because the badge on a chip, the row in the agent list and
    the panel that explains it all have to agree — and because when the date
    moves, it moves in one place rather than three. */
export const MOBILE_APPS = {
  label: "Coming soon",
  title: "Mobile apps are coming",
  /* Deliberately a range rather than a date. A range that turns out to be
     right is worth more than a date that slips. */
  window: "6–12 months",
  blurb:
    "Native iOS and Android builds from the same prompt that builds your web app — one description, a real app on both stores.",
  detail:
    "Everything on QuickStark.Ai today builds for the web. Mobile needs its own build pipeline, signing and store review, which is why it is a way out rather than a few weeks.",
} as const;
