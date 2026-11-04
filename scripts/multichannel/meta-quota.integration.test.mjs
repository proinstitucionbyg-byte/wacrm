import {PGlite} from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('late Meta advertising evidence corrects the allowance without deleting audit rows or excluding ordinary service sends',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table conversations(id uuid primary key default gen_random_uuid(),account_id uuid not null);
 create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references conversations(id),message_id text,status text,billing_billable boolean,billing_type text,billing_category text);
 create table whatsapp_service_message_reservations(id uuid primary key default gen_random_uuid(),account_id uuid,source_message_row_id uuid,message_id text,status text check(status in ('reserved','sent','delivered','failed')),updated_at timestamptz default now());
 insert into conversations(account_id)values('11111111-1111-4111-8111-111111111111');
 insert into messages(conversation_id,message_id,status)select id,'provider-ad','delivered' from conversations;
 insert into whatsapp_service_message_reservations(account_id,message_id,status)values('11111111-1111-4111-8111-111111111111','provider-ad','delivered');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261104233500_meta_free_entry_quota_reconciliation.sql',import.meta.url),'utf8'));
 const state=async()=> (await db.query("select status from whatsapp_service_message_reservations where message_id='provider-ad'")).rows[0].status;
 assert.equal(await state(),'delivered');
 await db.exec("update messages set billing_billable=false,billing_category='service' where message_id='provider-ad'");assert.equal(await state(),'delivered');
 await db.exec("update messages set billing_type='free_entry_point',billing_category='referral_conversion' where message_id='provider-ad'");assert.equal(await state(),'exempt');
 await db.exec("update whatsapp_service_message_reservations set status='delivered' where message_id='provider-ad'");assert.equal(await state(),'exempt');
 assert.equal((await db.query('select count(*)::int n from whatsapp_service_message_reservations')).rows[0].n,1);
 await db.exec("update messages set billing_billable=true,billing_type='regular',billing_category='service' where message_id='provider-ad'");assert.equal(await state(),'delivered');
 await db.exec("update messages set billing_billable=false,billing_type='free_entry_point' where message_id='provider-ad';insert into whatsapp_service_message_reservations(account_id,message_id,status) values('22222222-2222-4222-8222-222222222222','provider-ad','sent');");
 assert.equal((await db.query("select status from whatsapp_service_message_reservations where account_id='22222222-2222-4222-8222-222222222222'")).rows[0].status,'sent');
 }finally{await db.close();}
});
