-- Additive: existing chat_messages without a session remain available to old clients.
create table public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova aula' check (char_length(title) between 1 and 120),
  grade text not null default '' check (char_length(grade) <= 60),
  subject text not null default '' check (char_length(subject) <= 120),
  topic text not null default '' check (char_length(topic) <= 160),
  goal text not null default '' check (char_length(goal) <= 500),
  mode text not null default 'tutor' check (mode in ('tutor','lesson','exercise','exam','review','practice')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tutor_sessions_owner_idx on public.tutor_sessions(user_id, updated_at desc);
alter table public.tutor_sessions enable row level security;
revoke all on public.tutor_sessions from anon, authenticated;
grant select, insert, update, delete on public.tutor_sessions to authenticated;
create policy tutor_sessions_own on public.tutor_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger tutor_sessions_updated_at before update on public.tutor_sessions
for each row execute function public.set_profile_updated_at();

alter table public.chat_messages add column session_id uuid references public.tutor_sessions(id) on delete cascade;
create index chat_messages_session_idx on public.chat_messages(user_id, session_id, created_at desc);
-- Session ownership is an additional requirement to the existing per-user policies.
create policy chat_session_owner on public.chat_messages as restrictive for all to authenticated
  using (session_id is null or exists (select 1 from public.tutor_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  with check (session_id is null or exists (select 1 from public.tutor_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

-- Plan changes are administrative only; no client can upgrade its own entitlement.
create table public.tutor_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','premium')),
  updated_at timestamptz not null default now()
);
alter table public.tutor_plans enable row level security;
revoke all on public.tutor_plans from anon, authenticated;
grant select on public.tutor_plans to authenticated;
create policy tutor_plans_read_own on public.tutor_plans for select to authenticated using (user_id = (select auth.uid()));

create table public.tutor_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index tutor_usage_owner_time_idx on public.tutor_usage(user_id, created_at desc);
alter table public.tutor_usage enable row level security;
revoke all on public.tutor_usage from anon, authenticated;
grant select on public.tutor_usage to authenticated;
create policy tutor_usage_read_own on public.tutor_usage for select to authenticated using (user_id = (select auth.uid()));

-- A reservation counts even when the external provider fails, to avoid free retry abuse.
-- The transaction-scoped lock serializes concurrent requests for the same user.
create function public.reserve_tutor_request() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limit integer;
  v_today integer;
  v_minute integer;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if v_uid is null then raise exception 'Autenticação necessária' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select plan into v_plan from public.tutor_plans where user_id = v_uid;
  v_plan := coalesce(v_plan, 'free');
  v_limit := case when v_plan = 'premium' then 120 else 20 end;
  select count(*) filter (where created_at >= v_day_start),
         count(*) filter (where created_at >= now() - interval '1 minute')
    into v_today, v_minute from public.tutor_usage where user_id = v_uid and created_at >= least(v_day_start, now() - interval '1 minute');
  if v_today >= v_limit then return jsonb_build_object('allowed', false, 'reason', 'daily', 'limit', v_limit, 'remaining', 0, 'plan', v_plan); end if;
  if v_minute >= 5 then return jsonb_build_object('allowed', false, 'reason', 'minute', 'limit', v_limit, 'remaining', greatest(v_limit-v_today,0), 'plan', v_plan); end if;
  insert into public.tutor_usage(user_id) values (v_uid);
  return jsonb_build_object('allowed', true, 'limit', v_limit, 'remaining', greatest(v_limit-v_today-1,0), 'plan', v_plan);
end;
$$;
revoke all on function public.reserve_tutor_request() from public, anon;
grant execute on function public.reserve_tutor_request() to authenticated;
