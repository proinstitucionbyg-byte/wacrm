import { beforeEach, describe, expect, it, vi } from 'vitest'
import { automationAudioEvidence } from './audio-evidence'
const h = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/ai/transcribe', () => ({ transcribeSavedAudio: h.read }))
function setup(config: Record<string, unknown> = {}) {
  const chain = { update: vi.fn(), eq: vi.fn() }
  chain.update.mockReturnValue(chain); chain.eq.mockReturnValue(chain)
  const db = { from: vi.fn(() => chain) }
  return { chain, db, args: { db: db as never, accountId: 'account', automationId: 'automation',
    name: 'NUTRICION PROMO', stepId: 'step', config, url: 'https://example.com/one.ogg' } }
}
beforeEach(() => vi.clearAllMocks())
describe('saved promotion audio evidence', () => {
  it('uses a complete sent text or image caption without transcribing even a cached audio', async () => {
    const { args, db } = setup({ audio_transcript: 'Mensualidad 79.90', audio_transcript_url: 'https://example.com/one.ogg' })
    const writtenText = 'Primer mes S/19.90. Mensualidad S/49.90. Duracion 6 meses.'
    expect(await automationAudioEvidence({ ...args, writtenText })).toContain('[OFERTA ENVIADA:')
    expect(h.read).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalled()
  })
  it('falls back to audio if the written monthly price is struck out or missing', async () => {
    h.read.mockResolvedValue('Mensualidad 79.90, primer mes 19.90, seis meses')
    const { args } = setup()
    expect(await automationAudioEvidence({ ...args, writtenText: '6 meses. ~Mensualidad S/79.90~ Primer mes S/19.90' })).toContain('[AUDIO ENVIADO:')
    expect(h.read).toHaveBeenCalledOnce()
  })
  it.each(['NUTRICION 19.90','FARMACIA 19.90','RECURSOS 19.90','ASISTENTE 19.90','EDUCACIÓN 19.90'])('recognizes the existing promotion name %s',async name => {
    h.read.mockResolvedValue('Primer mes 19.90 soles')
    const {args} = setup()
    expect(await automationAudioEvidence({...args,name})).toContain('19.90')
    expect(h.read).toHaveBeenCalledOnce()
  })
  it('reuses only the transcript bound to this exact audio URL', async () => {
    const { args, db } = setup({ audio_transcript: 'Primer mes 19.90', audio_transcript_url: 'https://example.com/one.ogg' })
    expect(await automationAudioEvidence(args)).toContain('Primer mes 19.90')
    expect(h.read).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalled()
  })
  it('retranscribes a changed audio and does not overwrite a concurrent editor change', async () => {
    h.read.mockResolvedValue('Segundo mes 59.90 soles')
    const { args, chain } = setup({ audio_transcript: '79.90', audio_transcript_url: 'old' })
    expect(await automationAudioEvidence(args)).toContain('59.90')
    expect(chain.eq).toHaveBeenCalledWith('step_config', JSON.stringify(args.config))
    expect(chain.eq).toHaveBeenCalledWith('automation_id', 'automation')
  })
  it('does not fabricate prices when transcription fails', async () => {
    h.read.mockResolvedValue(null)
    const { args, db } = setup()
    expect(await automationAudioEvidence(args)).toBeUndefined()
    expect(db.from).not.toHaveBeenCalled()
  })
  it('does not spend transcription calls on unrelated audios', async () => {
    const { args } = setup()
    expect(await automationAudioEvidence({ ...args, name: 'BIENVENIDA DIA 30' })).toBeUndefined()
    expect(h.read).not.toHaveBeenCalled()
  })
})
