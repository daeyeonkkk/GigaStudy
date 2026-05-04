import type { CSSProperties } from 'react'

import type { ArrangementRegion, TempoChange } from '../../types/studio'

export type TimelineBounds = {
  minSeconds: number
  maxSeconds: number
  durationSeconds: number
}

export type MeasureStart = {
  measureIndex: number
  seconds: number
}

export function getMeasureStarts(
  timelineBounds: TimelineBounds,
  bpm: number,
  beatsPerMeasure: number,
  tempoChanges: TempoChange[] = [],
): MeasureStart[] {
  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const changesByMeasure = new Map(
    tempoChanges
      .slice()
      .sort((left, right) => left.measure_index - right.measure_index)
      .map((change) => [change.measure_index, change.bpm]),
  )
  const starts: MeasureStart[] = []
  let measureIndex = 1
  let seconds = 0
  let activeBpm = Math.max(1, bpm)
  const maxTimelineSeconds = Math.max(0.25, timelineBounds.maxSeconds)
  while (seconds <= maxTimelineSeconds + 0.001 && starts.length < 10000) {
    activeBpm = changesByMeasure.get(measureIndex) ?? activeBpm
    starts.push({ measureIndex, seconds: Math.round(seconds * 10000) / 10000 })
    seconds += (60 / Math.max(1, activeBpm)) * safeBeatsPerMeasure
    measureIndex += 1
  }
  if (starts.length < 2) {
    const measureSeconds = (60 / Math.max(1, bpm)) * safeBeatsPerMeasure
    starts.push({ measureIndex: 2, seconds: Math.round(measureSeconds * 10000) / 10000 })
  }
  return starts
}

export function getTimelinePercent(seconds: number, timelineBounds: TimelineBounds): number {
  return Math.max(
    0,
    Math.min(100, ((seconds - timelineBounds.minSeconds) / timelineBounds.durationSeconds) * 100),
  )
}

export function getDurationPercent(seconds: number, durationSeconds: number): number {
  return Math.max(0, Math.min(100, (seconds / Math.max(0.25, durationSeconds)) * 100))
}

export function getRegionHitAreaStyle(
  region: ArrangementRegion,
  timelineBounds: TimelineBounds,
): CSSProperties {
  return {
    '--region-left': `${getTimelinePercent(region.start_seconds, timelineBounds)}%`,
    '--region-width': `${Math.max(1.5, getDurationPercent(region.duration_seconds, timelineBounds.durationSeconds))}%`,
  } as CSSProperties
}

export function getRegionLaneStyle(
  isPlaying: boolean,
  playheadSeconds: number | null,
  timelineBounds: TimelineBounds,
): CSSProperties {
  return {
    '--lane-min-height': '94px',
    '--playhead-left': `${getTimelinePercent(isPlaying ? playheadSeconds ?? 0 : 0, timelineBounds)}%`,
  } as CSSProperties
}
