import type { CSSProperties } from 'react'

import { getBeatSeconds, STUDIO_TIME_PRECISION_SECONDS } from '../../lib/studio'
import type { ArrangementRegion } from '../../types/studio'

export type TimelineBounds = {
  minSeconds: number
  maxSeconds: number
  durationSeconds: number
}

export type MeasureStart = {
  measureIndex: number
  seconds: number
}

const BEAT_UNIT_WIDTH_PIXELS = 50
const MIN_TIMELINE_WIDTH_PIXELS = 900

export function getBeatUnitWidthPixels(): number {
  return BEAT_UNIT_WIDTH_PIXELS
}

export function getMeasureWidthPixels(beatsPerMeasure: number): number {
  return Math.max(0.25, beatsPerMeasure) * BEAT_UNIT_WIDTH_PIXELS
}

export function getTimelineWidthPixels(
  durationSeconds: number,
  bpm: number,
  minimumPixels = MIN_TIMELINE_WIDTH_PIXELS,
): number {
  const durationBeats = Math.max(STUDIO_TIME_PRECISION_SECONDS, durationSeconds) / getBeatSeconds(bpm)
  return Math.max(minimumPixels, durationBeats * BEAT_UNIT_WIDTH_PIXELS)
}

export function getTimelinePixelForSeconds(
  seconds: number,
  timelineBounds: TimelineBounds,
  bpm: number,
): number {
  const timelineWidthPixels = getTimelineWidthPixels(timelineBounds.durationSeconds, bpm, 0)
  return (getTimelinePercent(seconds, timelineBounds) / 100) * timelineWidthPixels
}

export function getFollowScrollLeft({
  leadPixels = 80,
  playheadPixels,
  scrollWidth,
  viewportWidth,
}: {
  leadPixels?: number
  playheadPixels: number
  scrollWidth: number
  viewportWidth: number
}): number {
  const maxScrollLeft = Math.max(0, scrollWidth - viewportWidth)
  const effectiveLeadPixels = Math.max(0, Math.min(leadPixels, viewportWidth * 0.4))
  return Math.max(0, Math.min(maxScrollLeft, playheadPixels - effectiveLeadPixels))
}

export function getMeasureStarts(
  timelineBounds: TimelineBounds,
  bpm: number,
  beatsPerMeasure: number,
): MeasureStart[] {
  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const measureSeconds = (60 / Math.max(1, bpm)) * safeBeatsPerMeasure
  const starts: MeasureStart[] = []
  let measureIndex = 1
  let seconds = 0
  const maxTimelineSeconds = Math.max(0.25, timelineBounds.maxSeconds)
  while (seconds <= maxTimelineSeconds + STUDIO_TIME_PRECISION_SECONDS && starts.length < 10000) {
    starts.push({ measureIndex, seconds: Math.round(seconds * 10000) / 10000 })
    seconds += measureSeconds
    measureIndex += 1
  }
  if (starts.length < 2) {
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
  return Math.max(0, Math.min(100, (seconds / Math.max(STUDIO_TIME_PRECISION_SECONDS, durationSeconds)) * 100))
}

export function getRegionHitAreaStyle(
  region: ArrangementRegion,
  timelineBounds: TimelineBounds,
): CSSProperties {
  return {
    '--region-left': `${getTimelinePercent(region.start_seconds, timelineBounds)}%`,
    '--region-width': `${getDurationPercent(region.duration_seconds, timelineBounds.durationSeconds)}%`,
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
