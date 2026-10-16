/* Whether a framed address may keep `allow-same-origin` in its sandbox.
 *
 * The two frames that carry that token show a deployed app on its OWN origin
 * (`*.vercel.app` or a custom domain), where same-origin means "as itself" and
 * the app needs it to hold its own session. Combined with `allow-scripts` on
 * THIS app's origin, it would mean the opposite: a document that can reach the
 * signed-in user's cookies and lift its own sandbox. So the token is kept only
 * for an address that is provably somewhere else.
 *
 * Shared by the preview route (server) and the preview panel (browser), which
 * pass their own origin in: `new URL(request.url).origin` and
 * `window.location.origin` respectively. */
export function isSafeExternalOrigin(targetUrl: string, appOrigin: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(targetUrl);
    app = new URL(appOrigin);
  } catch {
    return false;
  }

  const localhost = target.hostname === "localhost";
  if (target.protocol !== "https:" && !(target.protocol === "http:" && localhost)) return false;

  if (target.origin === app.origin) return false;

  const host = target.hostname.toLowerCase();
  const appHost = app.hostname.toLowerCase();
  if (host === appHost || host.endsWith(`.${appHost}`)) return false;

  return true;
}
