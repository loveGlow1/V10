import type { Blueprint } from "@/lib/builder/blueprints/base";

/* A fintech: a bank, lender, wallet, payments or investment company.
 *
 * Money is trust, so the order of the page is the order of a customer's
 * doubts: what is it, is it safe, what does it cost, how do I start. A
 * generated fintech page fails on the second one — a padlock icon and the word
 * "secure" — so security and compliance are full sections with specifics, and
 * the regulatory line is stated plainly without inventing a licence number.
 *
 * The public site plus a signed-in area that belongs to each customer: their
 * accounts, their transactions, their identity check. Those are the tables in
 * the fintech preset (presets.ts), every one owned by a user and behind
 * row-level security, because one customer seeing another's balance is the
 * worst thing this site can do. */

export const fintech: Blueprint = {
  kind: "fintech",

  identity:
    "The site of a financial company — a bank, lender, wallet, payments or investment product — that earns a customer's trust, explains plainly what it costs, and lets them open an account and see their own money once signed in.",

  requirements: [
    "Navigation — the wordmark, links to Personal or Business (whichever the brief serves), Pricing, Security and Help, a 'Log in' link, and 'Open an account' as the primary button. Sticky, and it collapses to a working menu on a phone.",
    "Hero — the outcome in plain words (at most ten), a subhead naming who it is for and the one number that matters (a rate, a fee, a speed), 'Open an account' and a quieter secondary action, and the product drawn in code: a phone or card showing a balance and recent transactions with real, local amounts.",
    "Trust badges — the regulator or licensing line stated plainly, deposit protection or safeguarding where it applies, customer count or volume processed, and app-store ratings, as a single quiet band. Never an invented licence number.",
    "Feature split — three alternating rows, each pairing one capability (sending money, saving, borrowing, cards, business tools — whatever the brief offers) with a drawn depiction of it and the outcome for the customer.",
    "Security — a full section: how money and data are protected (encryption, two-factor sign-in, card freeze, fraud monitoring, how funds are held), each stated specifically, and what to do if something goes wrong.",
    "Rates and pricing — a clear table of fees and rates, compared against what customers pay elsewhere where that is honest, with a calculator that really computes (interest earned, repayment, or transfer cost) from the user's input.",
    "App download — the app shown on a drawn phone with App Store and Google Play buttons as styled links.",
    "FAQ — at least six questions about safety, fees, eligibility, limits, opening an account and closing one, in <details> elements.",
    "Closing call to action — open an account, with what is needed to do it (ID, a few minutes).",
    "Compliance footer — the company's legal name, the regulatory statement, a risk warning where lending or investing is involved, links to terms, privacy and complaints, and a copyright with a real year.",
  ],

  optionalFeatures: [
    "A business-accounts band, when the brief serves both.",
    "Named press mentions.",
    "A status or uptime line.",
  ],

  depth: {
    minimumSections: 9,
    floors: [
      "Security and compliance are full sections, with specifics — never a padlock and the word 'secure'.",
      "Every amount is in the market's currency and plausible for it.",
      "The calculator computes from what is typed, not from a fixed example.",
      "At least six FAQ entries.",
    ],
  },

  interactions: [
    "Every nav link resolves to a section or a page that exists.",
    "The rates calculator updates as the user types, and refuses input it cannot use with an inline message.",
    "'Open an account' leads to sign-up — never to a fake success.",
    "FAQ items open and close.",
  ],

  conditionalRequirements: [
    {
      when: "the project has accounts (it does by default)",
      require:
        "sign-up, sign-in and sign-out that work, and a signed-in area showing the customer's OWN accounts with balances, their transactions with dates, descriptions, amounts and running balance, and their identity-verification (KYC) status with the step they are on. Every figure is read from the customer's own rows; nothing is shared between customers",
    },
    {
      when: "the brief names Stripe, card payments or taking money in",
      require:
        "the payment control wired to a Stripe socket that names exactly what it would charge, and answers 'Payments connect to a back end that isn't attached yet' until Stripe is connected — never a fake success",
    },
    {
      when: "the brief names Plaid, open banking or linking a bank account",
      require:
        "a 'Link a bank' action declared as an open-banking socket, pending until connected, with what it would read stated plainly",
    },
  ],

  exclusions: [
    "No cart or product grid.",
    "No invented licence or registration numbers, no invented regulator names, and no promise of returns.",
    "No glossy stock photos of cash, gold coins or rising arrows; no gradients or emoji as decoration.",
    "No balance or transaction belonging to one customer visible to another.",
  ],

  frontendOnlyExclusions: ["No admin back office."],

  admin: {
    identity: "The operations console for the people who run the company: customers, their verification, and their activity.",
    requirements: [
      "A customer list with search, status and verification state, and a customer detail showing their accounts and transactions.",
      "A KYC review queue: each submission with its documents and an approve or reject action with a reason, which updates what the customer sees.",
      "Only staff can reach it; a customer who opens /admin is refused.",
    ],
  },

  qualityRules: [
    "Calm and plain. A steady neutral palette with one trustworthy accent, comfortable density, hairline borders, numbers set in tabular figures.",
    "Every claim of safety names the mechanism behind it.",
    "Copy is plain-spoken and free of jargon; fees are never hidden.",
  ],

  completionRules: [
    "Every nav link resolves.",
    "The calculator works.",
    "Where accounts exist, a signed-in customer sees only their own money.",
  ],

  assets: {
    photographs: ["hero", "editorial", "lifestyle"],
    drawn: ["logo", "brand-mark", "icon", "screenshot", "illustration", "avatar", "decorative"],
    note:
      "The product — the card, the phone, the balance — is drawn in code. Photographs are of real customers managing their money in real places, never of cash or coins. Avatars are monograms.",
  },
};
