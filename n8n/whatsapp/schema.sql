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
alter table public.clients add column if not exists contact_phone text;
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

-- Per-customer WhatsApp state for every business, plus the recent chat (memory),
-- so the bot remembers customers even if n8n restarts or moves.
create table if not exists public.wa_contacts (
  ckey text primary key,              -- instance:phone
  client_id text,
  instance text,
  phone text,
  name text,
  session bigint,
  last_at bigint,
  handoff_since bigint,
  agent_at bigint,
  handoff_last bigint,
  lead_at bigint,
  followed_at bigint,
  rate_start bigint,
  rate_count bigint,
  history text,                       -- JSON list of the last messages in this chat
  history_session bigint,             -- which chat (session) the history belongs to
  updated_at timestamptz not null default now()
);
create index if not exists wa_contacts_lead_at on public.wa_contacts (lead_at);

-- The engine always inserts a contact's new state: if the contact exists, its row
-- is updated instead, keeping what that step does not send (memory, lead times).
create or replace function public.wa_contacts_upsert() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.wa_contacts set
    client_id = new.client_id, instance = new.instance, phone = new.phone, name = new.name,
    session = new.session, last_at = new.last_at, handoff_since = new.handoff_since,
    agent_at = new.agent_at, handoff_last = new.handoff_last,
    rate_start = new.rate_start, rate_count = new.rate_count,
    lead_at = coalesce(new.lead_at, lead_at), followed_at = coalesce(new.followed_at, followed_at),
    history = coalesce(new.history, history), history_session = coalesce(new.history_session, history_session),
    updated_at = now()
  where ckey = new.ckey;
  if found then return null; end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger wa_contacts_upsert before insert on public.wa_contacts
  for each row execute function public.wa_contacts_upsert();

-- Only the server (n8n) touches these tables: RLS on, no policies.
alter table public.clients enable row level security;
alter table public.inventory enable row level security;
alter table public.bot_events enable row level security;
alter table public.wa_contacts enable row level security;
revoke all on public.clients, public.inventory, public.bot_events, public.wa_contacts from anon, authenticated;
