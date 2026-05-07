import { describe, expect, it } from 'vitest'

import {
  isPendingRecordingExpired,
  PENDING_RECORDING_RETENTION_MS,
  type PendingTrackRecording,
} from '../../apps/web/src/components/studio/useStudioRecording'

function pendingRecording(createdAtMs: number): PendingTrackRecording {
  return {
    allowOverwrite: false,
    audioDataUrl: 'data:audio/wav;base64,AAAA',
    createdAtMs,
    durationSeconds: 1,
    expiresAtMs: createdAtMs + PENDING_RECORDING_RETENTION_MS,
    filename: 'take.wav',
    slotId: 1,
    trackName: 'Soprano',
  }
}

describe('pending recording retention', () => {
  it('keeps a new pending recording for 30 minutes', () => {
    const recording = pendingRecording(1_000)

    expect(isPendingRecordingExpired(recording, 1_000 + PENDING_RECORDING_RETENTION_MS - 1)).toBe(false)
    expect(isPendingRecordingExpired(recording, 1_000 + PENDING_RECORDING_RETENTION_MS)).toBe(true)
  })
})
