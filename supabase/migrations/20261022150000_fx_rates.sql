-- Payments in any currency — naira through Paystack, and any of Stripe's —
-- kept as they were made and valued in US dollars at their day's rate, so the
-- card rule's $25 line means the same in every currency.
--
-- Mirrors supabase/schema.sql.

-- fx_rates: what one unit of each currency is worth in US dollars, refreshed
-- daily by /api/cron/fx-rates (src/lib/money.ts). Payments are made in naira
-- through Paystack and in any of Stripe's currencies; the card rule's $25 line
-- is in dollars, so each payment is valued at its day's rate. Readable by the
-- server only.
create table if not exists public.fx_rates (
  currency     text primary key check (currency ~ '^[A-Z]{3}$'),
  usd_per_unit numeric not null check (usd_per_unit > 0),
  updated_at   timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
revoke all on public.fx_rates from anon, authenticated;
comment on table public.fx_rates is 'US dollars per unit of each currency (e.g. NGN, GHS, EUR), refreshed daily by /api/cron/fx-rates. Service role only: RLS on with no policy BY DESIGN.';

-- What a payment was, as it was made: the amount in its own currency (naira,
-- not kobo) and the ISO 4217 code. amount_usd beside them is its dollar value
-- on the day. Written by src/lib/money.ts recordPayment for every provider.
alter table public.credit_ledger add column if not exists paid_amount numeric(14,3);
alter table public.credit_ledger add column if not exists paid_currency text;

-- An amount in any currency, in US dollars at the latest rate; null when the
-- currency has no rate.
create or replace function public.to_usd(p_amount numeric, p_currency text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_amount is null or p_currency is null then null
    when upper(p_currency) = 'USD' then p_amount
    else p_amount * (select r.usd_per_unit from public.fx_rates r where r.currency = upper(p_currency))
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
  -- top-up with no payment on it (granted by hand) — its credits at the pack
  -- rate.
  select
    coalesce((
      select sum(coalesce(l.amount_usd, public.to_usd(l.paid_amount, l.paid_currency), l.credits * public.topup_usd_per_credit()))
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'topup' and l.credits > 0
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

revoke all on function public.to_usd(numeric, text) from public, anon, authenticated;
grant execute on function public.to_usd(numeric, text) to service_role;
