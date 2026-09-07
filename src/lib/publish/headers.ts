/* The headers the middleware uses to tell the serving route which site a
 * request is for.
 *
 * In a file of their own because both ends need them and the two ends run in
 * different runtimes: the middleware is on the edge and the route is on Node.
 * Importing the route from the middleware to reach a constant would pull the
 * Supabase service client into the edge bundle, where it does not belong.
 *
 * These are set by the middleware and stripped from the incoming request first
 * — see middleware.ts. A value here is never something a caller sent. */

export const SITE_SLUG_HEADER = "x-quickstark-site-slug";
export const SITE_DOMAIN_HEADER = "x-quickstark-site-domain";
