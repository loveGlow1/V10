/* QuickStark.Ai — the project asset library.

   Safe to run more than once, like the other files here. It creates one table,
   its indexes and its policies, plus the storage bucket the bytes go in.

   WHY THIS EXISTS

   Pictures used to live inside the generated page: base64 in the markup, made
   again on every build, impossible to reuse, impossible to replace without
   rewriting the page, and carried in full by every reader whether they scrolled
   to them or not.

   An asset is a thing now. It has an id, it belongs to a project, it came from
   somewhere (the user uploaded it, we generated it, a library provided it), it
   is in a state, and it remembers the request that produced it — which is what
   lets the next build find it instead of paying to make it again.

   See src/lib/builder/assets/. */

create table if not exists public.project_assets (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,

  /* What it is, which also decides whether it is a photograph at all: a logo,
     an icon and an avatar are drawn in code and never sourced. See MEDIUM in
     src/lib/builder/assets/asset-types.ts. */
  type text not null,

  /* user | generated | external | placeholder — and the order of preference
     when a slot is filled, which is why "user" must always be distinguishable. */
  source text not null,

  /* pending | generating | ready | failed. A failed asset is kept rather than
     deleted: it is the record of what was tried, and it stops a retry loop
     asking for the same impossible picture on every build. */
  status text not null default 'pending',

  url text not null default '',
  thumbnail_url text,
  width integer,
  height integer,
  format text,
  quality text not null default 'premium',

  /* The FINGERPRINT of the visual spec, not the sentence somebody typed. Two
     builds that resolve to the same picture share it; two that resolve to
     different pictures do not, however similar the wording was. This column is
     the whole of the reuse mechanism. */
  prompt text,
  provider text,

  alt_text text,
  tags text[],

  /* Set when this asset replaced or was derived from another — a regenerated
     hero, an upscaled product shot. Keeps the history without keeping the bytes
     twice. */
  parent_asset_id uuid references public.project_assets(id) on delete set null,
  generation_version integer default 1,

  created_at timestamptz not null default now()
);

/* Read paths, in the order they are actually used: everything for one project,
   then the reuse lookup, which is a fingerprint within a project. */
create index if not exists project_assets_project_idx
  on public.project_assets (project_id, created_at desc);

create index if not exists project_assets_reuse_idx
  on public.project_assets (project_id, prompt, status)
  where prompt is not null;

alter table public.project_assets enable row level security;

/* Owners read their own project's assets. Writes go through the service key
   from the build path, which is deliberate: the browser must not be able to
   point a project's asset at an address of its own choosing, because that
   address is then served inside somebody's site. */
drop policy if exists "Owners read their project assets" on public.project_assets;
create policy "Owners read their project assets"
  on public.project_assets for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

/* The bucket the bytes live in.

   Public-read on purpose: these are pictures on a public website, and signing
   each one would mean a page whose images expire. Writes are service-key only —
   the policy below grants nothing to anon or authenticated, which is what keeps
   the bucket from becoming open storage. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  true,
  26214400,
  array['image/webp','image/jpeg','image/png','image/svg+xml','image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone may read project assets" on storage.objects;
create policy "Anyone may read project assets"
  on storage.objects for select
  using (bucket_id = 'project-assets');

/* The curated library gets a bucket of its own, because it is global rather
   than per-project: one catalogue of photographs every build may draw on, not
   something owned by whoever's project happened to acquire it first.

   It stays empty until the photographs are uploaded, and that is fine — the
   provider reports itself misconfigured while CURATED_ASSETS_BASE_URL is
   unset, so it is skipped rather than serving addresses that 404. Point that
   variable here once there are files at the paths the catalogue names
   (src/lib/builder/assets/providers/curated.ts). */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quickstark-library',
  'quickstark-library',
  true,
  26214400,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone may read the curated library" on storage.objects;
create policy "Anyone may read the curated library"
  on storage.objects for select
  using (bucket_id = 'quickstark-library');
