-- Removing a card in the app.
--
-- card_status is split in two: card_status_without_card is the rule for an
-- account with no card on file, which the app also asks before someone
-- removes theirs ("you'll need to add one again before you build").
-- Behaviour is unchanged. Mirrors supabase/schema.sql.

-- What card_status would say with no card on file: the rule for an account
-- without one, and what the screens tell someone before they remove theirs.
create or replace function public.card_status_without_card(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
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
    else public.card_status_without_card(p_user_id)
  end;
$$;

revoke all on function public.card_status_without_card(uuid) from public, anon, authenticated;
grant execute on function public.card_status_without_card(uuid) to service_role;
revoke all on function public.card_status(uuid) from public, anon, authenticated;
grant execute on function public.card_status(uuid) to service_role;
