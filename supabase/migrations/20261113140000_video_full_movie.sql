-- Full Movie: Nollywood-style feature films up to an hour (lib/video/pipelines.ts).
alter table public.video_projects drop constraint if exists video_projects_pipeline_check;
alter table public.video_projects add constraint video_projects_pipeline_check check (pipeline in (
  'animated_graphics','commercial_ad','product_showcase','clone','cinematic_short',
  'ugc_influencer','social_video','explainer','trailer','photo_to_video','clip_edit','full_movie'));
