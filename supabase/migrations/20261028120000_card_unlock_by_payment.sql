-- Paying unlocks the card gate.
--
-- The $25-and-two-months rule is gone. A card payment unlocks for good (asked
-- to put a card back if it was removed); a crypto payment unlocks for 8 days,
-- asks until day 15, then locks until a card is added. card_deadline gives
-- the screens the date. Mirrors supabase/schema.sql.

-- Paid by card: a Stripe (or, earlier, Paystack) payment on the ledger.
create or replace function public.card_funded(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credit_ledger l
     where l.user_id = p_user_id and l.credits > 0
       and (l.dedupe_key like 'stripe:%' or l.dedupe_key like 'paystack:%')
  );
$$;

-- When the account first paid in crypto, or null.
create or replace function public.crypto_funded_at(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(coalesce(p.confirmed_at, p.updated_at)) from public.crypto_payments p
   where p.user_id = p_user_id and p.status = 'confirmed';
$$;

-- A crypto payment unlocks the account without a card for a while: asked
-- from card_crypto_remind_after(), locked from card_crypto_lock_after(), both
-- counted from the first crypto payment.
create or replace function public.card_crypto_remind_after()
returns interval language sql immutable set search_path = '' as $$ select interval '8 days' $$;

create or replace function public.card_crypto_lock_after()
returns interval language sql immutable set search_path = '' as $$ select interval '15 days' $$;

-- When an account with no card will be locked out for want of one: its first
-- crypto payment plus card_crypto_lock_after(). Null when a card is on file,
-- the account has paid by card, or there is no crypto payment — the screens
-- show the date in the reminder.
create or replace function public.card_deadline(p_user_id uuid)
returns timestamptz
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
    ) or public.card_funded(p_user_id) then null
    else public.crypto_funded_at(p_user_id) + public.card_crypto_lock_after()
  end;
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
    -- Paid by card before: asked to put one on file again, keeps working.
    when public.card_funded(p_user_id) then 'suggest'
    -- Paid in crypto: unlocked, unasked, for the first while.
    when public.crypto_funded_at(p_user_id) > now() - public.card_crypto_remind_after() then 'ok'
    -- Credit the owner gifted — granted by an administrator — is the
    -- account's to use, card or no card. Only that credit: the account may
    -- spend up to what it was gifted (net of corrections), counted from its
    -- first gift, and no further. Signup credit sitting beside it stays
    -- locked until a card is added.
    when exists (
      select 1 from public.credit_balances b
       where b.user_id = p_user_id and (b.daily + b.rollover + b.monthly + b.top_up) > 0
    ) and (
      select coalesce(sum(l.credits), 0) from public.credit_ledger l
       where l.user_id = p_user_id and l.source = 'admin'
    ) - (
      select coalesce(sum(-l.credits), 0) from public.credit_ledger l
       where l.user_id = p_user_id
         and l.action in ('chat', 'generate', 'publish', 'runtime')
         and l.created_at >= (
           select min(a.created_at) from public.credit_ledger a
            where a.user_id = p_user_id and a.source = 'admin'
         )
    ) > 0 then 'suggest'
    -- Paid in crypto a while ago: asked, with the date, until the lock.
    when public.crypto_funded_at(p_user_id) > now() - public.card_crypto_lock_after() then 'suggest'
    else 'required'
  end;
$$;

revoke all on function public.card_funded(uuid) from public, anon, authenticated;
grant execute on function public.card_funded(uuid) to service_role;
revoke all on function public.crypto_funded_at(uuid) from public, anon, authenticated;
grant execute on function public.crypto_funded_at(uuid) to service_role;
revoke all on function public.card_deadline(uuid) from public, anon, authenticated;
grant execute on function public.card_deadline(uuid) to service_role;
revoke all on function public.card_status(uuid) from public, anon, authenticated;
grant execute on function public.card_status(uuid) to service_role;
