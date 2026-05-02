import type { ArrangementRegion, PitchEvent } from '../../types/studio'

const DEFAULT_REGION_SECONDS = 4
const DEFAULT_MIN_MIDI = 36
const DEFAULT_MAX_MIDI = 84

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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
