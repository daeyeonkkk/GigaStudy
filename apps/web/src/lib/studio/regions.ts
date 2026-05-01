import type { ArrangementRegion, PitchEvent, ScoreNote, TrackSlot } from '../../types/studio'
import { getBeatSeconds } from './timing'

const DEFAULT_REGION_SECONDS = 4
const DEFAULT_MIN_MIDI = 36
const DEFAULT_MAX_MIDI = 84

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getNoteStartSeconds(note: ScoreNote, bpm: number): number {
  if (isFiniteNumber(note.onset_seconds) && note.onset_seconds >= 0) {
    return note.onset_seconds
  }
  return Math.max(0, (note.beat - 1) * getBeatSeconds(bpm))
}

function getNoteDurationSeconds(note: ScoreNote, bpm: number): number {
  if (isFiniteNumber(note.duration_seconds) && note.duration_seconds > 0) {
    return note.duration_seconds
  }
  return Math.max(0.08, note.duration_beats * getBeatSeconds(bpm))
}

function getTrackContentDurationSeconds(track: TrackSlot, events: PitchEvent[]): number {
  const eventDuration = Math.max(
    0,
    ...events.map((event) => event.start_seconds - track.sync_offset_seconds + event.duration_seconds),
  )
  const audioDuration = isFiniteNumber(track.duration_seconds) ? track.duration_seconds : 0
  return Math.max(DEFAULT_REGION_SECONDS, audioDuration, eventDuration)
}

export function mapNoteToPitchEvent(
  note: ScoreNote,
  track: TrackSlot,
  regionId: string,
  bpm: number,
): PitchEvent {
  const startSeconds = track.sync_offset_seconds + getNoteStartSeconds(note, bpm)
  const durationSeconds = getNoteDurationSeconds(note, bpm)

  return {
    event_id: `${regionId}-${note.id}`,
    track_slot_id: track.slot_id,
    region_id: regionId,
    label: note.label,
    pitch_midi: note.pitch_midi,
    pitch_hz: note.pitch_hz,
    start_seconds: startSeconds,
    duration_seconds: durationSeconds,
    start_beat: note.beat,
    duration_beats: note.duration_beats,
    confidence: note.confidence,
    source: note.source,
    is_rest: note.is_rest,
  }
}

export function buildTrackRegion(track: TrackSlot, bpm: number): ArrangementRegion | null {
  if (track.status !== 'registered' || (track.notes.length === 0 && !track.audio_source_path)) {
    return null
  }

  const regionId = `track-${track.slot_id}-region-1`
  const pitchEvents = track.notes
    .map((note) => mapNoteToPitchEvent(note, track, regionId, bpm))
    .sort((left, right) => left.start_seconds - right.start_seconds || left.event_id.localeCompare(right.event_id))

  return {
    region_id: regionId,
    track_slot_id: track.slot_id,
    track_name: track.name,
    source_kind: track.source_kind,
    source_label: track.source_label,
    audio_source_path: track.audio_source_path,
    audio_mime_type: track.audio_mime_type,
    start_seconds: track.sync_offset_seconds,
    duration_seconds: getTrackContentDurationSeconds(track, pitchEvents),
    sync_offset_seconds: track.sync_offset_seconds,
    volume_percent: track.volume_percent,
    pitch_events: pitchEvents,
    diagnostics: track.diagnostics,
  }
}

export function buildArrangementRegions(tracks: TrackSlot[], bpm: number): ArrangementRegion[] {
  return tracks
    .map((track) => buildTrackRegion(track, bpm))
    .filter((region): region is ArrangementRegion => region !== null)
}

export function getArrangementDurationSeconds(
  tracks: TrackSlot[],
  bpm: number,
  minimumSeconds = DEFAULT_REGION_SECONDS,
): number {
  const regions = buildArrangementRegions(tracks, bpm)
  return getArrangementRegionDurationSeconds(regions, minimumSeconds)
}

export function getArrangementRegionDurationSeconds(
  regions: ArrangementRegion[],
  minimumSeconds = DEFAULT_REGION_SECONDS,
): number {
  const regionEnd = Math.max(0, ...regions.map((region) => region.start_seconds + region.duration_seconds))
  return Math.max(minimumSeconds, regionEnd)
}

export function getPitchedEvents(events: PitchEvent[]): PitchEvent[] {
  return events.filter(
    (event) => event.is_rest !== true && isFiniteNumber(event.pitch_midi),
  )
}

export function getPitchEventRange(events: PitchEvent[]): { maxMidi: number; minMidi: number } {
  const pitchedEvents = getPitchedEvents(events)
  if (pitchedEvents.length === 0) {
    return { maxMidi: DEFAULT_MAX_MIDI, minMidi: DEFAULT_MIN_MIDI }
  }

  const minMidi = Math.min(...pitchedEvents.map((event) => event.pitch_midi ?? DEFAULT_MIN_MIDI))
  const maxMidi = Math.max(...pitchedEvents.map((event) => event.pitch_midi ?? DEFAULT_MAX_MIDI))
  const paddedMin = Math.max(0, Math.floor(minMidi) - 2)
  const paddedMax = Math.min(127, Math.ceil(maxMidi) + 2)
  if (paddedMax - paddedMin < 12) {
    const center = Math.round((paddedMin + paddedMax) / 2)
    return {
      minMidi: Math.max(0, center - 6),
      maxMidi: Math.min(127, center + 6),
    }
  }
  return { maxMidi: paddedMax, minMidi: paddedMin }
}
