import { describe, expect, it } from 'vitest'

import {
  isPendingRecordingExpired,
  PENDING_RECORDING_RETENTION_MS,
  type PendingTrackRecording,
} from '../../apps/web/src/components/studio/useStudioRecording'
import {
  isPendingScoreRecordingExpired,
  type PendingScoreRecording,
} from '../../apps/web/src/components/studio/useStudioScoring'

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

function pendingScoreRecording(createdAtMs: number): PendingScoreRecording {
  return {
    audioDataUrl: 'data:audio/wav;base64,AAAA',
    createdAtMs,
    durationSeconds: 1,
    expiresAtMs: createdAtMs + PENDING_RECORDING_RETENTION_MS,
    filename: 'score-take.wav',
    includeMetronome: true,
    referenceSlotIds: [1, 2],
    scoreMode: 'answer',
    slotId: 3,
    trackName: 'Tenor',
  }
}

describe('pending recording retention', () => {
  it('keeps a new pending recording for 30 minutes', () => {
    const recording = pendingRecording(1_000)

    expect(isPendingRecordingExpired(recording, 1_000 + PENDING_RECORDING_RETENTION_MS - 1)).toBe(false)
    expect(isPendingRecordingExpired(recording, 1_000 + PENDING_RECORDING_RETENTION_MS)).toBe(true)
  })

  it('uses the same retention window for pending scoring recordings', () => {
    const recording = pendingScoreRecording(2_000)

    expect(isPendingScoreRecordingExpired(recording, 2_000 + PENDING_RECORDING_RETENTION_MS - 1)).toBe(false)
    expect(isPendingScoreRecordingExpired(recording, 2_000 + PENDING_RECORDING_RETENTION_MS)).toBe(true)
  })
})
