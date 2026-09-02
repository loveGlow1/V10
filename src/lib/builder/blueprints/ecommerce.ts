import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A storefront.
 *
 * The failure this one exists to stop is a shop that is really a landing page
 * about a shop: a hero, three "featured products" with no prices, and a button
 * saying Shop Now that goes nowhere. A store is judged on whether you can find
 * a thing, look at it properly, put it in a basket, change your mind, and reach
 * a total that adds up — and none of that is a section, it is behaviour.
 *
 * So the cart arithmetic is spelled out. It is the part a model most reliably
 * fakes, and a subtotal that does not equal the sum of its lines is the tell
 * that the whole thing is scenery.
 *
 * It is a shopper's storefront, not a merchant's back office. Someone who asks
 * for a store wants the thing their customers see; the admin side is a web app
 * and is built as one when it is what was actually asked for. */

export const ecommerce: Blueprint = {
  kind: "ecommerce",

  identity:
    "A storefront someone can actually shop: find a product, inspect it, put it in a basket, change quantities, and reach a checkout whose total is correct.",

  requirements: [
    "Announcement bar — one real offer or shipping threshold, dismissible.",
    "Header — wordmark, category navigation, a search field that filters the catalog on the page, and a cart button showing a live item count.",
    "Campaign hero — one season, collection or offer, with a specific claim and a button that jumps to the catalog. One band, not three.",
    "Collection views — four to six categories, each drawn with inline SVG or a CSS treatment, each filtering the grid below.",
    "Product listing — the catalog, and the center of the build. Every product written into the HTML: name, one line of what it is, a real price with a currency symbol, a rating with a review count, an inline-SVG or CSS product image, a stock or shipping note, and an add-to-cart button. Vary them properly — different prices, some on sale with the old price struck through, one or two sold out.",
    "Product detail — a dialog or panel opened from any card, holding a larger image, the full description, materials or specification, a variant picker (size, color, or this product's equivalent) that changes the price where it should, a quantity stepper, delivery and returns detail, and add-to-cart.",
    "Cart — a slide-over drawer listing every line with its image, variant, unit price, a working quantity stepper and a remove control; then subtotal, shipping (free above the threshold the announcement bar named), tax, and a total. An empty state that says something useful.",
    "Checkout — a real multi-step flow inside the page: contact, delivery address, shipping method, payment details, each step validating before it advances, with an order summary alongside that stays in step with the cart.",
    "Order confirmation — an order number, an itemised summary, a delivery estimate, and what happens next.",
    "Trust — shipping, returns and guarantee stated plainly, plus payment marks drawn as inline SVG.",
    "Reviews — four to six real-sounding reviews with names, ratings, dates and a verified-purchase mark.",
    "Footer — shop, help and company columns, a newsletter field that validates, contact details, and policy links pointing at real anchors on the page.",
  ],

  optionalFeatures: [
    "A 'you may also like' row inside the product dialog.",
    "A size guide, care instructions or specification tab.",
    "A sticky mobile bar carrying the price and add-to-cart.",
    "A wishlist that holds items in memory.",
  ],

  depth: {
    minimumSections: 10,
    floors: [
      "At least eight meaningful products, all written into the HTML. Twelve is better if the document can carry them.",
      "At least three categories that actually filter.",
      "At least four reviews.",
      "Prices that read like a real price list — varied, ending sensibly, in one currency, and identical wherever the same product appears.",
    ],
  },

  interactions: [
    "Add to cart updates the header count and the drawer, and adding the same product twice increments its line rather than adding a second one.",
    "THE ARITHMETIC MUST BE RIGHT. Subtotal is the sum of quantity times unit price over every line. Shipping follows the stated rule. Tax is a stated percentage of the subtotal. Total is the sum of the three, and every one of those numbers changes the moment a quantity does.",
    "Quantity steppers and remove controls work from both the cart and the product detail.",
    "Removing the last line returns the drawer to its empty state, and checkout refuses to start from an empty cart.",
    "Search and category filters act on products already in the markup — hide and show, never build.",
    "Every checkout field validates specifically: an email shape, a card number's length, a ZIP or postal code that is not blank, with the error beside the field rather than in an alert.",
    "Nothing posts anywhere. Payment is a demonstration, and the build says so once, quietly, near the pay button.",
  ],

  conditionalRequirements: [
    {
      when: "the brief explicitly asks for customer accounts, order history or saved addresses",
      require:
        "a sign-in that works and an account panel showing that customer's orders — as an addition a guest can skip, never a wall in front of the shop",
    },
    {
      when: "the products have meaningful variants — sizes, colors, materials, plans",
      require: "a variant picker that changes price, image and availability, and carries the choice into the cart line",
    },
    {
      when: "the brief names WordPress or WooCommerce",
      require:
        "this same structure in that vocabulary — shop page, product archive, single product, cart, checkout, my account — so the preview maps onto a real store",
    },
    {
      when: "the brief is a service, booking or digital product rather than physical goods",
      require: "delivery and shipping replaced by what that product actually needs — scheduling, access, license terms",
    },
  ],

  exclusions: [
    "No sign-in wall in front of the shop. A guest can browse, add to cart and check out.",
    "No admin dashboard, no inventory back office, no merchant management interface, no order-management tooling. That is a web app, and it is built as one when it is what was asked for.",
    "No blog index or article archive.",
    "Not a landing page with a Shop Now button and nothing behind it. If there is no catalog you can add to a cart, this is not a store.",
    "No external image URLs and no invented CDN links for product photos.",
  ],

  qualityRules: [
    "The catalog reads like one store's range: a coherent set of things, priced coherently, described in one voice.",
    "Product copy says what the thing is and what it is made of, not that it is 'high quality'.",
    "The shopping experience is judged on a phone as well as on a desktop: the drawer, the steppers and the checkout all have to work at 320px.",
    "Sale prices, stock states and ratings are varied and plausible rather than uniform.",
  ],

  completionRules: [
    "A complete purchase can be made end to end: browse, open a product, add it, change the quantity, check out, reach the confirmation.",
    "Every total shown anywhere agrees with the lines it is a total of.",
    "Every category and filter offered returns products.",
  ],

  assets: {
    photographs: ["hero", "product", "lifestyle", "gallery"],
    drawn: ["logo", "icon", "decorative"],
    note:
      "Products are photographed identically — same ground, same light, same framing — because a catalogue where every item was shot differently reads as a marketplace of strangers rather than one shop. Lifestyle frames are the exception and are used sparingly.",
  },
};
