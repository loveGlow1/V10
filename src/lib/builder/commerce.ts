/* What a project does with products, as capabilities rather than as a verdict.
 *
 * `commerce: boolean` was the first attempt and it was too coarse by exactly
 * one distinction too few. It could tell a catalogue from a shop, which fixed
 * the worst case — a furniture showcase being migrated an `orders` table — and
 * it could not tell a shop that takes cards from one that invoices, or a shop
 * with customer accounts from one with guest checkout, or a storefront from a
 * storefront with a back office. Every one of those is a different product,
 * and a boolean answered all of them the same way.
 *
 * ── PRODUCTS ARE NOT COMMERCE ─────────────────────────────────────────────
 *
 * The rule the whole file is built around. A product can simply be content: a
 * furniture maker showing their range, a restaurant showing its menu, a studio
 * showing its work. None of those is a transaction, and reading "products" as
 * "shop" is what put a cart, a checkout, customer accounts and a back office
 * in front of people who wanted a page with their range on it.
 *
 * So every capability below starts false and each one is switched on by
 * something in the brief that needs it — never by the project having products,
 * and never by it being filed under a kind.
 *
 * ── Dependencies are applied, not assumed ─────────────────────────────────
 *
 * A checkout with no cart is a button that charges for nothing; orders with no
 * checkout are rows nothing writes. So a capability brings in what it cannot
 * work without, once, in `withDependencies` — which means the detector below
 * can read each phrase for exactly what it says and stay readable, and the
 * closure is in one place rather than spread through twenty regexes.
 */

/* The capabilities, in the order somebody would meet them: what is shown,
   what is chosen, what is bought, what happens afterwards, and who manages
   it. */
export const COMMERCE_CAPABILITIES = [
  "catalog",
  "productDetails",
  "categories",
  "variants",
  "inventory",
  "cart",
  "wishlist",
  "checkout",
  "payments",
  "orders",
  "customerAccounts",
  "reviews",
  "shipping",
  "coupons",
  "admin",
] as const;

export type CommerceCapability = (typeof COMMERCE_CAPABILITIES)[number];

export type Commerce = { enabled: boolean } & Record<CommerceCapability, boolean>;

/** Nothing on. What every project starts as, and what most of them stay. */
export function noCommerce(): Commerce {
  const commerce = { enabled: false } as Commerce;
  for (const capability of COMMERCE_CAPABILITIES) commerce[capability] = false;
  return commerce;
}

/** What each one is called where a person reads it. */
export const CAPABILITY_LABEL: Record<CommerceCapability, string> = {
  catalog: "Catalogue",
  productDetails: "Product pages",
  categories: "Categories",
  variants: "Variants",
  inventory: "Inventory",
  cart: "Cart",
  wishlist: "Wishlist",
  checkout: "Checkout",
  payments: "Payments",
  orders: "Orders",
  customerAccounts: "Customer accounts",
  reviews: "Reviews",
  shipping: "Shipping",
  coupons: "Discount codes",
  admin: "Product management",
};

/* ── What the words mean ──────────────────────────────────────────────────
 *
 * One entry per capability, and each pattern is a thing somebody writes rather
 * than a synonym of the capability's own name. "Checkout" is in the checkout
 * list because people do write it; so is "buy", "purchase" and "pay for",
 * because far more of them write that instead.
 *
 * Deliberately NOT here: "products" on its own, anywhere but `catalog`. The
 * word products is the subject of the sentence in every one of these briefs
 * and it tells you nothing about which of them this is. */
