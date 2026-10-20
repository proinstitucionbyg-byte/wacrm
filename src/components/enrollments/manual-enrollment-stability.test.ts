import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('manual enrollment stability', () => {
  const source = readFileSync('src/components/enrollments/manual-enrollment.tsx', 'utf8')

  it('restores unsaved fields after a browser refresh', () => {
    expect(source).toContain("const MANUAL_ENROLLMENT_DRAFT='wacrm:enrollments:manual-draft'")
    expect(source).toContain('sessionStorage.getItem(MANUAL_ENROLLMENT_DRAFT)')
    expect(source).toContain('sessionStorage.setItem(MANUAL_ENROLLMENT_DRAFT')
  })

  it('warns before a refresh can discard an open form', () => {
    expect(source).toContain("window.addEventListener('beforeunload',protect)")
    expect(source).toContain('const hasManualDraft=open&&')
  })
})
