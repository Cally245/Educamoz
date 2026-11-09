-- Existing catalog is shared. Ownership is recorded for new content; existing
-- records remain unchanged and stay under administrator management.
alter table public.subjects add column created_by uuid references auth.users(id) on delete set null default auth.uid();
alter table public.topics add column created_by uuid references auth.users(id) on delete set null default auth.uid();
create index subjects_created_by_idx on public.subjects(created_by);
create index topics_created_by_idx on public.topics(created_by);

-- Teachers can inspect their own unpublished records but not other drafts.
create policy subjects_teacher_read_own on public.subjects for select to authenticated using (
  created_by = (select auth.uid()) and exists (select 1 from public.class_teachers t where t.user_id = (select auth.uid()))
);
create policy topics_teacher_read_own on public.topics for select to authenticated using (
  created_by = (select auth.uid()) and exists (select 1 from public.class_teachers t where t.user_id = (select auth.uid()))
);

-- Narrow server-side operations avoid granting teachers general editing or
-- deletion rights on existing catalog content or administrator-only resources.
create function public.teacher_create_subject(p_title text, p_slug text, p_description text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.class_teachers where user_id=v_uid) then
    raise exception 'Acesso reservado a professores autorizados' using errcode='42501';
  end if;
  insert into public.subjects(title,slug,description,published,created_by)
    values(btrim(p_title),btrim(p_slug),coalesce(btrim(p_description),''),true,v_uid) returning id into v_id;
  return v_id;
end; $$;

create function public.teacher_create_topic(p_subject_id uuid, p_title text, p_description text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.class_teachers where user_id=v_uid) then
    raise exception 'Acesso reservado a professores autorizados' using errcode='42501';
  end if;
  -- A topic may only be added to an already published subject. This ensures
  -- an immediately published topic is actually visible to students.
  if not exists (select 1 from public.subjects where id=p_subject_id and published) then
    raise exception 'Escolhe uma disciplina publicada' using errcode='22023';
  end if;
  insert into public.topics(subject_id,title,description,published,created_by)
    values(p_subject_id,btrim(p_title),coalesce(btrim(p_description),''),true,v_uid) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.teacher_create_subject(text,text,text), public.teacher_create_topic(uuid,text,text) from public, anon;
grant execute on function public.teacher_create_subject(text,text,text), public.teacher_create_topic(uuid,text,text) to authenticated;
