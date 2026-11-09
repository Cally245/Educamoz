-- Study links reuse the existing global library.
create function public.teacher_create_material(p_title text, p_description text, p_url text, p_topic_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.class_teachers where user_id=auth.uid()) then raise exception 'Acesso reservado' using errcode='42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 or char_length(coalesce(p_description,''))>5000 or p_url is null or char_length(p_url)>2048 or p_url !~* '^https?://[^[:space:]]+$' then raise exception 'Material inválido' using errcode='22023'; end if;
  if p_topic_id is not null and not exists(select 1 from public.topics t join public.subjects s on s.id=t.subject_id where t.id=p_topic_id and t.published and s.published) then raise exception 'Matéria indisponível' using errcode='22023'; end if;
  insert into public.materials(title,description,url,topic_id,published) values(btrim(p_title),btrim(coalesce(p_description,'')),btrim(p_url),p_topic_id,true) returning id into v_id;
  return v_id;
end; $$;

alter table public.exams add column created_by uuid references auth.users(id) on delete set null;
alter table public.exam_questions add column kind text not null default 'multiple_choice' check (kind in ('multiple_choice','written'));
alter table public.exam_questions drop constraint exam_questions_options_check;
alter table public.exam_questions add constraint exam_questions_options_check check (
  jsonb_typeof(options)='array' and ((kind='multiple_choice' and jsonb_array_length(options) between 2 and 6) or (kind='written' and jsonb_array_length(options)=0))
);
alter table public.exam_attempts add column status text not null default 'graded' check (status in ('graded','pending_review'));
alter table public.exam_attempts add column final_grade numeric check (final_grade is null or final_grade between 0 and 20);
create table public.exam_written_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid references public.exam_questions(id) on delete set null,
  question_text text not null,
  question_position integer not null,
  answer text not null check(char_length(btrim(answer)) between 1 and 10000),
  grade numeric check(grade between 0 and 20 and grade=round(grade,1)),
  feedback text not null default '' check(char_length(feedback)<=5000),
  unique(attempt_id, question_id)
);
create index exam_written_answers_attempt_idx on public.exam_written_answers(attempt_id);
alter table public.exam_written_answers enable row level security;
revoke all on public.exam_written_answers from public, anon, authenticated;
grant select on public.exam_written_answers to authenticated;
create policy exam_written_student_read on public.exam_written_answers for select to authenticated using (
  exists(select 1 from public.exam_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()))
);

