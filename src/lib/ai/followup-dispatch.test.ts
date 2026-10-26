import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conv: {} as Record<string, unknown>, last: {} as Record<string, unknown>,
  customer: {} as Record<string, unknown>, pending: [] as unknown[],
  text: vi.fn(), interactive: vi.fn(), context: vi.fn(), candidates: vi.fn(),
  run:vi.fn(), route:vi.fn(), general:null as null | {id:string;name:string;trigger_config:object},
  runs:[] as Array<{automation_id:string;status?:string;created_at?:string;trigger_event?:string;steps_executed:Array<{detail:string}>}>,
  runAutomations:[] as Array<{id:string;name:string;trigger_config?:object}>,
}))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  let update = false
  const filters: Array<[string,unknown]> = []
  const result = () => ({error:null,data: table === 'conversations' ? (update ? {id:'chat'} : [h.conv])
    : table === 'messages' ? (filters.some(([key,value]) => key === 'sender_type' && value === 'customer') ? h.customer : h.last)
    : table === 'automation_pending_executions' ? null : table === 'automations' ? (filters.some(([key]) => key === 'id') ? h.runAutomations : h.general) : table === 'automation_logs' ? h.runs : []})
  const chain = {
    select: () => chain, update: () => { update = true; return chain },
    eq: (key:string,value:unknown) => {filters.push([key,value]); return chain},
    lt: () => chain, gt: () => chain, gte: () => chain, neq: () => chain, in: (key:string,value:unknown) => {filters.push([key,value]); return chain},
    is: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => table === 'automation_pending_executions'
      ? {data:h.pending.find(row => {
        const statuses=filters.find(([key])=>key==='status')?.[1] as string[] | undefined
        return statuses?.includes((row as {status?:string}).status ?? 'pending')
      }) ?? null,error:null} : result(),
    then: (resolve:(value:unknown)=>unknown) => Promise.resolve(result()).then(resolve),
  }
  return chain
} }) }))
vi.mock('./config', () => ({loadAiConfig:async()=>({autoReplyEnabled:true})}))
vi.mock('./context', () => ({buildConversationContext:h.context}))
vi.mock('./automation-match', async importOriginal => ({...await importOriginal<typeof import('./automation-match')>(),findCandidateAutomations:h.candidates}))
vi.mock('@/lib/automations/engine', () => ({runAutomationById:h.run}))
vi.mock('./handoff-routing', async importOriginal => ({...await importOriginal<typeof import('./handoff-routing')>(),routeConversationToArea:h.route}))
vi.mock('@/lib/automations/meta-send', () => ({engineSendInteractive:h.interactive}))
vi.mock('@/lib/flows/meta-send', () => ({engineSendText:h.text}))

import { runIdleFollowups, IDLE_FOLLOWUP_TEXT } from './followup'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-17T20:00:00Z'))
  h.conv = {id:'chat',account_id:'account',user_id:'owner',contact_id:'contact',
    last_message_at:'2026-10-17T19:40:02Z',followup_sent_at:'2026-10-17T19:40:00Z',last_human_message_at:null}
  h.customer = {sender_type:'customer',content_text:'Necesito ayuda',created_at:'2026-10-17T19:00:00Z'}
  h.last = {sender_type:'bot',content_type:'interactive',content_text:'¿Quieres que retomemos la conversación? Pulsa continuar y te ayudamos a elegir el área.',
    status:'sent',created_at:'2026-10-17T19:40:02Z'}
  h.pending = []
  h.runs = []
  h.runAutomations = []
  h.general = {id:'general',name:'CURSOS GENERALES',trigger_config:{}}
  h.run.mockResolvedValue(true)
  h.route.mockResolvedValue({agentId:'adviser'})
  h.context.mockResolvedValue([{role:'user',content:'Necesito ayuda'}])
  h.candidates.mockResolvedValue([])
  h.text.mockResolvedValue({whatsapp_message_id:'fallback'})
  h.interactive.mockResolvedValue({whatsapp_message_id:'button'})
})

