import { describe, expect, it } from 'vitest'
import { findCandidateAutomations, preferredCourseInformationAutomation } from './automation-match'
import { buildSystemPrompt } from './defaults'
import type { ChatMessage } from './types'

const catalog = [
  { id: 'malla-farmacia', name: 'MALLAS DE FARMACIA', description: null, trigger_config: { keywords: ['Malla de farmacia'] } },
  { id: 'promo-farmacia', name: 'FARMACIA 19.90', description: null, trigger_config: { keywords: ['Hola Deseo informacion sobre la Super Promo 19.90', 'en Auxiliar de Farmacia'] } },
  { id: 'promo-nutricion', name: 'NUTRICION 19.90', description: null, trigger_config: { keywords: ['nutricion'] } },
]
function db() {
  const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: catalog, error: null }) }
  return { from: () => chain } as unknown as Parameters<typeof findCandidateAutomations>[0]
}
async function candidates(messages: ChatMessage[]) { return findCandidateAutomations(db(), 'account-test', messages) }

describe('prioridad de informacion inicial del curso', () => {
  it('selects the actual Nutricion block instead of rewriting its steps', async () => {
    const messages: ChatMessage[]=[{role:'user',content:'Hola, quiero informacion de la promocion activa de NUTRICION Y DIETETICA.'}]
    expect(preferredCourseInformationAutomation(await candidates(messages),messages)).toBe('promo-nutricion')
  })
  it('selects an explicitly requested curriculum but does not restart sales for dates or payments',()=>{
    const options=catalog.map(({id,name})=>({id,name}))
    expect(preferredCourseInformationAutomation(options,[{role:'user',content:'Malla de farmacia'}])).toBe('malla-farmacia')
    for (const content of ['Cuando comienza Nutricion?', 'Quiero activar la promo de nutricion, pasame Yape', 'Info de farmacia y nutricion']) {
      expect(preferredCourseInformationAutomation(options,[{role:'user',content}])).toBeNull()
    }
    expect(preferredCourseInformationAutomation([...options,{id:'other',name:'NUTRICION PROMOCION'}],[{role:'user',content:'Info de nutricion'}])).toBeNull()
  })
  it.each(['Quiero informacion de farmacia', 'Info de farmacia', 'Hola, auxiliar de farmacia'])('prioriza superpromo y excluye malla al iniciar: %s', async (content) => {
    expect(await candidates([{ role: 'user', content }])).toEqual([{ id: 'promo-farmacia', name: 'FARMACIA 19.90' }])
  })
  it('un saludo o una pregunta previa no significa que ya se envio la oferta', async () => {
    expect(await candidates([{ role: 'assistant', content: 'Hola, quieres la promocion o los horarios?' }, { role: 'user', content: 'Info de farmacia' }])).toEqual([{ id: 'promo-farmacia', name: 'FARMACIA 19.90' }])
  })
  it.each(['Malla de farmacia', 'Quiero la maya de farmacia', 'Temario de farmacia'])('respeta solicitud explicita: %s', async (content) => {
    expect((await candidates([{ role: 'user', content }]))[0].id).toBe('malla-farmacia')
  })
  it('permite la malla despues de compartir la oferta principal', async () => {
    const result = await candidates([{ role: 'assistant', content: 'Farmacia: primer mes S/19.90; horarios miercoles y viernes.' }, { role: 'user', content: 'Farmacia' }])
    expect(result.some((a) => a.id === 'malla-farmacia')).toBe(true)
  })
  it('no elige farmacia si el interesado pregunta por nutricion', async () => {
    expect(await candidates([{ role: 'user', content: 'Info de nutricion' }])).toEqual([{ id: 'promo-nutricion', name: 'NUTRICION 19.90' }])
  })
  it('la instruccion evita ofrecer un menu entre promocion y malla', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', automations: [{ id: 'promo-farmacia', name: 'FARMACIA 19.90' }] })
    expect(prompt).toContain('Do not ask the customer to choose between a promotion and a curriculum')
    expect(prompt).toContain('prioritize the active FARMACIA 19.90')
  })
})
