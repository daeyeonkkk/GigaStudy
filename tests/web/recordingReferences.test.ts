import { describe, expect, it } from 'vitest'

import {
  getDefaultRecordingReferenceSlotIds,
  getRecordingGuideLabel,
  toggleRecordingReferenceSlot,
} from '../../apps/web/src/components/studio/recordingReferences'
import type { TrackSlot } from '../../apps/web/src/types/studio'

function track(slotId: number, status: TrackSlot['status']): TrackSlot {
  return {
    audio_mime_type: null,
    audio_source_label: null,
    audio_source_path: null,
    name: `Track ${slotId}`,
    source_kind: null,
    source_label: null,
    status,
    sync_offset_seconds: 0,
    volume_percent: 100,
    slot_id: slotId,
  }
}

describe('recording reference setup helpers', () => {
  it('defaults to registered tracks except the recording target', () => {
    const tracks = [
      track(1, 'registered'),
      track(2, 'registered'),
      track(3, 'empty'),
      track(4, 'registered'),
      track(5, 'generating'),
      track(6, 'empty'),
    ]

    expect(getDefaultRecordingReferenceSlotIds(tracks, 2)).toEqual([1, 4])
  })

  it('allows a registered target track to be enabled manually', () => {
    const selected = getDefaultRecordingReferenceSlotIds(
      [track(1, 'registered'), track(2, 'registered')],
      2,
    )

    expect(selected).toEqual([1])
    expect(toggleRecordingReferenceSlot(selected, 2)).toEqual([1, 2])
  })

  it('labels the active recording guide without exposing engine terms', () => {
    expect(getRecordingGuideLabel(2, true)).toBe('기준 재생 · 메트로놈')
    expect(getRecordingGuideLabel(2, false)).toBe('기준 재생 중')
    expect(getRecordingGuideLabel(0, true)).toBe('메트로놈만')
    expect(getRecordingGuideLabel(0, false)).toBe('무음 카운트')
  })
})
