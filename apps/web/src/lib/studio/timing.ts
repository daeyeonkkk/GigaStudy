import type { Studio, TempoChange } from '../../types/studio'

export type MeterContext = {
  beatsPerMeasure: number
  pulseQuarterBeats: number
}

const DEFAULT_BEATS_PER_MEASURE = 4
export const DEFAULT_METER: MeterContext = {
  beatsPerMeasure: DEFAULT_BEATS_PER_MEASURE,
  pulseQuarterBeats: 1,
}

export function getBeatSeconds(bpm: number): number {
  return 60 / Math.max(1, bpm)
}

export function beatToSeconds(
  beat: number,
  bpm: number,
  beatsPerMeasure: number,
  tempoChanges: TempoChange[] = [],
): number {
  const targetBeatOffset = Math.max(0, beat - 1)
  let elapsedSeconds = 0
  let cursorBeatOffset = 0
  let activeBpm = Math.max(1, bpm)
  for (const change of tempoChanges.slice().sort((left, right) => left.measure_index - right.measure_index)) {
    const changeBeatOffset = Math.max(0, (change.measure_index - 1) * beatsPerMeasure)
    if (changeBeatOffset <= cursorBeatOffset) {
      activeBpm = change.bpm
      continue
    }
    if (targetBeatOffset <= changeBeatOffset) {
      return elapsedSeconds + ((targetBeatOffset - cursorBeatOffset) * getBeatSeconds(activeBpm))
    }
    elapsedSeconds += (changeBeatOffset - cursorBeatOffset) * getBeatSeconds(activeBpm)
    cursorBeatOffset = changeBeatOffset
    activeBpm = change.bpm
  }
  return elapsedSeconds + ((targetBeatOffset - cursorBeatOffset) * getBeatSeconds(activeBpm))
}

function getQuarterBeatsPerMeasure(numerator: number, denominator: number): number {
  return Math.max(0.25, numerator * (4 / Math.max(1, denominator)))
}

function getPulseQuarterBeats(denominator: number): number {
  return Math.max(0.125, 4 / Math.max(1, denominator))
}

function getStudioBeatsPerMeasure(studio: Studio): number {
  return getQuarterBeatsPerMeasure(studio.time_signature_numerator ?? 4, studio.time_signature_denominator ?? 4)
}

export function getStudioMeter(studio: Studio): MeterContext {
  return {
    beatsPerMeasure: getStudioBeatsPerMeasure(studio),
    pulseQuarterBeats: getPulseQuarterBeats(studio.time_signature_denominator ?? 4),
  }
}

export function isMeasureDownbeat(quarterBeatOffset: number, beatsPerMeasure: number): boolean {
  const quotient = quarterBeatOffset / Math.max(0.25, beatsPerMeasure)
  return Math.abs(quotient - Math.round(quotient)) < 0.001
}

export function getMeasureIndexFromBeat(beat: number, beatsPerMeasure: number): number {
  return Math.floor((Math.max(1, beat) - 1) / beatsPerMeasure) + 1
}

function getBeatInMeasureFromBeat(beat: number, beatsPerMeasure: number): number {
  return ((Math.max(1, beat) - 1) % beatsPerMeasure) + 1
}

export function formatBeatInMeasure(beat: number, beatsPerMeasure: number): string {
  const rounded = Math.round(getBeatInMeasureFromBeat(beat, beatsPerMeasure) * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/u, '')
}
