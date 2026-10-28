-- A receipt for every crypto deposit and plan, emailed once per order.
--
-- Mirrors supabase/schema.sql.

-- When the customer's receipt for this order was emailed (lib/crypto-receipt.ts).
-- Null until it is; claimed by stamping it, so an order is receipted once.
alter table public.crypto_payments add column if not exists receipt_sent_at timestamptz;
