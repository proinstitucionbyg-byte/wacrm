import { describe, expect, it } from 'vitest'
import { verifiedCourseModalityReply } from './modality'

describe('verified course modality', () => {
  it.each(['Es precencial', '¿Son clases presenciales?', 'Quiero estudiar presencial'])('corrects %s', message => {
    expect(verifiedCourseModalityReply(message)).toContain('no dictamos cursos presenciales')
  })

  it('leaves unrelated queries in the normal flow', () => {
    expect(verifiedCourseModalityReply('¿Cuánto cuesta Farmacia?')).toBeNull()
  })
})
