-- Payments hardening.
--
-- The monthly top-up cap counts the credit bought (its pre-tax dollar value
-- at the pack's rate), not what the card was charged after tax and currency
-- conversion. And a refunded or disputed card top-up takes its credits back
-- (reverse_stripe_top_up, called by the Stripe webhook). Mirrors
-- supabase/schema.sql.

-- What the account has put in by hand this calendar month, in dollars of
-- credit bought — every paid top-up line, card or crypto, valued at the
-- pack's rate (the price before tax, in dollars, whatever currency it was
-- paid in), plus every crypto top-up still open, so orders left waiting
-- cannot stack past the cap. Open card checkouts are counted by the
-- checkout route, which can see them. Credit granted by an administrator is
-- not counted.
create or replace function public.top_up_spent_usd(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(
    coalesce((
      select sum(l.credits * public.topup_usd_per_credit())
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'topup' and l.credits > 0
         and l.source is distinct from 'admin'
         and l.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    ), 0)
    + coalesce((
      select sum(p.amount_usd)
        from public.crypto_payments p
       where p.user_id = p_user_id and p.purchase_kind = 'topup'
         and (p.status = 'submitted' or (p.status = 'awaiting_payment' and p.expires_at > now()))
         and p.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    ), 0), 2);
$$;

-- reverse_stripe_top_up — a card top-up refunded or disputed takes its
-- credits back.
--
-- p_target_credits is how much of the top-up should be taken back in all, so
-- far: its credits in proportion to what has been refunded, or all of them on
-- a dispute. Called again with the same or a smaller target it does nothing;
-- with a larger one (a second partial refund) it takes only the difference.
-- Each target is one ledger line, 'stripe-reversal:<session>:<target in
-- hundredths>', so a webhook delivered twice changes nothing.
--
-- Credit already spent cannot be taken back: the balance stops at zero and
-- the line says how much was short. Returns the credits taken by this call.
-- Service role only.
create or replace function public.reverse_stripe_top_up(
  p_session_id     text,
  p_user_id        uuid,
  p_target_credits numeric,
  p_reason         text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bought   numeric;
  v_done     numeric;
  v_target   numeric;
  v_owed     numeric;
  v_top_up   numeric;
  v_take     numeric;
begin
  select l.credits into v_bought
    from credit_ledger l
   where l.user_id = p_user_id and l.dedupe_key = 'stripe:' || p_session_id
     and l.action = 'topup' and l.credits > 0;
  if v_bought is null then
    return 0;
  end if;

  -- One reversal at a time per account.
  select b.top_up into v_top_up from credit_balances b where b.user_id = p_user_id for update;
  if not found then
    return 0;
  end if;

  v_target := least(round(greatest(p_target_credits, 0), 2), v_bought);
  select round(coalesce(max(split_part(l.dedupe_key, ':', 3)::numeric / 100), 0), 2) into v_done
    from credit_ledger l
   where l.user_id = p_user_id and l.dedupe_key like 'stripe-reversal:' || p_session_id || ':%';
  v_owed := v_target - v_done;
  if v_owed <= 0 then
    return 0;
  end if;

  v_take := least(v_owed, v_top_up);
  update credit_balances set top_up = top_up - v_take where user_id = p_user_id;
  insert into credit_ledger (user_id, action, credits, description, dedupe_key)
    values (
      p_user_id, 'topup', -v_take,
      coalesce(p_reason, 'Top-up reversed')
        || case when v_take < v_owed then ' (' || (v_owed - v_take) || ' credits already spent)' else '' end,
      'stripe-reversal:' || p_session_id || ':' || (v_target * 100)::bigint
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  return v_take;
end;
$$;

revoke all on function public.reverse_stripe_top_up(text, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.reverse_stripe_top_up(text, uuid, numeric, text) to service_role;
