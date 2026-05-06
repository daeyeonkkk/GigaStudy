import { describe, expect, it } from 'vitest'

import { prepareAudioFileForUpload } from '../../apps/web/src/lib/audio'

describe('audio upload preparation', () => {
  it('keeps non-WAV recording files as original blobs for direct upload', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'take.m4a', { type: 'audio/mp4' })

    const prepared = await prepareAudioFileForUpload(file)

    expect(prepared.filename).toBe('take.m4a')
    expect(prepared.blob).toBe(file)
    expect(prepared.contentType).toBe('audio/mp4')
  })

  it('rejects unsupported file extensions before upload', async () => {
    const file = new File(['not audio'], 'take.txt', { type: 'text/plain' })

    await expect(prepareAudioFileForUpload(file)).rejects.toThrow('지원하지 않는 오디오 파일 형식')
  })
})
