/* Taking the price of a charge away from the browser.

   RUN THIS LAST, and only once the deployment is charging through
   spend_credits_for — that is, once the code in src/app/api/credits/spend has
   shipped. Run before, it breaks every charge in the application; run after, it
   closes the hole and nothing changes for anybody.

   ── What the hole is ──────────────────────────────────────────────────────

   spend_credits used to read auth.uid() and be executable by `authenticated`.
   Any signed-in person could therefore call

     POST /rest/v1/rpc/spend_credits  { "p_action": "publish", "p_cost": 0 }

   straight from a browser console and name their own price. The function checks
   that the cost is not negative and that the balance covers it. It cannot check
   that the cost is the real one, because the price is decided in the
   application — which is exactly why the application, on the server, is now the
   only caller.

   grant_credits was never exposed, so nobody could ever credit themselves. What
   this closes is the price of a charge, not the creation of one. It was latent
   while the client-priced actions topped out at one credit; it stopped being
   latent when publishing shipped at fifty.

   Supabase's linter reports it as
   authenticated_security_definer_function_executable.

   ── After this runs ───────────────────────────────────────────────────────

   spend_credits still exists and still works — it is a wrapper over
   spend_credits_for — but only for a role that already holds EXECUTE on it,
   which after this is the service role alone. The application's fallback path
   will start failing, which is the point: it exists to survive the gap between
   deploying and running this, and once this has run there is no gap left.

   Safe to run more than once. */

revoke execute on function public.spend_credits(text, numeric, text, uuid, integer, integer)
  from authenticated;

/* Proof, rather than a hope. Both should come back false. */
select
  has_function_privilege(
    'authenticated',
    'public.spend_credits(text, numeric, text, uuid, integer, integer)',
    'EXECUTE'
  ) as authenticated_can_spend,
  has_function_privilege(
    'authenticated',
    'public.spend_credits_for(uuid, text, numeric, text, uuid, integer, integer)',
    'EXECUTE'
  ) as authenticated_can_spend_for;
