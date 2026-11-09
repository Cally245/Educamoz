-- Evaluations belong to a particular version of a submission. They are private
-- to the author and the currently authorized teacher who owns the classroom.
create table public.class_assessments (
  submission_id uuid primary key references public.class_submissions(id) on delete cascade,
  grade numeric not null check (grade between 0 and 20 and grade = round(grade, 1)),
  feedback text not null default '' check (char_length(feedback) <= 5000),
  evaluated_at timestamptz not null default now()
);
alter table public.class_assessments enable row level security;
revoke all on public.class_assessments from public, anon, authenticated;
grant select on public.class_assessments to authenticated;
create policy class_assessments_read on public.class_assessments for select to authenticated using (
  exists (select 1 from public.class_submissions s
    join public.class_assignments a on a.id = s.assignment_id
    where s.id = submission_id and
      ((s.user_id = (select auth.uid()) and public.is_class_member(a.class_id))
       or public.is_class_teacher(a.class_id)))
);

-- A change to a student's answer removes the old evaluation rather than
-- presenting it as an evaluation of the new answer.
create function public.clear_changed_submission_assessment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.content is distinct from new.content or old.link_url is distinct from new.link_url then
    delete from public.class_assessments where submission_id = new.id;
  end if;
  return new;
end; $$;
revoke all on function public.clear_changed_submission_assessment() from public, anon, authenticated;
create trigger class_submission_clear_assessment after update of content, link_url on public.class_submissions
for each row execute function public.clear_changed_submission_assessment();

-- Check both teacher ownership and the exact submission version the teacher read.
create function public.assess_class_submission(p_submission_id uuid, p_grade numeric, p_feedback text, p_expected_content text, p_expected_link text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_submission public.class_submissions%rowtype; v_class_id uuid;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if p_grade is null or p_grade < 0 or p_grade > 20 or p_grade <> round(p_grade, 1) then raise exception 'A nota deve estar entre 0 e 20, com até uma casa decimal' using errcode='22023'; end if;
  if char_length(coalesce(p_feedback, '')) > 5000 then raise exception 'Comentário demasiado longo' using errcode='22023'; end if;
  select s.* into v_submission from public.class_submissions s where s.id=p_submission_id for update;
  if not found then raise exception 'Entrega não encontrada' using errcode='42501'; end if;
  select a.class_id into v_class_id from public.class_assignments a where a.id=v_submission.assignment_id;
  if not public.is_class_teacher(v_class_id) then raise exception 'Acesso reservado ao professor da turma' using errcode='42501'; end if;
  if v_submission.content is distinct from p_expected_content or v_submission.link_url is distinct from p_expected_link then
    raise exception 'A entrega foi alterada; atualiza antes de avaliar' using errcode='40001';
  end if;
  insert into public.class_assessments(submission_id, grade, feedback, evaluated_at)
    values (p_submission_id, p_grade, btrim(coalesce(p_feedback,'')), now())
    on conflict (submission_id) do update set grade=excluded.grade, feedback=excluded.feedback, evaluated_at=excluded.evaluated_at;
end; $$;

-- This is deliberately irreversible, including members, assignments and work.
create function public.delete_classroom(p_class_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_class_teacher(p_class_id) then
    raise exception 'Acesso reservado ao professor da turma' using errcode='42501';
  end if;
  delete from public.classrooms where id=p_class_id;
  if not found then raise exception 'Turma não encontrada' using errcode='42501'; end if;
end; $$;
revoke all on function public.assess_class_submission(uuid,numeric,text,text,text), public.delete_classroom(uuid) from public, anon;
grant execute on function public.assess_class_submission(uuid,numeric,text,text,text), public.delete_classroom(uuid) to authenticated;
