-- Connect WhatsApp (Settings → Account). A signed-in person asks for a code;
-- sending it to the QuickStark.Ai WhatsApp assistant links the number that sent
-- it to their account, so the assistant can answer READ-ONLY questions about
-- that account (plan, credits, projects). See src/lib/whatsapp/link.ts.
--
-- The code is stored only as a sha256 hash and lives ten minutes. One number
-- belongs to one account at a time. Written and read only by the service role
-- (/api/whatsapp/link for the owner, /api/whatsapp/bot for the assistant):
-- RLS on with no policy BY DESIGN, all grants revoked from browser roles.
create table if not exists public.whatsapp_links (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  phone           text unique,
  code_hash       text unique,
  code_expires_at timestamptz,
  linked_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.whatsapp_links enable row level security;
revoke all on public.whatsapp_links from anon, authenticated;

comment on table public.whatsapp_links is 'Connect WhatsApp: which WhatsApp number belongs to which account, and the hashed one-time code that links it. Service role only: RLS on with no policy BY DESIGN.';

drop trigger if exists whatsapp_links_set_updated_at on public.whatsapp_links;
create trigger whatsapp_links_set_updated_at
  before update on public.whatsapp_links
  for each row execute function public.set_updated_at();
