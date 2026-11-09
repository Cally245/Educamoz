import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// PostgreSQL-compatible isolated test with stubbed Auth; not a real-user browser test.
test('classroom roles, membership and submission isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
      create table auth.users(id uuid primary key,email text);
      create table public.profiles(id uuid primary key,display_name text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.is_admin() returns boolean language sql stable security definer as $$select coalesce(auth.uid()='00000000-0000-4000-8000-000000000001'::uuid,false)$$;
      -- Test-only random bytes stand-in, not used in production.
      create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$select decode(substr(md5(random()::text),1,$1*2),'hex')$$;
      grant usage on schema auth,public to authenticated;
      insert into auth.users values
      ('00000000-0000-4000-8000-000000000001','admin@example.test'),
      ('00000000-0000-4000-8000-000000000002','teacher@example.test'),
      ('00000000-0000-4000-8000-000000000003','student1@example.test'),
      ('00000000-0000-4000-8000-000000000004','student2@example.test'),
      ('00000000-0000-4000-8000-000000000005','outsider@example.test');
      insert into public.profiles select id,email from auth.users;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261109153033_classrooms.sql',import.meta.url),'utf8'));
    const ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
    async function as(i) {await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ids[i-1]}',false)`);}
    await as(3);
    await assert.rejects(()=>db.query("select public.create_classroom('A','')"));
    await assert.rejects(()=>db.query("select public.set_class_teacher('teacher@example.test',true)"));
    await as(1); await db.query("select public.set_class_teacher('teacher@example.test',true)");
    await as(2); let {rows}=await db.query("select public.create_classroom('A','') as id"); const classId=rows[0].id;
    ({rows}=await db.query('select public.classroom_code($1) as code',[classId])); const code=rows[0].code; assert.match(code,/^[A-F0-9]{24}$/);
    ({rows}=await db.query("insert into public.class_assignments(class_id,title,instructions) values($1,'A','B') returning id",[classId])); const assignmentId=rows[0].id;
    await as(5); ({rows}=await db.query('select id from public.classrooms')); assert.equal(rows.length,0);
    await assert.rejects(()=>db.query('select public.classroom_code($1)',[classId]));
    await assert.rejects(()=>db.query('select access_code from public.classrooms'));
    await assert.rejects(()=>db.query("insert into public.class_submissions(assignment_id,user_id,content) values($1,$2,'X')",[assignmentId,ids[4]]));
    await as(3); ({rows}=await db.query('select public.join_classroom($1) as result',[code])); assert.equal(rows[0].result.ok,true);
    await db.query("insert into public.class_submissions(assignment_id,user_id,content) values($1,$2,'One')",[assignmentId,ids[2]]);
    await assert.rejects(()=>db.query('select public.class_assignment_submissions($1)',[assignmentId]));
    await as(4); await db.query('select public.join_classroom($1)',[code]); ({rows}=await db.query('select id from public.class_submissions')); assert.equal(rows.length,0);
    await db.query("insert into public.class_submissions(assignment_id,user_id,content) values($1,$2,'Two')",[assignmentId,ids[3]]);
    ({rows}=await db.query('select content from public.class_submissions')); assert.deepEqual(rows.map(row=>row.content),['Two']);
    await assert.rejects(()=>db.query('update public.class_submissions set user_id=$1',[ids[2]]));
    await db.query("update public.class_submissions set content='Updated' where user_id=$1",[ids[3]]);
    await as(2); ({rows}=await db.query('select * from public.class_assignment_submissions($1)',[assignmentId])); assert.deepEqual(rows.map(row=>row.content).sort(),['One','Updated']);
    await as(1); await db.query("select public.set_class_teacher('teacher@example.test',false)");
    await as(2); await assert.rejects(()=>db.query('select public.classroom_code($1)',[classId]));
    await assert.rejects(()=>db.query("insert into public.class_assignments(class_id,title,instructions) values($1,'C','D')",[classId]));
    await as(5); for(let i=0;i<10;i++) await db.query("select public.join_classroom('BAD')");
    ({rows}=await db.query("select public.join_classroom('BAD') as result")); assert.equal(rows[0].result.reason,'rate');
  } finally {await db.close();}
});
