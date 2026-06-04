import {
  formatDurationSeconds,
  formatTrackName,
  getPitchEventRange,
} from '../../lib/studio'
import type { PitchEvent } from '../../types/studio'

export type EventMiniSource = Pick<
  PitchEvent,
  'duration_seconds' | 'event_id' | 'is_rest' | 'label' | 'pitch_midi' | 'start_seconds'
>

export function getRenderableMiniEvents<T extends EventMiniSource>(events: T[]): T[] {
  return events.filter((event) => event.is_rest !== true)
}

export function getEventMiniTopPercent(event: EventMiniSource, events: EventMiniSource[]): number {
  if (typeof event.pitch_midi !== 'number') {
    return 50
  }

  const pitchRange = getPitchEventRange(events.map(toPitchRangeEvent))
  const span = Math.max(1, pitchRange.maxMidi - pitchRange.minMidi)
  return Math.max(12, Math.min(88, 12 + ((pitchRange.maxMidi - event.pitch_midi) / span) * 76))
}

export function getEventMiniPitchSpan(events: EventMiniSource[]): number {
  const pitchedEvents = events.filter((event) => typeof event.pitch_midi === 'number')
  if (pitchedEvents.length === 0) {
    return 1
  }
  const pitchRange = getPitchEventRange(pitchedEvents.map(toPitchRangeEvent))
  return Math.max(1, pitchRange.maxMidi - pitchRange.minMidi + 1)
}

export function getEventMiniLaneHeight(
  events: EventMiniSource[],
  options: {
    baseHeight?: number
    rowHeight?: number
    verticalPadding?: number
    maxHeight?: number
  } = {},
): number {
  const {
    baseHeight = 94,
    rowHeight = 12,
    verticalPadding = 44,
    maxHeight = 240,
  } = options
  if (events.length === 0) {
    return baseHeight
  }
  return Math.max(baseHeight, Math.min(maxHeight, getEventMiniPitchSpan(events) * rowHeight + verticalPadding))
}

export function getEventMiniTitle(
  event: EventMiniSource,
  trackName?: string | null,
): string {
  const trackLabel = trackName ? `${formatTrackName(trackName)} · ` : ''
  return `${trackLabel}${event.label} · 시작 ${formatDurationSeconds(event.start_seconds)} · 길이 ${formatDurationSeconds(event.duration_seconds)}`
}

export function getEventMiniAriaLabel(
  event: EventMiniSource,
  trackName?: string | null,
): string {
  const trackLabel = trackName ? `${formatTrackName(trackName)} ` : ''
  return `${trackLabel}${event.label}, 시작 ${formatDurationSeconds(event.start_seconds)}, 길이 ${formatDurationSeconds(event.duration_seconds)}`
}

function toPitchRangeEvent(event: EventMiniSource): PitchEvent {
  return {
    beat_in_measure: null,
    confidence: 1,
    duration_beats: 1,
    duration_seconds: event.duration_seconds,
    event_id: event.event_id,
    extraction_method: 'event-mini',
    is_rest: event.is_rest,
    label: event.label,
    measure_index: null,
    pitch_hz: null,
    pitch_midi: event.pitch_midi,
    quality_warnings: [],
    region_id: 'event-mini',
    source: 'document',
    start_beat: 1,
    start_seconds: event.start_seconds,
    track_slot_id: 1,
  }
}
