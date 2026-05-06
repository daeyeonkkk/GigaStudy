import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearAudioBufferCache,
  getAudioBufferCacheSize,
  getCachedDecodedAudioBuffer,
} from '../../apps/web/src/lib/studio'

describe('decoded audio buffer cache', () => {
  beforeEach(() => {
    clearAudioBufferCache()
  })

  it('reuses decoded original-audio buffers for the same track cache key', async () => {
    const audioBuffer = {
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 44_100,
    } as AudioBuffer
    const context = {
      decodeAudioData: vi.fn(async () => audioBuffer),
    } as unknown as AudioContext
    const fetchArrayBuffer = vi.fn(async () => new ArrayBuffer(8))

    const first = await getCachedDecodedAudioBuffer(context, 'studio:1:path:updated', '/audio', fetchArrayBuffer)
    const second = await getCachedDecodedAudioBuffer(context, 'studio:1:path:updated', '/audio', fetchArrayBuffer)

    expect(first).toBe(audioBuffer)
    expect(second).toBe(audioBuffer)
    expect(fetchArrayBuffer).toHaveBeenCalledTimes(1)
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(getAudioBufferCacheSize()).toBe(1)
  })
})
