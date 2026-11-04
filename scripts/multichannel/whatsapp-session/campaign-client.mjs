import{replyBodyHash}from'./adapter.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function createCampaignClient({origin,token,lineKey,fetchImpl=fetch,timeoutMs=30000}){
 let endpoint;try{const u=new URL(origin);const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||(!local&&u.protocol!=='https:')||(local&&!['http:','https:'].includes(u.protocol)))throw Error();endpoint=new URL('/api/multichannel/campaigns/worker',u);}catch{throw Error('Configuración de campañas inválida.');}
 if(!/^wcm_[a-f0-9]{64}$/.test(token??'')||!/^WA-[A-Za-z0-9_-]{1,60}$/.test(lineKey??'')||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('Configuración de campañas inválida.');
 async function request(payload,sessionPhone){
  if(!/^\d{7,15}$/.test(sessionPhone??''))throw Error('Sesión sin identidad.');
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...payload,line_key:lineKey,session_phone:sessionPhone})});
  if(!response.ok)throw Error('No se confirmó la operación de campaña.');const raw=await response.text();if(raw.length>20000)throw Error('Respuesta de campaña inválida.');return JSON.parse(raw);
 }
 return Object.freeze({
  heartbeat:(ready,phone)=>request({action:'heartbeat',ready},phone),
  async ack(value,phone){const r=await request({action:'ack',job_id:value.id,state:'delivered',provider_id:value.providerId},phone);if(!r.receipt?.recorded)throw Error('Acuse de campaña pendiente.');return r.receipt;},
  async claim(phone){const{job}=await request({action:'claim'},phone);if(!job)return null;
   if(job.mode!=='whatsapp_live'||job.line_key!==lineKey||!uuid(job.id)||!uuid(job.claim_token)||!uuid(job.account_id)||!uuid(job.campaign_id)||!/^\+[1-9]\d{7,14}$/.test(job.recipient??'')||typeof job.body!=='string'||!job.body.trim()||job.body.length>4000)throw Error('Tarea de campaña inválida.');
   return{id:job.id,key:'campaign:'+job.id,claimToken:job.claim_token,accountId:job.account_id,campaignId:job.campaign_id,lineKey,chatId:job.recipient.slice(1)+'@c.us',body:job.body};
  },
  async authorize(job){const{permit}=await request({action:'authorize',job_id:job.id,claim_token:job.claimToken,chat_id:job.chatId,body_hash:job.bodyHash??replyBodyHash(job.body)},job.sessionPhone);return permit??{allowed:false};},
  async finish(job,result,phone){
   if(['blocked','disabled'].includes(result.state)){const r=await request({action:'release',job_id:job.id,claim_token:job.claimToken},phone);if(r.receipt?.recorded)return r.receipt;}
   const state=result.state==='accepted'?'accepted':['blocked','disabled'].includes(result.state)?'failed':'needs_review';
   const payload={action:'record',job_id:job.id,claim_token:job.claimToken,state,...(state==='accepted'?{provider_id:result.providerId}:{})};
   const r=await request(payload,phone);if(!r.receipt?.recorded)throw Error('Resultado de campaña sin confirmar.');return r.receipt;
  },
 });
}
export function startCampaignPoller({adapter,client,pollMs=5000,onError=()=>{}}){
 if(!adapter?.dispatchCampaign||!client?.claim||!client?.heartbeat||pollMs<1000||pollMs>30000)throw Error('Ejecutor de campaña inválido.');
 let stopped=false,timer,wake;const acknowledged=new Set();const stats={polls:0,claimed:0,accepted:0,needsReview:0,errors:0};
 const task=(async()=>{while(!stopped){try{
  await adapter.refreshConnection();const s=adapter.status();if(s.linkedPhone){
   await client.heartbeat(s.status==='ready'&&!s.automationPaused,s.linkedPhone);
   for(const ack of adapter.campaignAcknowledgements?.()??[]){const key=ack.id+':'+ack.providerId;if(!acknowledged.has(key)){await client.ack(ack,s.linkedPhone);acknowledged.add(key);}}
   const job=s.automationPaused?null:await client.claim(s.linkedPhone);stats.polls++;
   if(job){stats.claimed++;let result;if(s.status!=='ready')result={state:'disabled'};else try{result=await adapter.dispatchCampaign(job);}catch{result={state:'needs_review'};}
    await client.finish(job,result,s.linkedPhone);if(result.state==='accepted')stats.accepted++;else if(['needs_review','already_attempted'].includes(result.state))stats.needsReview++;
   }
  }
 }catch{stats.errors++;try{onError();}catch{}}
 if(!stopped)await new Promise(r=>{wake=r;timer=setTimeout(()=>{wake=null;r();},pollMs);timer.unref?.();});}})();
 return Object.freeze({status:()=>({...stats}),async stop(){stopped=true;clearTimeout(timer);wake?.();await task;}});
}
