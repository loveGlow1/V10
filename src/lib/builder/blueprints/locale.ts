import type { Market } from "@/lib/builder/market";

/* Where the generated content is set.
 *
 * Every build has to be set somewhere: a price needs a currency, an address
 * needs a country, a date needs a format, and copy is spelled one way or the
 * other. Nothing used to say which, so the model chose — and chose differently
 * every time. A brief that named no country came back in pounds sterling with a
 * Manchester address, for a business that had never mentioned Britain.
 *
 * Two markets are served, and each gets a block written for it rather than one
 * block with the currency swapped. That distinction is the whole point of this
 * file: what makes a Nigerian page read as Nigerian is bank transfer sitting
 * above card, delivery quoted within Lagos and to other states, a price in six
 * figures without that being expensive, and an RC number in the footer. A US
 * block with ₦ in front of the numbers reads as a translation, which is the
 * thing being avoided.
 *
 * Both blocks open the same way, and that opening matters more than either of
 * them: a brief that names a country, a city or a currency wins outright. The
 * market only decides which default travels with a brief that named nowhere,
 * so nothing here has to enumerate the world to cope with Leeds. */

const OVERRULED = `WHERE THIS IS SET — a default, and the brief overrules it the moment it says otherwise:

- If the brief names a country, a city, a region or a currency, follow it exactly and ignore the rest of this section. "For my bakery in Leeds" is British: pounds, British spelling, a UK address. Do this even when the brief names somewhere neither of the markets below covers.
- Otherwise:`;

const CLOSING = `- Never mix two markets. Dollars beside a postcode, or a Lagos address beside a ZIP code, reads as carelessly assembled — which is exactly the impression this build is trying not to give. Pick one and hold it in every price, address, date, phone number and spelling on the page.`;

const US = `${OVERRULED} the build is American, and consistently so.
  - Prices and every figure in US dollars, written $1,299 and $24.50.
  - American spelling throughout the copy: color, catalog, license, center, organize, fulfillment, analyze, check (not cheque). Spell it this way even where these instructions are written otherwise.
  - Addresses as street, city, two-letter state and ZIP: 1420 Larkin Street, Suite 300, Denver, CO 80204. Real cities in real states.
  - Phone numbers as (415) 555-0142, using the 555-01xx range, which is reserved and cannot ring a real person.
  - Dates as March 4, 2026 or 03/04/2026, and one of those two throughout.
  - US units: miles, pounds, square feet, Fahrenheit.
  - US business vocabulary: sales tax rather than VAT, Inc. or LLC rather than Ltd, EIN rather than a company number, ZIP rather than postcode, cell rather than mobile, "business days" rather than "working days".
  - Where money moves: card first, then Apple Pay and Google Pay; ACH or wire for anything invoiced. Stripe is the plausible processor to name if one is named at all.
${CLOSING}`;

const NG = `${OVERRULED} the build is Nigerian, and consistently so.
  - Prices and every figure in naira, written ₦1,250,000 and ₦4,500 — with the ₦ symbol, thousands separated by commas, and no decimals unless the amount genuinely has kobo in it. Six and seven figure prices are ordinary here; do not shrink a price to look modest, and do not quote a dollar figure alongside unless the brief is about imports or international clients.
  - British spelling throughout the copy: colour, catalogue, licence, centre, organise, analyse, cheque. Spell it this way even though these instructions are written in American English.
  - Addresses as building and street, then area, then city and state: 14 Adeola Odeku Street, Victoria Island, Lagos. Or: Suite 12, Ceddi Plaza, Central Business District, Abuja. Postcodes exist and are not used — leave them off. Real areas in real cities: Lekki, Ikeja, Ikoyi, Yaba, Surulere and Ajah in Lagos; Wuse, Garki, Maitama and Gwarinpa in Abuja; and the equivalents in Port Harcourt, Ibadan, Enugu, Kano and Benin City.
  - Phone numbers in the local format, 0803 123 4567, or +234 803 123 4567 where the audience might be abroad. Nigeria has no reserved range that cannot ring somebody, so keep any number you invent obviously illustrative, and prefer a contact form, a WhatsApp link or an email address wherever a number is not essential.
  - Dates as 4 March 2026 or 04/03/2026 — day first — and one of those two throughout.
  - Metric units: kilometres, kilograms, square metres, Celsius.
  - Nigerian business vocabulary: VAT at 7.5% rather than sales tax, Limited or Ltd with an RC number from CAC, where a US business would carry Inc and an EIN, mobile rather than cell, "working days" rather than "business days", estate rather than subdivision, "dispatch rider" for local delivery.
  - Where money moves — this is the part a translated page always gets wrong. Bank transfer comes FIRST and is the ordinary way people pay: show the account name, a bank and an account number, or a transfer flow. Card is offered but is not the default. Then USSD, and pay-on-delivery for physical goods within a city. Paystack and Flutterwave are the plausible processors to name; Opay, Moniepoint, PalmPay and Kuda are the plausible banks and wallets alongside GTBank, Access, Zenith, UBA and First Bank.
  - Delivery is quoted as within-city and to other states, not as national next-day: same-day or next-day within Lagos, two to four working days to other states, by dispatch rider locally and a courier such as GIG Logistics beyond. Free delivery thresholds are quoted in naira and are generous, because delivery is a real cost here rather than a marketing line.
  - Names, where people are named, should read as Nigerian and not as one ethnic group throughout: Chidinma Okonkwo, Tunde Bakare, Aisha Bello, Emeka Nwosu, Folake Adeyemi, Ibrahim Musa.
  - Write in the register Nigerian businesses actually use with customers: direct, warm and specific. Do not perform local slang the business would not print, and do not write it as though explaining Nigeria to a foreigner.
${CLOSING}`;

const BLOCKS: Record<Market, string> = { us: US, ng: NG };

/** The locale section for one market. */
export function localeFor(market: Market): string {
  return BLOCKS[market];
}
