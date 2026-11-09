import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Local role simulation exercises SQL and RLS; it does not replace browser/Auth tests.
test('only the classroom teacher may delete or evaluate, and assessments follow the submission version', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
      create table auth.users(id uuid primary key,email text);
      create table public.profiles(id uuid primary key,display_name text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.is_admin() returns boolean language sql stable security definer as $$select coalesce(auth.uid()='00000000-0000-4000-8000-000000000001'::uuid,false)$$;
      create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$select decode(substr(md5(random()::text),1,$1*2),'hex')$$;
      grant usage on schema auth,public to authenticated;
      insert into auth.users values
      ('00000000-0000-4000-8000-000000000001','admin@example.test'),
      ('00000000-0000-4000-8000-000000000002','teacher@example.test'),
      ('00000000-0000-4000-8000-000000000003','student@example.test'),
      ('00000000-0000-4000-8000-000000000004','peer@example.test'),
      ('00000000-0000-4000-8000-000000000005','otherteacher@example.test');
      insert into public.profiles select id,email from auth.users;`);
    for (const migration of ['20261109153033_classrooms.sql','20261109154511_classroom_assessments.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
    const ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
    async function as(i) {await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ids[i-1]}',false)`);}
    await as(1); await db.query("select public.set_class_teacher('teacher@example.test',true)"); await db.query("select public.set_class_teacher('otherteacher@example.test',true)");
    await as(2); let {rows}=await db.query("select public.create_classroom('A','') as id"); const classId=rows[0].id;
    ({rows}=await db.query('select public.classroom_code($1) as code',[classId])); const code=rows[0].code;
    ({rows}=await db.query("insert into public.class_assignments(class_id,title,instructions) values($1,'A','B') returning id",[classId])); const assignment=rows[0].id;
    await as(3); await db.query('select public.join_classroom($1)',[code]);
    ({rows}=await db.query("insert into public.class_submissions(assignment_id,user_id,content) values($1,$2,'First answer') returning id",[assignment,ids[2]])); const submission=rows[0].id;
    const grade=(content='First answer',value=15.5)=>db.query('select public.assess_class_submission($1,$2,$3,$4,$5)',[submission,value,'Bom trabalho',content,null]);
    await assert.rejects(()=>grade());
    await assert.rejects(()=>db.query('select public.delete_classroom($1)',[classId]));
    await assert.rejects(()=>db.query("insert into public.class_assessments(submission_id,grade) values($1,20)",[submission]));
    await as(5); await assert.rejects(()=>grade()); await assert.rejects(()=>db.query('select public.delete_classroom($1)',[classId]));
    await as(2); await assert.rejects(()=>grade('First answer',20.1)); await assert.rejects(()=>grade('First answer',10.55));
    await grade(); ({rows}=await db.query('select grade,feedback from public.class_assessments')); assert.equal(Number(rows[0].grade),15.5);
    await as(4); await db.query('select public.join_classroom($1)',[code]); ({rows}=await db.query('select * from public.class_assessments')); assert.equal(rows.length,0);
    await as(3); ({rows}=await db.query('select grade,feedback from public.class_assessments')); assert.equal(Number(rows[0].grade),15.5); assert.equal(rows[0].feedback,'Bom trabalho');
    await assert.rejects(()=>db.query('update public.class_assessments set grade=20'));
    // No-op saves keep the grade, genuine changes invalidate it.
    await db.query("update public.class_submissions set content='First answer' where id=$1",[submission]);
    ({rows}=await db.query('select * from public.class_assessments')); assert.equal(rows.length,1);
    await db.query("update public.class_submissions set content='Revised answer' where id=$1",[submission]);
    ({rows}=await db.query('select * from public.class_assessments')); assert.equal(rows.length,0);
    await as(2); await assert.rejects(()=>grade('First answer'), {code:'40001'}); await grade('Revised answer',17);
    await as(1); await db.query("select public.set_class_teacher('teacher@example.test',false)");
    await as(2); await assert.rejects(()=>grade('Revised answer')); await assert.rejects(()=>db.query('select public.delete_classroom($1)',[classId]));
    await as(1); await db.query("select public.set_class_teacher('teacher@example.test',true)");
    await as(2); await db.query('select public.delete_classroom($1)',[classId]);
    await db.exec('reset role');
    for (const table of ['classrooms','class_members','class_assignments','class_submissions','class_assessments']) {
      ({rows}=await db.query(`select count(*)::int as count from public.${table}`)); assert.equal(rows[0].count,0,table);
    }
  } finally {await db.close();}
});
