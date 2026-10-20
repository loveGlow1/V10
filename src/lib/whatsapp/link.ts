/* Connect WhatsApp — proving a WhatsApp number belongs to an account.
 *
 * A signed-in person asks for a code in Settings; it is shown only to them,
 * lives ten minutes, and is stored as a hash. Sending it to the QuickStark.Ai
 * WhatsApp assistant links the number that sent it to that account. Nothing
 * else ever links a number: not a typed email, not a name, not a claim to be
 * staff. Once linked, the assistant may READ that account's workspace summary
 * (lib/whatsapp/workspace.ts) and nothing more.
 *
 * Pure apart from hashing and randomness — check:whatsapp runs it offline. */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** How long a code can be sent before it stops working. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/* No 0/O, 1/I/L: a code is read off one screen and typed on another. Eight
   characters of 31 is ~10^12, so guessing a live code is not a strategy. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** The QuickStark.Ai assistant's WhatsApp number, digits only. */
export const BOT_NUMBER = (process.env.WHATSAPP_BOT_NUMBER || "2349032056805").replace(/\D/g, "");

/** A new code, as shown to the person: "QS-7KQ2-M9XD". */
export function newLinkCode(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `QS-${part()}-${part()}`;
}

/** The code inside a WhatsApp message, however it was typed, or null. */
export function codeIn(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const match = text.toUpperCase().match(/\bQS[\s-]*([2-9A-Z]{4})[\s-]*([2-9A-Z]{4})\b/);
  if (!match) return null;
  const code = `QS-${match[1]}-${match[2]}`;
  return [...match[1], ...match[2]].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** What is stored: never the code itself. */
export function hashCode(code: string): string {
  return createHash("sha256").update(`quickstark-whatsapp-link:${code}`).digest("hex");
}

/** A WhatsApp number as digits with its country code, or null. */
export function phoneDigits(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).split("@")[0].replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** "+234 ••• 6805" — enough to recognise, not enough to copy. */
export function maskPhone(digits: string): string {
  return `+${digits.slice(0, 3)} ••• ${digits.slice(-4)}`;
}

/** The link that opens WhatsApp with the code already typed. */
export function whatsappLinkUrl(code: string): string {
  return `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(`LINK ${code}`)}`;
}

/** Whether the bot's request carries the shared secret. Constant-time. */
export function botSecretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
