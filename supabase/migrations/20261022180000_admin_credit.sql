-- Credit granted by an administrator is the account's to use, card or no
-- card. Such lines are marked (credit_ledger.source = 'admin'); grant_credits
-- marks them from now on, and the hand grants made before are marked here.
-- They do not count as funding toward the card rule's $25.
--
-- Mirrors supabase/schema.sql.

alter table public.credit_ledger add column if not exists source text;

-- Earlier hand grants: top-ups with no payment behind them — no checkout
-- reference, no amount paid, and not a crypto settlement ("… paid in BTC").
update public.credit_ledger
   set source = 'admin'
 where source is null
   and action = 'topup'
   and dedupe_key is null
   and paid_amount is null
   and coalesce(description, '') not ilike '% paid in %';

create or replace function public.grant_credits(
  p_user_id     uuid,
  p_credits     numeric,
  p_action      text default 'topup',
  p_description text default null
)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.credit_balances;
begin
  if p_credits <= 0 then
    raise exception 'a grant must be positive' using errcode = '22023';
  end if;

  perform public.ensure_credit_balance(p_user_id);

  update public.credit_balances
    set top_up = top_up + p_credits
    where user_id = p_user_id
    returning * into v_balance;

  -- Credit granted by hand is marked as such: an account may spend it
  -- whether or not it has a card on file (see card_status), and it is not a
  -- payment, so it does not count as funding.
  insert into public.credit_ledger (user_id, action, credits, description, source)
    values (p_user_id, p_action, p_credits, p_description, 'admin');

  return v_balance;
end;
$$;

create or replace function public.funded_usd(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- A line's dollar value, best known first: what it was worth on the day,
  -- then what it is worth now in the currency it was paid in, then — for a
  -- top-up with no payment recorded on it — its credits at the pack rate.
  -- Credit granted by an administrator is not funding and is left out.
  select
    coalesce((
      select sum(coalesce(l.amount_usd, public.to_usd(l.paid_amount, l.paid_currency), l.credits * public.topup_usd_per_credit()))
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'topup' and l.credits > 0
         and l.source is distinct from 'admin'
    ), 0)
    + coalesce((
      select sum(coalesce(l.amount_usd, public.to_usd(l.paid_amount, l.paid_currency), 0))
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'grant'
         and (l.dedupe_key like 'stripe:%' or l.dedupe_key like 'paystack:%')
    ), 0)
    + coalesce((
      select sum(p.amount_usd)
        from public.crypto_payments p
       where p.user_id = p_user_id and p.status = 'confirmed' and p.purchase_kind = 'plan'
    ), 0);
$$;

create or replace function public.card_status(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.payment_cards c
       where c.user_id = p_user_id
         and (c.exp_year is null
              or (c.exp_year * 100 + coalesce(c.exp_month, 12))
                 >= (extract(year from now())::int * 100 + extract(month from now())::int))
    ) then 'ok'
    -- Credit granted by an administrator is the account's to use, card or no
    -- card: while it holds a balance and has had such a grant, it works and
    -- is only asked to add a card.
    when exists (
      select 1 from public.credit_ledger l
       where l.user_id = p_user_id and l.source = 'admin' and l.credits > 0
    ) and exists (
      select 1 from public.credit_balances b
       where b.user_id = p_user_id and (b.daily + b.rollover + b.monthly + b.top_up) > 0
    ) then 'suggest'
    when public.funded_usd(p_user_id) >= public.card_suggest_min_usd()
     and exists (
       select 1 from auth.users u
        where u.id = p_user_id and u.created_at <= now() - public.card_suggest_min_age()
     ) then 'suggest'
    else 'required'
  end;
$$;
