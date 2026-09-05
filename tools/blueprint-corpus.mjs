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
  /* Relabelled when `news` became a kind. It was blog because blog was the
     only publishing kind there was, and a brief that says "news site" in as
     many words is the clearest case the new kind has. */
  ["news site for local politics", "news"],
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

/* The ladder, exercised rung by rung. Each of these exists because one rung
   has to beat another: a label beats the subject it is about, machinery beats
   the label, and neither may fire on words that only look like them. */
export const LADDER = [
  // rung 2 — the brief names its kind, and the subject does not overrule it
  ["build me a landing page for my fashion brand", "landing"],
  ["create an ecommerce store for my fashion brand", "ecommerce"],
  ["build a blog about technology", "blog"],
  ["create a web app for managing projects", "webapp"],
  // rung 3 — machinery beats the label
  ["build a landing page with products, a cart and checkout", "ecommerce"],
  ["a landing page where customers log in and see their orders", "webapp"],
  // rung 3 must NOT fire on words that only resemble machinery. A sign-up
  // field and a payment button are on half the landing pages ever built.
  ["a landing page with a sign up form", "landing"],
  ["landing page for a charity with a donate button", "landing"],
  // lightweight products are still web apps — the blueprint decides how much
  // architecture they get, not the router
  ["build me a mortgage repayment calculator", "webapp"],
  ["an AI tool that rewrites emails", "webapp"],
  ["a unit converter for cooking measurements", "webapp"],
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

/* News against blog, which is the only pair in this system that shares a
 * vocabulary. Both publish articles; the corpus above cannot separate them
 * because nothing in it tries.
 *
 * The pairs matter more than the individual briefs. "a blog about politics" and
 * "a news site covering politics" differ by two words and by everything else:
 * one is somebody writing, the other is somebody publishing. If the rules
 * cannot hold that line they will quietly turn every blog into a newsroom, or
 * never build a newsroom at all. */
export const NEWSROOM = [
  // ── news ──────────────────────────────────────────────────────────────────
  ["build a news site for my town", "news"],
  ["a news website covering local politics and business", "news"],
  ["online newspaper with breaking news and categories", "news"],
  ["digital publication, front page with top stories and latest", "news"],
  ["newsroom site — politics, business, sports, entertainment", "news"],
  ["a media outlet for tech news with trending stories", "news"],
  ["news portal with headlines, live updates and a newsdesk", "news"],

  // ── blog, and none of these may be read as news ───────────────────────────
  ["a blog about politics", "blog"],
  ["personal blog where I write essays about cities", "blog"],
  ["company blog with tutorials and guides", "blog"],
  ["a writing site for long-form pieces on architecture", "blog"],
];

export const SETS = { corpus: CORPUS, mixed: MIXED, ladder: LADDER, wild: WILD, newsroom: NEWSROOM };

/* Which market a brief is set in — see src/lib/builder/market.ts.
 *
 * Two markets are served, so a default is a decision rather than a fallback.
 * Most of these name no country at all: what identifies a Nigerian brief in
 * practice is a city, a payment processor or a courier, because nobody writes
 * "in Nigeria" when they write "checkout with Paystack".
 *
 * "default" is the expected answer where the brief genuinely names nowhere.
 * Those are not failures — they are the cases the assumption exists for, and
 * counting them is how you tell how often it is load-bearing.
 */
export const MARKETS = [
  // named Nigeria, one way or another
  ["a landing page for my bakery in Lagos", "ng"],
  ["an online store selling ankara fabric with Paystack checkout", "ng"],
  ["build a fintech app for Nigerian SMEs", "ng"],
  ["a store with delivery across Lagos and Abuja", "ng"],
  ["a blog about Nollywood and afrobeats", "ng"],
  ["landing page for a school in Lekki", "ng"],
  ["storefront that takes bank transfer and Flutterwave", "ng"],
  ["a logistics app for dispatch riders in Port Harcourt", "ng"],
  ["a landing page for my salon, prices in naira", "ng"],
  ["web app for a pharmacy chain in Ibadan and Enugu", "ng"],

  // named the United States, one way or another
  ["a landing page for a dental clinic in Austin", "us"],
  ["an online store with Stripe checkout and free shipping over $75", "us"],
  ["a SaaS dashboard for restaurants in Chicago", "us"],
  ["landing page for an LLC doing tax prep", "us"],
  ["a store shipping nationwide from Denver, sales tax included", "us"],
  ["blog about high school football in Texas", "us"],

  // named nowhere: the default is doing the work
  ["build me a landing page for my gym", "default"],
  ["an online store for handmade candles", "default"],
  ["a blog about woodworking", "default"],
  ["a task manager with team accounts", "default"],
];
