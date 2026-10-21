-- Free credit needs a card on file.
--
-- The welcome credit stops arriving at signup. A new account's balance opens
-- empty, and the welcome is granted once a card has been saved and verified
-- through Stripe Checkout in setup mode — a zero-amount authorisation, never a
-- charge — and only once per card, by its Stripe fingerprint. Accounts that
-- were welcomed at signup already carry the 'signup-bonus' ledger line, so
-- they keep what they have and are not welcomed twice.
--
-- Mirrors supabase/schema.sql.

-- Signup no longer grants the welcome.
-- It also opens the new account's credit balance — empty. The welcome credit
-- is not handed out here any more: it is granted once a card has been saved
-- and verified (no charge), by grant_card_welcome() below, and only once per
-- card. Opening the balance belongs here rather than in the application
-- because an account can be created by an OAuth callback, an email
-- confirmation or a hand-made row in the Supabase dashboard, and every one of
-- those must arrive the same way.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Scalars rather than a credit_plans%rowtype: a composite type is resolved
  -- when the function is created, and the credit tables are defined further
  -- down this file. The queries below resolve at call time, which is after the
  -- whole file has been applied.
  v_daily   numeric(10,2);
  v_monthly numeric(10,2);
begin
  insert into public.user_profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    -- Email sign-up sends full_name; OAuth providers send one or the other.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;

  select daily_credits, monthly_credits into v_daily, v_monthly
    from public.credit_plans where id = 'free';

  -- Nothing in the top-up bucket: on Free that bucket is the whole balance,
  -- and the only credit it receives without paying is the welcome, which
  -- waits for a verified card (grant_card_welcome).
  --
  -- `on conflict do nothing` means an account that somehow already has a
  -- balance keeps the one it has.
  insert into public.credit_balances (user_id, plan_id, daily, monthly, top_up)
  values (new.id, 'free', v_daily, v_monthly, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A card on file, and the welcome credit it unlocks.
--
-- Free credit is only for an account with a real card behind it: the person
-- saves a card through Stripe Checkout in setup mode, the bank verifies it
-- with a zero-amount authorisation, and nothing is charged. When that
-- succeeds, grant_card_welcome() credits the welcome — once per account (the
-- ledger's 'signup-bonus' line, which is also what accounts welcomed at signup
-- before this rule already carry) and once per CARD, by its Stripe
-- fingerprint, so one card cannot unlock free credit on account after account.
--
-- payment_cards: the account's card as Stripe holds it. Brand, last four and
-- expiry are readable by its owner (the Billing screen shows them); the Stripe
-- ids and the fingerprint are not readable by any browser role. Written only
-- by the service role, from /api/payments/stripe/card and the Stripe webhook.
create table if not exists public.payment_cards (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  payment_method_id  text not null,
  brand              text,
  last4              text,
  exp_month          integer,
  exp_year           integer,
  fingerprint        text not null,
  verified_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.payment_cards enable row level security;
revoke all on public.payment_cards from anon, authenticated;
grant select (user_id, brand, last4, exp_month, exp_year, verified_at) on public.payment_cards to authenticated;

drop policy if exists "payment_cards: owner reads" on public.payment_cards;
create policy "payment_cards: owner reads" on public.payment_cards
  for select to authenticated using ((select auth.uid()) = user_id);

drop trigger if exists payment_cards_set_updated_at on public.payment_cards;
create trigger payment_cards_set_updated_at
  before update on public.payment_cards
  for each row execute function public.set_updated_at();

comment on table public.payment_cards is 'The card an account saved (Stripe setup mode, verified, never charged). Owner reads brand/last4/expiry; Stripe ids and fingerprint are service-role only.';

-- card_welcome_claims: which card unlocked a welcome, for which account. The
-- fingerprint is the key, so a card claims once. The account is set null, not
-- deleted with it, so closing an account and signing up again does not free
-- the card for a second welcome. Service role only: RLS on, no policy.
create table if not exists public.card_welcome_claims (
  fingerprint text primary key,
  user_id     uuid references auth.users (id) on delete set null,
  claimed_at  timestamptz not null default now()
);

alter table public.card_welcome_claims enable row level security;
revoke all on public.card_welcome_claims from anon, authenticated;

comment on table public.card_welcome_claims is 'One welcome credit per card: the Stripe card fingerprint that unlocked it and the account it went to. Service role only: RLS on with no policy BY DESIGN.';

-- grant_card_welcome — a verified card becomes the welcome credit.
--
-- Answers 'granted', 'already' (this account has had its welcome) or
-- 'card_used' (this card already unlocked one for another account). Safe to
-- call twice for the same card and account — the webhook and the browser's
-- return both call it — because the ledger line is named and unique.
create or replace function public.grant_card_welcome(p_user_id uuid, p_fingerprint text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonus    numeric(10,2);
  v_claimant uuid;
  v_granted  uuid;
begin
  -- The server only, whatever EXECUTE grants say: a browser calling this with
  -- its own id and a made-up fingerprint would be free credit on demand.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'grant_card_welcome is for the service role only';
  end if;

  if p_user_id is null or coalesce(p_fingerprint, '') = '' then
    return 'invalid';
  end if;

  if exists (
    select 1 from public.credit_ledger
     where user_id = p_user_id and dedupe_key = 'signup-bonus'
  ) then
    return 'already';
  end if;

  insert into public.card_welcome_claims (fingerprint, user_id)
  values (p_fingerprint, p_user_id)
  on conflict (fingerprint) do nothing;

  select user_id into v_claimant
    from public.card_welcome_claims where fingerprint = p_fingerprint;
  if v_claimant is distinct from p_user_id then
    return 'card_used';
  end if;

  -- Clamped where the money lands, as the signup grant always was: no edit to
  -- signup_bonus_credits() alone can hand a first-timer more than the ceiling.
  v_bonus := least(
    greatest(coalesce(public.signup_bonus_credits(), 0), 0),
    public.max_signup_bonus_credits()
  );
  if v_bonus <= 0 then
    return 'already';
  end if;

  perform public.ensure_credit_balance(p_user_id);

  insert into public.credit_ledger (user_id, action, credits, description, dedupe_key)
  values (p_user_id, 'grant', v_bonus, 'Welcome credit — card verified', 'signup-bonus')
  on conflict do nothing
  returning user_id into v_granted;
  if v_granted is null then
    return 'already';
  end if;

  update public.credit_balances
     set top_up = top_up + v_bonus
   where user_id = p_user_id;

  return 'granted';
end;
$$;

revoke all on function public.grant_card_welcome(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_card_welcome(uuid, text) to service_role;
