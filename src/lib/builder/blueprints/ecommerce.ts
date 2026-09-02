import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A storefront.
 *
 * The failure this one exists to stop is a shop that is really a landing page
 * about a shop: a hero, three "featured products" with no prices, and a button
 * saying Shop Now that goes nowhere. A store is judged on whether you can find
 * a thing, look at it properly, put it in a basket, change your mind, and get
 * to a total that adds up — and none of that is a section, it is behaviour.
 *
 * So the cart maths is spelled out. It is the part a model most reliably fakes,
 * and a subtotal that does not equal the sum of its lines is the tell that the
 * whole thing is scenery. */

export const ecommerce: Blueprint = {
  purpose:
    "A storefront someone can actually shop: find a product, inspect it, put it in a basket, change quantities, and reach a checkout whose total is correct.",

  sections: [
    "Announcement bar — one real offer or shipping threshold, dismissible.",
    "Header — wordmark, category navigation, a search field that filters the catalogue on the page, and a cart button showing a live item count.",
    "Campaign hero — one season, collection or offer, with a specific claim and a button that jumps to the catalogue. One band, not three.",
    "Category tiles — four to six categories, each drawn with inline SVG or a CSS treatment, each filtering the grid below.",
    "Product grid — the catalogue, and the centre of the page. Every product written into the HTML: name, one line of what it is, a real price with a currency symbol, a rating with a review count, an inline-SVG or CSS product image, a stock or shipping note, and an add-to-cart button. Vary the products properly — different prices, some on sale with the old price struck through, one or two sold out.",
    "Product detail — a dialog or panel, opened from any card, holding a larger image, the full description, materials or specification, a variant picker (size, colour, or the brief's equivalent) that changes the price where it should, a quantity stepper, delivery and returns detail, and add-to-cart.",
    "Cart — a slide-over drawer listing every line with its image, variant, unit price, a working quantity stepper and a remove control; then subtotal, shipping (free above the threshold the announcement bar named), tax, and a total. An empty state that says something useful.",
    "Checkout — a real multi-step flow inside the page: contact, delivery address, shipping method, payment details, each step validating before it advances, with an order summary alongside that stays in step with the cart. It ends on a confirmation screen with an order number, an itemised summary and a delivery estimate.",
    "Trust — shipping, returns and guarantee stated plainly in three short blocks, plus payment marks drawn as inline SVG.",
    "Reviews — four to six real-sounding reviews with names, ratings, dates and a verified-purchase mark.",
    "Footer — shop, help and company columns, a newsletter field that validates, contact details, and policy links pointing at real anchors on the page.",
  ],

  optional: [
    "A 'you may also like' row inside the product dialog.",
    "A size guide or care instructions panel.",
    "A sticky mobile bar carrying the price and add-to-cart.",
  ],

  behaviour: [
    "Add to cart updates the header count and the drawer, and adding the same product twice increments its line rather than adding a second one.",
    "THE MATHS MUST BE RIGHT. Subtotal is the sum of quantity times unit price over every line. Shipping follows the stated rule. Tax is a stated percentage of the subtotal. Total is the sum of the three, and every one of those numbers changes the moment a quantity does.",
    "Removing the last line returns the drawer to its empty state, and checkout refuses to start from an empty cart.",
    "Search and category filters act on products already in the markup — hide and show, never build.",
    "Every form field validates specifically: an email shape, a card number's length, a postcode that is not blank, with the error next to the field rather than in an alert.",
    "Nothing posts anywhere. Payment is a demonstration and the page says so once, quietly, near the pay button.",
  ],

  excludes: [
    "No sign-in wall in front of the shop, no account dashboard, no admin or inventory back office. A guest can do everything.",
    "No blog index or article archive.",
    "Not a landing page with a Shop Now button and nothing behind it. If there is no catalogue you can add to a basket, this is not a store.",
    "No external image URLs and no invented CDN links for product photos.",
  ],

  depth: [
    "At least eight products in the grid, all of them in the HTML. Twelve is better if the document can carry them.",
    "At least three distinct categories that actually filter.",
    "At least four reviews.",
    "Prices that look like a real price list — varied, ending sensibly, in one currency, consistent everywhere the same product appears.",
    "If the brief names WordPress or WooCommerce, keep this structure and use that vocabulary in the copy and the section names: shop page, product archive, single product, cart, checkout, my account.",
  ],
};
