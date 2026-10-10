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
  it('reuses only the transcript bound to this exact audio URL', async () => {
    const { args, db } = setup({ audio_transcript: 'Primer mes 19.90', audio_transcript_url: 'https://example.com/one.ogg' })
    expect(await automationAudioEvidence(args)).toContain('Primer mes 19.90')
    expect(h.read).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalled()
  })
  it('retranscribes a changed audio and does not overwrite a concurrent editor change', async () => {
    h.read.mockResolvedValue('Segundo mes 59.90 soles')
    const { args, chain } = setup({ audio_transcript: '79.90', audio_transcript_url: 'old' })
    expect(await automationAudioEvidence(args)).toContain('59.90')
    expect(chain.eq).toHaveBeenCalledWith('step_config', args.config)
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
