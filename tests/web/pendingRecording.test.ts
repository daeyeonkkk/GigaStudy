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
  const audioBlob = new Blob(['track'], { type: 'audio/webm' })
  return {
    allowOverwrite: false,
    audioBlob,
    audioObjectUrl: 'blob:track-recording',
    contentType: audioBlob.type,
    createdAtMs,
    durationSeconds: 1,
    encoding: 'media_recorder',
    expiresAtMs: createdAtMs + PENDING_RECORDING_RETENTION_MS,
    filename: 'take.webm',
    sizeBytes: audioBlob.size,
    slotId: 1,
    trackName: 'Soprano',
  }
}

function pendingScoreRecording(createdAtMs: number): PendingScoreRecording {
  const audioBlob = new Blob(['score'], { type: 'audio/webm' })
  return {
    audioBlob,
    audioObjectUrl: 'blob:score-recording',
    contentType: audioBlob.type,
    createdAtMs,
    durationSeconds: 1,
    encoding: 'media_recorder',
    expiresAtMs: createdAtMs + PENDING_RECORDING_RETENTION_MS,
    filename: 'score-take.webm',
    includeMetronome: true,
    referenceSlotIds: [1, 2],
    scoreMode: 'answer',
    sizeBytes: audioBlob.size,
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
