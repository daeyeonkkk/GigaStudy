import { describe, expect, it } from 'vitest'

import {
  clampTrackVolumePercent,
  parseTrackVolumeDraft,
  shouldSaveTrackVolumeDraft,
} from '../../apps/web/src/components/studio/trackVolumeDraft'

describe('track volume draft helpers', () => {
  it('previews valid draft volume without requiring a server save', () => {
    expect(parseTrackVolumeDraft('72.4')).toBe(72)
    expect(parseTrackVolumeDraft('101')).toBe(100)
    expect(parseTrackVolumeDraft('-3')).toBe(0)
    expect(parseTrackVolumeDraft('not a number')).toBeNull()
  })

  it('saves only when the committed draft differs from the last saved value', () => {
    expect(shouldSaveTrackVolumeDraft(72, 72)).toBe(false)
    expect(shouldSaveTrackVolumeDraft(72, 71)).toBe(true)
    expect(shouldSaveTrackVolumeDraft(101, 100)).toBe(false)
    expect(clampTrackVolumePercent(Number.NaN, 64)).toBe(64)
  })
})
