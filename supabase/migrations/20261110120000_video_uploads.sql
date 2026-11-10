-- The video studio takes the person's own footage, sound and pictures.
--
-- An upload goes from the browser straight into the private video-assets
-- bucket (never through a function body), then is registered as a
-- video_assets row and prepared on the server: probed, given a working copy
-- every cut can read the same way (H.264, 30 fps, AAC stereo) and a poster
-- frame. Uploaded clips become scenes of the timeline like generated ones,
-- and a new pipeline, clip_edit ("Edit my clips"), stitches them.

-- The kinds an upload can be, beside the references and renders.
alter table public.video_assets drop constraint if exists video_assets_kind_check;
alter table public.video_assets add constraint video_assets_kind_check
  check (kind in ('product','person','photo','reference','render','video','audio','image'));

alter table public.video_assets
  add column if not exists name         text not null default '',
  add column if not exists source       text not null default 'upload',
  add column if not exists status       text not null default 'ready',
  add column if not exists error        text,
  add column if not exists size_bytes   bigint,
  add column if not exists duration_s   numeric,
  add column if not exists width        integer,
  add column if not exists height       integer,
  add column if not exists has_audio    boolean,
  add column if not exists working_path text,
  add column if not exists poster_path  text,
  add column if not exists analysis     jsonb,
  add column if not exists updated_at   timestamptz not null default now();

alter table public.video_assets drop constraint if exists video_assets_upload_shape_check;
alter table public.video_assets add constraint video_assets_upload_shape_check check (
  char_length(name) <= 200
  and source in ('upload','generated')
  and status in ('processing','ready','failed')
  and (error is null or char_length(error) <= 500)
  and (working_path is null or char_length(working_path) <= 400)
  and (poster_path is null or char_length(poster_path) <= 400)
);

-- clip_edit: the person's clips, stitched.
alter table public.video_projects drop constraint if exists video_projects_pipeline_check;
alter table public.video_projects add constraint video_projects_pipeline_check check (pipeline in (
  'animated_graphics','commercial_ad','product_showcase','clone','cinematic_short',
  'ugc_influencer','social_video','explainer','trailer','photo_to_video','clip_edit'));

-- A clip may be up to 400 MB: it is prepared in a function whose /tmp holds
-- 512 MB, the upload and its working copy together.
update storage.buckets set file_size_limit = 419430400 where id = 'video-assets';
