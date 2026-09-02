/* Briefs people actually send to a website builder, each labelled with the kind
 * of thing a careful reader would build from it.
 *
 * Three sets, kept apart on purpose. `CORPUS` is what the rules in
 * src/lib/builder/kinds.ts were written against. `MIXED` is the set that
 * matters: briefs carrying signals for two kinds at once, which is where a
 * first-match reader gets it wrong and where the complaint that started all of
 * this came from — "a landing page that is not for e-commerce shouldn't come up
 * when it's just a landing page". `WILD` was written before it was ever run,
 * and used once, to find what the rules did not yet know.
 *
 * A wrong answer fails the run. A deferral does not: a brief the rules decline
 * goes to the model, which is the designed behaviour rather than a miss.
 *
 * Add to these whenever a real brief is built as the wrong kind. A brief that
 * was misread once is the most valuable test there is.
 */

/** Written first; the rules were developed against this set. */
export const CORPUS = [
  // ── landing ──────────────────────────────────────────────────────────────
  ["build me a landing page for my gym", "landing"],
  ["a landing page for a B2B analytics startup", "landing"],
  ["I need a one pager for my consultancy", "landing"],
  ["waitlist page for an app I'm launching in March", "landing"],
  ["coming soon page for a new album", "landing"],
  ["a marketing page for our new pricing", "landing"],
  ["portfolio site for a freelance illustrator", "landing"],
  ["a sales page for my online course", "landing"],
  ["landing page for a dentist in Leeds with a booking enquiry form", "landing"],
  ["make me a lead capture page for a mortgage broker", "landing"],
  ["a page for our wedding venue with photos and enquiries", "landing"],
  ["squeeze page for my newsletter", "landing"],

  // ── ecommerce ────────────────────────────────────────────────────────────
  ["build an online store that sells handmade ceramics", "ecommerce"],
  ["a storefront with a cart and stripe checkout", "ecommerce"],
  ["e-commerce site for a coffee roastery", "ecommerce"],
  ["I want to sell my prints online with a basket and checkout", "ecommerce"],
  ["a shop with a product catalogue and inventory", "ecommerce"],
  ["webshop for skincare products with variants and discount codes", "ecommerce"],
  ["build a shopify style store for trainers", "ecommerce"],
  ["a marketplace for secondhand bikes with checkout", "ecommerce"],
  ["online store with cart, checkout and order history", "ecommerce"],

  // ── blog ─────────────────────────────────────────────────────────────────
  ["build me a blog about woodworking", "blog"],
  ["a wordpress site for my law firm's articles", "blog"],
  ["I need a magazine site about electronic music", "blog"],
  ["a publication with articles and categories", "blog"],
  ["news site for local politics", "blog"],
  ["set up a wordpress blog with categories and tags", "blog"],
  ["an editorial site for long form essays", "blog"],
  ["a content site where I post recipes as articles", "blog"],

  // ── webapp ───────────────────────────────────────────────────────────────
  ["build a task manager with team accounts", "webapp"],
  ["a CRM for a small sales team", "webapp"],
  ["saas dashboard showing my sales numbers", "webapp"],
  ["an internal tool for tracking equipment", "webapp"],
  ["a booking system where clients sign in and manage appointments", "webapp"],
  ["build me an admin panel for our support tickets", "webapp"],
  ["a project management app with users, roles and a database", "webapp"],
  ["full stack app for invoicing", "webapp"],
  ["a portal where our customers log in and see their orders", "webapp"],
  ["helpdesk with ticketing and a dashboard", "webapp"],
];

/** Briefs that carry two kinds at once. This is the set the split exists for. */
export const MIXED = [
  /* Explicitly a landing page, mentioning a shop. The page is ABOUT the shop.
     This is the exact complaint that started the split. */
  ["a landing page for my shopify store", "landing"],
  ["landing page for my online shop", "landing"],
  ["a marketing page for our store's spring collection", "landing"],
  /* Explicitly a landing page, mentioning an app. Still a landing page. */
  ["a landing page for my saas dashboard product", "landing"],
  ["landing page for our project management platform", "landing"],
  /* A landing page that also wants the shopping to work is a store. */
  ["a landing page with a product catalogue, cart and checkout", "ecommerce"],
  /* WordPress plus selling is a store, not a blog. */
  ["a woocommerce shop for my bakery with checkout", "ecommerce"],
  /* A blog on a marketing site is not a blog. */
  ["a landing page for my agency with a blog section", "landing"],
  /* An app that publishes is still an app. */
  ["an app where writers sign in and manage their posts", "webapp"],
  /* A store's back office is an app. */
  ["an admin dashboard for managing store inventory and orders", "webapp"],
];

/** Written before it was run, and used once to find what the rules missed. */
export const WILD = [
  ["something for my restaurant", "landing"],
  ["a site where people book tables and I can see the bookings", "webapp"],
  ["build me a page that explains what we do and gets us calls", "landing"],
  ["I sell candles, I need somewhere people can buy them", "ecommerce"],
  ["a place to publish my weekly essays with an archive", "blog"],
  ["a dashboard for my team with sign in and charts", "webapp"],
  ["landing page, dark, one screen, big headline, email capture", "landing"],
  ["wordpress theme preview for a travel blog", "blog"],
  ["store front for vinyl records, cart and checkout, uk shipping", "ecommerce"],
  ["internal crm, accounts, roles, postgres behind it", "webapp"],
];

export const SETS = { corpus: CORPUS, mixed: MIXED, wild: WILD };
