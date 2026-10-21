-- Who must add a card, and who is only asked: established customers (funded
-- $25 or more, with us over two months) are asked but keep working; everyone
-- else without a valid card must add one first. Records what each Stripe
-- payment cost on its ledger line from now on.
--
-- Mirrors supabase/schema.sql.

-- Who must add a card, and who is only asked.
--
-- Like emergent.sh, a card on file is the price of free credit and of using
-- the service at all — with one softening for established customers:
--
--   'ok'        an unexpired card is on file.
--   'suggest'   no card, but the account has put at least $25 into QuickStark
--               and has been with us more than two months: it is asked to add
--               a card (and can dismiss the ask) but keeps working.
--   'required'  everyone else — new accounts, and any account funded below
--               $25 — may not use the service until it adds a card.
--
-- "Funded" is credit put into the account, in dollars: every top-up line
-- (card, crypto, or granted by hand) at the top-up pack's rate, and every plan
-- bought — at what was paid where that was recorded (credit_ledger.amount_usd
-- for Stripe, crypto_payments.amount_usd for crypto). A card counts while it
-- has not expired.
--
-- The $25, two months and the pack rate are card_suggest_min_usd(),
-- card_suggest_min_age() and topup_usd_per_credit(); keep the rate in step with
-- TOP_UP_PACK in src/app/dashboard/credits.ts ($15 for 50 credits).
--
-- Read by the server (src/lib/card-gate.ts) before any work is started, and
-- by /api/payments/stripe/card for the screens. Service role only.
alter table public.credit_ledger add column if not exists amount_usd numeric(10,2);
comment on column public.credit_ledger.amount_usd is 'What was paid for this line, in US dollars, where known (Stripe Checkout settlements). Null for charges and grants.';

create or replace function public.card_suggest_min_usd()
returns numeric language sql immutable set search_path = '' as $$ select 25::numeric $$;

create or replace function public.card_suggest_min_age()
returns interval language sql immutable set search_path = '' as $$ select interval '2 months' $$;

create or replace function public.topup_usd_per_credit()
returns numeric language sql immutable set search_path = '' as $$ select (15::numeric / 50) $$;

create or replace function public.funded_usd(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(coalesce(l.amount_usd, l.credits * public.topup_usd_per_credit()))
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'topup' and l.credits > 0
    ), 0)
    + coalesce((
      select sum(coalesce(l.amount_usd, 0))
        from public.credit_ledger l
       where l.user_id = p_user_id and l.action = 'grant' and l.dedupe_key like 'stripe:%'
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
    when public.funded_usd(p_user_id) >= public.card_suggest_min_usd()
     and exists (
       select 1 from auth.users u
        where u.id = p_user_id and u.created_at <= now() - public.card_suggest_min_age()
     ) then 'suggest'
    else 'required'
  end;
$$;

create or replace function public.card_required(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.card_status(p_user_id) = 'required';
$$;

revoke all on function public.funded_usd(uuid) from public, anon, authenticated;
grant execute on function public.funded_usd(uuid) to service_role;
revoke all on function public.card_status(uuid) from public, anon, authenticated;
grant execute on function public.card_status(uuid) to service_role;
revoke all on function public.card_required(uuid) from public, anon, authenticated;
grant execute on function public.card_required(uuid) to service_role;
