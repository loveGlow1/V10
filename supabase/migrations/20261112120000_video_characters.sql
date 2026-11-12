-- Characters that look the same in every scene.
--
-- A character is a person's own, reusable across their videos: a name, a
-- fixed description (age, face, hair, wardrobe) repeated word for word in
-- every scene that shows them, a set of reference pictures made ONCE (front,
-- three-quarter, full body) and never regenerated per scene, and the voice
-- they speak in. Every generated scene with a character is filmed from those
-- same pictures (reference-to-video), so the face does not drift.
--
-- A character made from a photograph of a real person records that the
-- owner confirmed they have the right to use that likeness (consent_at).

create table if not exists public.video_characters (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  descriptor      text not null,
  reference_paths text[] not null default '{}'::text[],
  voice_id        text,
  source          text not null default 'generated',
  consent_at      timestamptz,
  status          text not null default 'making',
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint video_characters_shape_check check (
    char_length(name) between 1 and 60
    and char_length(descriptor) between 1 and 600
    and cardinality(reference_paths) <= 6
    and (voice_id is null or char_length(voice_id) <= 80)
    and source in ('generated', 'photo')
    and status in ('making', 'ready', 'failed')
    and (error is null or char_length(error) <= 500)
    and (source = 'generated' or consent_at is not null)
  )
);
create index if not exists video_characters_user_idx on public.video_characters (user_id, created_at desc);

alter table public.video_characters enable row level security;
drop policy if exists "owner reads video_characters" on public.video_characters;
create policy "owner reads video_characters" on public.video_characters for select using (user_id = (select auth.uid()));
drop policy if exists "owner writes video_characters" on public.video_characters;
create policy "owner writes video_characters" on public.video_characters for insert with check (user_id = (select auth.uid()));
drop policy if exists "owner updates video_characters" on public.video_characters;
create policy "owner updates video_characters" on public.video_characters for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "owner deletes video_characters" on public.video_characters;
create policy "owner deletes video_characters" on public.video_characters for delete using (user_id = (select auth.uid()));

-- Which characters a video uses, before and between its plans.
alter table public.video_projects add column if not exists character_ids uuid[] not null default '{}'::uuid[];
