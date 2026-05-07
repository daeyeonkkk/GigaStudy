import { describe, expect, it } from 'vitest'

import {
  getAudioTrackSchedule,
  getPitchEventSchedule,
  getSustainedPitchEvents,
} from '../../apps/web/src/components/studio/studioPlaybackHelpers'
import { getGridSeconds } from '../../apps/web/src/components/studio/TrackBoardEditorGrid'
import {
  computeMelodicEnvelope,
  getPercussionHitKind,
  getSixteenthNoteSeconds,
  getPitchEventPlaybackFrequency,
  STUDIO_TIME_PRECISION_SECONDS,
  getTrackVolumeScale,
  getVolumeScaleFromPercent,
} from '../../apps/web/src/lib/studio'
import type { TrackSlot } from '../../apps/web/src/types/studio'
import type { PitchEvent } from '../../apps/web/src/types/studio'

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
      precisionSeconds: STUDIO_TIME_PRECISION_SECONDS,
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
      precisionSeconds: STUDIO_TIME_PRECISION_SECONDS,
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

  it('can synthesize MIDI-backed events even when label and pitch_hz are missing', () => {
    const event = {
      is_rest: false,
      label: 'Imported pitch',
      pitch_hz: null,
      pitch_midi: 69,
    } as PitchEvent

    expect(getPitchEventPlaybackFrequency(event)).toBeCloseTo(440)
  })

  it('maps percussion labels to playable hit kinds and frequencies', () => {
    const labels = [
      ['Kick', 'kick', 90],
      ['Snare', 'snare', 180],
      ['Clap', 'clap', 320],
      ['HatClosed', 'hat-closed', 620],
      ['HatOpen', 'hat-open', 700],
      ['Rim', 'rim', 480],
    ] as const

    labels.forEach(([label, kind, frequency]) => {
      const event = {
        is_rest: false,
        label,
        pitch_hz: null,
        pitch_midi: null,
      } as PitchEvent

      expect(getPercussionHitKind(label)).toBe(kind)
      expect(getPitchEventPlaybackFrequency(event)).toBe(frequency)
    })
  })

  it('collapses vocal playback events to one active pitch at a time', () => {
    const baseEvent = {
      beat_in_measure: null,
      confidence: 1,
      duration_beats: 1,
      extraction_method: 'test',
      is_rest: false,
      measure_index: null,
      pitch_hz: null,
      quality_warnings: [],
      region_id: 'region-1',
      source: 'midi',
      start_beat: 1,
      track_slot_id: 1,
    } satisfies Partial<PitchEvent>
    const events = [
      {
        ...baseEvent,
        duration_seconds: 1,
        event_id: 'low',
        label: 'C5',
        pitch_midi: 72,
        start_seconds: 0,
      },
      {
        ...baseEvent,
        duration_seconds: 1,
        event_id: 'high',
        label: 'E5',
        pitch_midi: 76,
        start_seconds: 0,
      },
      {
        ...baseEvent,
        duration_seconds: 1,
        event_id: 'next',
        label: 'G5',
        pitch_midi: 79,
        start_seconds: 0.5,
      },
    ] as PitchEvent[]

    const scheduled = getSustainedPitchEvents(events, false, 0.25, 1)

    expect(scheduled.map((event) => event.event.event_id)).toEqual(['high', 'next'])
    expect(scheduled[0].durationSeconds).toBeCloseTo(0.5)
    expect(scheduled[1].startSeconds).toBeCloseTo(0.5)
  })

  it('keeps repeated symbolic notes as separate playback attacks', () => {
    const baseEvent = {
      beat_in_measure: null,
      confidence: 1,
      duration_beats: 1,
      extraction_method: 'test',
      is_rest: false,
      label: 'E4',
      measure_index: null,
      pitch_hz: null,
      pitch_midi: 64,
      quality_warnings: [],
      region_id: 'region-1',
      source: 'midi',
      start_beat: 1,
      track_slot_id: 1,
    } satisfies Partial<PitchEvent>
    const events = [
      {
        ...baseEvent,
        duration_seconds: 0.5,
        event_id: 'repeat-1',
        start_seconds: 0,
      },
      {
        ...baseEvent,
        duration_seconds: 0.5,
        event_id: 'repeat-2',
        start_seconds: 0.5,
      },
    ] as PitchEvent[]

    const scheduled = getSustainedPitchEvents(events, false, STUDIO_TIME_PRECISION_SECONDS, 1)

    expect(scheduled.map((event) => event.event.event_id)).toEqual(['repeat-1', 'repeat-2'])
  })

  it('keeps sixteenth-note same-pitch repeats as separate attacks', () => {
    const sixteenthSeconds = getSixteenthNoteSeconds(101)
    const baseEvent = {
      beat_in_measure: null,
      confidence: 1,
      extraction_method: 'test',
      is_rest: false,
      label: 'E4',
      measure_index: null,
      pitch_hz: null,
      pitch_midi: 64,
      quality_warnings: ['measure_boundary_tie', 'same_pitch_contiguous_merged'],
      region_id: 'region-1',
      source: 'midi',
      track_slot_id: 1,
    } satisfies Partial<PitchEvent>
    const events = [
      {
        ...baseEvent,
        duration_beats: 1,
        duration_seconds: sixteenthSeconds * 4,
        event_id: 'phrase-a',
        start_beat: 1,
        start_seconds: 0,
      },
      {
        ...baseEvent,
        duration_beats: 0.25,
        duration_seconds: sixteenthSeconds,
        event_id: 'phrase-b',
        start_beat: 2,
        start_seconds: sixteenthSeconds * 4,
      },
      {
        ...baseEvent,
        duration_beats: 0.75,
        duration_seconds: sixteenthSeconds * 3,
        event_id: 'phrase-c-q1',
        start_beat: 2.25,
        start_seconds: sixteenthSeconds * 5,
      },
    ] as PitchEvent[]

    const scheduled = getSustainedPitchEvents(events, false, STUDIO_TIME_PRECISION_SECONDS, 1)

    expect(scheduled.map((event) => event.event.event_id)).toEqual(['phrase-a', 'phrase-b', 'phrase-c-q1'])
  })

  it('uses a grid-aware melodic envelope for short repeated notes', () => {
    const sixteenthSeconds = getSixteenthNoteSeconds(101)
    const shortRepeatEnvelope = computeMelodicEnvelope(sixteenthSeconds, sixteenthSeconds, 0)
    const openShortEnvelope = computeMelodicEnvelope(sixteenthSeconds, sixteenthSeconds)
    const dottedEighthEnvelope = computeMelodicEnvelope(sixteenthSeconds * 3, sixteenthSeconds, 0)
    const quarterEnvelope = computeMelodicEnvelope(sixteenthSeconds * 4, sixteenthSeconds, 0)

    expect(shortRepeatEnvelope.attackSeconds).toBeCloseTo(sixteenthSeconds * 0.08)
    expect(shortRepeatEnvelope.attackSeconds).toBeLessThan(sixteenthSeconds * 0.1)
    expect(shortRepeatEnvelope.peakGainRatio).toBeCloseTo(1.1)
    expect(shortRepeatEnvelope.endGainRatio).toBeCloseTo(0.9)
    expect(shortRepeatEnvelope.releaseSeconds).toBeLessThan(openShortEnvelope.releaseSeconds)
    expect(shortRepeatEnvelope.releaseSeconds).toBeCloseTo(STUDIO_TIME_PRECISION_SECONDS * 6)
    expect(dottedEighthEnvelope.endGainRatio).toBeCloseTo(0.7 + 0.2 / 3)
    expect(quarterEnvelope.endGainRatio).toBeCloseTo(0.7 + 0.2 / 4)
  })

  it('still sustains measure-split tie fragments across a barline', () => {
    const baseEvent = {
      beat_in_measure: null,
      confidence: 1,
      duration_beats: 1,
      extraction_method: 'test',
      is_rest: false,
      label: 'E4',
      measure_index: null,
      pitch_hz: null,
      pitch_midi: 64,
      quality_warnings: ['measure_boundary_tie'],
      region_id: 'region-1',
      source: 'midi',
      start_beat: 1,
      track_slot_id: 1,
    } satisfies Partial<PitchEvent>
    const events = [
      {
        ...baseEvent,
        duration_seconds: 0.5,
        event_id: 'sustain-q1',
        start_seconds: 0,
      },
      {
        ...baseEvent,
        duration_seconds: 0.5,
        event_id: 'sustain-q2',
        start_seconds: 0.5,
      },
    ] as PitchEvent[]

    const scheduled = getSustainedPitchEvents(events, false, STUDIO_TIME_PRECISION_SECONDS, 1)

    expect(scheduled.map((event) => event.event.event_id)).toEqual(['sustain-q1'])
    expect(scheduled[0].durationSeconds).toBeCloseTo(1)
  })

  it('keeps playback duration at studio precision instead of the readable import grid', () => {
    const readableImportUnitSeconds = getSixteenthNoteSeconds(113)
    const schedule = getPitchEventSchedule({
      durationSeconds: 0.03,
      eventStartSeconds: 0,
      precisionSeconds: STUDIO_TIME_PRECISION_SECONDS,
      scheduledStart: 10,
      startSeconds: 0,
    })

    expect(readableImportUnitSeconds).toBeCloseTo((60 / 113) * 0.25)
    expect(schedule?.remainingDurationSeconds).toBeCloseTo(0.03)
  })

  it('preserves sub-sixteenth event durations for playback', () => {
    const baseEvent = {
      beat_in_measure: null,
      confidence: 1,
      duration_beats: 0.057,
      duration_seconds: 0.03,
      event_id: 'short',
      extraction_method: 'test',
      is_rest: false,
      label: 'A4',
      measure_index: null,
      pitch_hz: null,
      pitch_midi: 69,
      quality_warnings: [],
      region_id: 'region-1',
      source: 'midi',
      start_beat: 1,
      start_seconds: 0,
      track_slot_id: 1,
    } as PitchEvent

    const scheduled = getSustainedPitchEvents([baseEvent], false, STUDIO_TIME_PRECISION_SECONDS, 1)

    expect(scheduled[0].durationSeconds).toBeCloseTo(0.03)
  })

  it('uses the BPM-derived sixteenth note for editor snapping', () => {
    expect(getGridSeconds(120)).toBeCloseTo(0.125)
    expect(getGridSeconds(113)).toBeCloseTo((60 / 113) * 0.25)
  })
})