-- Create an entire valid exam atomically; the answer key is never granted to teachers or students.
create function public.teacher_create_exam(p_subject_id uuid,p_title text,p_description text,p_questions jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_exam uuid; v_question uuid; v_item jsonb; v_option jsonb; v_index int:=0; v_correct int;
begin
  if v_uid is null or not exists(select 1 from public.class_teachers where user_id=v_uid) then raise exception 'Acesso reservado' using errcode='42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 or char_length(coalesce(p_description,''))>5000 then raise exception 'Exame inválido' using errcode='22023'; end if;
  if not exists(select 1 from public.subjects where id=p_subject_id and published) then raise exception 'Disciplina indisponível' using errcode='22023'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 30 then raise exception 'Indica entre 1 e 30 perguntas' using errcode='22023'; end if;
  insert into public.exams(subject_id,title,description,published,created_by) values(p_subject_id,btrim(p_title),btrim(coalesce(p_description,'')),false,v_uid) returning id into v_exam;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_index:=v_index+1;
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'question') is distinct from 'string' or char_length(btrim(v_item->>'question')) not between 1 and 2000 then raise exception 'Pergunta inválida' using errcode='22023'; end if;
    if v_item->>'kind'='written' then
      insert into public.exam_questions(exam_id,position,question,options,kind) values(v_exam,v_index,btrim(v_item->>'question'),'[]'::jsonb,'written');
    elsif v_item->>'kind'='multiple_choice' then
      if jsonb_typeof(v_item->'options') is distinct from 'array' or jsonb_array_length(v_item->'options') not between 2 and 6 or (v_item->>'correct') is null or (v_item->>'correct') !~ '^[0-5]$' then raise exception 'Opções inválidas' using errcode='22023'; end if;
      for v_option in select value from jsonb_array_elements(v_item->'options') loop
        if jsonb_typeof(v_option) <> 'string' or char_length(btrim(v_option#>>'{}')) not between 1 and 500 then raise exception 'Opção inválida' using errcode='22023'; end if;
      end loop;
      v_correct:=(v_item->>'correct')::int;
      if v_correct>=jsonb_array_length(v_item->'options') then raise exception 'Resposta correta inválida' using errcode='22023'; end if;
      insert into public.exam_questions(exam_id,position,question,options,kind) values(v_exam,v_index,btrim(v_item->>'question'),v_item->'options','multiple_choice') returning id into v_question;
      insert into public.exam_answer_keys(question_id,correct_index) values(v_question,v_correct);
    else raise exception 'Tipo de pergunta inválido' using errcode='22023'; end if;
  end loop;
  update public.exams set published=true where id=v_exam;
  return v_exam;
end; $$;

-- Preserve the existing simulator RPC and result table, adding pending written reviews.
create or replace function public.submit_exam(p_exam_id uuid,p_answers jsonb) returns public.exam_attempts
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_total int; v_score int:=0; v_written int:=0; v_title text; v_result public.exam_attempts; v_q record; v_value jsonb;
begin
  if v_user is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'Respostas inválidas' using errcode='22023'; end if;
  select e.title into v_title from public.exams e join public.subjects s on s.id=e.subject_id where e.id=p_exam_id and e.published and s.published;
  if v_title is null then raise exception 'Exame indisponível' using errcode='22023'; end if;
  select count(*) into v_total from public.exam_questions where exam_id=p_exam_id;
  if v_total=0 or v_total>200 or (select count(*) from jsonb_object_keys(p_answers))<>v_total then raise exception 'Responde a todas as perguntas' using errcode='22023'; end if;
  for v_q in select q.*,k.correct_index from public.exam_questions q left join public.exam_answer_keys k on k.question_id=q.id where q.exam_id=p_exam_id loop
    v_value:=p_answers->v_q.id::text;
    if v_q.kind='multiple_choice' then
      if v_q.correct_index is null or v_q.correct_index >= jsonb_array_length(v_q.options) or v_value is null or jsonb_typeof(v_value) not in ('number','string') or (v_value#>>'{}') !~ '^[0-5]$' or (v_value#>>'{}')::int>=jsonb_array_length(v_q.options) then raise exception 'Respostas inválidas' using errcode='22023'; end if;
      if (v_value#>>'{}')::int=v_q.correct_index then v_score:=v_score+1; end if;
    else
      if jsonb_typeof(v_value) is distinct from 'string' or char_length(btrim(v_value#>>'{}')) not between 1 and 10000 then raise exception 'Resposta escrita inválida' using errcode='22023'; end if;
      v_written:=v_written+1;
    end if;
  end loop;
  insert into public.exam_attempts(user_id,exam_id,exam_title,score,total,status,final_grade)
    values(v_user,p_exam_id,v_title,v_score,v_total,case when v_written>0 then 'pending_review' else 'graded' end,case when v_written>0 then null else round(v_score::numeric*20/v_total,1) end) returning * into v_result;
  insert into public.exam_written_answers(attempt_id,question_id,question_text,question_position,answer)
    select v_result.id,q.id,q.question,q.position,btrim(p_answers->>q.id::text) from public.exam_questions q where q.exam_id=p_exam_id and q.kind='written';
  return v_result;
end; $$;

create function public.teacher_exam_reviews() returns table(answer_id uuid,attempt_id uuid,exam_title text,student_name text,question text,answer text,grade numeric,feedback text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.class_teachers where user_id=auth.uid()) then raise exception 'Acesso reservado' using errcode='42501'; end if;
  return query select w.id,a.id,e.title,coalesce(nullif(btrim(p.display_name),''),'Estudante'),w.question_text,w.answer,w.grade,w.feedback
    from public.exam_written_answers w join public.exam_attempts a on a.id=w.attempt_id join public.exams e on e.id=a.exam_id left join public.profiles p on p.id=a.user_id
    where e.created_by=auth.uid() order by a.completed_at desc, w.question_position;
end; $$;

create function public.teacher_grade_exam_answer(p_answer_id uuid,p_grade numeric,p_feedback text) returns void
language plpgsql security definer set search_path='' as $$
declare v_attempt uuid; v_exam uuid; v_total int; v_score int; v_pending int; v_sum numeric;
begin
  if auth.uid() is null or not exists(select 1 from public.class_teachers where user_id=auth.uid()) then raise exception 'Acesso reservado' using errcode='42501'; end if;
  if p_grade is null or p_grade<0 or p_grade>20 or p_grade<>round(p_grade,1) or char_length(coalesce(p_feedback,''))>5000 then raise exception 'Avaliação inválida' using errcode='22023'; end if;
  select a.id,e.id into v_attempt,v_exam from public.exam_written_answers w join public.exam_attempts a on a.id=w.attempt_id join public.exams e on e.id=a.exam_id where w.id=p_answer_id and e.created_by=auth.uid();
  if v_attempt is null then raise exception 'Acesso reservado' using errcode='42501'; end if;
  select total,score into v_total,v_score from public.exam_attempts where id=v_attempt for update;
  update public.exam_written_answers set grade=p_grade,feedback=btrim(coalesce(p_feedback,'')) where id=p_answer_id and attempt_id=v_attempt;
  select count(*) filter(where grade is null),coalesce(sum(grade),0) into v_pending,v_sum from public.exam_written_answers where attempt_id=v_attempt;
  update public.exam_attempts set status=case when v_pending=0 then 'graded' else 'pending_review' end,
    final_grade=case when v_pending=0 then round((v_score*20+v_sum)/v_total,1) else null end where id=v_attempt;
end; $$;

-- Ranking includes each member's best graded attempt on the selected exam.
create function public.class_exam_ranking(p_class_id uuid,p_exam_id uuid) returns table(student_name text,grade numeric,completed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_class_teacher(p_class_id) then raise exception 'Acesso reservado' using errcode='42501'; end if;
  if not exists(select 1 from public.exams e join public.subjects s on s.id=e.subject_id where e.id=p_exam_id and e.published and s.published) then raise exception 'Exame indisponível' using errcode='42501'; end if;
  return query select x.name,x.grade,x.completed from (
    select distinct on(a.user_id) a.user_id,coalesce(nullif(btrim(p.display_name),''),'Estudante') as name,
      coalesce(a.final_grade,round(a.score::numeric*20/a.total,1)) as grade,a.completed_at as completed
    from public.class_members m join public.exam_attempts a on a.user_id=m.user_id left join public.profiles p on p.id=a.user_id
    where m.class_id=p_class_id and a.exam_id=p_exam_id and a.status='graded'
    order by a.user_id,coalesce(a.final_grade,round(a.score::numeric*20/a.total,1)) desc,a.completed_at desc
  ) x order by x.grade desc,x.completed asc,x.user_id;
end; $$;
revoke all on function public.teacher_create_material(text,text,text,uuid),public.teacher_create_exam(uuid,text,text,jsonb),public.teacher_exam_reviews(),public.teacher_grade_exam_answer(uuid,numeric,text),public.class_exam_ranking(uuid,uuid) from public,anon;
grant execute on function public.teacher_create_material(text,text,text,uuid),public.teacher_create_exam(uuid,text,text,jsonb),public.teacher_exam_reviews(),public.teacher_grade_exam_answer(uuid,numeric,text),public.class_exam_ranking(uuid,uuid) to authenticated;
