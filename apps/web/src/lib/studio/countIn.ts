import type { MeterContext } from './timing'

export const COUNT_IN_CAPTURE_PREROLL_MS = 120
export const COUNT_IN_FIRST_PULSE_DELAY_MS = 100
export const COUNT_IN_ZERO_HOLD_MS = 220
const COUNT_IN_CAPTURE_PREROLL_MAX_BEATS = 0.24

export function getCountInTotalPulses(meter: MeterContext): number {
  return Math.max(1, Math.round(meter.beatsPerMeasure / meter.pulseQuarterBeats))
}

export function getCountInDisplayValue(totalPulses: number, pulseIndex: number): number {
  return Math.max(0, totalPulses - pulseIndex - 1)
}

export function getCountInStartOffsetPulses(totalPulses: number): number {
  return Math.max(0, totalPulses - 1)
}

export function getCountInCapturePrerollMs(pulseMilliseconds: number): number {
  return Math.max(
    30,
    Math.min(COUNT_IN_CAPTURE_PREROLL_MS, pulseMilliseconds * COUNT_IN_CAPTURE_PREROLL_MAX_BEATS),
  )
}
