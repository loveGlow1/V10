/* The handful of facts both legal documents need, in one place.
 *
 * Everything here starts empty on purpose. A policy that goes live still saying
 * "[LEGAL ENTITY NAME]" is worse than no policy at all, so an unfilled value
 * renders as a visible marker on the page and the documents carry a banner
 * saying they are not final. Fill these in and both notices disappear on their
 * own — there is nothing else to remember to remove.
 */

export const LEGAL = {
  /** Registered company name, e.g. "QuickStark Technologies Ltd". */
  entity: "",
  /** Country of registration. */
  country: "",
  /** Registered postal address. */
  address: "",
  /** General contact address for the terms. */
  contactEmail: "",
  /** Where privacy requests go. May be the same address. */
  privacyEmail: "",
  /** Governing law and courts, e.g. "England and Wales". */
  jurisdiction: "",
  /** Shown at the top of both documents, e.g. "1 September 2026". */
  effectiveDate: "",
  /** Who processes card payments, once one is connected. */
  paymentProvider: "",
  /** Which model provider generation runs through. */
  aiProvider: "",
  /** Minimum age to hold an account. */
  minimumAge: "16",
  /** Notice given before a material change takes effect. */
  noticeDays: "30",
  /** How long data survives account closure. */
  deletionDays: "30",
  /** How long billing records are kept, for tax law. */
  billingYears: "6",
  /** Liability cap period. */
  liabilityMonths: "12",
} as const;

export type LegalKey = keyof typeof LEGAL;

/** The values that must be filled before either document is fit to publish. */
export const REQUIRED_KEYS: LegalKey[] = [
  "entity",
  "country",
  "address",
  "contactEmail",
  "privacyEmail",
  "jurisdiction",
  "effectiveDate",
];

export function missingDetails(): LegalKey[] {
  return REQUIRED_KEYS.filter((key) => !LEGAL[key].trim());
}

/** True while anything required is still blank. */
export const isDraft = missingDetails().length > 0;
