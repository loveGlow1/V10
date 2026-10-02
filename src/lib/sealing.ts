/* Sealing a secret before it is written to a table.
 *
 * AES-256-GCM under a key derived from some secret the deployment already
 * holds — for an OAuth connection, that provider's client secret. Rotating
 * that secret makes everything sealed under it unreadable, which callers read
 * as "not connected": the right failure for a leaked secret.
 *
 * Same format as the Supabase connection's sealing (supabase-oauth.ts), so a
 * value is recognisable by its "v1." prefix wherever it turns up.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type Sealer = {
  seal(value: string): string;
  unseal(sealed: string): string | null;
};

export function sealerFor(material: string): Sealer {
  const key = createHash("sha256").update(material).digest();
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
    },
    unseal(sealed) {
      if (!sealed.startsWith("v1.")) return null;
      try {
        const raw = Buffer.from(sealed.slice(3), "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
