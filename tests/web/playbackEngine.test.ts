import { describe, expect, it } from 'vitest'

import {
  getPlaybackSchedulerProfileConfig,
  getWindowedPlaybackEvents,
  selectPlaybackSchedulerProfile,
} from '../../apps/web/src/lib/studio'
import { isPauseablePlaybackRoute } from '../../apps/web/src/components/studio/useStudioPlayback'

describe('playback engine scheduler profiles', () => {
  it('selects ultraStable for six dense long tracks', () => {
    const profile = selectPlaybackSchedulerProfile({
      durationSeconds: 320,
      eventCount: 1_800,
      isMobileLike: false,
      trackCount: 6,
    })

    expect(profile.id).toBe('ultraStable')
    expect(profile.scheduleAheadSeconds).toBe(4)
    expect(profile.warmupWindowCount).toBe(2)
  })

  it('keeps recording and scoring routes on at least the stable profile', () => {
    expect(
      selectPlaybackSchedulerProfile({
        durationSeconds: 30,
        eventCount: 12,
        isMobileLike: false,
        route: 'recording',
        trackCount: 1,
      }).id,
    ).toBe('stable')
    expect(
      selectPlaybackSchedulerProfile({
        durationSeconds: 30,
        eventCount: 12,
        isMobileLike: false,
        route: 'scoring',
        trackCount: 1,
      }).id,
    ).toBe('stable')
  })

  it('allows pause only for general playback routes', () => {
    expect(isPauseablePlaybackRoute('studio')).toBe(true)
    expect(isPauseablePlaybackRoute('practice')).toBe(true)
    expect(isPauseablePlaybackRoute('recording')).toBe(false)
    expect(isPauseablePlaybackRoute('scoring')).toBe(false)
  })

  it('schedules only the warm-up window for a long dense event list', () => {
    const profile = getPlaybackSchedulerProfileConfig('ultraStable')
    const events = Array.from({ length: 1_200 }, (_, index) => ({
      durationSeconds: 0.2,
      relativeStartSeconds: index * 0.25,
    }))

    const windowed = getWindowedPlaybackEvents(
      events,
      0,
      0,
      profile.scheduleAheadSeconds * profile.warmupWindowCount,
    )

    expect(windowed.events.length).toBeLessThan(40)
    expect(windowed.nextCursor).toBe(windowed.events.length)
  })

  it('keeps a sustained event that began before a seek window', () => {
    const events = [
      { durationSeconds: 5, relativeStartSeconds: 178 },
      { durationSeconds: 0.4, relativeStartSeconds: 182 },
      { durationSeconds: 0.4, relativeStartSeconds: 188 },
    ]

    const windowed = getWindowedPlaybackEvents(events, 0, 180, 184)

    expect(windowed.events.map((event) => event.relativeStartSeconds)).toEqual([178, 182])
    expect(windowed.nextCursor).toBe(2)
  })
})
