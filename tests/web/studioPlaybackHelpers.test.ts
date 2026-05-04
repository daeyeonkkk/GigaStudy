import { describe, expect, it } from 'vitest'

import {
  getAudioTrackSchedule,
  getPitchEventSchedule,
} from '../../apps/web/src/components/studio/studioPlaybackHelpers'
import {
  getTrackVolumeScale,
  getVolumeScaleFromPercent,
} from '../../apps/web/src/lib/studio/playback'
import type { TrackSlot } from '../../apps/web/src/types/studio'

describe('studio playback scheduling helpers', () => {
  it('keeps selected audio tracks aligned to one scheduled start', () => {
    const syncedTrack = getAudioTrackSchedule({
      bufferDurationSeconds: 18,
      scheduledStart: 10,
      startSeconds: -0.3,
      trackStartSeconds: -0.3,
    })
    const laterTrack = getAudioTrackSchedule({
      bufferDurationSeconds: 20,
      scheduledStart: 10,
      startSeconds: -0.3,
      trackStartSeconds: 0.2,
    })

    expect(syncedTrack.relativeStartSeconds).toBe(0)
    expect(syncedTrack.sourceOffsetSeconds).toBe(0)
    expect(syncedTrack.scheduledStartSeconds).toBe(10)
    expect(syncedTrack.timelineEndSeconds).toBeCloseTo(17.7)
    expect(laterTrack.relativeStartSeconds).toBeCloseTo(0.5)
    expect(laterTrack.sourceOffsetSeconds).toBe(0)
    expect(laterTrack.scheduledStartSeconds).toBeCloseTo(10.5)
  })

  it('seeks into early audio without moving the shared grid', () => {
    const schedule = getAudioTrackSchedule({
      bufferDurationSeconds: 18,
      scheduledStart: 10,
      startSeconds: 0,
      trackStartSeconds: -0.3,
    })

    expect(schedule.relativeStartSeconds).toBe(0)
    expect(schedule.sourceOffsetSeconds).toBeCloseTo(0.3)
    expect(schedule.scheduledStartSeconds).toBe(10)
  })

  it('treats public pitch event start seconds as already sync-resolved', () => {
    const schedule = getPitchEventSchedule({
      durationSeconds: 0.75,
      eventStartSeconds: 1.2,
      scheduledStart: 10,
      startSeconds: -0.3,
    })

    expect(schedule).not.toBeNull()
    expect(schedule?.relativeStartSeconds).toBeCloseTo(1.5)
    expect(schedule?.remainingDurationSeconds).toBeCloseTo(0.75)
    expect(schedule?.scheduledStartSeconds).toBeCloseTo(11.5)
  })

  it('trims synthesized events when playback starts inside the event', () => {
    const schedule = getPitchEventSchedule({
      durationSeconds: 1.2,
      eventStartSeconds: 1,
      scheduledStart: 10,
      startSeconds: 1.5,
    })

    expect(schedule).not.toBeNull()
    expect(schedule?.relativeStartSeconds).toBe(0)
    expect(schedule?.remainingDurationSeconds).toBeCloseTo(0.7)
    expect(schedule?.scheduledStartSeconds).toBe(10)
  })

  it('uses one gain mapping for initial and live track volume changes', () => {
    const track = { volume_percent: 37.6 } as TrackSlot

    expect(getVolumeScaleFromPercent(37.6)).toBe(0.38)
    expect(getTrackVolumeScale(track)).toBe(0.38)
    expect(getVolumeScaleFromPercent(Number.NaN)).toBe(1)
  })
})
