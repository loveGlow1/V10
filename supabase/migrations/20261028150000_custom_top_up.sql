-- Credit added by hand, any whole-dollar amount.
--
-- A crypto top-up for an amount that is not whole packs records no packs; its
-- credits and amount_usd say what it is. Mirrors supabase/schema.sql.

alter table public.crypto_payments drop constraint if exists crypto_payments_purchase_shape;
alter table public.crypto_payments add constraint crypto_payments_purchase_shape check (
  (purchase_kind = 'plan'  and plan_id is not null and plan_id <> 'free' and packs is null)
  or
  (purchase_kind = 'topup' and (packs is null or packs > 0) and plan_id is null)
);
