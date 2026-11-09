import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// This isolates PostgreSQL/RLS behavior with simulated Supabase identities.
test('authorized teachers publish to shared catalog without modifying others', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.class_teachers(user_id uuid primary key references auth.users(id));
      alter table public.class_teachers enable row level security;
      grant usage on schema auth,public to authenticated;
      grant select on public.class_teachers to authenticated;
      create policy class_teachers_own on public.class_teachers for select to authenticated using(user_id=(select auth.uid()));
      create function public.is_admin() returns boolean language sql stable security definer as $$select coalesce(auth.uid()='00000000-0000-4000-8000-000000000001'::uuid,false)$$;
      create table public.subjects(id uuid primary key default gen_random_uuid(), slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), title text not null check(char_length(title) between 1 and 120), description text not null default '', published boolean not null default false);
      create table public.topics(id uuid primary key default gen_random_uuid(), subject_id uuid not null references public.subjects(id) on delete cascade, title text not null check(char_length(title) between 1 and 160), description text not null default '', published boolean not null default false);
      alter table public.subjects enable row level security; alter table public.topics enable row level security;
      grant select,insert,update,delete on public.subjects,public.topics to authenticated;
      create policy subjects_read_published on public.subjects for select to authenticated using(published);
      create policy topics_read_published on public.topics for select to authenticated using(published and exists(select 1 from public.subjects s where s.id=subject_id and s.published));
      create policy subjects_admin on public.subjects for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
      create policy topics_admin on public.topics for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
      insert into auth.users values ('00000000-0000-4000-8000-000000000001','admin@example.test'),('00000000-0000-4000-8000-000000000002','teacher@example.test'),('00000000-0000-4000-8000-000000000003','otherteacher@example.test'),('00000000-0000-4000-8000-000000000004','student@example.test');
      insert into public.class_teachers(user_id) select id from auth.users where email in ('teacher@example.test','otherteacher@example.test');
      insert into public.subjects(slug,title,published) values('existing','Existing',true),('hidden','Hidden',false);
    `);
    for (const migration of ['20261109155525_teacher_catalog.sql', '20261109155633_teacher_catalog_limits.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
    const ids=Array.from({length:4},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
    async function as(i) {await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ids[i-1]}',false)`)}
    await as(4);
    await assert.rejects(()=>db.query("select public.teacher_create_subject('A','a','')"));
    await assert.rejects(()=>db.query("insert into public.subjects(title,slug,published,created_by) values('A','a',true,$1)",[ids[1]]));
    await as(2);
    await assert.rejects(()=>db.query("select public.teacher_create_subject('A','a',$1)",['x'.repeat(5001)]));
    await assert.rejects(()=>db.query("select public.teacher_create_subject('A',$1,'')",['a'.repeat(121)]));
    let {rows}=await db.query("select public.teacher_create_subject('Matemática','matematica','Nova') as id"); const created=rows[0].id;
    ({rows}=await db.query("select id from public.subjects where slug='existing'")); const existing=rows[0].id;
    await assert.rejects(()=>db.query("select public.teacher_create_topic($1,'A',$2)",[existing,'x'.repeat(5001)]));
    ({rows}=await db.query("select public.teacher_create_topic($1,'Álgebra','Introdução') as id",[existing])); const topic=rows[0].id;
    await assert.rejects(()=>db.query("insert into public.subjects(title,slug,published,created_by) values('Spoof','spoof',true,$1)",[ids[2]]));
    ({rows}=await db.query("update public.subjects set title='Changed' where id=$1 returning id",[existing])); assert.equal(rows.length,0);
    ({rows}=await db.query("update public.subjects set published=false where id=$1 returning id",[created])); assert.equal(rows.length,0);
    ({rows}=await db.query('delete from public.topics where id=$1 returning id',[topic])); assert.equal(rows.length,0);
    await assert.rejects(()=>db.query("select public.teacher_create_subject('Duplicate','matematica','')"));
    await db.exec('reset role'); ({rows}=await db.query("select id from public.subjects where slug='hidden'")); const hidden=rows[0].id;
    await as(2); await assert.rejects(()=>db.query("select public.teacher_create_topic($1,'Secret','')",[hidden]));
    await as(4); ({rows}=await db.query('select title from public.subjects where id=$1',[created])); assert.equal(rows[0].title,'Matemática');
    ({rows}=await db.query('select title from public.topics where id=$1',[topic])); assert.equal(rows[0].title,'Álgebra');
    await as(3); ({rows}=await db.query('update public.topics set published=false where id=$1 returning id',[topic])); assert.equal(rows.length,0);
    await as(1); await db.query('update public.subjects set published=false where id=$1',[created]);
    await as(2); ({rows}=await db.query('select id from public.subjects where id=$1',[created])); assert.equal(rows.length,1);
    await as(4); ({rows}=await db.query('select id from public.subjects where id=$1',[created])); assert.equal(rows.length,0);
    await db.exec('reset role'); await db.query('delete from public.class_teachers where user_id=$1',[ids[1]]);
    await as(2); await assert.rejects(()=>db.query("select public.teacher_create_subject('Denied','denied','')"));
    ({rows}=await db.query('select id from public.subjects where id=$1',[created])); assert.equal(rows.length,0);
    await as(1); ({rows}=await db.query('select id from public.subjects where id=$1',[created])); assert.equal(rows.length,1);
  } finally {await db.close();}
});
