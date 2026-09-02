import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A publication: a blog, a magazine, a WordPress content site.
 *
 * The kind a generic prompt fails most obviously, because the generic page has
 * a shape — hero, features, pricing — and a publication shares none of it. What
 * came back for "a blog about woodworking" was a marketing page for a
 * woodworking blog: a hero, three cards headed "Latest posts" with titles and
 * no articles, and a call to action.
 *
 * A publication is judged on whether there is something to read. So the rule
 * that matters most is the full article: one real piece of writing, of real
 * length, that a person could sit down with. Everything else is the furniture
 * around it.
 *
 * WordPress-style content management belongs here rather than in a kind of its
 * own — what people mean by a WordPress site is posts, categories, authors and
 * pages. A WordPress brief that is really a shop routes to the store instead;
 * see src/lib/builder/kinds.ts. */

export const blog: Blueprint = {
  kind: "blog",

  identity:
    "A publication with something to read in it: a front page that ranks its stories, at least one full article a person can actually read, and the archive around them.",

  requirements: [
    "Masthead — the publication's name set as a wordmark with some typographic conviction, a tagline, and the primary category navigation.",
    "Lead story — one featured article given the space to be one: category, headline, a two-sentence standfirst, author with role, date, reading time, and an inline-SVG or CSS artwork panel.",
    "Article grid — the rest of the front page. Every card carries its own category tag, headline, a one- or two-sentence excerpt about that article, a named author, a real date and a reading time. Vary the lengths and the categories; never repeat one card with the words changed.",
    "The article itself — a complete, readable piece on the site's subject, laid out properly: a measure of 65 to 75 characters, a clear type scale, a standfirst, subheadings, at least one pull quote, at least one list or captioned figure, and eight hundred words or more of real writing that says something. This is what the whole build is judged on. It can open in place from any card, or sit below the grid as the current story.",
    "Author card — an SVG monogram, a real name, two sentences of biography, and links to anchors on the page.",
    "Category and tag navigation — the publication's real sections, each filtering the articles already in the markup, with a count beside each name.",
    "Related content — three further reads under the article, chosen to make sense beside it.",
    "Newsletter — one honest pitch, what you get and how often, an email field that validates in-page and answers with a success state.",
    "A sidebar or equivalent band — most-read list, an about block, and the archive by month.",
    "Pagination — numbered, with the current page marked, moving between sets of articles already in the HTML.",
    "Footer — sections, about, contact, an RSS link, and a copyright line with a real year.",
  ],

  optionalFeatures: [
    "A search field over the articles in the markup.",
    "A comments thread under the article, with three or four real-sounding comments and a form that validates.",
    "A dark-mode toggle, when the design earns one.",
    "A reading-progress indicator on the article.",
  ],

  depth: {
    minimumSections: 8,
    floors: [
      "At least seven meaningful articles, all in the HTML.",
      "At least four categories that actually filter.",
      "The full article: eight hundred words minimum, written about the brief's actual subject. Not a summary of an article — the article.",
      "Named authors with roles, and dates within the last few months in one format.",
    ],
  },

  interactions: [
    "Category, tag and search all filter articles already in the markup — hide and show, never build.",
    "Opening an article from a card shows that article and returns cleanly to the front page. It never navigates away and never uses a router.",
    "Pagination moves between real sets of articles, and the current page is marked.",
    "The newsletter form validates the email shape and answers in-page.",
    "Reading times are consistent with the length of what they describe.",
  ],

  conditionalRequirements: [
    {
      when: "the brief names WordPress",
      require:
        "WordPress's own vocabulary and structure — posts, pages, categories, tags, author archive, featured image, excerpt — and a footer line naming which template each part would be (index, single, archive, page), so the preview maps onto a real theme",
    },
    {
      when: "the brief names more than one contributor, or an editorial team",
      require: "distinct author voices across the articles, and an author archive that filters to one writer",
    },
    {
      when: "the subject is technical",
      require: "at least one syntax-styled code block inside the full article, and correct code in it",
    },
    {
      when: "the brief is a news or reviews publication",
      require: "the conventions of that form — datelines, standfirsts, scores or verdict boxes — used consistently",
    },
  ],

  exclusions: [
    "No pricing table and no SaaS pricing tiers.",
    "No cart, no basket, no checkout, no product grid meant for buying.",
    "No marketing hero. This is not a landing page for a blog; it is the blog.",
    "No sign-in, no dashboard, no wp-admin. If the brief asks to see WordPress, show the theme.",
    "No article whose body is three sentences. One real piece of writing beats six stubs.",
  ],

  qualityRules: [
    "Editorial hierarchy carries the front page: the lead story is unmistakably the lead, and the grid ranks what follows.",
    "Headlines are written the way that publication would write them — specific, not 'Article about woodworking'.",
    "Typography is the design here. Measure, leading, scale and the space around the text matter more than any decoration.",
    "The excerpts describe their own articles. An excerpt that would fit any of the seven is a placeholder.",
  ],

  completionRules: [
    "The full article is complete, over eight hundred words, and readable end to end.",
    "Every category offered returns articles, and every count beside a category matches what it filters to.",
    "Every author, date and reading time shown is consistent wherever that article appears.",
  ],
};
