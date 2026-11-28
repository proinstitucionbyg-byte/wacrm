import{PGlite}from'../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import{readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';import{before,after,beforeEach,test}from'node:test';import assert from'node:assert/strict';
import{EventEmitter}from'node:events';
import{createSessionAdapter,replyBodyHash}from'./whatsapp-session/adapter.mjs';
import{createCampaignClient}from'./whatsapp-session/campaign-client.mjs';
import{sessionScope}from'./whatsapp-session/store.mjs';
const db=new PGlite(),account=randomUUID(),actor=randomUUID(),contact=randomUUID();let w1,w2;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table accounts(id uuid primary key);create table profiles(user_id uuid primary key,account_id uuid,account_role text);
 create table contacts(id uuid primary key,account_id uuid,phone text,phone_normalized text);
 create table conversations(id uuid primary key default gen_random_uuid(),account_id uuid,user_id uuid,contact_id uuid,status text,assigned_agent_id uuid,automation_enabled boolean,ai_enabled boolean,ai_autoreply_disabled boolean,last_human_message_at timestamptz,last_message_text text,last_message_at timestamptz,updated_at timestamptz,unique(account_id,contact_id));
 create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_type text,content_type text,content_text text,message_id text,status text,created_at timestamptz,whatsapp_session_line_key text,media_url text);`);
 for(const name of ['20261029151921_multichannel_worker_queue.sql','20261028173948_multichannel_sms_dispatch.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`create table multichannel_whatsapp_session_lines(account_id uuid not null,line_key text not null,worker_id uuid not null,linked_phone text not null,paused boolean not null default false,primary key(account_id,line_key));`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261104073046_multichannel_live_campaigns.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261107131046_multichannel_campaign_media_sequences.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261115191612_edit_pending_campaign_content.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261116011432_campaign_line_distribution.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261116020000_campaign_parallel_windows.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261126230000_campaign_personalization_safety.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261127155000_campaign_technical_fallback_distribution.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261128033000_campaign_technical_auto_resume.sql',import.meta.url),'utf8'));
 await db.exec('create table whatsapp_management_state(worker_id uuid,account_id uuid,snapshot jsonb,seen_at timestamptz);');
 await db.exec(await readFile(new URL('../../supabase/migrations/20261128144046_campaign_manual_dispatch.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate whatsapp_management_state');
 await db.exec('reset role;truncate multichannel_jobs,multichannel_campaigns,multichannel_whatsapp_session_lines,multichannel_sms_authorizations,multichannel_sms_authorization_events,multichannel_sms_bindings,multichannel_workers,multichannel_lines,messages,conversations,contacts,profiles,accounts cascade;');
 await db.query('insert into accounts values($1)',[account]);await db.query("insert into profiles values($1,$2,'owner')",[actor,account]);
 await db.query("insert into contacts values($1,$2,'51900000001','51900000001')",[contact,account]);
 const rows=(await db.query("insert into multichannel_workers(account_id,name,token_hash)values($1,'A',repeat('a',64)),($1,'B',repeat('b',64)) returning id",[account])).rows;
 [w1,w2]=rows.map(r=>r.id);
 await db.query("insert into multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone)values($1,'WA-a',$2,'51900000002'),($1,'WA-b',$3,'51900000003')",[account,w1,w2]);
});
const input=(patch={})=>({request_id:randomUUID(),review_hash:'a'.repeat(64),name:'Aviso',purpose:'notice',body:'Texto ficticio',routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'whatsapp_support',line_key:'WA-b'}],run_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),interval_seconds:1,block_size:10,block_pause_seconds:0,recipients:[{contact_id:contact,permission_expires_at:new Date(Date.now()+7200000).toISOString(),evidence:'Permiso ficticio revisado'}],...patch});
const media={kind:'image',url:'https://assets.example.test/storage/v1/object/public/course.png'};
const sequence=()=>[{body:'Imagen del curso',delay_seconds:0,media},{body:'Audio del curso',delay_seconds:60,media:{...media,kind:'audio',url:media.url.replace('png','ogg')}}];
async function manualReady(){await step('heartbeat');await db.query('insert into whatsapp_management_state values($1,$2,$3,clock_timestamp())',[w1,account,JSON.stringify([{lineKey:'WA-a',linkedPhone:'51900000002',active:true,status:'ready'}])]);}
async function adjust(id,patch={}){const p={request:randomUUID(),action:'send',lines:['WA-a'],count:1,unit:'messages',interval:1,block:1,pause:5000,enable:false,...patch};return(await db.query('select adjust_campaign_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r',[account,actor,id,p.request,p.action,p.lines,p.count,p.unit,p.interval,p.block,p.pause,p.enable])).rows[0].r;}
async function manualCampaign(){const other=randomUUID();await db.query('insert into contacts values($1,$2,$3,$3)',[other,account,'51900000004']);const p=input({sequence:[{body:'Primero',delay_seconds:0},{body:'Segundo',delay_seconds:0}]});p.recipients.push({...p.recipients[0],contact_id:other});const c=await control('create',p);await control('activate',{campaign_id:c.id,review_hash:c.review_hash});await control('pause',{campaign_id:c.id,value:true});await manualReady();return c;}

test('manual batch sends only its exact message allowance and pauses while preserving the remaining queue',async()=>{
 const c=await manualCampaign(),r=await adjust(c.id);assert.equal(r.messages,1);
 const job=await step('claim');assert.ok(job);await step('authorize','WA-a',job);await step('record','WA-a',{...job,result:'accepted',provider:'manual-first'});
 assert.equal((await db.query('select status from multichannel_campaigns where id=$1',[c.id])).rows[0].status,'paused');
 assert.equal(await step('claim'),null);assert.equal((await db.query("select count(*)::int n from multichannel_jobs where status='queued'")).rows[0].n,3);
});
test('manual recipient limit includes the complete remaining sequence and request retries are idempotent',async()=>{
 const c=await manualCampaign(),request=randomUUID(),r=await adjust(c.id,{unit:'recipients',request});assert.equal(r.messages,2);assert.equal(r.recipients,1);
 assert.equal((await adjust(c.id,{unit:'recipients',request})).duplicate,true);
 assert.equal((await db.query('select cardinality(manual_batch_job_ids) n from multichannel_campaigns where id=$1',[c.id])).rows[0].n,2);
});
test('manual batch never selects uncertain messages or descendants of an uncertain step',async()=>{
 const c=await manualCampaign();await db.exec("update multichannel_jobs set status='needs_review' where campaign_sequence=0 and campaign_step=0");
 const r=await adjust(c.id,{count:25});assert.equal(r.messages,2);const root=await step('claim');assert.equal(root.campaign_sequence,1);
});
test('manual adjustment rejects offline, stale, restricted and cross-account lines without changing the queue',async()=>{
 const c=await manualCampaign();await assert.rejects(adjust(c.id,{lines:['WA-b']}),/no está disponible/);
 await db.exec("update whatsapp_management_state set seen_at=now()-interval '1 minute'");await assert.rejects(adjust(c.id),/no está disponible/);
 await db.exec("update whatsapp_management_state set seen_at=clock_timestamp();update multichannel_whatsapp_session_lines set campaign_restricted=true where line_key='WA-a'");await assert.rejects(adjust(c.id),/restricción/);
 await db.exec("update multichannel_whatsapp_session_lines set campaign_restricted=false;update whatsapp_management_state set account_id=worker_id");await assert.rejects(adjust(c.id),/no está disponible/);
 assert.equal((await db.query('select manual_batch_job_ids from multichannel_campaigns where id=$1',[c.id])).rows[0].manual_batch_job_ids,null);
});
test('saving manual dispatch changes only pending schedule and routes and does not activate',async()=>{
 const c=await manualCampaign(),r=await adjust(c.id,{action:'save',interval:30,block:2,pause:100});assert.equal(r.status,'paused');
 const campaign=(await db.query('select * from multichannel_campaigns where id=$1',[c.id])).rows[0];assert.equal(campaign.interval_seconds,30);assert.equal(campaign.manual_batch_job_ids,null);assert.equal(campaign.routes.length,1);assert.equal(await step('claim'),null);
});
test('saved block timing restarts from the pending messages and still enforces a real pause after catching up',async()=>{
 const c=await manualCampaign();await db.exec('update multichannel_jobs set campaign_sequence=campaign_sequence+100');
 await adjust(c.id,{action:'save',block:1,pause:100});await control('pause',{campaign_id:c.id,value:false});
 const root=await step('claim');assert.ok(root);await step('authorize','WA-a',root);await step('record','WA-a',{...root,result:'accepted',provider:'manual-block'});
 await db.exec("update multichannel_jobs set run_at=now()-interval '1 minute' where status='queued'");
 assert.equal(await step('claim'),null);
 await db.query("update multichannel_jobs set started_at=now()-interval '101 seconds' where id=$1",[root.id]);
 assert.ok(await step('claim'));
});
test('paused ready line requires explicit enabling and an in-flight job cannot be edited',async()=>{
 const c=await manualCampaign();await db.exec("update multichannel_whatsapp_session_lines set paused=true where line_key='WA-a'");await assert.rejects(adjust(c.id),/bot está pausado/);
 await adjust(c.id,{enable:true});assert.equal((await db.query("select paused from multichannel_whatsapp_session_lines where line_key='WA-a'")).rows[0].paused,false);
 const j=await step('claim');assert.ok(j);await control('pause',{campaign_id:c.id,value:true});await assert.rejects(adjust(c.id),/en proceso/);
});
test('browser database role cannot invoke manual dispatch',async()=>{await db.exec('set role authenticated');await assert.rejects(db.query('select adjust_campaign_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[account,actor,randomUUID(),randomUUID(),'send',['WA-a'],25,'messages',25,25,5000,false]),/permission denied/);});
const control=async(action,payload,who=actor)=>(await db.query('select multichannel_campaign_control($1,$2,$3,$4) as r',[account,who,action,JSON.stringify(payload)])).rows[0].r;
async function step(action,line='WA-a',job={},ready=true){return(await db.query('select multichannel_campaign_worker_step($1,$2,$3,$4,$5,$6,$7,$8,$9) as r',[line==='WA-a'?w1:w2,line,action,job.id??null,job.claim_token??null,ready,line==='WA-a'?'51900000002':'51900000003',job.result??null,job.provider??null])).rows[0].r;}
async function campaign(patch={}){const c=await control('create',input(patch));await control('activate',{campaign_id:c.id,review_hash:c.review_hash});return c;}

test('four selected lines redistribute an offline primary evenly across the other three, and stop remains final',async()=>{
 await db.query("insert into multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone)values($1,'WA-c',$2,'51900000004'),($1,'WA-d',$2,'51900000005')",[account,w2]);
 const payload=input({routes:['WA-a','WA-b','WA-c','WA-d'].map(line_key=>({channel:'whatsapp_support',line_key}))});
 for(let i=0;i<5;i++){const id=randomUUID(),phone='5190000010'+i;await db.query('insert into contacts values($1,$2,$3,$3)',[id,account,phone]);payload.recipients.push({...payload.recipients[0],contact_id:id});}
 const c=await control('create',payload);await control('activate',{campaign_id:c.id,review_hash:c.review_hash});
 const run=async(action,line,job={})=>{const identity=(await db.query('select worker_id,linked_phone from multichannel_whatsapp_session_lines where account_id=$1 and line_key=$2',[account,line])).rows[0];return(await db.query('select multichannel_campaign_worker_step($1,$2,$3,$4,$5,true,$6,$7,$8) r',[identity.worker_id,line,action,job.id??null,job.claim_token??null,identity.linked_phone,job.result??null,job.provider??null])).rows[0].r;};
 for(const line of ['WA-b','WA-c','WA-d'])await run('heartbeat',line);
 const counts={'WA-b':0,'WA-c':0,'WA-d':0};
 for(let i=0;i<6;i++){
  await db.query("update multichannel_jobs set run_at=now()-interval '2 seconds',started_at=case when started_at is not null then now()-interval '2 seconds' else null end where campaign_id=$1",[c.id]);
  let accepted=false;
  for(const line of Object.keys(counts)){
   const job=await run('claim',line);if(!job)continue;
   await run('authorize',line,job);await run('record',line,{...job,result:'accepted',provider:'accepted-'+i});counts[line]++;accepted=true;break;
  }
  assert.equal(accepted,true,JSON.stringify((await db.query('select campaign_sequence,line_key,status,routing_alert,run_at from multichannel_jobs where campaign_id=$1 order by campaign_sequence',[c.id])).rows));
 }
 assert.deepEqual(counts,{'WA-b':2,'WA-c':2,'WA-d':2});
 await control('pause',{campaign_id:c.id});
 for(const line of Object.keys(counts))assert.equal(await run('claim',line),null);
});
const personalized=async(action,payload)=>(await db.query('select multichannel_campaign_control_personalized($1,$2,$3,$4) as r',[account,actor,action,JSON.stringify(payload)])).rows[0].r;
async function safeStep(action,ready=true,restricted=false){return(await db.query('select multichannel_campaign_worker_step_safe($1,$2,$3,null,null,$4,$5,null,null,$6) as r',[w1,'WA-a',action,ready,'51900000002',restricted])).rows[0].r;}

test('personalization keeps each phone paired with its own name and date in messages and media',async()=>{
 const second=randomUUID();await db.query("insert into contacts values($1,$2,'51900000009','51900000009')",[second,account]);
 const payload=input({sequence:[{body:'Hola [nombre], hasta [fecha1]',delay_seconds:0,media:{...media,caption:'Para [nombre]'}}]});
 payload.recipients=[{...payload.recipients[0],contact_id:second,variables:{nombre:'Rosa',fecha1:'28/11'}},{...payload.recipients[0],variables:{nombre:'Pedro',fecha1:'29/11'}}];
 const c=await personalized('create',payload);
 const rows=(await db.query('select recipient,body,media from multichannel_jobs where campaign_id=$1 order by run_at',[c.id])).rows;
 assert.deepEqual(rows.map(r=>[r.recipient,r.body,r.media.caption]),[['+51900000009','Hola Rosa, hasta 28/11','Para Rosa'],['+51900000001','Hola Pedro, hasta 29/11','Para Pedro']]);
 assert.equal(await step('claim'),null);
});
test('a missing variable rolls back the entire campaign instead of leaving a partial queue',async()=>{
 await assert.rejects(personalized('create',input({body:'Hola [nombre]'})),/Missing campaign variable/);
 assert.equal((await db.query('select count(*)::int n from multichannel_campaigns')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from multichannel_jobs')).rows[0].n,0);
});
test('technical pause resumes on the next sweep when a selected line reconnects',async()=>{
 const c=await campaign();await db.query("update multichannel_campaigns set created_at=now()-interval '2 minutes' where id=$1",[c.id]);
 assert.equal((await db.query('select campaign_safety_sweep() r')).rows[0].r.paused_no_lines,1);
 await step('heartbeat');await db.query('select campaign_safety_sweep()');assert.equal((await db.query('select status from multichannel_campaigns')).rows[0].status,'active');
 assert.equal((await db.query('select status from multichannel_jobs')).rows[0].status,'queued');
});

test('a manual pause during an automatic outage never auto-resumes',async()=>{
 const c=await campaign();await db.query("update multichannel_campaigns set created_at=now()-interval '2 minutes' where id=$1",[c.id]);await db.query('select campaign_safety_sweep()');
 await personalized('pause',{campaign_id:c.id,value:true});await step('heartbeat');await db.query('select campaign_safety_sweep()');
 assert.equal((await db.query('select status from multichannel_campaigns')).rows[0].status,'paused');assert.equal((await db.query('select technical_pause_at from multichannel_campaigns')).rows[0].technical_pause_at,null);
});

test('a technical pause cannot resume through a provider restriction on another selected line',async()=>{
 const c=await campaign();await db.query("update multichannel_campaigns set created_at=now()-interval '2 minutes' where id=$1",[c.id]);await db.query('select campaign_safety_sweep()');
 await step('heartbeat','WA-b');await db.query("update multichannel_whatsapp_session_lines set campaign_restricted=true where line_key='WA-a'");await db.query('select campaign_safety_sweep()');
 assert.equal((await db.query('select status from multichannel_campaigns')).rows[0].status,'paused');
});

test('editing a technical pause makes it manual even if its name is unchanged',async()=>{
 const c=await campaign();await db.query("update multichannel_campaigns set created_at=now()-interval '2 minutes' where id=$1",[c.id]);await db.query('select campaign_safety_sweep()');
 await db.query('update multichannel_campaigns set name=name where id=$1',[c.id]);await step('heartbeat');await db.query('select campaign_safety_sweep()');
 assert.equal((await db.query('select status from multichannel_campaigns')).rows[0].status,'paused');
});
test('manual attention cancels pending steps and preserves an uncertain attempted step',async()=>{
 const c=await campaign({sequence:sequence()});await step('heartbeat');const first=await step('claim');await step('authorize','WA-a',first);await step('record','WA-a',{...first,result:'needs_review'});
 await db.query('select mark_campaign_recipient_handled($1,$2,$3)',[account,actor,first.id]);
 assert.deepEqual((await db.query('select status from multichannel_jobs where campaign_id=$1 order by campaign_step',[c.id])).rows.map(r=>r.status),['needs_review','cancelled']);
});
test('provider restriction pauses the campaign and prevents backup or manual resume until review',async()=>{
 const c=await campaign();await step('heartbeat','WA-b');await safeStep('heartbeat',false,true);
 assert.equal(await step('claim','WA-b'),null);
 await assert.rejects(personalized('pause',{campaign_id:c.id,value:false}),/restriction requires review/);
 assert.equal((await db.query('select status from multichannel_campaigns where id=$1',[c.id])).rows[0].status,'paused');
});
test('a human message since campaign creation cancels the remaining queue',async()=>{
 await campaign();await db.query("insert into conversations(account_id,contact_id,last_human_message_at) values($1,$2,clock_timestamp())",[account,contact]);
 assert.equal((await db.query('select campaign_safety_sweep() r')).rows[0].r.cancelled_manual,1);
 assert.equal((await db.query('select status from multichannel_jobs')).rows[0].status,'cancelled');
});
test('editing personalized drafts renders every pending recipient again and rolls back missing variables',async()=>{
 const c=await personalized('create',input({body:'Hola [nombre]',recipients:[{...input().recipients[0],variables:{nombre:'Pedro'}}]}));
 const edit=body=>db.query('select edit_pending_campaign_content_personalized($1,$2,$3,$4,$5,$6,$7)',[account,actor,c.id,c.review_hash,'Editada',JSON.stringify([{body,delay_seconds:0}]),'b'.repeat(64)]);
 await assert.rejects(edit('Hasta [fecha1]'),/Missing campaign variable/);
 assert.equal((await db.query('select body from multichannel_jobs')).rows[0].body,'Hola Pedro');
 await edit('Buen día [nombre]');assert.equal((await db.query('select body from multichannel_jobs')).rows[0].body,'Buen día Pedro');
});

test('database claim through campaign client and adapter sends each mixed-media step once in order',async()=>{
 const phone='51900000002',lineKey='WA-a',provider=new EventEmitter(),records=[],sent=[];
 provider.info={wid:{user:phone}};provider.initialize=async()=>{};provider.destroy=async()=>{};provider.getState=async()=>'CONNECTED';
 provider.sendMessage=async(to,content,options)=>{sent.push({to,content,options});return{id:{_serialized:'provider-sequence-'+sent.length,fromMe:true},fromMe:true,to};};
 const sequence=[{body:'Inicio',delay_seconds:0},...['image','audio','video'].map(kind=>({body:kind,delay_seconds:0,media:{...media,kind,url:media.url.replace('.png','.'+kind)}}))];
 await campaign({sequence});
 const remote=createCampaignClient({origin:'https://crm.example.test',token:'wcm_'+'a'.repeat(64),lineKey,fetchImpl:async(_url,init)=>{
  const p=JSON.parse(init.body);const data=await step(p.action,lineKey,{id:p.job_id,claim_token:p.claim_token,result:p.state,provider:p.provider_id},p.ready);
  if(p.action==='authorize')return Response.json({permit:data?.allowed&&replyBodyHash(data.body,data.media)===p.body_hash?{allowed:true,permissionConfirmed:true,paused:false,accountId:data.account_id,lineKey:data.line_key,sessionPhone:data.session_phone,jobId:data.job_id,campaignId:data.campaign_id,chatId:data.chat_id,bodyHash:p.body_hash,expiresAt:Date.parse(data.expires_at)}:{allowed:false}});
  return Response.json({[p.action==='claim'?'job':'receipt']:data});
 }});
 const adapter=createSessionAdapter({accountId:account,lineKey,client:provider,enabled:true,campaignsEnabled:true,authorizeCampaign:remote.authorize,
  prepareMedia:async m=>({content:{kind:m.kind,url:m.url},options:{...(m.kind==='audio'?{sendAudioAsVoice:true}:{})}}),
  store:{scope:sessionScope(account,lineKey),records:()=>records,append:async(kind,payload)=>records.push({kind,payload:structuredClone(payload)}),close:async()=>{}}});
 try{
  await adapter.start();await remote.heartbeat(true,phone);
  for(let index=0;index<sequence.length;index++){
   const job=await remote.claim(phone);assert.ok(job);const result=await adapter.dispatchCampaign(job);assert.equal(result.state,'accepted');
   await remote.finish(job,result,phone);assert.equal((await adapter.dispatchCampaign(job)).state,'already_attempted');
   await db.query("update multichannel_jobs set started_at=now()-interval '2 seconds' where id=$1",[job.id]);
  }
  assert.deepEqual(sent.map(s=>typeof s.content==='string'?s.content:s.content.kind),['Inicio','image','audio','video']);
  assert.equal(sent[2].options.sendAudioAsVoice,true);assert.ok(sent.every(s=>s.to==='51900000001@c.us'));
  assert.equal((await db.query("select count(*)::int as n from multichannel_jobs where status='accepted'")).rows[0].n,4);
  assert.equal(await remote.claim(phone),null);assert.equal((await db.query('select count(*)::int as n from messages')).rows[0].n,4);
 }finally{await adapter.stop();}
});

test('sequence waits for acceptance and delay, then uses a technical fallback when the origin is offline',async()=>{
 await campaign({sequence:sequence()});await step('heartbeat');await step('heartbeat','WA-b');
 const first=await step('claim');assert.equal(first.campaign_step,0);assert.deepEqual(first.media,media);
 const permit=await step('authorize','WA-a',first);assert.deepEqual(permit.media,media);
 assert.deepEqual((await db.query('select content_type,media_url from messages')).rows,[{content_type:'image',media_url:media.url}]);
 assert.equal(await step('claim','WA-b'),null);
 await step('record','WA-a',{...first,result:'accepted',provider:'sequence-image'});
 assert.equal(await step('claim'),null);
 await db.query("update multichannel_jobs set started_at=now()-interval '2 seconds' where id=$1",[first.id]);
 await db.query("update multichannel_jobs set run_at=now()-interval '1 second' where predecessor_id=$1",[first.id]);
 await step('heartbeat','WA-a',{},false);
 const second=await step('claim','WA-b');assert.equal(second.campaign_step,1);assert.equal(second.line_key,'WA-b');
 assert.equal(second.predecessor_id,first.id);assert.equal(second.media.kind,'audio');
});

test('an uncertain sequence step never authorizes its successor even if its due time passed',async()=>{
 await campaign({sequence:sequence()});await step('heartbeat');const first=await step('claim');await step('authorize','WA-a',first);
 await step('record','WA-a',{...first,result:'needs_review'});
 await db.query("update multichannel_jobs set run_at=now()-interval '1 second' where predecessor_id=$1",[first.id]);
 assert.equal(await step('claim'),null);
 assert.equal((await db.query('select routing_alert from multichannel_jobs where predecessor_id=$1',[first.id])).rows[0].routing_alert,'sequence_previous_step_unconfirmed');
});

test('sequence SMS fallback requires explicitly reviewed text and invalid sequence rolls back',async()=>{
 await assert.rejects(campaign({sequence:sequence(),routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'sms',line_key:'SMS-missing'}]}));
 assert.equal((await db.query('select count(*)::int as n from multichannel_campaigns')).rows[0].n,0);
 await assert.rejects(campaign({sequence:[{body:'x',delay_seconds:1}]}),/Invalid sequence step/);
 assert.equal((await db.query('select count(*)::int as n from multichannel_jobs')).rows[0].n,0);
});
test('draft cannot send; review activates and repeated creation does not duplicate',async()=>{
 const plan=input(),c=await control('create',plan);await step('heartbeat');assert.equal(await step('claim'),null);
 assert.equal((await control('create',plan)).duplicate,true);
 await assert.rejects(control('create',{...plan,review_hash:'b'.repeat(64)}));
 await control('activate',{campaign_id:c.id,review_hash:c.review_hash});assert.equal((await step('claim')).campaign_id,c.id);
});
test('future campaign does not start and a paused one cannot be claimed',async()=>{
 const c=await campaign({run_at:new Date(Date.now()+600000).toISOString()});await step('heartbeat');assert.equal(await step('claim'),null);
 await control('pause',{campaign_id:c.id,value:true});assert.equal(await step('claim'),null);
});
test('selects first ready fallback and fences a pause between claim and start',async()=>{
 const c=await campaign();await step('heartbeat','WA-b');assert.equal(await step('claim','WA-a'),null);
 const j=await step('claim','WA-b');assert.equal(j.line_key,'WA-b');await control('pause',{campaign_id:c.id,value:true});
 assert.equal((await step('authorize','WA-b',j)).allowed,false);assert.equal((await db.query('select started_at from multichannel_jobs where id=$1',[j.id])).rows[0].started_at,null);
});
test('started uncertain work never moves to a second WhatsApp',async()=>{
 await campaign();await step('heartbeat');await step('heartbeat','WA-b');const j=await step('claim');assert.equal((await step('authorize','WA-a',j)).allowed,true);
 await db.query("update multichannel_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);await step('heartbeat','WA-a',{},false);
 assert.equal(await step('claim','WA-b'),null);assert.equal((await db.query('select status from multichannel_jobs where id=$1',[j.id])).rows[0].status,'needs_review');
});
test('no available route creates an alert and preserves the pending work',async()=>{
 await campaign();assert.equal(await step('claim'),null);
 assert.equal((await db.query('select routing_alert,status from multichannel_jobs')).rows[0].routing_alert,'no_available_authorized_line');
});
test('records the actual provider result and never marks uncertainty delivered',async()=>{
 await campaign();await step('heartbeat');const j=await step('claim');await step('authorize','WA-a',j);
 assert.equal((await step('record','WA-a',{...j,result:'accepted',provider:'real-provider-key'})).recorded,true);
 const r=(await db.query('select status,provider_id from multichannel_jobs')).rows[0];assert.equal(r.status,'accepted');assert.equal(r.provider_id,'real-provider-key');
});
test('browser roles cannot access the campaign queue or its transitions',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from multichannel_campaigns'));await assert.rejects(control('create',input()));await db.exec('reset role');}
 await assert.rejects(control('create',input(),randomUUID()));
});
test('actual block pauses remain enforced after the machine catches up with overdue work',async()=>{
 const second=randomUUID();await db.query("insert into contacts values($1,$2,'51900000004','51900000004')",[second,account]);
 const p=input({block_size:1,block_pause_seconds:60,run_at:new Date(Date.now()-3600000).toISOString()});p.recipients.push({...p.recipients[0],contact_id:second});await campaign(p);await step('heartbeat');
 const j=await step('claim');await step('authorize','WA-a',j);await step('record','WA-a',{...j,result:'accepted',provider:'first-provider'});
 assert.equal(await step('claim'),null);await db.query("update multichannel_jobs set started_at=now()-interval '61 seconds' where id=$1",[j.id]);assert.equal((await step('claim')).contact_id,second);
});
test('one hub may reserve work for distinct WhatsApp profiles in parallel',async()=>{
 await db.query("update multichannel_whatsapp_session_lines set worker_id=$1 where line_key='WA-b'",[w1]);w2=w1;
 await campaign();await campaign({routes:[{channel:'whatsapp_support',line_key:'WA-b'}]});await step('heartbeat');await step('heartbeat','WA-b');
 const a=await step('claim'),b=await step('claim','WA-b');assert.ok(a);assert.ok(b);assert.notEqual(a.id,b.id);
});
test('a confirmed provider ack updates the same CRM message without creating another',async()=>{
 await campaign();await step('heartbeat');const j=await step('claim');await step('authorize','WA-a',j);await step('record','WA-a',{...j,result:'accepted',provider:'ack-provider'});
 assert.equal((await step('ack','WA-a',{...j,result:'delivered',provider:'ack-provider'})).recorded,true);
 assert.deepEqual((await db.query('select status,message_id from messages')).rows,[{status:'delivered',message_id:'ack-provider'}]);
 assert.equal((await step('ack','WA-a',{...j,result:'delivered',provider:'wrong-provider'})),null);
});
test('SMS fallback requires a ready device and a separate current SMS authorization',async()=>{
 await db.query("insert into multichannel_lines(account_id,line_key,channel,paused,available,device_key,interval_seconds,daily_limit,limit_note)values($1,'SMS-backup','sms',false,true,'device',1,20,'Fictitious test limit')",[account]);
 await assert.rejects(campaign({sequence:sequence(),routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'sms',line_key:'SMS-backup'}]}),/Explicit SMS text required/);
 await campaign({sequence:sequence(),sms_body:'Respaldo SMS revisado',routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'sms',line_key:'SMS-backup'}]});
 assert.equal(await step('claim'),null);assert.equal((await db.query("select count(*)::int as n from multichannel_jobs where mode='sms_live'")).rows[0].n,0);
 await db.query("insert into multichannel_sms_authorizations(account_id,contact_id,purpose,recipient,granted,expires_at,evidence,reviewed_by)values($1,$2,'notice','+51900000001',true,now()+interval '2 hours','Separate SMS consent',$3)",[account,contact,actor]);
 await db.query("insert into multichannel_sms_bindings(account_id,line_key,worker_id,ready_at)values($1,'SMS-backup',$2,now())",[account,w2]);
 await step('claim');const child=(await db.query("select * from multichannel_jobs where mode='sms_live'")).rows[0];assert.ok(child);assert.equal(child.status,'queued');assert.equal(child.body,'Respaldo SMS revisado');assert.equal(child.media,null);
 assert.equal((await db.query("select count(*)::int as n from multichannel_jobs where mode='whatsapp_live' and status='cancelled'")).rows[0].n,2);
 await control('pause',{campaign_id:child.campaign_id,value:true});
 await db.query("update multichannel_jobs set status='claimed',worker_id=$2,claim_token=$3,lease_until=now()+interval '2 minutes' where id=$1",[child.id,w2,randomUUID()]);
 await assert.rejects(db.query("update multichannel_jobs set status='dispatching' where id=$1",[child.id]),/Campaign paused/);
});

const editContent=async(c,steps,who=actor,hash=c.review_hash)=>(await db.query('select edit_pending_campaign_content($1,$2,$3,$4,$5,$6,$7) r',[account,who,c.id,hash,'Editada',JSON.stringify(steps),'b'.repeat(64)])).rows[0].r;
test('editing paused content preserves delivered and uncertain steps and their queue identity',async()=>{
 const steps=[{body:'one',delay_seconds:0},{body:'two',delay_seconds:10},{body:'three',delay_seconds:10}];const c=await campaign({sequence:steps});await control('pause',{campaign_id:c.id,value:true});
 await db.exec("update multichannel_jobs set status='delivered',provider_id='delivered-provider',started_at=now() where campaign_step=0;update multichannel_jobs set status='needs_review',started_at=now() where campaign_step=1;");
 const before=(await db.query('select id,body,status,provider_id,routing_alert from multichannel_jobs order by campaign_step')).rows;
 const result=await editContent(c,steps.map(x=>({...x,body:x.body+' edited'})));assert.equal(result.updated_steps,1);assert.equal(result.unchanged_steps,2);
 const after=(await db.query('select id,body,status,provider_id,routing_alert from multichannel_jobs order by campaign_step')).rows;
 assert.deepEqual(after.slice(0,2),before.slice(0,2));assert.equal(after[2].id,before[2].id);assert.equal(after[2].body,'three edited');assert.equal(after[2].routing_alert,before[2].routing_alert);assert.equal((await db.query('select status from multichannel_campaigns')).rows[0].status,'paused');
});
test('content edit requires pause, current review, owner and unchanged timing',async()=>{
 const steps=[{body:'one',delay_seconds:0},{body:'two',delay_seconds:10}];const c=await campaign({sequence:steps});await assert.rejects(editContent(c,steps),/Pause/);await control('pause',{campaign_id:c.id,value:true});
 await assert.rejects(editContent(c,steps,randomUUID()),/Owner/);await assert.rejects(editContent(c,steps,actor,'c'.repeat(64)),/changed/);await assert.rejects(editContent(c,[steps[0]]),/step count/);await assert.rejects(editContent(c,[steps[0],{...steps[1],delay_seconds:11}]),/timing/);assert.equal((await db.query('select body from multichannel_jobs where campaign_step=0')).rows[0].body,'one');
});
test('a claimed but unstarted step is not edited or returned to the queue',async()=>{
 const c=await campaign();await step('heartbeat');const j=await step('claim');assert.ok(j);await control('pause',{campaign_id:c.id,value:true});const result=await editContent(c,[{body:'edited',delay_seconds:0}]);assert.equal(result.updated_steps,0);const row=(await db.query('select body,status,claim_token from multichannel_jobs where id=$1',[j.id])).rows[0];assert.equal(row.status,'claimed');assert.equal(row.claim_token,j.claim_token);assert.equal(row.body,'Texto ficticio');
});

test('one campaign runs explicit recipient ranges in parallel without starving the later range',async()=>{
 await db.query("update multichannel_whatsapp_session_lines set worker_id=$1 where line_key='WA-b'",[w1]);w2=w1;
 const people=[];for(let i=0;i<105;i++){const id=randomUUID();people.push(id);await db.query('insert into contacts values($1,$2,$3,$3)',[id,account,'519'+String(i).padStart(8,'0')]);}
 const p=input({dispatch_mode:'parallel',distribution:[{from:1,to:101,line_key:'WA-a'},{from:102,to:105,line_key:'WA-b'}],run_at:new Date(Date.now()-3600000).toISOString()});p.recipients=people.map(contact_id=>({...p.recipients[0],contact_id}));const c=await control('create',p);await control('activate',{campaign_id:c.id,review_hash:c.review_hash});await step('heartbeat');await step('heartbeat','WA-b');
 const b=await step('claim','WA-b'),a=await step('claim');assert.ok(b);assert.ok(a);assert.equal(b.contact_id,people[101]);assert.equal(a.contact_id,people[0]);assert.notEqual(a.id,b.id);
});
test('sequential ranges keep audience order and reject gaps or unauthorized lines atomically',async()=>{
 const other=randomUUID();await db.query('insert into contacts values($1,$2,$3,$3)',[other,account,'51900000004']);const p=input({distribution:[{from:1,to:1,line_key:'WA-a'},{from:2,to:2,line_key:'WA-b'}]});p.recipients.push({...p.recipients[0],contact_id:other});
 await assert.rejects(control('create',{...p,distribution:[{from:1,to:1,line_key:'WA-a'}]}),/cover every/);assert.equal((await db.query('select count(*)::int n from multichannel_campaigns')).rows[0].n,0);
 await assert.rejects(control('create',{...p,distribution:[{from:1,to:2,line_key:'WA-other'}]}),/selected lines/);
 const c=await control('create',p);await control('activate',{campaign_id:c.id,review_hash:c.review_hash});await step('heartbeat');await step('heartbeat','WA-b');assert.equal(await step('claim','WA-b'),null);assert.equal((await step('claim')).contact_id,contact);
});

test('parallel lanes keep a recipient sequence on its actual fallback line',async()=>{
 const other=randomUUID();await db.query('insert into contacts values($1,$2,$3,$3)',[other,account,'51900000004']);const p=input({dispatch_mode:'parallel',distribution:[{from:1,to:1,line_key:'WA-a'},{from:2,to:2,line_key:'WA-b'}],sequence:[{body:'first',delay_seconds:0},{body:'second',delay_seconds:0}]});p.recipients.push({...p.recipients[0],contact_id:other});const c=await control('create',p);await control('activate',{campaign_id:c.id,review_hash:c.review_hash});await step('heartbeat','WA-b');const root=await step('claim','WA-b');assert.ok(root);await step('authorize','WA-b',root);await step('record','WA-b',{...root,result:'accepted',provider:'fallback-first'});await db.query("update multichannel_jobs set started_at=now()-interval '2 seconds' where id=$1",[root.id]);await step('heartbeat');assert.equal(await step('claim'),null);const child=await step('claim','WA-b');assert.equal(child.predecessor_id,root.id);assert.equal(child.line_key,'WA-b');
});

test('parallel lane timing accepts a short valid window without changing sequential limits',async()=>{
 const other=randomUUID();await db.query('insert into contacts values($1,$2,$3,$3)',[other,account,'51900000004']);const p=input({dispatch_mode:'parallel',distribution:[{from:1,to:1,line_key:'WA-a'},{from:2,to:2,line_key:'WA-b'}],run_at:new Date().toISOString(),expires_at:new Date(Date.now()+5000).toISOString(),interval_seconds:50});p.recipients.push({...p.recipients[0],contact_id:other});const c=await control('create',p);assert.ok(c.id);assert.equal((await db.query('select count(distinct run_at)::int n from multichannel_jobs')).rows[0].n,1);
});
