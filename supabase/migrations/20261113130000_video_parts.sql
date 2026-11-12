-- A long film is cut in parts (src/lib/video/chapters.ts): one video_renders
-- row per part, engine 'part', provider 'part:<k>'.
alter table public.video_renders drop constraint if exists video_renders_engine_check;
alter table public.video_renders add constraint video_renders_engine_check
  check (engine in ('video','image','avatar','voice','music','compose','part'));

-- A finished film of up to an hour is written into this bucket as one file
-- (streamed, chapters.ts), which can be well over the 400 MB an upload may
-- be. Uploads keep their own limits in the app (lib/video/assets.ts LIMITS).
-- The project's global upload limit (Storage settings) must allow it too.
update storage.buckets set file_size_limit = 5368709120 where id = 'video-assets';
