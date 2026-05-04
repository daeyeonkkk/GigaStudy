import {
  getPitchEventPlaybackFrequency,
  regionsHavePlayableEvents,
  STUDIO_TIME_PRECISION_SECONDS,
  trackHasPlayableAudio,
  type PlaybackSourceMode,
} from '../../lib/studio'
import type { ArrangementRegion, PitchEvent, TrackSlot } from '../../types/studio'

export type ScheduledPitchEvent = {
  durationSeconds: number
  event: PitchEvent
  frequency: number
  startSeconds: number
}

export type AudioTrackSchedule = {
  relativeStartSeconds: number
  scheduledStartSeconds: number
  sourceOffsetSeconds: number
  timelineEndSeconds: number
}

export type PitchEventSchedule = {
  eventEndSeconds: number
  relativeStartSeconds: number
  remainingDurationSeconds: number
  scheduledStartSeconds: number
}

const VOCAL_SLOT_CENTERS: Record<number, number> = {
  1: 70.5,
  2: 64.5,
  3: 57.5,
  4: 54.5,
  5: 50,
}

export function getSustainedPitchEvents(
  events: PitchEvent[],
  isPercussion: boolean,
  precisionSeconds: number = STUDIO_TIME_PRECISION_SECONDS,
  slotId = 0,
): ScheduledPitchEvent[] {
  const timelinePrecisionSeconds = Math.max(STUDIO_TIME_PRECISION_SECONDS, precisionSeconds)
  const scheduledEvents = events
    .map((event) => {
      const frequency = getPitchEventPlaybackFrequency(event)
      return frequency === null
        ? null
        : {
            durationSeconds: Math.max(0, event.duration_seconds),
            event,
            frequency,
            startSeconds: event.start_seconds,
          }
    })
    .filter((event): event is ScheduledPitchEvent => event !== null)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.event.event_id.localeCompare(right.event.event_id))

  if (isPercussion) {
    return scheduledEvents
  }

  const merged: ScheduledPitchEvent[] = []
  for (const current of scheduledEvents) {
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push({ ...current })
      continue
    }

    const previousEndSeconds = previous.startSeconds + previous.durationSeconds
    const currentEndSeconds = current.startSeconds + current.durationSeconds
    const samePitch =
      current.event.label === previous.event.label ||
      Math.abs(current.frequency - previous.frequency) < 0.5 ||
      (current.event.pitch_midi !== null &&
        current.event.pitch_midi !== undefined &&
        current.event.pitch_midi === previous.event.pitch_midi)
    const smallGap = current.startSeconds <= previousEndSeconds + timelinePrecisionSeconds
    if (samePitch && smallGap) {
      previous.durationSeconds = Math.max(previous.durationSeconds, currentEndSeconds - previous.startSeconds)
      continue
    }

    merged.push({ ...current })
  }
  return enforceMonophonicPlaybackLine(merged, slotId, timelinePrecisionSeconds)
}

function enforceMonophonicPlaybackLine(
  events: ScheduledPitchEvent[],
  slotId: number,
  minimumEventSeconds: number,
): ScheduledPitchEvent[] {
  const selectedByOnset: ScheduledPitchEvent[] = []
  let onsetGroup: ScheduledPitchEvent[] = []
  let groupStartSeconds: number | null = null
  for (const event of events) {
    if (groupStartSeconds === null || Math.abs(event.startSeconds - groupStartSeconds) <= 0.001) {
      onsetGroup.push(event)
      groupStartSeconds = groupStartSeconds ?? event.startSeconds
      continue
    }
    selectedByOnset.push(bestPlaybackEventForSlot(onsetGroup, slotId))
    onsetGroup = [event]
    groupStartSeconds = event.startSeconds
  }
  if (onsetGroup.length > 0) {
    selectedByOnset.push(bestPlaybackEventForSlot(onsetGroup, slotId))
  }

  const line: ScheduledPitchEvent[] = []
  for (const event of selectedByOnset) {
    const current = { ...event }
    const previous = line[line.length - 1]
    if (previous) {
      const previousEndSeconds = previous.startSeconds + previous.durationSeconds
      if (current.startSeconds < previousEndSeconds - 0.001) {
        previous.durationSeconds = Math.max(minimumEventSeconds, current.startSeconds - previous.startSeconds)
      }
    }
    line.push(current)
  }
  return line.filter((event) => event.durationSeconds >= minimumEventSeconds)
}