describe('idle follow-up dispatch', () => {
  it('retains the student choice when the five latest messages are all outgoing',async()=>{
    h.conv.followup_sent_at=null
    h.customer.content_text='Información de nutrición'
    h.context.mockResolvedValue([{role:'assistant',content:'Selecciona una opción'}])
    h.candidates.mockResolvedValue([{id:'nutrition',name:'NUTRICION 19.90'}])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.candidates).toHaveBeenCalledWith(expect.anything(),'account',expect.arrayContaining([{role:'user',content:'Información de nutrición'}]),3)
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'nutrition'}))
  })
  it('never sends a general menu when the last selected button identifies Inicial',async()=>{
    h.conv.followup_sent_at=null
    h.last={sender_type:'bot',content_type:'text',content_text:'Nuestra clase de Inicial',created_at:'2026-10-17T19:40:00Z'}
    h.context.mockResolvedValue([{role:'user',content:'🌱 Cero en Inicial'},{role:'assistant',content:'Nuestra clase de Inicial'}])
    h.runs=[{automation_id:'education',status:'failed',steps_executed:[]}]
    h.candidates.mockResolvedValue([])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.route).toHaveBeenCalledWith(expect.anything(),'account','chat','ventas')
    expect(h.text).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('EDUCACION INICIAL')}))
  })
  it('does not jump to an unused course block after a failed step',async()=>{
    h.conv.followup_sent_at=null
    h.customer.content_text='Quiero información de Nutrición'
    h.context.mockResolvedValue([{role:'user',content:'Quiero información de Nutrición'}])
    h.runs=[{automation_id:'nutrition',status:'failed',steps_executed:[]}]
    h.candidates.mockResolvedValue([{id:'nutrition-curriculum',name:'MALLAS DE NUTRICION'}])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.route).toHaveBeenCalledWith(expect.anything(),'account','chat','ventas')
  })
  it('does not reopen a completed course after an off-script AI answer', async () => {
    h.conv.followup_sent_at = null
    h.last = {sender_type:'bot',content_type:'text',content_text:'Sí, puedes estudiar desde tu celular.',created_at:'2026-10-17T19:40:00Z'}
    h.runs = [{automation_id:'education',status:'success',steps_executed:[]}]
    h.runAutomations = [{id:'education',name:'EDUCACION INICIAL'}]
    h.candidates.mockResolvedValue([{id:'education',name:'EDUCACION INICIAL'}])
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('does not start an unused Administrative block after the real abbreviated root finishes',async()=>{
    h.conv.followup_sent_at=null
    h.last={sender_type:'bot',content_type:'text',content_text:'Puedes revisar los beneficios.',created_at:'2026-10-17T19:40:00Z'}
    h.runs=[{automation_id:'admin',status:'success',steps_executed:[]}]
    h.runAutomations=[{id:'admin',name:'ASISTENTE A 19.90 (49.90)',trigger_config:{sales_window_close:true}}]
    h.candidates.mockResolvedValue([{id:'admin-zero',name:'DESDE CERO ADMIN (49.90)'}])
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('does not follow up before ten minutes when the last-message timestamp was stale',async()=>{
    h.conv.followup_sent_at=null
    h.last.created_at='2026-10-17T19:59:43Z'
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
  })
  it('does not repeat a follow-up when our outgoing updated the conversation time', async () => {
    expect(await runIdleFollowups()).toBe(0)
    expect(h.interactive).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('sends plain text instead of repeating a failed button', async () => {
    h.last.status = 'failed'
    expect(await runIdleFollowups()).toBe(1)
    expect(h.text).toHaveBeenCalledWith(expect.objectContaining({text:IDLE_FOLLOWUP_TEXT,conversationId:'chat'}))
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('uses the saved general automation for an unknown sales request instead of another button', async () => {
    h.conv.followup_sent_at = null
    h.last = {...h.customer}
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'general'}))
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('does not retry a text fallback that already failed before insertion', async () => {
    h.last.status = 'failed'
    h.conv.followup_sent_at = '2026-10-17T19:41:00Z'
    expect(await runIdleFollowups()).toBe(0)
    expect(h.text).not.toHaveBeenCalled()
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it.each(['VENTAS','FIDELIZACION'])('resumes %s after adviser inactivity using only five messages', async area => {
    h.conv.ai_handoff_area = area
    h.conv.followup_sent_at = '2026-10-17T19:10:00Z'
    h.conv.last_human_message_at = '2026-10-17T19:40:00Z'
    h.last = {sender_type:'agent',content_type:'text',content_text:'Te ayudamos por aquí.',created_at:'2026-10-17T19:40:00Z'}
    expect(await runIdleFollowups()).toBe(1)
    expect(h.context).toHaveBeenCalledWith(expect.anything(),'chat',5)
    if (area === 'VENTAS') {
      expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'general'}))
      expect(h.route).not.toHaveBeenCalled()
    } else {
      expect(h.route).toHaveBeenCalledWith(expect.anything(),'account','chat','fidelizacion')
      expect(h.run).not.toHaveBeenCalled()
    }
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('keeps a fidelity handoff already announced without rerouting or sending sales', async () => {
    h.conv.ai_handoff_area = 'FIDELIZACION'
    h.conv.ai_handed_off_at = '2026-10-17T19:01:00Z'
    h.conv.followup_sent_at = null
    h.last = {...h.customer}
    expect(await runIdleFollowups()).toBe(0)
    expect(h.route).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled()
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('does not reopen a support query that already received a complete answer', async () => {
    h.conv.ai_handoff_area = 'FIDELIZACION'
    h.conv.followup_sent_at = null
    h.last = {sender_type:'bot',content_type:'text',content_text:'Tu consulta está resuelta. Gracias.',created_at:'2026-10-17T19:40:00Z'}
    expect(await runIdleFollowups()).toBe(0)
    expect(h.route).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled()
  })
  it('tags fidelity when human support was promised in text without a formal handoff yet', async () => {
    h.conv.ai_handoff_area = 'FIDELIZACION'
    h.conv.followup_sent_at = null
    h.last = {sender_type:'bot',content_type:'text',content_text:'Una asesora te atenderá en breve.',created_at:'2026-10-17T19:40:00Z'}
    h.context.mockResolvedValue([{role:'user',content:'No puedo ingresar a mi clase'},
      {role:'assistant',content:'Una asesora te atenderá en breve.'}])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.route).toHaveBeenCalledWith(expect.anything(),'account','chat','fidelizacion')
    expect(h.run).not.toHaveBeenCalled()
  })
  it('uses the matching course block instead of general courses when the context is specific', async () => {
    h.conv.followup_sent_at = null
    h.last = {...h.customer}
    h.context.mockResolvedValue([{role:'user',content:'Me interesa nutrición'}])
    h.candidates.mockResolvedValue([{id:'nutrition',name:'NUTRICION 19.90'}])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'nutrition'}))
  })
  it('continues sales after sending information even when the last message was not a question', async () => {
    h.conv.followup_sent_at = null
    h.conv.ai_handoff_area = 'VENTAS'
    h.last = {sender_type:'bot',content_type:'text',content_text:'Te compartimos la información.',created_at:'2026-10-17T19:40:00Z'}
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'general'}))
  })
  it('never restarts the saved block that sent the last message', async () => {
    h.conv.followup_sent_at = null
    h.last.message_id = 'wamid.nutrition'
    h.runs = [{automation_id:'nutrition',steps_executed:[{detail:'sent via Meta (wamid.nutrition)'}]}]
    h.candidates.mockResolvedValue([{id:'nutrition',name:'NUTRICION 19.90'}])
    expect(await runIdleFollowups()).toBe(1)
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({automationId:'general'}))
    expect(h.run).not.toHaveBeenCalledWith(expect.objectContaining({automationId:'nutrition'}))
  })
  it('does not restart general courses when that same block already owns the final message', async () => {
    h.conv.followup_sent_at = null
    h.last.message_id = 'wamid.general'
    h.runs = [{automation_id:'general',steps_executed:[{detail:'sent via Meta (wamid.general)'}]}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('does not resume during the five-minute human pause or interrupt a scheduled wait', async () => {
    h.conv.last_human_message_at = '2026-10-17T19:57:00Z'
    h.conv.followup_sent_at = null
    expect(await runIdleFollowups()).toBe(0)
    h.conv.last_human_message_at = null
    h.pending = [{id:'scheduled'}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('does not replace a paused saved sequence with a different block',async()=>{
    h.conv.followup_sent_at=null
    h.pending=[{id:'saved-paused-step',status:'paused'}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('does not launch general courses after a payment activation when an older payment run has no pending wait', async () => {
    h.conv.followup_sent_at = null
    h.customer = {sender_type:'customer',content_text:'🔥 Activar promoción',created_at:'2026-10-17T19:29:00Z'}
    h.last = {sender_type:'bot',content_type:'image',content_text:'Realiza tu pago y envía el comprobante',created_at:'2026-10-17T19:29:10Z'}
    h.runs = [{automation_id:'payment',status:'success',created_at:'2026-10-17T19:29:02Z',steps_executed:[]}]
    h.runAutomations = [{id:'payment',name:'YAPE O PLIN'}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it.each([false,true])('retains payment after a newer question about class days (failed menu: %s)',async failedMenu=>{
    h.conv.followup_sent_at=null
    h.customer={sender_type:'customer',content_text:'¿Qué días son las clases?',created_at:'2026-10-17T19:35:00Z'}
    h.context.mockResolvedValue([{role:'user',content:'¿Qué días son las clases?'}])
    if(!failedMenu) h.last={sender_type:'bot',content_type:'text',content_text:'Puedes estudiar desde tu celular.',created_at:'2026-10-17T19:36:00Z'}
    else h.last.status='failed'
    h.runs=[{automation_id:'payment',status:'success',created_at:'2026-10-17T19:29:02Z',steps_executed:[]}]
    h.runAutomations=[{id:'payment',name:'YAPE O PLIN',trigger_config:{payment_followup:true}}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('still routes fidelity support after a recent payment flow',async()=>{
    h.conv.followup_sent_at=null
    h.conv.ai_handoff_area='FIDELIZACION'
    h.last={...h.customer}
    h.runs=[{automation_id:'payment',status:'success',created_at:'2026-10-17T18:29:02Z',steps_executed:[]}]
    h.runAutomations=[{id:'payment',name:'YAPE O PLIN',trigger_config:{payment_followup:true}}]
    expect(await runIdleFollowups()).toBe(1)
    expect(h.route).toHaveBeenCalledWith(expect.anything(),'account','chat','fidelizacion')
    expect(h.run).not.toHaveBeenCalled()
  })
})
