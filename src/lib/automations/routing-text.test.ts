import { describe, expect, it } from 'vitest'
import { inboundRoutingText } from './routing-text'
import { triggerMatches } from './engine'
import type { Automation } from '@/types'

describe('inboundRoutingText', () => {
  it('routes a transcribed voice greeting without the inbox audio marker', () => {
    const spoken = inboundRoutingText('🎤 Hola', ' Hola ')
    expect(spoken).toBe('Hola')
    expect(triggerMatches({ trigger_type: 'keyword_match', trigger_config: {
      match_type: 'exact', keywords: ['hola'], case_sensitive: false,
    } } as Automation, { message_text: spoken })).toBe(true)
  })

  it('preserves ordinary text and the failed-transcription fallback', () => {
    expect(inboundRoutingText('Hola')).toBe('Hola')
    expect(inboundRoutingText('🎤 [Audio que no se pudo entender]', null))
      .toBe('🎤 [Audio que no se pudo entender]')
  })
})
