-- Limit client-supplied catalogue text on the server as well as in the UI.
create or replace function public.teacher_create_subject(p_title text, p_slug text, p_description text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.class_teachers where user_id=v_uid) then
    raise exception 'Acesso reservado a professores autorizados' using errcode='42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120
     or p_slug is null or char_length(btrim(p_slug)) not between 1 and 120
     or char_length(coalesce(p_description,'')) > 5000 then
    raise exception 'Dados da disciplina inválidos' using errcode='22023';
  end if;
  insert into public.subjects(title,slug,description,published,created_by)
    values(btrim(p_title),btrim(p_slug),coalesce(btrim(p_description),''),true,v_uid) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.teacher_create_topic(p_subject_id uuid, p_title text, p_description text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.class_teachers where user_id=v_uid) then
    raise exception 'Acesso reservado a professores autorizados' using errcode='42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160
     or char_length(coalesce(p_description,'')) > 5000 then
    raise exception 'Dados da matéria inválidos' using errcode='22023';
  end if;
  if not exists (select 1 from public.subjects where id=p_subject_id and published) then
    raise exception 'Escolhe uma disciplina publicada' using errcode='22023';
  end if;
  insert into public.topics(subject_id,title,description,published,created_by)
    values(p_subject_id,btrim(p_title),coalesce(btrim(p_description),''),true,v_uid) returning id into v_id;
  return v_id;
end; $$;
