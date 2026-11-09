-- Prevent deleting a topic from accidentally exposing its previously hidden materials.
alter table public.materials drop constraint materials_topic_id_fkey;
alter table public.materials add constraint materials_topic_id_fkey
  foreign key (topic_id) references public.topics(id) on delete restrict;
