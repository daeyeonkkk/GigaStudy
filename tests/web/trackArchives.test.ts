import { describe, expect, it } from 'vitest'

import {
  getTrackArchiveDisplayLabel,
  sortTrackArchivesForDisplay,
} from '../../apps/web/src/lib/studio'
import type { TrackMaterialArchiveSummary } from '../../apps/web/src/types/studio'

function archive(
  archiveId: string,
  overrides: Partial<TrackMaterialArchiveSummary> = {},
): TrackMaterialArchiveSummary {
  return {
    archive_id: archiveId,
    archived_at: '2026-01-01T00:00:00Z',
    duration_seconds: 1,
    event_count: 2,
    has_audio: false,
    pinned: false,
    reason: 'before_overwrite',
    source_kind: 'audio',
    source_label: 'take.wav',
    track_name: 'Soprano',
    track_slot_id: 1,
    ...overrides,
  }
}

describe('track archive display helpers', () => {
  it('uses user-facing labels for restore-only archives', () => {
    expect(getTrackArchiveDisplayLabel(archive('original', {
      pinned: true,
      reason: 'original_score',
      source_kind: 'midi',
    }))).toBe('원본 악보')
    expect(getTrackArchiveDisplayLabel(archive('recording', {
      source_kind: 'recording',
    }))).toBe('이전 녹음')
    expect(getTrackArchiveDisplayLabel(archive('ai', {
      source_kind: 'ai',
    }))).toBe('이전 생성')
    expect(getTrackArchiveDisplayLabel(archive('score', {
      source_kind: 'document',
    }))).toBe('이전 악보')
  })

  it('keeps pinned originals first, then shows newest overwrite snapshots', () => {
    const sorted = sortTrackArchivesForDisplay([
      archive('older', { archived_at: '2026-01-01T00:00:00Z' }),
      archive('original', {
        archived_at: '2025-12-31T00:00:00Z',
        pinned: true,
        reason: 'original_score',
        source_kind: 'document',
      }),
      archive('newer', { archived_at: '2026-01-02T00:00:00Z' }),
    ])

    expect(sorted.map((item) => item.archive_id)).toEqual(['original', 'newer', 'older'])
  })
})
