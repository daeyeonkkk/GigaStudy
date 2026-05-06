import { describe, expect, it } from 'vitest'

import {
  getBeatUnitWidthPixels,
  getMeasureWidthPixels,
  getTimelineWidthPixels,
} from '../../apps/web/src/components/studio/TrackBoardTimelineLayout'

describe('timeline layout scale', () => {
  it('uses a fixed quarter-beat width across meters', () => {
    expect(getBeatUnitWidthPixels()).toBe(50)
    expect(getMeasureWidthPixels(4)).toBe(200)
    expect(getMeasureWidthPixels(3)).toBe(150)
    expect(getMeasureWidthPixels(3 * (4 / 8))).toBe(75)
    expect(getMeasureWidthPixels(6 * (4 / 8))).toBe(150)
  })

  it('maps real seconds back to fixed beat pixels for the current bpm', () => {
    const beatSeconds = 60 / 102
    expect(getTimelineWidthPixels(beatSeconds * 4, 102, 0)).toBeCloseTo(200)
    expect(getTimelineWidthPixels(beatSeconds * 0.25, 102, 0)).toBeCloseTo(12.5)
    expect(getTimelineWidthPixels(beatSeconds * 0.5, 102, 0)).toBeCloseTo(25)
  })

  it('keeps sixteenth notes readable inside a 3/8 measure', () => {
    const sixteenthWidthPixels = getBeatUnitWidthPixels() * 0.25
    const measureWidthPixels = getMeasureWidthPixels(3 * (4 / 8))

    expect(sixteenthWidthPixels).toBe(12.5)
    expect(measureWidthPixels).toBe(75)
    expect(sixteenthWidthPixels * 6).toBe(measureWidthPixels)
  })
})
