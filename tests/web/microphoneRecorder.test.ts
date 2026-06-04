import { describe, expect, it, vi } from 'vitest'

import { stopMicrophoneRecorder, type MicrophoneRecorder } from '../../apps/web/src/lib/audio'

function recorderFixture(overrides: Partial<MicrophoneRecorder>): MicrophoneRecorder {
  return {
    context: { state: 'closed', close: vi.fn() } as unknown as AudioContext,
    source: { disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode,
    processor: { disconnect: vi.fn() } as unknown as ScriptProcessorNode,
    stream: { getTracks: () => [] } as unknown as MediaStream,
    wavChunks: [],
    mediaChunks: [],
    mediaRecorder: null,
    mediaType: 'audio/webm;codecs=opus',
    extension: '.webm',
    sampleRate: 44_100,
    startedAt: 0,
    capturing: true,
    rmsLevel: 0,
    peakLevel: 0,
    ...overrides,
  }
}

describe('microphone recorder output', () => {
  it('returns a compressed MediaRecorder blob when media chunks exist', async () => {
    const recorder = recorderFixture({
      mediaChunks: [new Blob(['opus'], { type: 'audio/webm;codecs=opus' })],
    })

    const audio = await stopMicrophoneRecorder(recorder)

    expect(audio?.encoding).toBe('media_recorder')
    expect(audio?.extension).toBe('.webm')
    expect(audio?.contentType).toBe('audio/webm;codecs=opus')
    expect(audio?.sizeBytes).toBeGreaterThan(0)
  })

  it('falls back to a WAV blob when only PCM chunks exist', async () => {
    const recorder = recorderFixture({
      extension: '.wav',
      mediaType: 'audio/wav',
      wavChunks: [new Float32Array([0, 0.25, -0.25, 0])],
    })

    const audio = await stopMicrophoneRecorder(recorder)

    expect(audio?.encoding).toBe('wav_fallback')
    expect(audio?.extension).toBe('.wav')
    expect(audio?.contentType).toBe('audio/wav')
    expect(audio?.sizeBytes).toBeGreaterThan(44)
  })
})
