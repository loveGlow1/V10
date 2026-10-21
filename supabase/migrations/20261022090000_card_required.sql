-- No card, no service — for accounts that have never paid.
--
-- New accounts already wait for a card before their welcome credit
-- (20261021180000_card_welcome.sql). Accounts from before that rule were
-- handed their free credit at signup; those that have never paid must now
-- add a card too before they can spend it. card_required() says which
-- accounts that is; the server refuses work for them until a card is saved.
--
-- Mirrors supabase/schema.sql.

-- card_required — whether an account must save a card before it may use the
-- service at all.
--
-- Free credit is for accounts with a real card behind them. That holds for
-- new accounts (whose welcome waits for a card, see grant_card_welcome) and
-- for accounts from before the rule that were handed free credit at signup
-- and have never paid: they too must add a card to spend it. An account that
-- has paid — a paid plan now, or ever a top-up or plan by card or crypto — has
-- shown a way to pay and is never asked. A card counts while it has not
-- expired.
--
-- Read by the server (src/lib/card-gate.ts) before any work is started, and
-- by /api/payments/stripe/card for the screens. Service role only.
create or replace function public.card_required(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
    -- A card that has not expired.
    exists (
      select 1 from public.payment_cards c
       where c.user_id = p_user_id
         and (c.exp_year is null
              or (c.exp_year * 100 + coalesce(c.exp_month, 12))
                 >= (extract(year from now())::int * 100 + extract(month from now())::int))
    )
    -- On a paid plan.
    or exists (
      select 1 from public.credit_balances b
       where b.user_id = p_user_id and b.plan_id <> 'free'
    )
    -- Ever paid: a top-up, or anything bought through Stripe Checkout.
    or exists (
      select 1 from public.credit_ledger l
       where l.user_id = p_user_id
         and (l.action = 'topup' or l.dedupe_key like 'stripe:%')
    )
    -- Ever paid in crypto.
    or exists (
      select 1 from public.crypto_payments p
       where p.user_id = p_user_id and p.status = 'confirmed'
    )
  );
$$;

revoke all on function public.card_required(uuid) from public, anon, authenticated;
grant execute on function public.card_required(uuid) to service_role;
