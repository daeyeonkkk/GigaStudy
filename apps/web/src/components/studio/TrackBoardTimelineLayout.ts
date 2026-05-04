import type { CSSProperties } from 'react'

import type { ArrangementRegion } from '../../types/studio'

export type TimelineBounds = {
  minSeconds: number
  maxSeconds: number
  durationSeconds: number
}

export function getMeasureStarts(timelineBounds: TimelineBounds, bpm: number, beatsPerMeasure: number): number[] {
  const beatSeconds = 60 / Math.max(1, bpm)
  const measureSeconds = Math.max(beatSeconds, beatSeconds * Math.max(1, beatsPerMeasure))
  const measureCount = Math.max(2, Math.ceil(timelineBounds.maxSeconds / measureSeconds) + 1)
  return Array.from({ length: measureCount }, (_, index) => index * measureSeconds)
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
