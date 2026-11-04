import{test}from'node:test';import assert from'node:assert/strict';import{EventEmitter}from'node:events';import{randomUUID}from'node:crypto';
import{createCampaignClient,startCampaignPoller}from'./campaign-client.mjs';import{createSessionAdapter,replyBodyHash}from'./adapter.mjs';import{sessionScope}from'./store.mjs';
const accountId=randomUUID(),campaignId=randomUUID(),id=randomUUID(),claim=randomUUID(),lineKey='WA-fictional',phone='51900000001',recipient='+51900000002',body='Aviso ficticio';
const token='wcm_'+'a'.repeat(64);
const rawJob={id,claim_token:claim,account_id:accountId,campaign_id:campaignId,line_key:lineKey,mode:'whatsapp_live',recipient,body};
test('claim, two permits, send and provider receipt retain the same campaign and reservation',async()=>{
 const calls=[];let claimed=false;const records=[],client=new EventEmitter();client.info={wid:{user:phone}};client.initialize=async()=>{};client.destroy=async()=>{};client.getState=async()=> 'CONNECTED';let sends=0;
 client.sendMessage=async(to,text)=>{sends++;assert.equal(text,body);return{id:{_serialized:'provider-real',fromMe:true},fromMe:true,to};};
 const remote=createCampaignClient({origin:'https://crm.example.test',token,lineKey,fetchImpl:async(_url,init)=>{
  const p=JSON.parse(init.body);calls.push(p);assert.equal(p.line_key,lineKey);assert.equal(p.session_phone,phone);
  if(p.action==='claim'){const job=claimed?null:rawJob;claimed=true;return Response.json({job});}
  if(p.action==='authorize'){assert.equal(p.job_id,id);assert.equal(p.claim_token,claim);assert.equal(p.body_hash,replyBodyHash(body));return Response.json({permit:{allowed:true,paused:false,permissionConfirmed:true,accountId,lineKey,sessionPhone:phone,jobId:id,campaignId,chatId:recipient.slice(1)+'@c.us',bodyHash:p.body_hash,expiresAt:Date.now()+5000}});}
  return Response.json({receipt:{recorded:true}});
 }});
 const adapter=createSessionAdapter({accountId,lineKey,client,enabled:true,campaignsEnabled:true,authorizeCampaign:remote.authorize,store:{scope:sessionScope(accountId,lineKey),records:()=>records,append:async(kind,payload)=>records.push({kind,payload:structuredClone(payload)}),close:async()=>{}}});
 await adapter.start();const poller=startCampaignPoller({adapter,client:remote,pollMs:1000});
 const deadline=Date.now()+1500;while(!calls.some(c=>c.action==='record')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 await poller.stop();assert.equal(sends,1);assert.equal(calls.filter(c=>c.action==='authorize').length,2);
 assert.equal(calls.find(c=>c.action==='record').provider_id,'provider-real');assert.equal(adapter.status().received,0);
 client.emit('message_ack',{id:{_serialized:'provider-real'}},2);await adapter.idle();await remote.ack(adapter.campaignAcknowledgements()[0],phone);
 assert.equal(calls.at(-1).action,'ack');assert.equal(calls.at(-1).state,'delivered');await adapter.stop();
});
test('rejects a task from another line or a simulated task before dispatch',async()=>{
 for(const patch of [{line_key:'WA-other'},{mode:'simulation'}]){
  const c=createCampaignClient({origin:'https://crm.example.test',token,lineKey,fetchImpl:async()=>Response.json({job:{...rawJob,...patch}})});
  await assert.rejects(c.claim(phone),/inválida/);
 }
 assert.throws(()=>createCampaignClient({origin:'http://untrusted.example',token,lineKey}));
});
test('an offline WhatsApp still reports health so the server can route an authorized SMS fallback',async()=>{
 const events=[];const adapter={refreshConnection:async()=>{},status:()=>({status:'disconnected',linkedPhone:phone}),dispatchCampaign:async()=>{throw Error('Must not send');}};
 const client={heartbeat:async ready=>events.push(ready),claim:async()=>null};
 const p=startCampaignPoller({adapter,client,pollMs:1000});const deadline=Date.now()+500;while(!events.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));await p.stop();assert.deepEqual(events,[false]);
});
test('a paused bot reports unavailable for campaigns and does not claim work',async()=>{
 let claims=0;const health=[];const adapter={refreshConnection:async()=>{},status:()=>({status:'ready',linkedPhone:phone,automationPaused:true}),dispatchCampaign:async()=>{throw Error('Must not send');}};
 const p=startCampaignPoller({adapter,client:{heartbeat:async ready=>health.push(ready),claim:async()=>{claims++;}},pollMs:1000});
 const deadline=Date.now()+500;while(!health.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));await p.stop();assert.deepEqual(health,[false]);assert.equal(claims,0);
});
