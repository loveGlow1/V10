import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A news publication.
 *
 * The kind that exists because a blog could not cover it. Both publish
 * articles, and there the resemblance stops — the difference is not subject
 * matter but CADENCE and RANK. A blog is written: pieces are finished, they sit
 * beside each other, and one from March reads the same in September. A
 * publication is published: stories arrive constantly, they are not equal, and
 * which of them matters most changes between one visit and the next.
 *
 * So the front page is the whole product. A blog's home page is a way in to the
 * articles; a newspaper's front page IS the editorial act — the lead, what sits
 * beside it, what is merely listed — and a publication where every story is a
 * card of the same size has not been edited. That is the failure this blueprint
 * exists to prevent, and the one a general "blog" prompt produces every time.
 *
 * The second difference is time. A blog has dates; a publication has clocks. An
 * hour matters, "updated" matters, and a story that broke twenty minutes ago
 * has to say so where a reader sees it before the headline.
 */

export const news: Blueprint = {
  kind: "news",

  identity:
    "A working news publication: a front page that ranks its stories rather than listing them, beats to browse, and articles stamped with when they happened and when they last changed.",

  requirements: [
    "A masthead: the publication's name, today's date, and the beats it covers as real navigation. This is a newspaper's identity and it goes at the top.",
    "A FRONT PAGE THAT RANKS. One lead story, given more space, a larger headline and its own image than anything else on the page; two or three secondary stories below or beside it; then a denser list of everything else. Three visual tiers minimum. A grid of equal cards is not a front page.",
    "A latest feed, in reverse chronological order, with a visible time against every entry — 'in the last hour', '3 hours ago', or a clock time. This is the column a reader checks to see what is new.",
    "At least four beats — the sections this publication actually covers — each reachable, each landing on a page with its own lead story and its own list.",
    "At least twelve stories written, spread across the beats, with real headlines, real standfirsts and real bylines. A publication with four stories is a blog.",
    "One full article, opened from the front page: headline, standfirst, byline, published time, the body written out over at least six hundred words, and the related stories under it.",
    "Working search or filtering across the stories, returning real matches from what is actually on the page.",
  ],

  optionalFeatures: [
    "A breaking bar across the top for a developing story, with its own timestamp",
    "A live-updates article: one story carrying a reverse-chronological list of stamped updates",
    "Most-read or trending, ranked and numbered",
    "An author page with that journalist's recent stories",
    "A newsletter sign-up that validates and confirms",
    "An archive by date",
  ],

  depth: {
    minimumSections: 7,
    counts: "front-page regions — masthead, lead, secondaries, latest feed, beat sections, trending, footer",
    floors: [
      "twelve stories minimum, each with a headline, a standfirst, a byline, a beat and a timestamp",
      "four beats minimum, each with at least three stories of its own",
      "one article of six hundred words or more, written in full",
      "every timestamp different, and every one plausible against the others",
    ],
  },

  interactions: [
    "Opening a story from anywhere on the front page reaches that story, not a placeholder.",
    "Choosing a beat filters to that beat's stories and says how many it found.",
    "Search returns real matches and says plainly when it finds none.",
    "Timestamps are computed from real dates rather than written as strings, so 'ago' is honest.",
  ],

  conditionalRequirements: [
    {
      when: "the brief describes breaking, developing or live coverage",
      require:
        "a breaking treatment that is unmistakable — a bar, a flag on the card, a colour used for nothing else — carrying its own 'updated' time, and one story that is genuinely still developing with stamped updates newest first",
    },
    {
      when: "the publication is local, regional or about one place",
      require:
        "the place named throughout — in the masthead, in bylines, in the beats — and stories about that place rather than generic national news with a town's name attached",
    },
    {
      when: "the brief describes an editorial team, or names journalists",
      require:
        "real bylines used consistently, and at least one author page listing that journalist's stories with their beat",
    },
    {
      when: "the brief asks for publishing, drafting, scheduling or an editor's view",
      require:
        "an editorial view behind sign-in: a story list with draft, scheduled, published and archived states, and the actions that move a story between them working end to end",
    },
  ],

  exclusions: [
    "Not a blog. A grid of EQUAL CARDS is the failure: if every story has the same visual weight, nobody edited this, and ranking is the only thing that makes it a publication.",
    "No marketing hero. A publication opens on its lead story, not on a slogan with a button under it.",
    "No pricing, no cart, no checkout. A paywall, if the brief asks for one, is a gate on an article — not a storefront.",
    "Not a dashboard with news in it.",
    "No lorem ipsum, and no headline that says 'Article Title' or 'Breaking News Story'.",
    "No timestamp that says 'now' on every story. A front page where everything broke this minute is a front page nobody edited.",
  ],

  qualityRules: [
    "The lead story is obvious in the first second, without reading a word. That is what ranking means.",
    "Headlines are written as that publication would write them — a specific claim about a specific thing, in the register of the beat.",
    "Standfirsts add to the headline rather than restating it.",
    "Density is correct here in a way it would not be on a blog: a front page carries a lot, and airy spacing reads as an empty publication.",
    "Time is visible everywhere a story appears.",
  ],

  completionRules: [
    "The front page has three distinguishable tiers of importance.",
    "Every beat in the navigation returns its own stories.",
    "The full article is written out, over six hundred words, and its byline and timestamp match everywhere it appears.",
    "No two stories share a headline, an image or a timestamp.",
  ],

  assets: {
    photographs: ["article-cover", "editorial", "portrait"],
    drawn: ["logo", "icon"],
    note:
      "News photography, not stock: the frame taken at the thing, under whatever light was there, with people in it. Every story needs its own — a front page where two stories share a picture is a front page that has run out. Bylines take portraits where the journalist is real and initials where they are not.",
  },
};
