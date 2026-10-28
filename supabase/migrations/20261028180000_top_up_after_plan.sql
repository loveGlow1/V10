-- Top-ups only for accounts that have paid for a plan, from $15.
--
-- Mirrors supabase/schema.sql.

-- Whether the account has ever paid for a paid plan — by card (Stripe, or
-- earlier Paystack) or in crypto. Credit granted by hand and a trial's free
-- month do not count. Top-ups are open only to such accounts (see
-- src/lib/top-up-access.ts).
create or replace function public.paid_for_plan(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credit_ledger l
     where l.user_id = p_user_id and l.action = 'grant' and l.credits > 0
       and (l.dedupe_key like 'stripe:%' or l.dedupe_key like 'paystack:%')
  ) or exists (
    select 1 from public.crypto_payments p
     where p.user_id = p_user_id and p.status = 'confirmed' and p.purchase_kind = 'plan'
  );
$$;

revoke all on function public.paid_for_plan(uuid) from public, anon, authenticated;
grant execute on function public.paid_for_plan(uuid) to service_role;
