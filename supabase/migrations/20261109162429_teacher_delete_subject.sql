-- Teachers can delete only their own empty subjects. Never cascade through
-- shared topics, materials, exams or student work.
create function public.teacher_delete_subject(p_subject_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform 1 from public.class_teachers where user_id=v_user for share;
  if v_user is null or not found then
    raise exception 'Acesso reservado a professores autorizados' using errcode='42501';
  end if;
  perform 1 from public.subjects where id=p_subject_id and created_by=v_user for update;
  if not found then
    raise exception 'Disciplina indisponível ou sem permissão' using errcode='42501';
  end if;
  if exists (select 1 from public.topics where subject_id=p_subject_id)
     or exists (select 1 from public.exams where subject_id=p_subject_id) then
    raise exception 'A disciplina possui matérias ou exames associados' using errcode='23503';
  end if;
  delete from public.subjects where id=p_subject_id and created_by=v_user;
end; $$;
revoke all on function public.teacher_delete_subject(uuid) from public, anon;
grant execute on function public.teacher_delete_subject(uuid) to authenticated;

-- Authors may also see their own unpublished exams while authorized.
create policy exams_teacher_read_own on public.exams for select to authenticated
  using (created_by = (select auth.uid()) and exists (select 1 from public.class_teachers where user_id = (select auth.uid())));
