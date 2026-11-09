-- Base inicial sem conteúdo de demonstração inserido. Os resultados são declarados
-- pelo cliente e não devem ser tratados como notas verificadas ou exames oficiais.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.topics(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  url text not null check (url ~ '^https?://'),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_label text not null check (char_length(exercise_label) between 1 and 160),
  score integer not null check (score >= 0),
  total integer not null check (total > 0 and score <= total),
  completed_at timestamptz not null default now()
);

create index topics_subject_id_idx on public.topics(subject_id);
create index materials_topic_id_idx on public.materials(topic_id);
create index practice_attempts_user_completed_idx on public.practice_attempts(user_id, completed_at desc);

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.materials enable row level security;
alter table public.practice_attempts enable row level security;

-- Restrict client privileges explicitly; server-side administrative access must
-- be implemented separately and must never expose a service key to clients.
revoke all on public.profiles, public.subjects, public.topics, public.materials, public.practice_attempts from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.subjects, public.topics, public.materials to authenticated;
grant select, insert, delete on public.practice_attempts to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy subjects_read_published on public.subjects for select to authenticated using (published);
create policy topics_read_published on public.topics for select to authenticated using (
  published and exists (select 1 from public.subjects s where s.id = subject_id and s.published)
);
create policy materials_read_published on public.materials for select to authenticated using (
  published and (topic_id is null or exists (select 1 from public.topics t where t.id = topic_id and t.published))
);
create policy attempts_select_own on public.practice_attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy attempts_insert_own on public.practice_attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy attempts_delete_own on public.practice_attempts for delete to authenticated using ((select auth.uid()) = user_id);

create function public.set_profile_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_profile_updated_at();
