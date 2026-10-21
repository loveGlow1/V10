-- Only credit the owner gifted can be used without a card; signup credit
-- waits for one.
--
-- The owner's gifts were also recorded as 'grant' lines (manual grants,
-- goodwill top-ups, a plan activated by an administrator, and their
-- corrections); they are marked as administrator credit here, beside the
-- top-ups marked before. Signup credit ("Welcome credit", and its "Free plan
-- adjusted" trims), payments and checkouts are left as they are.
--
-- An account may now spend administrator credit only up to what it was
-- gifted, counted from its first gift — not whatever balance it holds.
--
-- Mirrors supabase/schema.sql.

update public.credit_ledger
   set source = 'admin'
 where source is null
   and action = 'grant'
   and coalesce(dedupe_key, '') not like 'signup-bonus'
   and coalesce(dedupe_key, '') not like 'stripe:%'
   and coalesce(dedupe_key, '') not like 'paystack:%'
   and coalesce(description, '') not ilike 'welcome credit%'
   and coalesce(description, '') not ilike 'free plan adjusted%'
   and coalesce(description, '') not ilike '% paid in %';

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
    when public.funded_usd(p_user_id) >= public.card_suggest_min_usd()
     and exists (
       select 1 from auth.users u
        where u.id = p_user_id and u.created_at <= now() - public.card_suggest_min_age()
     ) then 'suggest'
    else 'required'
  end;
$$;
