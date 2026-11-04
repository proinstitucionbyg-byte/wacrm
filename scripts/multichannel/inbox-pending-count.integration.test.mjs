import {PGlite} from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('counts distinct visible contacts until a reply is actually sent, independently of opening the chat',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
   create function public.has_member_permission(uuid,text,text) returns boolean language sql as $$select true$$;
   create table conversations(id uuid primary key,account_id uuid,contact_id uuid,inbox_cleared_at timestamptz,unread_count int default 0);
   create table messages(id uuid default gen_random_uuid(),conversation_id uuid,sender_type text,status text,created_at timestamptz);
   alter table conversations enable row level security;alter table messages enable row level security;
   grant usage on schema public,auth to authenticated;grant select on conversations,messages to authenticated;
   create policy visible_conversations on conversations to authenticated using(account_id='00000000-0000-0000-0000-000000000001');
   create policy visible_messages on messages to authenticated using(exists(select 1 from conversations c where c.id=conversation_id));`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104180121_inbox_pending_contact_count.sql',import.meta.url),'utf8'));
  const account='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
  const conv='00000000-0000-0000-0000-000000000011',second='00000000-0000-0000-0000-000000000012';
  await db.query(`insert into conversations values($1,$3,$1,null,100),($2,$3,$2,null,1),('00000000-0000-0000-0000-000000000013',$4,$2,null,1)`,[conv,second,account,other]);
  await db.exec(`insert into messages(conversation_id,sender_type,status,created_at) select '${conv}','customer','delivered','2026-11-04 10:00Z'::timestamptz+g*interval '1 second' from generate_series(1,100) g;
   insert into messages(conversation_id,sender_type,status,created_at) values('${second}','customer','delivered','2026-11-04 10:00Z');`);
  const count=async(acct=account)=>{await db.exec('set role authenticated');try{return Number((await db.query('select inbox_pending_contact_count($1) n',[acct])).rows[0].n);}finally{await db.exec('reset role');}};
  assert.equal(await count(),2);assert.equal(await count(other),0);
  await db.query('update conversations set unread_count=0 where id=$1',[conv]);assert.equal(await count(),2);
  await db.query(`insert into messages(conversation_id,sender_type,status,created_at) values($1,'agent','sending','2026-11-04 10:03Z')`,[conv]);assert.equal(await count(),2);
  await db.query(`update messages set status='failed' where sender_type='agent'`);assert.equal(await count(),2);
  await db.query(`update messages set status='sent' where sender_type='agent'`);assert.equal(await count(),1);
  await db.query(`insert into messages(conversation_id,sender_type,status,created_at) values($1,'customer','delivered','2026-11-04 10:04Z')`,[conv]);assert.equal(await count(),2);
  await db.query(`update conversations set inbox_cleared_at='2026-11-04 10:05Z' where id=$1`,[conv]);assert.equal(await count(),1);
  const grant=await db.query(`select has_function_privilege('anon','inbox_pending_contact_count(uuid)','execute') allowed`);assert.equal(grant.rows[0].allowed,false);
 }finally{await db.close();}
});
