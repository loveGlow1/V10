-- WhatsApp bot tables, for setting the bot up on a fresh Supabase project.
-- Safe to run more than once. Run it in Supabase → SQL Editor.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  instance_name text not null,
  business_name text,
  alert_numbers text[],
  created_at timestamptz not null default now()
);
alter table public.clients add column if not exists website text;
alter table public.clients add column if not exists ai_prompt text;
alter table public.clients add column if not exists alert_email text;
alter table public.clients add column if not exists daily_summary boolean not null default true;
alter table public.clients add column if not exists tagline text;
alter table public.clients add column if not exists about text;
alter table public.clients add column if not exists faqs text;
alter table public.clients add column if not exists tone text;
alter table public.clients add column if not exists currency text not null default 'NGN';
alter table public.clients add column if not exists menu jsonb;
alter table public.clients add column if not exists services_note text;
alter table public.clients add column if not exists contact_email text;
alter table public.clients add column if not exists active boolean not null default true;
create unique index if not exists clients_instance_name_unique on public.clients (instance_name);
create unique index if not exists clients_client_id_unique on public.clients (client_id);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  item_name text not null,
  quantity integer not null default 0,
  price numeric,
  created_at timestamptz not null default now()
);
alter table public.inventory add column if not exists payment_url text;
alter table public.inventory add column if not exists description text;
create unique index if not exists inventory_client_item_unique on public.inventory (client_id, lower(item_name));

create table if not exists public.bot_events (
  id bigint generated always as identity primary key,
  client_id text not null,
  phone text not null,
  name text,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists bot_events_client_created on public.bot_events (client_id, created_at desc);

-- Only the server (n8n) touches these tables: RLS on, no policies.
alter table public.clients enable row level security;
alter table public.inventory enable row level security;
alter table public.bot_events enable row level security;
revoke all on public.clients, public.inventory, public.bot_events from anon, authenticated;
