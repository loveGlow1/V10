-- Pay as you go up to $10,000 a month, and one credit formula.
--
-- Mirrors supabase/schema.sql.

-- Pay as you go: credit added by hand, any whole-dollar amount up to
-- top_up_monthly_cap_usd() ($10,000) a calendar month (UTC) per account.
--
-- One formula for what a top-up buys, here and in the app
-- (topUpCreditsFor in src/lib/crypto-payments.ts): dollars at the pack's
-- rate, to the cent of a credit — $15 → 50, $20 → 66.67, $10,000 →
-- 33,333.33.
create or replace function public.top_up_monthly_cap_usd()
returns numeric language sql immutable set search_path = '' as $$ select 10000::numeric $$;

create or replace function public.top_up_credits_for(p_usd numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_usd / public.topup_usd_per_credit(), 2);
$$;

-- What the account has put in by hand this calendar month, in dollars: every
-- paid top-up line (card or crypto, at what was paid where known, else at the
-- pack's rate) and every crypto top-up still open — so orders left waiting
-- cannot stack past the cap. Credit granted by an administrator is not
-- counted.
create or replace function public.top_up_spent_usd(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(
    coalesce((
      select sum(coalesce(l.amount_usd, public.to_usd(l.paid_amount, l.paid_currency), l.credits * public.topup_usd_per_credit()))
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

-- How much more the account may top up this month, in dollars.
create or replace function public.top_up_room_usd(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, public.top_up_monthly_cap_usd() - public.top_up_spent_usd(p_user_id));
$$;

revoke all on function public.top_up_spent_usd(uuid) from public, anon, authenticated;
grant execute on function public.top_up_spent_usd(uuid) to service_role;
revoke all on function public.top_up_room_usd(uuid) from public, anon, authenticated;
grant execute on function public.top_up_room_usd(uuid) to service_role;

-- A crypto top-up order credits exactly what its price buys. NOT VALID: it
-- holds every order from here on; earlier ones were whole packs, which agree.
alter table public.crypto_payments drop constraint if exists crypto_payments_top_up_credits;
alter table public.crypto_payments add constraint crypto_payments_top_up_credits check (
  purchase_kind <> 'topup' or credits = public.top_up_credits_for(amount_usd)
) not valid;
