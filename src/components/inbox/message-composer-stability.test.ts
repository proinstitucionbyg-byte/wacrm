import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('inbox composer stability', () => {
  const source = readFileSync('src/components/inbox/message-composer.tsx', 'utf8')

  it('keeps a separate local draft for every conversation', () => {
    expect(source).toContain('wacrm:inbox:draft:${conversationId}')
    expect(source).toContain('sessionStorage.setItem(textStorageKey, text)')
    expect(source).toContain("sessionStorage.getItem(textStorageKey) ?? ''")
  })

  it('blocks a silent unload while text, media or audio remains unsent', () => {
    expect(source).toContain("window.addEventListener('beforeunload', protectDraft)")
    expect(source).toContain('recording || Boolean(text.trim()) || Boolean(draft) || interactiveOpen')
  })
})
