import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('inbox background refresh', () => {
  it('does not refetch the complete list every minute while realtime is connected', () => {
    const source = readFileSync('src/app/(dashboard)/inbox/page.tsx', 'utf8')
    expect(source).toContain('if (!isConnected) refreshIfVisible()')
    expect(source).not.toContain('window.setInterval(refreshIfVisible, 60_000)')
  })
})
