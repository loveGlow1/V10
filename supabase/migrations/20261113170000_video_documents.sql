-- Documents a video's director reads (a script, a brand guide, a brief):
-- PDF, TXT or Markdown, uploaded beside the clips (src/lib/video/assets.ts).
alter table public.video_assets drop constraint if exists video_assets_kind_check;
alter table public.video_assets add constraint video_assets_kind_check
  check (kind in ('product','person','photo','reference','render','video','audio','image','document'));
