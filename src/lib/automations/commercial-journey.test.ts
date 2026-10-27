import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import snapshot from './__fixtures__/commercial-courses-2026-10-27.json'
import type {AutomationStep} from '@/types'
import {buildCompleteCommercialCadence,COMPLETE_CADENCE_VERSION,readCommercialCadence,INFORMATION_GROUP_POSITIONS} from './commercial-cadence'

// Stateful local database and provider. No service credentials, OpenAI or Meta.
type Row=Record<string,any>
const h=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,sends:[] as Row[],serial:0}))
vi.mock('./audio-evidence',()=>({automationAudioEvidence:vi.fn(async()=>undefined)}))
vi.mock('./admin-client',()=>({supabaseAdmin:()=>({
  rpc:async()=>({data:null,error:null}),
  from:(table:string)=>{
    const predicates:Array<(r:Row)=>boolean>=[]; let payload:Row|Row[]|undefined,op='read',single=false,take=Infinity
    let ordering:{key:string;asc:boolean}|undefined
    const get=(r:Row,k:string)=>k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k]
    const contains=(a:any,b:any):boolean=>b&&typeof b==='object'?Object.entries(b).every(([k,v])=>contains(a?.[k],v)):a===b
    const resolve=()=>{
      const data=h.tables[table]??(h.tables[table]=[])
      let rows=data.filter(r=>predicates.every(p=>p(r)))
      if(ordering) rows.sort((a,b)=>(a[ordering!.key]<b[ordering!.key]?-1:1)*(ordering!.asc?1:-1))
      rows=rows.slice(0,take)
      if(op==='insert') {
        const value=Array.isArray(payload)?null:payload
        if(table==='automation_logs' && value?.inbound_message_id
          && data.some(r=>r.account_id===value.account_id&&r.automation_id===value.automation_id&&r.inbound_message_id===value.inbound_message_id))
          return {data:null,error:{code:'23505',message:'duplicate local inbound claim'},count:0}
        rows=(Array.isArray(payload)?payload:[payload!]).map(r=>({id:`local-${++h.serial}`,created_at:new Date().toISOString(),...structuredClone(r)}))
        data.push(...rows)
      } else if(op==='update') rows.forEach(r=>Object.assign(r,structuredClone(payload)))
      return {data:structuredClone(single?rows[0]??null:rows),error:null,count:rows.length}
    }
    const q:any={select:()=>q,insert:(v:Row|Row[])=>(op='insert',payload=v,q),update:(v:Row)=>(op='update',payload=v,q),
      eq:(k:string,v:any)=>(predicates.push(r=>get(r,k)===v),q),neq:(k:string,v:any)=>(predicates.push(r=>get(r,k)!==v),q),
      is:(k:string,v:any)=>(predicates.push(r=>(get(r,k)??null)===v),q),
      in:(k:string,v:any[])=>(predicates.push(r=>v.includes(get(r,k))),q),
      gt:(k:string,v:any)=>(predicates.push(r=>get(r,k)>v),q),gte:(k:string,v:any)=>(predicates.push(r=>get(r,k)>=v),q),
      lte:(k:string,v:any)=>(predicates.push(r=>get(r,k)<=v),q),contains:(k:string,v:any)=>(predicates.push(r=>contains(get(r,k),v)),q),
      like:(k:string,v:string)=>(predicates.push(r=>String(get(r,k)??'').endsWith(v.replace(/^%/,''))),q),
      order:(key:string,o:{ascending?:boolean}={})=>(ordering={key,asc:o.ascending!==false},q),limit:(n:number)=>(take=n,q),
      single:()=>{single=true;return Promise.resolve(resolve())},maybeSingle:()=>{single=true;return Promise.resolve(resolve())},
      then:(fn:any,reject:any)=>Promise.resolve(resolve()).then(fn,reject)}
    return q
  },
})}))
vi.mock('./meta-send',()=>{
  const send=async(args:Row)=>{
    if(args.mediaType && args.mediaType!=='audio' && String(args.caption??'').length>1024)throw Error('Meta caption exceeds 1024 characters')
    const id=`mock-wamid-${++h.serial}`
    h.sends.push({...structuredClone(args),at:new Date().toISOString()})
    h.tables.messages.push({id,message_id:id,conversation_id:args.conversationId,sender_type:'bot',
      content_text:args.text??args.payload?.body??args.caption,interactive_payload:args.payload,
      media_url:args.mediaUrl,status:'delivered',created_at:new Date().toISOString()})
    return {whatsapp_message_id:id}
  }
  return {engineSendText:send,engineSendMedia:send,engineSendInteractive:send,engineSendTemplate:send}
})
import {runAutomationById,runAutomationsForTrigger,resumePendingExecution} from './engine'
const A='local-account',C='local-contact',CHAT='local-chat'
const time=(s:string)=>new Date(`2026-10-27T${s}:00-05:00`)
function setup(index=0,at='01:00') {
  vi.useFakeTimers();vi.setSystemTime(time(at));h.serial=0;h.sends=[]
  const course=snapshot.courses[index]
  h.tables={contacts:[{id:C,account_id:A}],conversations:[{id:CHAT,contact_id:C,account_id:A,automation_enabled:true,
    last_customer_message_at:time(at).toISOString(),last_human_message_at:null}],messages:[],payment_reviews:[],automation_logs:[],automation_pending_executions:[],
    automations:snapshot.courses.map(c=>({id:c.id,account_id:A,user_id:'author',is_active:true,name:c.name,
      trigger_type:'keyword_match',trigger_config:{keywords:[`start-${c.id}`],match_type:'exact',commercial_cadence:buildCompleteCommercialCadence(c.steps as AutomationStep[])}})),
    automation_steps:snapshot.courses.flatMap(c=>c.steps),
  }
  h.tables.messages.push({id:'inbound',message_id:'inbound',conversation_id:CHAT,sender_type:'customer',created_at:new Date().toISOString()})
  return course
}
const start=(id:string)=>runAutomationById({accountId:A,automationId:id,contactId:C,conversationId:CHAT})
function nextPending(){return h.tables.automation_pending_executions.filter(r=>r.status==='pending').sort((a,b)=>Date.parse(a.run_at)-Date.parse(b.run_at))[0]}
async function tick(){
  const row=nextPending();if(!row)return false
  vi.setSystemTime(Math.max(Date.now(),Date.parse(row.run_at)));row.status='running'
  await resumePendingExecution(structuredClone(row) as Parameters<typeof resumePendingExecution>[0]);return true
}
async function finish(){let n=0;while(await tick())if(++n>150)throw Error('Local execution loop exceeded');return n}
function inbound(text:string){
  const at=new Date().toISOString();h.tables.messages.push({id:`in-${++h.serial}`,conversation_id:CHAT,sender_type:'customer',content_text:text,created_at:at})
  h.tables.conversations[0].last_customer_message_at=at
}
afterEach(()=>vi.useRealTimers())
beforeEach(()=>vi.clearAllMocks())
describe('complete course journey: real catalog, local dispatch → waits → delivery → resume',()=>{
  it.each(snapshot.courses.map((c,i)=>[c.name,i] as const))('%s completes without any click or reply',async(_,index)=>{
    const course=setup(index)
    expect(await start(course.id)).toBe(true)
    await finish()
    const urlsSeen=new Set<string>()
    const expected=course.steps.filter(s=>{
      if(s.step_type==='wait')return false
      if(s.step_type!=='send_media')return true
      const url=`${(s.step_config as Row).url}\u0000${(s.step_config as Row).caption??''}`
      if(urlsSeen.has(url))return false
      urlsSeen.add(url);return true
    })
    const continuations=expected.filter(s=>s.step_type==='send_media'&&String((s.step_config as Row).caption??'').length>1024).length
    expect(h.sends).toHaveLength(expected.length+continuations)
    const media=h.sends.filter(s=>s.mediaUrl).map(s=>s.mediaUrl)
    expect(media).toEqual(expected.filter(s=>s.step_type==='send_media').map(s=>(s.step_config as Row).url))
    expect(h.sends.at(-1)!.at).toBe(new Date('2026-10-28T05:00:00Z').toISOString())
    expect(h.tables.automation_logs.every(r=>r.status==='success')).toBe(true)
    expect(h.tables.automation_pending_executions.some(r=>r.status==='pending')).toBe(false)
    expect(h.tables.automation_logs[0].trigger_event).toContain(COMPLETE_CADENCE_VERSION)
    expect(h.sends.every(s=>s.at<new Date(time('01:00').getTime()+24*3600000).toISOString())).toBe(true)
  })
  it.each(['11:00','21:00'])('handles a %s arrival without losing the final block',async at=>{
    const c=setup(0,at);await start(c.id);await finish()
    expect(h.sends.at(-1)!.payload.buttons).toEqual((c.steps.at(-1)!.step_config as Row).buttons)
    expect(h.tables.automation_logs.every(r=>r.status==='success')).toBe(true)
  })
  it('preserves initial contents and delays the proactive night follow-up until six',async()=>{
    const c=setup();await start(c.id);await tick()
    expect(h.sends.map(s=>s.payload?.buttons?.some((b:Row)=>b.id==='commercial_human'))).not.toContain(true)
    expect(h.sends[0].caption+(h.sends[1].text??'')).toBe((c.steps[0].step_config as Row).caption)
    expect(nextPending().run_at).toBe('2026-10-27T11:00:00.000Z')
  })
  it('includes the human button only late and after ten delivered groups',async()=>{
    const c=setup();await start(c.id);await finish()
    const human=h.sends.filter(s=>s.payload?.buttons?.some((b:Row)=>b.id==='commercial_human'))
    expect(human).toHaveLength(1)
    expect(human[0].payload.buttons.at(-1).title.length).toBeLessThanOrEqual(20)
    const urls=new Set(h.sends.filter(s=>s.at<=human[0].at).map(s=>s.mediaUrl))
    expect(INFORMATION_GROUP_POSITIONS.filter(g=>g.some(p=>urls.has((c.steps[p].step_config as Row).url))).length).toBeGreaterThanOrEqual(10)
  })
  it.each(['pending','validated'])('stops after %s payment evidence',async status=>{
    const c=setup();await start(c.id);const before=h.sends.length
    h.tables.payment_reviews.push({id:'pay',account_id:A,conversation_id:CHAT,contact_id:C,status,created_at:new Date().toISOString()})
    await finish();expect(h.sends).toHaveLength(before)
  })
  it.each(['stop','human'])('respects the existing %s pause without discarding its cursor',async()=>{
    const c=setup();await start(c.id);h.tables.conversations[0].automation_enabled=false
    const before=h.sends.length;await tick()
    expect(h.sends).toHaveLength(before);expect(h.tables.automation_pending_executions.some(r=>r.status==='paused')).toBe(true)
  })
  it('a reply after three hours recalculates the window without repeating the greeting',async()=>{
    const c=setup(0,'11:00');await start(c.id);vi.setSystemTime(time('14:00'));inbound('Gracias');await finish()
    expect(h.sends.filter(s=>s.mediaUrl===(c.steps[0].step_config as Row).url)).toHaveLength(1)
    expect(h.sends.at(-1)!.at).toBe('2026-10-28T18:00:00.000Z')
  })
  it('retains skipped and remaining block identities when time is insufficient',async()=>{
    const c=setup();await start(c.id)
    const pending=nextPending();pending.next_step_position=4;pending.run_at='2026-10-28T05:00:00.000Z'
    await finish()
    expect(h.tables.automation_logs.some(r=>r.steps_executed.some((s:Row)=>s.status==='skipped'))).toBe(true)
    expect(h.tables.automation_pending_executions.some(r=>r.status==='paused'&&r.context.commercial_remaining_step_ids.length>0)).toBe(true)
    expect(h.sends.every(s=>s.at<'2026-10-28T05:59:00.000Z')).toBe(true)
  })
  it('pins all 55 contents and refuses a drifting or compact-as-complete catalog',()=>{
    const c=setup();const full=buildCompleteCommercialCadence(c.steps as AutomationStep[])
    expect(readCommercialCadence(full)?.steps).toHaveLength(55)
    expect(full.steps.map(s=>s.config)).toEqual(c.steps.map(s=>s.step_config))
    expect(()=>buildCompleteCommercialCadence(c.steps.slice(0,11) as AutomationStep[])).toThrow()
  })
  it.each(snapshot.secondary.map(s=>[s.name,s] as const))('%s answers and returns to the exact saved course',async(_,route)=>{
    const link=route.steps.find(s=>s.step_type==='run_automation')!
    const target=(link.step_config as Row).automation_id
    const c=setup(snapshot.courses.findIndex(c=>c.id===target),'11:00')
    await start(c.id);await tick()
    const saved=nextPending(),position=saved.next_step_position
    h.tables.automations.push({...route,account_id:A,user_id:'author',is_active:true,trigger_type:'keyword_match',
      trigger_config:{...route.trigger_config,course_detour:true,course_response_only:true}})
    h.tables.automation_steps.push(...route.steps)
    inbound((route.trigger_config as Row).keywords[0])
    await runAutomationsForTrigger({accountId:A,contactId:C,triggerType:'keyword_match',
      context:{conversation_id:CHAT,message_text:(route.trigger_config as Row).keywords[0],inbound_at:new Date().toISOString()}})
    // A route's existing short wait still finishes before the saved course resumes.
    for(let n=0;saved.status==='cancelled'&&n<10;n++) await tick()
    expect(saved.status).toBe('pending');expect(saved.next_step_position).toBe(position)
    await finish()
    expect(h.sends.filter(s=>s.mediaUrl===(c.steps[0].step_config as Row).url)).toHaveLength(1)
    expect(h.tables.automation_logs.every(r=>r.status==='success')).toBe(true)
    expect(h.sends.every(s=>!snapshot.courses.filter(other=>other.id!==target).some(other=>(other.steps[0].step_config as Row).url===s.mediaUrl))).toBe(true)
  })
  it.each(['silence','Ok','Gracias','¿Cuál es el horario?'])('the actual payment sequence returns to the course after %s',async answer=>{
    const c=setup(3,'11:00');await start(c.id);await tick()
    const saved=nextPending(),position=saved.next_step_position
    const pay=snapshot.payment
    h.tables.automations.push({...pay,account_id:A,user_id:'author',is_active:true,trigger_type:'keyword_match'})
    h.tables.automation_steps.push(...pay.steps)
    inbound('🔥 Activar mi promo')
    expect(await start(pay.id)).toBe(true)
    expect(saved.status).toBe('cancelled')
    const mediaBefore=h.sends.length
    if(answer!=='silence') {vi.setSystemTime(Date.now()+60_000);inbound(answer)}
    for(let n=0;saved.status==='cancelled'&&n<10;n++) await tick()
    expect(saved.status).toBe('pending');expect(saved.next_step_position).toBe(position)
    if(answer!=='silence')expect(h.sends).toHaveLength(mediaBefore)
    await finish()
    expect(h.sends.filter(s=>s.mediaUrl===(c.steps[0].step_config as Row).url)).toHaveLength(1)
    expect(h.tables.automation_logs.every(r=>r.status==='success')).toBe(true)
  })
  it('does not offer the human button when delivery evidence covers fewer than ten groups',async()=>{
    const c=setup();await start(c.id)
    const pending=nextPending();pending.next_step_position=49;pending.run_at=new Date().toISOString()
    await finish()
    expect(h.sends.some(s=>s.payload?.buttons?.some((b:Row)=>b.id==='commercial_human'))).toBe(false)
  })
  it.each(['resume','manual pause','payment','ambiguous holds'])('new inbound handles a window hold: %s',async reason=>{
    const c=setup();await start(c.id)
    const pending=nextPending();pending.run_at='2026-10-28T06:01:00.000Z'
    await tick();expect(pending.status).toBe('done')
    const held=h.tables.automation_pending_executions.find(r=>r.status==='paused')!
    expect(held.context.commercial_window_hold).toBe(true)
    if(reason==='manual pause')h.tables.conversations[0].automation_enabled=false
    if(reason==='payment')h.tables.payment_reviews.push({id:'validated',account_id:A,conversation_id:CHAT,status:'validated'})
    if(reason==='ambiguous holds')h.tables.automation_pending_executions.push({...structuredClone(held),id:'second-hold'})
    inbound('Quiero continuar')
    await runAutomationsForTrigger({accountId:A,contactId:C,triggerType:'new_message_received',context:{conversation_id:CHAT,
      inbound_at:new Date().toISOString(),message_text:'Quiero continuar'}})
    expect(held.status).toBe(reason==='resume'?'pending':'paused')
    if(reason==='resume') {
      expect(Date.parse(held.run_at)-Date.now()).toBe(20*60_000)
      await finish();expect(h.sends.filter(s=>s.mediaUrl===(c.steps[0].step_config as Row).url)).toHaveLength(1)
    }
  })
  it('repeated or concurrent delivery of the same click does not cancel the saved journey or send twice',async()=>{
    const route=snapshot.secondary.find(s=>s.name==='MALLAS DE ADMIN (49.90)')!
    const c=setup(0,'11:00');await start(c.id);await tick()
    const saved=nextPending(),position=saved.next_step_position
    h.tables.automations.push({...route,account_id:A,user_id:'author',is_active:true,trigger_type:'keyword_match',
      trigger_config:{...route.trigger_config,course_detour:true,course_response_only:true}})
    h.tables.automation_steps.push(...route.steps)
    const event={accountId:A,contactId:C,triggerType:'keyword_match' as const,context:{conversation_id:CHAT,
      inbound_at:new Date().toISOString(),inbound_message_id:'provider-click-once',message_text:'Malla de Admin.'}}
    await runAutomationsForTrigger(event)
    const sent=h.sends.length
    await Promise.all([runAutomationsForTrigger(event),runAutomationsForTrigger(event)])
    expect(h.sends).toHaveLength(sent);expect(saved.status).toBe('pending');expect(saved.next_step_position).toBe(position)
    expect(h.tables.automation_logs.filter(r=>r.automation_id===route.id)).toHaveLength(1)
  })
  it('a later opening keyword cannot restart an already launched complete course',async()=>{
    const c=setup();await start(c.id);const sent=h.sends.length,saved=nextPending()
    await runAutomationsForTrigger({accountId:A,contactId:C,triggerType:'keyword_match',context:{conversation_id:CHAT,
      message_text:`start-${c.id}`,inbound_message_id:'another-ad-message',inbound_at:new Date().toISOString()}})
    expect(h.sends).toHaveLength(sent);expect(saved.status).toBe('pending')
  })
  it('a person already paid receives no new commercial welcome',async()=>{
    const c=setup();h.tables.payment_reviews.push({id:'paid',account_id:A,conversation_id:CHAT,contact_id:C,status:'validated'})
    await start(c.id);await finish();expect(h.sends).toHaveLength(0)
  })
  it('disabling the actual automation holds the next position without sending',async()=>{
    const c=setup();await start(c.id);const sent=h.sends.length
    h.tables.automations.find(r=>r.id===c.id)!.is_active=false
    await tick();expect(h.sends).toHaveLength(sent)
    expect(h.tables.automation_pending_executions.some(r=>r.status==='paused')).toBe(true)
  })
  it.each(snapshot.menus.map(m=>[m.name,m.id] as const))('the actual %s links terminate through their bounded ranges',async(_,id)=>{
    setup()
    h.tables.automations.push(...snapshot.menus.map(menu=>({...menu,account_id:A,user_id:'author',is_active:true,trigger_type:'keyword_match'})))
    h.tables.automation_steps.push(...snapshot.menus.flatMap(menu=>menu.steps))
    expect(await start(id)).toBe(true);await finish()
    expect(h.tables.automation_logs.map(row=>row.automation_id).sort()).toEqual(snapshot.menus.map(menu=>menu.id).sort())
    expect(h.tables.automation_logs.every(row=>row.status==='success')).toBe(true)
    expect(h.sends.length).toBeLessThan(30)
  })
  it('several different secondary visits keep one course and its cursor',async()=>{
    const c=setup(0,'11:00');await start(c.id);await tick()
    const saved=nextPending(),position=saved.next_step_position
    for(const name of ['MALLAS DE ADMIN (49.90)','CLASES MODELOS DE ADMIN (49.90)','Certificación Admin (49.90)']) {
      const route=snapshot.secondary.find(s=>s.name===name)!
      h.tables.automations.push({...route,account_id:A,user_id:'author',is_active:true,trigger_type:'keyword_match',
        trigger_config:{...route.trigger_config,course_detour:true,course_response_only:true}})
      h.tables.automation_steps.push(...route.steps)
      const text=route.trigger_config.keywords[0];inbound(text)
      await runAutomationsForTrigger({accountId:A,contactId:C,triggerType:'keyword_match',context:{conversation_id:CHAT,
        message_text:text,inbound_at:new Date().toISOString(),inbound_message_id:`click-${route.id}`}})
      for(let n=0;saved.status==='cancelled'&&n<10;n++)await tick()
      expect(saved.status).toBe('pending');expect(saved.next_step_position).toBe(position)
    }
    await finish();expect(h.sends.filter(s=>s.mediaUrl===(c.steps[0].step_config as Row).url)).toHaveLength(1)
    expect(h.tables.automation_logs.every(r=>r.status==='success')).toBe(true)
  })
})
