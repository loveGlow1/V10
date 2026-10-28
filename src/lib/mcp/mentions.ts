/* Which of the person's connectors a build request draws on. Pure, so it is
 * tested on its own (tools/check-connectors.mjs) — it decides when somebody's
 * account is read, so a loose match costs more than a missed one. */

export type LiveConnector = { serverId: string; name: string; url: string; token: string | null };

/** The connectors a request draws on — named as the person's own or as a
 *  source: "my Stripe products", "from Notion", "in my Canva", "using Linear".
 *  A bare mention is not enough: "a linear gradient", "a checkout with
 *  Stripe" or "host it on Vercel" describes the build, and reaches into
 *  nobody's account. */
export function mentionedConnectors(text: string, connectors: LiveConnector[]): LiveConnector[] {
  const said = text.toLowerCase().replace(/\s+/g, " ");
  if (/\b(?:my|our) (?:connectors|connected apps|connected tools)\b/.test(said)) return connectors;
  return connectors.filter((connector) => {
    const words = [connector.serverId.startsWith("custom:") ? "" : connector.serverId, ...connector.name.toLowerCase().split(/[^a-z0-9]+/)]
      .map((word) => word.toLowerCase())
      .filter((word) => word.length >= 4 && !["custom", "connector"].includes(word));
    return words.some((word) =>
      new RegExp(`\\b(?:my|our|from|using|via|connected|through) (?:my |our |the )?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(said),
    );
  });
}
