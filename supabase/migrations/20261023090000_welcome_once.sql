-- One welcome per account, whenever it was given.
--
-- Eleven accounts were welcomed at signup before the welcome line was named
-- ('signup-bonus'). grant_card_welcome only looked for the name, so saving a
-- card would have welcomed them a second time. Their lines are named here,
-- and the function also recognises any earlier welcome grant.
--
-- Mirrors supabase/schema.sql.

update public.credit_ledger l
   set dedupe_key = 'signup-bonus'
 where l.action = 'grant'
   and l.dedupe_key is null
   and coalesce(l.description, '') ilike 'welcome credit%'
   and not exists (
     select 1 from public.credit_ledger o
      where o.user_id = l.user_id and o.dedupe_key = 'signup-bonus'
   )
   and l.id = (
     select min(f.id::text)::uuid from public.credit_ledger f
      where f.user_id = l.user_id and f.action = 'grant'
        and f.dedupe_key is null and coalesce(f.description, '') ilike 'welcome credit%'
   );

create or replace function public.grant_card_welcome(p_user_id uuid, p_fingerprint text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonus    numeric(10,2);
  v_claimant uuid;
  v_granted  uuid;
begin
  -- The server only, whatever EXECUTE grants say: a browser calling this with
  -- its own id and a made-up fingerprint would be free credit on demand.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'grant_card_welcome is for the service role only';
  end if;

  if p_user_id is null or coalesce(p_fingerprint, '') = '' then
    return 'invalid';
  end if;

  -- Welcomed already: the named line, or — for accounts welcomed before the
  -- line was named — any earlier welcome grant.
  if exists (
    select 1 from public.credit_ledger
     where user_id = p_user_id
       and (dedupe_key = 'signup-bonus'
            or (action = 'grant' and coalesce(description, '') ilike 'welcome credit%'))
  ) then
    return 'already';
  end if;

  insert into public.card_welcome_claims (fingerprint, user_id)
  values (p_fingerprint, p_user_id)
  on conflict (fingerprint) do nothing;

  select user_id into v_claimant
    from public.card_welcome_claims where fingerprint = p_fingerprint;
  if v_claimant is distinct from p_user_id then
    return 'card_used';
  end if;

  -- Clamped where the money lands, as the signup grant always was: no edit to
  -- signup_bonus_credits() alone can hand a first-timer more than the ceiling.
  v_bonus := least(
    greatest(coalesce(public.signup_bonus_credits(), 0), 0),
    public.max_signup_bonus_credits()
  );
  if v_bonus <= 0 then
    return 'already';
  end if;

  perform public.ensure_credit_balance(p_user_id);

  insert into public.credit_ledger (user_id, action, credits, description, dedupe_key)
  values (p_user_id, 'grant', v_bonus, 'Welcome credit — card verified', 'signup-bonus')
  on conflict do nothing
  returning user_id into v_granted;
  if v_granted is null then
    return 'already';
  end if;

  update public.credit_balances
     set top_up = top_up + v_bonus
   where user_id = p_user_id;

  return 'granted';
end;
$$;