const SIGNALS: Record<CommerceCapability, RegExp[]> = {
  catalog: [
    /\b(products?|catalog(?:ue)?|range|collection|merchandise|our (?:items|goods|wares)|menu|lookbook)\b/i,
    /\b(showcas\w+|display\w*|featur\w+|list\w*)\b[^.]{0,24}\b(products?|items?|range|work|pieces)\b/i,
  ],
  productDetails: [
    /\b(product (?:page|detail|details)|item page|individual products?|each product)\b/i,
    /\b(browse|view|look at|see|read about)\b[^.]{0,24}\b(products?|items?|each one)\b/i,
  ],
  categories: [
    /\b(categor(?:y|ies)|collections?|departments?|product types?|filter by|browse by)\b/i,
  ],
  variants: [
    /\b(variants?|sizes?|colou?rs? (?:and|or) sizes?|options?|different (?:sizes?|colou?rs?)|sku)\b/i,
  ],
  inventory: [
    /\b(inventory|stock(?:\s+(?:levels?|control|count))?|track(?:ing)? stock|in stock|out of stock|back ?order)\b/i,
  ],
  cart: [
    /\b(cart|basket|bag|add to (?:cart|basket|bag))\b/i,
  ],
  wishlist: [
    /\b(wish ?list|saved (?:items?|products?)|save (?:products?|items?) for later|favou?rites?)\b/i,
  ],
  checkout: [
    /\b(check ?out|buy|purchase|order online|place an order|pay for)\b/i,
  ],
  payments: [
    /\b(payments?|pay (?:online|by card|with)|card payments?|stripe|paypal|paystack|flutterwave|take money)\b/i,
    /* Buying is paying. "Customers can add products to a cart and buy them"
       describes a shop that takes money and never uses the word — and a
       checkout with payments switched off is a button that completes an order
       nobody was charged for. */
    /\b(buy|purchase|pay for)\b/i,
  ],
  orders: [
    /\b(orders?|order history|order confirmation|receipts?|invoices?)\b/i,
  ],
  customerAccounts: [
    /\b(customer accounts?|customers? (?:can )?(?:log|sign) ?in|shopper accounts?|their (?:orders?|account|profile))\b/i,
  ],
  reviews: [
    /\b(reviews?|ratings?|stars?|testimonials? on products?|customer feedback)\b/i,
  ],
  shipping: [
    /\b(shipping|delivery|postage|deliver\w*|calculate (?:delivery|shipping))\b/i,
  ],
  coupons: [
    /\b(coupons?|discount codes?|promo codes?|vouchers?|promotions?)\b/i,
  ],
  admin: [
    /* "add products" is the merchant stocking the shop — and "add products TO
       A CART" is a customer shopping, which is the commonest sentence in any
       store brief. The first version matched both and gave every online store
       a back office nobody asked for. The negative lookahead is what tells
       them apart, and it has to come before the noun rather than after it. */
    /\b(manage|manag\w+|add|edit|upload|remove|delete)\b[^.]{0,20}\b(products?|inventory|stock|orders?|catalog(?:ue)?|customers?)\b(?![^.]{0,12}\b(?:to|into)\b[^.]{0,12}\b(?:cart|basket|bag|wish ?list)\b)/i,
    /\b(admin|back ?office|dashboard)\b[^.]{0,28}\b(products?|inventory|stock|orders?|catalog(?:ue)?|customers?)\b/i,
    /\b(products?|inventory|orders?)\b[^.]{0,24}\b(from (?:an? )?admin|in the admin|back ?office)\b/i,
  ],
};

/* ── A SHOP, NAMED AS ONE ────────────────────────────────────────────────
 *
 * The other half of the hard rule. "Product website", "product showcase" and
 * "product catalogue" must never be read as a store — but "online store" IS
 * one, and a shop with no way to buy anything is a picture of a shop.
 *
 * "Build me an online store for handmade candles" names no capability at all:
 * no cart, no checkout, no payment, no order. Read capability by capability it
 * comes back as a catalogue, which is the over-correction — the person asked
 * for a store in the first three words.
 *
 * So the nouns that only ever mean selling bring the selling capabilities, and
 * the dependency chain fills in the rest. Deliberately short, and deliberately
 * without "shop" on its own: `\bshop\b` matches inside "barber shop", which is
 * the false positive kinds.ts has its own long note about. */
const SELLS = [
  /\b(online (?:store|shop)|e[- ]?commerce|web ?shop|storefront)\b/i,
  /\b(sell|selling)\b[^.]{0,20}\b(online|products?|items?|goods)\b/i,
  /\b(customers?|people|visitors?)\b[^.]{0,20}\b(buy|purchase|order)\b/i,
];

/* Somebody declining the transaction, which is the commonest thing a
   product-shaped brief actually says. Held above every signal below: a person
   who writes "no cart" has decided, and a pattern that reads "cart" out of it
   is the builder arguing with them. */
const DECLINED = [
  /\bno (?:cart|basket|checkout|shopping cart|online (?:sales|ordering|payments?)|payments?|orders?|accounts?)\b/i,
  /\bwithout (?:a )?(?:cart|basket|checkout|online (?:sales|ordering)|payments?|accounts?)\b/i,
  /\b(?:not|isn'?t|won'?t be)\s+(?:actually\s+)?(?:selling|taking orders?|an? (?:online )?(?:shop|store))\b/i,
  /\b(?:just|only)\s+(?:a\s+)?(?:catalog(?:ue)?|showcase|gallery|product (?:list|range|display))\b/i,
  /\b(?:browse|display|showcase|catalog(?:ue)?)[- ]only\b/i,
  /\benquir\w+\b[^.]{0,24}\b(?:instead|rather than|to (?:buy|order))\b/i,
];

/* What each capability cannot work without.
 *
 * A checkout with no cart is a button that charges for nothing; orders with no
 * checkout are rows nothing writes; a wishlist with no account has nobody to
 * belong to. Applied transitively below, so naming `shipping` alone brings the
 * whole chain it sits on. */
const REQUIRES: Partial<Record<CommerceCapability, CommerceCapability[]>> = {
  /* A catalogue with no way to look at one thing is a wall of thumbnails.
     The only pairing here that runs downward rather than up, and it is the
     one the spec's own showcase example asks for. */
  catalog: ["productDetails"],
  productDetails: [],
  categories: ["catalog"],
  variants: ["catalog"],
  inventory: ["catalog"],
  cart: ["catalog", "productDetails"],
  wishlist: ["catalog", "customerAccounts"],
  /* A checkout produces an order. Without this a store built from "customers
     can buy them" had a checkout and nowhere for the sale to go. */
  checkout: ["cart", "orders"],
  payments: ["checkout"],
  orders: ["checkout"],
  shipping: ["checkout", "orders"],
  coupons: ["checkout"],
  reviews: ["catalog"],
  admin: ["catalog"],
};

