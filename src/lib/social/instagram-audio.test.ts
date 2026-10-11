import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ download: vi.fn(), run: vi.fn(), write: vi.fn(), read: vi.fn(), unlink: vi.fn(), rmdir: vi.fn(), upload: vi.fn(), signed: vi.fn() }))
vi.mock('./media', () => ({ downloadSocialMedia: mocks.download }))
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => {
  const cb = args.pop() as (error: Error | null, stdout?: string, stderr?: string) => void
  mocks.run(...args); cb(null, '', '')
} }))
vi.mock('node:fs/promises', () => ({ mkdtemp: async () => '/tmp/wacrm-ig-test', writeFile: mocks.write, readFile: mocks.read, unlink: mocks.unlink, rmdir: mocks.rmdir }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ storage: { from: () => ({ upload: mocks.upload, createSignedUrl: mocks.signed }) } }) }))
import { instagramAudioUrl } from './instagram-audio'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.download.mockResolvedValue({ buffer: Buffer.from('OggS-original-recording'), contentType: 'audio/ogg' })
  mocks.read.mockResolvedValue(Buffer.from('converted-aac'))
  mocks.unlink.mockResolvedValue(undefined); mocks.rmdir.mockResolvedValue(undefined)
  mocks.upload.mockResolvedValue({ error: null })
  mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://example.org/private-audio.m4a' } })
})
describe('Instagram audio compatibility', () => {
  it('converts the recording to AAC and returns a private temporary link', async () => {
    expect(await instagramAudioUrl('account', 'https://example.org/original.ogg')).toBe('https://example.org/private-audio.m4a')
    expect(mocks.run.mock.calls[0][0]).toBe('ffmpeg')
    expect(mocks.run.mock.calls[0][1]).toContain('aac')
    expect(mocks.run.mock.calls[0][1]).toContain('file,pipe')
    expect(mocks.upload.mock.calls[0][2]).toEqual({ contentType: 'audio/mp4', upsert: true })
    expect(mocks.signed.mock.calls[0][1]).toBe(3600)
    expect(mocks.unlink).toHaveBeenCalledTimes(2)
    expect(mocks.rmdir).toHaveBeenCalledTimes(1)
  })
  it('rejects a playlist instead of allowing ffmpeg to follow its references', async () => {
    mocks.download.mockResolvedValue({ buffer: Buffer.from('#EXTM3U\nfile:///private'), contentType: 'audio/mpegurl' })
    await expect(instagramAudioUrl('account', 'https://example.org/list')).rejects.toThrow('no es un audio')
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('cleans temporary files when storage fails and never reports a delivered audio', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'denied' } })
    await expect(instagramAudioUrl('account', 'https://example.org/original.ogg')).rejects.toThrow('preparar')
    expect(mocks.signed).not.toHaveBeenCalled()
    expect(mocks.rmdir).toHaveBeenCalledTimes(1)
  })
})
