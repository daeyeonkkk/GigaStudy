import {
  getPitchEventPlaybackFrequency,
  regionsHavePlayableEvents,
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

export function getSustainedPitchEvents(events: PitchEvent[], isPercussion: boolean): ScheduledPitchEvent[] {
  const scheduledEvents = events
    .map((event) => {
      const frequency = getPitchEventPlaybackFrequency(event)
      return frequency === null
        ? null
        : {
            durationSeconds: Math.max(isPercussion ? 0.08 : 0.12, event.duration_seconds),
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
    const smallGap = current.startSeconds <= previousEndSeconds + 0.08
    if (samePitch && smallGap) {
      previous.durationSeconds = Math.max(previous.durationSeconds, currentEndSeconds - previous.startSeconds)
      continue
    }

    merged.push({ ...current })
  }
  return merged
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