/** Everything the named capabilities cannot work without, added in. */
export function withDependencies(commerce: Commerce): Commerce {
  const out = { ...commerce };

  /* Repeated to a fixed point rather than walked once: shipping needs
     checkout, checkout needs cart, cart needs product pages. The chain is
     short, so a handful of passes settles it and the bound stops a cycle
     somebody adds later from hanging a build. */
  for (let pass = 0; pass < COMMERCE_CAPABILITIES.length; pass += 1) {
    let changed = false;
    for (const capability of COMMERCE_CAPABILITIES) {
      if (!out[capability]) continue;
      for (const needed of REQUIRES[capability] ?? []) {
        if (!out[needed]) {
          out[needed] = true;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  out.enabled = COMMERCE_CAPABILITIES.some((capability) => out[capability]);
  return out;
}

/**
 * The commerce a brief asks for.
 *
 * Reads the words, not the kind. A project filed as ecommerce whose brief only
 * ever showcases gets a catalogue, and a project filed as anything else that
 * describes a cart gets one.
 */
export function decideCommerce(brief: string): { commerce: Commerce; why: string[] } {
  const text = brief ?? "";
  const commerce = noCommerce();
  const why: string[] = [];

  if (text.trim().length === 0) return { commerce, why };

  /* What was turned down, read first. A brief may decline the transaction and
     then describe the catalogue in detail, and the declining is the part that
     decides. */
  const declined = DECLINED.some((pattern) => pattern.test(text));

  for (const capability of COMMERCE_CAPABILITIES) {
    const hit = SIGNALS[capability].map((pattern) => text.match(pattern)).find(Boolean);
    if (!hit) continue;

    /* The transactional half, refused. The catalogue half is untouched: they
       asked for products, they are getting products. */
    if (declined && TRANSACTIONAL.has(capability)) continue;

    commerce[capability] = true;
    why.push(`"${hit[0].toLowerCase()}" — ${CAPABILITY_LABEL[capability].toLowerCase()}`);
  }

  /* A store, named as one. Read after the per-capability pass so an explicit
     "cart" or "checkout" in the same brief has already registered its own
     reason, and skipped entirely when the brief declined the transaction —
     "just the storefront design, no backend" says both, and the declining is
     the half that decides. */
  if (!declined) {
    const shop = SELLS.map((pattern) => text.match(pattern)).find(Boolean);
    if (shop) {
      commerce.catalog = true;
      commerce.cart = true;
      commerce.checkout = true;
      commerce.payments = true;
      why.push(`"${shop[0].toLowerCase()}" is a shop, so there is a cart, a checkout and a way to pay`);
    }
  }

  if (declined && commerce.catalog) {
    why.push("and no cart, checkout, orders or accounts, because the brief says so");
  }

  return { commerce: withDependencies(commerce), why };
}

/* The capabilities that exist only because money or a customer relationship
   does. These are what "no cart" turns off; everything else is the product
   range, which such a brief is asking FOR. */
const TRANSACTIONAL = new Set<CommerceCapability>([
  "cart",
  "wishlist",
  "checkout",
  "payments",
  "orders",
  "customerAccounts",
  "shipping",
  "coupons",
]);

/**
 * Whether these capabilities need somewhere to keep data.
 *
 * NOT the same question as "does it have products". A showcase whose range is
 * written into the page needs no database and must not be given one — that is
 * the rule this answers, and it is why `catalog` is absent from the list
 * below. What needs a database is a thing that CHANGES: an order somebody
 * placed, an account somebody holds, stock that goes down, a product the owner
 * edits without us rebuilding the site.
 */
export function needsDatabase(commerce: Commerce): boolean {
  return (
    commerce.orders ||
    commerce.customerAccounts ||
    commerce.inventory ||
    commerce.wishlist ||
    commerce.reviews ||
    commerce.coupons ||
    commerce.admin
  );
}

/** What the generator is told, when there is anything to tell it. */
export function commerceBrief(commerce: Commerce): string {
  if (!commerce.enabled) return "";

  const on = COMMERCE_CAPABILITIES.filter((capability) => commerce[capability]);
  const off = COMMERCE_CAPABILITIES.filter((capability) => !commerce[capability]);

  return [
    "COMMERCE — what this project does with products.",
    "",
    `HAS: ${on.map((capability) => CAPABILITY_LABEL[capability]).join(", ")}`,
    off.length > 0
      ? `HAS NOT: ${off.map((capability) => CAPABILITY_LABEL[capability]).join(", ")} — do not build these, do not stub them, and do not leave a control pointing at one.`
      : "",
    "",
    on.includes("cart")
      ? "The cart is real: adding changes it, it survives moving between pages, and every figure derived from it is computed from what is in it."
      : "THERE IS NO CART. No 'add to basket' button, no basket icon, no quantity stepper — a product is shown, and the way to act on it is whatever this brief asked for instead.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
