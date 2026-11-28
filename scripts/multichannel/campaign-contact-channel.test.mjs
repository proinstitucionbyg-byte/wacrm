import{PGlite}from'../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';import{readFile}from'node:fs/promises';import test from'node:test';import assert from'node:assert/strict';
test('repairs only missing WhatsApp contact metadata, preserves other channels, and stamps future jobs',async()=>{
 const db=new PGlite(),a='4d761b3c-4c6c-4986-bcd8-d95f1754fe35';
 try{await db.exec(`create role anon;create role authenticated;create table contacts(id int,account_id uuid,channel text,external_id text,phone_normalized text,phone text);create table multichannel_jobs(account_id uuid,contact_id int,mode text,channel text,line_key text,recipient text);create table multichannel_whatsapp_session_lines(account_id uuid,line_key text);
 insert into contacts values(1,'${a}',null,null,'51912345678',null),(2,'${a}','instagram','ig-id','51912345678',null),(3,'${a}',null,null,'51999999999',null),(4,'${a}',null,null,'912345679',null),(5,'${a}',null,null,'51912345678',null);
 insert into multichannel_whatsapp_session_lines values('${a}','WA-real');
 insert into multichannel_jobs values('${a}',1,'whatsapp_live','whatsapp_support','WA-real','+51912345678'),('${a}',2,'whatsapp_live','whatsapp_support','WA-real','+51912345678'),('${a}',3,'whatsapp_live','whatsapp_support','WA-real','+51912345678');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261128164518_campaign_contact_channel_metadata.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select channel from contacts order by id')).rows.map(r=>r.channel),['whatsapp','instagram',null,null,null]);
 await db.exec(`insert into multichannel_jobs values('${a}',4,'whatsapp_live','whatsapp_support','WA-real','+51912345679'),('${a}',5,'sms_live','sms','WA-real','+51912345678');`);
 assert.deepEqual((await db.query('select channel from contacts where id in(4,5) order by id')).rows.map(r=>r.channel),['whatsapp',null]);
 }finally{await db.close();}
});