function bestPlaybackEventForSlot(events: ScheduledPitchEvent[], slotId: number): ScheduledPitchEvent {
  return events.slice().sort((left, right) => playbackEventRank(left, slotId) - playbackEventRank(right, slotId))[0]
}

function playbackEventRank(event: ScheduledPitchEvent, slotId: number): number {
  const midi = event.event.pitch_midi
  if (typeof midi !== 'number') {
    return 0
  }
  if (slotId === 1) {
    return -midi
  }
  if (slotId === 5) {
    return midi
  }
  const center = VOCAL_SLOT_CENTERS[slotId] ?? midi
  return Math.abs(midi - center)
}

export function getPlaybackRegionsBySlot(
  regions: ArrangementRegion[] | null | undefined,
): Map<number, ArrangementRegion[]> {
  const regionsBySlot = new Map<number, ArrangementRegion[]>()
  for (const region of regions ?? []) {
    const trackRegions = regionsBySlot.get(region.track_slot_id) ?? []
    trackRegions.push(region)
    regionsBySlot.set(region.track_slot_id, trackRegions)
  }
  for (const trackRegions of regionsBySlot.values()) {
    trackRegions.sort((left, right) => left.start_seconds - right.start_seconds)
  }
  return regionsBySlot
}

export function getMaxBeatFromRegions(
  regions: ArrangementRegion[] | null | undefined,
  initialMaxBeat = 1,
): number {
  let maxBeat = initialMaxBeat
  regions?.forEach((region) => {
    region.pitch_events.forEach((event) => {
      maxBeat = Math.max(maxBeat, event.start_beat + event.duration_beats - 1)
    })
  })
  return maxBeat
}

export function buildPlaybackTrackPlan(
  tracksToPlay: TrackSlot[],
  playbackSource: PlaybackSourceMode,
  regionsBySlot: Map<number, ArrangementRegion[]>,
) {
  const hasPlayableEvents = (track: TrackSlot) => regionsHavePlayableEvents(regionsBySlot.get(track.slot_id))
  const playableTracks = tracksToPlay.filter(
    (track) =>
      track.status === 'registered' &&
      (playbackSource === 'audio'
        ? trackHasPlayableAudio(track) || hasPlayableEvents(track)
        : hasPlayableEvents(track)),
  )
  const audioTracks = playbackSource === 'audio' ? playableTracks.filter(trackHasPlayableAudio) : []
  const eventTracks = playableTracks.filter(
    (track) => !(playbackSource === 'audio' && trackHasPlayableAudio(track)) && hasPlayableEvents(track),
  )

  return { audioTracks, eventTracks, playableTracks }
}

export function getAudioTrackSchedule({
  bufferDurationSeconds,
  scheduledStart,
  startSeconds,
  trackStartSeconds,
}: {
  bufferDurationSeconds: number
  scheduledStart: number
  startSeconds: number
  trackStartSeconds: number
}): AudioTrackSchedule {
  const relativeStartSeconds = Math.max(0, trackStartSeconds - startSeconds)
  return {
    relativeStartSeconds,
    scheduledStartSeconds: scheduledStart + relativeStartSeconds,
    sourceOffsetSeconds: Math.max(0, startSeconds - trackStartSeconds),
    timelineEndSeconds: trackStartSeconds + Math.max(0, bufferDurationSeconds),
  }
}

export function getPitchEventSchedule({
  durationSeconds,
  eventStartSeconds,
  precisionSeconds,
  scheduledStart,
  startSeconds,
}: {
  durationSeconds: number
  eventStartSeconds: number
  precisionSeconds?: number
  scheduledStart: number
  startSeconds: number
}): PitchEventSchedule | null {
  const timelinePrecisionSeconds = Math.max(STUDIO_TIME_PRECISION_SECONDS, precisionSeconds ?? STUDIO_TIME_PRECISION_SECONDS)
  const safeDurationSeconds = Math.max(0, durationSeconds)
  const eventEndSeconds = eventStartSeconds + safeDurationSeconds
  if (eventEndSeconds <= startSeconds) {
    return null
  }
  const relativeStartSeconds = Math.max(0, eventStartSeconds - startSeconds)
  const remainingDurationSeconds = Math.max(
    timelinePrecisionSeconds,
    eventEndSeconds - Math.max(eventStartSeconds, startSeconds),
  )
  return {
    eventEndSeconds,
    relativeStartSeconds,
    remainingDurationSeconds,
    scheduledStartSeconds: scheduledStart + relativeStartSeconds,
  }
}
