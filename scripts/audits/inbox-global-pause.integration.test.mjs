import { PGlite } from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('global history search respects RLS and canonical pause survives automated writes', async () => {
 const db=new PGlite(),actor=randomUUID(),account=randomUUID(),other=randomUUID(),contact=randomUUID(),chat=randomUUID();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema crm_private;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table profiles(user_id uuid,account_id uuid,account_role text default 'owner');
   create function public.has_member_permission(uuid,text,text) returns boolean language sql stable as $$select $1=auth.uid() and ($3<>'supervise' or exists(select 1 from public.profiles where user_id=$1 and account_role='owner'))$$;
   create function public.is_account_member(uuid) returns boolean language sql stable as $$select exists(select 1 from public.profiles where user_id=auth.uid() and account_id=$1)$$;
   create table contacts(id uuid primary key,account_id uuid,name text,phone text);
   create table conversations(id uuid primary key,account_id uuid,user_id uuid,contact_id uuid,unread_count int default 0,inbox_cleared_at timestamptz,last_message_at timestamptz,
    ai_enabled boolean default true,automation_enabled boolean default true,ai_autoreply_disabled boolean default false,ai_disabled_at timestamptz,automation_disabled_at timestamptz);
   create function crm_private.inbox_visible_from(uuid) returns timestamptz language sql stable as $$select '-infinity'::timestamptz from public.conversations where id=$1 and public.is_account_member(account_id)$$;
   create table messages(id uuid primary key,conversation_id uuid,content_text text,created_at timestamptz default now());
   create table inbox_hidden_messages(message_id uuid,user_id uuid);
   create table tags(id uuid primary key default gen_random_uuid(),account_id uuid,user_id uuid,name text,color text,kind text,audience jsonb);
   create table contact_tags(contact_id uuid,tag_id uuid,unique(contact_id,tag_id));
   create table automation_pending_executions(account_id uuid,context jsonb,status text);
   alter table conversations enable row level security;
   create policy visible on conversations to authenticated using(is_account_member(account_id));
   alter table contacts enable row level security;
   create policy visible on contacts to authenticated using(is_account_member(account_id));
   alter table messages enable row level security;
   create policy visible on messages to authenticated using(exists(select 1 from conversations c where c.id=conversation_id));
   grant usage on schema public,auth,crm_private to authenticated;
   grant select on all tables in schema public to authenticated;`);
  for(const name of ['20261127153000_inbox_global_search.sql','20261127154000_durable_manual_automatic_pause.sql','20261127163000_inbox_search_visibility_once.sql'])
   await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.query('insert into profiles(user_id,account_id) values($1,$2)',[actor,account]);
  await db.query("insert into contacts values($1,$2,'Jordan','51934218296')",[contact,account]);
  await db.query('insert into conversations(id,account_id,user_id,contact_id,last_message_at,unread_count) values($1,$2,$3,$4,now(),1)',[chat,account,actor,contact]);
  const hidden=randomUUID();
  await db.query("insert into messages values($1,$2,'hidden unique phrase',now())",[hidden,chat]);
  await db.query('insert into inbox_hidden_messages values($1,$2)',[hidden,actor]);
  await db.query("insert into messages select gen_random_uuid(),$1,'irrelevant history '||n,now() from generate_series(1,1100)n",[chat]);
  await db.query("insert into messages values(gen_random_uuid(),$1,'Vladimir historial antiguo',now()-interval '1 year')",[chat]);
  const outsider=randomUUID(),outsidechat=randomUUID();
  await db.query("insert into contacts values($1,$2,'Vladimir otra cuenta','51934218296')",[outsider,other]);
  await db.query('insert into conversations(id,account_id,user_id,contact_id,last_message_at) values($1,$2,$3,$4,now())',[outsidechat,other,actor,outsider]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await db.exec('set role authenticated');
  for(const query of ['+51 934 218 296','934218296','51 934218296','Vladimir']){
   assert.deepEqual((await db.query('select conversation_id from search_inbox_conversations($1,false,0)',[query])).rows.map(r=>r.conversation_id),[chat]);
  }
  assert.equal((await db.query("select * from search_inbox_conversations('hidden unique phrase',false,0)")).rows.length,0);
  assert.equal((await db.query("select * from search_inbox_conversations('',true,0)")).rows.length,1);
  await db.exec('reset role');
  await db.query("update conversations set inbox_cleared_at=now()-interval '1 day' where id=$1",[chat]);
  await db.exec('set role authenticated');
  assert.equal((await db.query("select * from search_inbox_conversations('Vladimir',false,0)")).rows.length,0);
  await db.exec('reset role');
  await db.query('update conversations set inbox_cleared_at=null where id=$1',[chat]);
  await db.query('update inbox_hidden_messages set user_id=$1',[randomUUID()]);
  await db.exec('set role authenticated');
  assert.equal((await db.query("select * from search_inbox_conversations('hidden unique phrase',false,0)")).rows.length,1);
  await db.exec('reset role');
  await db.query("insert into automation_pending_executions values($1,$2,'pending')",[account,JSON.stringify({conversation_id:chat})]);
  await db.query('select set_conversation_automatic_pause($1,true)',[chat]);
  await db.query('update conversations set ai_enabled=true,automation_enabled=true,automation_disabled_at=now(),ai_disabled_at=now() where id=$1',[chat]);
  let c=(await db.query('select * from conversations where id=$1',[chat])).rows[0];
  assert.equal(c.ai_enabled,false);assert.equal(c.automation_enabled,false);assert.equal(c.automation_disabled_at,null);
  assert.equal((await db.query('select status from automation_pending_executions')).rows[0].status,'paused');
  // Ordinary labels do not enable, disable, or release the pause.
  await db.query("insert into tags(account_id,user_id,name,kind) values($1,$2,'ETIQUETA NORMAL','process')",[account,actor]);
  await db.query("insert into contact_tags select $1,id from tags where name='ETIQUETA NORMAL'",[contact]);
  assert.equal((await db.query('select ai_enabled from conversations where id=$1',[chat])).rows[0].ai_enabled,false);
  await db.query("select set_conversation_automatic_control($1,'ai',true)",[chat]);
  c=(await db.query('select * from conversations where id=$1',[chat])).rows[0];assert.equal(c.ai_enabled,true);assert.equal(c.automation_enabled,false);
  assert.equal((await db.query("select count(*)::int n from contact_tags ct join tags t on t.id=ct.tag_id where t.name='DESACTIVADO AMBOS'")).rows[0].n,0);
  await db.query('select set_conversation_automatic_pause($1,true)',[chat]);
  await db.query("delete from contact_tags using tags where tag_id=tags.id and name='DESACTIVADO AMBOS'");
  assert.equal((await db.query('select automation_enabled from conversations where id=$1',[chat])).rows[0].automation_enabled,true);
  assert.equal((await db.query('select status from automation_pending_executions')).rows[0].status,'pending');
  const agent=randomUUID();await db.query("insert into profiles values($1,$2,'agent')",[agent,account]);
  await db.exec(`create or replace function crm_private.inbox_visible_from(uuid) returns timestamptz language sql stable as $$
   select case when p.account_role='owner' then '-infinity'::timestamptz else now()-interval '1 day' end
   from public.conversations c join public.profiles p on p.account_id=c.account_id and p.user_id=auth.uid() where c.id=$1$$;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[agent]);await db.exec('set role authenticated');
  assert.equal((await db.query("select * from search_inbox_conversations('Vladimir',false,0)")).rows.length,0);
  assert.equal((await db.query("select * from search_inbox_conversations('934218296',false,0)")).rows.length,1);
  await db.exec('reset role');
  await db.exec("create or replace function crm_private.inbox_visible_from(uuid) returns timestamptz language sql stable as $$select null::timestamptz$$");
  await db.exec('set role authenticated');
  assert.equal((await db.query("select * from search_inbox_conversations('934218296',false,0)")).rows.length,0);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(db.query("select * from search_inbox_conversations('934218296',false,0)"),/Forbidden/);
 } finally {await db.close();}
});
