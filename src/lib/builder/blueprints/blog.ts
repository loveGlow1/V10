import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A publication: a blog, a magazine, a WordPress content site.
 *
 * The one that a generic prompt fails most obviously, because the generic page
 * has a shape — hero, features, pricing — and a publication does not share any
 * of it. What came back for "a blog about woodworking" was a marketing page for
 * a woodworking blog: a hero, three cards headed "Latest posts" with titles and
 * no articles, and a call to action.
 *
 * A publication is judged on whether there is something to read. So the rule
 * that matters most here is the full article: one real piece of writing, of
 * real length, that a person could sit down with. Everything else is the
 * furniture around it.
 *
 * WordPress lives here rather than in a kind of its own. What people mean by a
 * WordPress site is a content site with posts, categories, authors and pages —
 * so this blueprint answers in WordPress's own vocabulary when the brief uses
 * it. A WordPress brief that is really a shop is routed to the store instead;
 * see src/lib/builder/kinds.ts. */

export const blog: Blueprint = {
  purpose:
    "A publication with something to read in it: a front page that ranks its stories, a full article a person can actually read, and the archive around them.",

  sections: [
    "Masthead — the publication's name set as a wordmark with some typographic conviction, a tagline, the primary category navigation, and a search field that filters the articles on the page.",
    "Lead story — one featured article given the space to be one: category, headline, a two-sentence standfirst, author with role, date, reading time, and an inline-SVG or CSS artwork panel.",
    "Article grid — at least six more articles, every one of them written into the HTML with its own category tag, headline, a one- or two-sentence excerpt that is about that article, a named author, a real date and a reading time. Vary the lengths and the categories; do not repeat one card six times with the words changed.",
    "The article itself — a complete, readable piece on the site's subject, laid out properly: a measure of 65 to 75 characters, a clear type scale, a standfirst, subheadings, at least one pull quote, at least one list or figure with a caption, and eight hundred to twelve hundred words of real writing that says something. This is the section the whole page is judged on. It can open in place from any card, or sit below the grid as the current story.",
    "Author card — photo drawn as an SVG monogram, a real name, two sentences of biography, and links that go to anchors on the page.",
    "Category and tag navigation — the site's real sections, each filtering the articles already in the markup, with the count beside each name.",
    "Newsletter — one honest pitch, what you get and how often, an email field that validates in-page and answers with a success state.",
    "Sidebar or an equivalent band — most-read list, an about block, and the archive by month.",
    "Pagination — numbered, with the current page marked; it moves between sets of articles that are already in the HTML.",
    "Footer — sections, about, contact, an RSS link, and a copyright line with a real year.",
  ],

  optional: [
    "A comments thread under the article, with three or four real-sounding comments and a form that validates.",
    "Related articles under the piece.",
    "A dark-mode toggle, if the design earns one.",
  ],

  behaviour: [
    "Category, tag and search all filter articles that are already in the markup — hide and show, never build.",
    "Opening an article from a card shows that article and returns cleanly to the front page. It never navigates away and never uses a router.",
    "The newsletter form validates the email shape and answers in-page.",
    "Reading times are consistent with the length of what they describe.",
  ],

  excludes: [
    "No cart, no basket, no checkout, no product grid, no prices.",
    "No pricing tiers and no SaaS hero. This is not a landing page for a blog; it is the blog.",
    "No sign-in, no dashboard, no admin. If the brief asks to see WordPress admin, show the theme rather than wp-admin.",
    "No article whose body is three sentences. One real piece of writing beats six stubs.",
  ],

  depth: [
    "At least seven articles in total, all in the HTML.",
    "At least four categories that actually filter.",
    "The full article: eight hundred words minimum, written about the brief's actual subject.",
    "Named authors with roles. Dates within the last few months, in one format.",
    "If the brief names WordPress, use its vocabulary and structure — posts, pages, categories, tags, author archive, featured image, excerpt — and name in the footer which template each part would be (index, single, archive, page) so the preview maps onto a real theme.",
  ],
};
