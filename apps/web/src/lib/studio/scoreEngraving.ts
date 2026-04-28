import type { CSSProperties } from 'react'

import type { TrackRenderNote } from './scoreRendering'

export type EngravingDuration = {
  beats: number
  dots: number
  duration: 'w' | 'h' | 'q' | '8' | '16'
}

export type EngravingEvent = {
  duration: EngravingDuration
  durationBeats: number
  eventKey: string
  hidden: boolean
  kind: 'note' | 'rest'
  renderNote: TrackRenderNote | null
  startBeat: number
  tieStart: boolean
  tieStop: boolean
}

export type EngravingMeasure = {
  endBeat: number
  events: EngravingEvent[]
  measureIndex: number
  measureNumber: number
  startBeat: number
  width: number
  x: number
}

export type EngravingLayout = {
  measures: EngravingMeasure[]
  scoreWidth: number
  syncPxPerBeat: number
}

const GRID_BEATS = 0.25
const EPSILON_BEATS = 0.001
const MIN_SPACER_REST_BEATS = 0.25
const MIN_VISIBLE_REST_BEATS = 0.75
const FIRST_MEASURE_EXTRA_WIDTH_PX = 86
const SCORE_RIGHT_PADDING_PX = 32
const MEASURE_LEFT_PADDING_PX = 42
const MEASURE_RIGHT_PADDING_PX = 34
const MIN_MEASURE_WIDTH_PX = 260
const MAX_MEASURE_WIDTH_PX = 1080
const MIN_SCORE_WIDTH_PX = 1040
const WHOLE_REST: EngravingDuration = { beats: 4, duration: 'w', dots: 0 }
const SHARP_KEY_ACCIDENTAL_COUNTS: Record<string, number> = {
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
}
const FLAT_KEY_ACCIDENTAL_COUNTS: Record<string, number> = {
  F: 1,
  Bb: 2,
  Eb: 3,
  Ab: 4,
  Db: 5,
  Gb: 6,
  Cb: 7,
}

const durationCandidates: EngravingDuration[] = [
  { beats: 4, duration: 'w', dots: 0 },
  { beats: 3.5, duration: 'h', dots: 2 },
  { beats: 3, duration: 'h', dots: 1 },
  { beats: 2, duration: 'h', dots: 0 },
  { beats: 1.75, duration: 'q', dots: 2 },
  { beats: 1.5, duration: 'q', dots: 1 },
  { beats: 1, duration: 'q', dots: 0 },
  { beats: 0.75, duration: '8', dots: 1 },
  { beats: 0.5, duration: '8', dots: 0 },
  { beats: 0.375, duration: '16', dots: 1 },
  { beats: 0.25, duration: '16', dots: 0 },
]

type NormalizedNote = {
  endBeat: number
  renderNote: TrackRenderNote
  startBeat: number
}

function roundToGrid(value: number): number {
  return Math.round(value / GRID_BEATS) * GRID_BEATS
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function getKeySignatureAccidentalCount(keySignature: string | null | undefined): number {
  if (!keySignature || keySignature === 'C') {
    return 0
  }
  return SHARP_KEY_ACCIDENTAL_COUNTS[keySignature] ?? FLAT_KEY_ACCIDENTAL_COUNTS[keySignature] ?? 0
}

function getKeySignatureWidthAllowance(keySignature: string | null | undefined): number {
  const accidentalCount = getKeySignatureAccidentalCount(keySignature)
  if (accidentalCount === 0) {
    return 0
  }
  return 22 + accidentalCount * 11
}

function samePitch(left: TrackRenderNote, right: TrackRenderNote): boolean {
  const leftMidi = left.note.pitch_midi
  const rightMidi = right.note.pitch_midi
  if (
    typeof leftMidi === 'number' &&
    Number.isFinite(leftMidi) &&
    typeof rightMidi === 'number' &&
    Number.isFinite(rightMidi)
  ) {
    return Math.round(leftMidi) === Math.round(rightMidi)
  }
  return left.note.label === right.note.label
}

function accidentalWeight(note: TrackRenderNote): number {
  return /[#bn]/u.test(note.note.accidental ?? note.note.spelled_label ?? note.note.label) ? 1 : 0
}

function decomposeDuration(beats: number): EngravingDuration[] {
  const pieces: EngravingDuration[] = []
  let remaining = Math.max(GRID_BEATS, roundToGrid(beats))

  while (remaining >= GRID_BEATS - EPSILON_BEATS) {
    const next =
      durationCandidates.find((candidate) => candidate.beats <= remaining + EPSILON_BEATS) ??
      durationCandidates[durationCandidates.length - 1]
    pieces.push(next)
    remaining = roundToGrid(remaining - next.beats)
  }

  return pieces
}

function normalizeMeasureNotes(
  measureNotes: TrackRenderNote[],
  measureStartBeat: number,
  measureEndBeat: number,
): NormalizedNote[] {
  const normalized: NormalizedNote[] = []

  measureNotes
    .filter((renderNote) => renderNote.note.is_rest !== true)
    .map((renderNote) => {
      const latestStartBeat = Math.max(measureStartBeat, measureEndBeat - GRID_BEATS)
      const startBeat = clamp(roundToGrid(renderNote.displayBeat), measureStartBeat, latestStartBeat)
      const durationBeats = Math.max(GRID_BEATS, roundToGrid(renderNote.displayDurationBeats))
      return {
        renderNote,
        startBeat,
        endBeat: clamp(startBeat + durationBeats, startBeat + GRID_BEATS, measureEndBeat),
      }
    })
    .filter((entry) => entry.endBeat > entry.startBeat + EPSILON_BEATS && entry.endBeat <= measureEndBeat + EPSILON_BEATS)
    .sort((left, right) => left.startBeat - right.startBeat || left.renderNote.renderKey.localeCompare(right.renderNote.renderKey))
    .forEach((entry) => {
      const previous = normalized[normalized.length - 1]
      if (!previous) {
        normalized.push(entry)
        return
      }

      if (entry.startBeat <= previous.endBeat + EPSILON_BEATS) {
        if (samePitch(previous.renderNote, entry.renderNote)) {
          previous.endBeat = Math.max(previous.endBeat, entry.endBeat)
          previous.renderNote = {
            ...previous.renderNote,
            tieStart: previous.renderNote.tieStart || entry.renderNote.tieStart,
          }
          return
        }

        const previousMinimumEnd = previous.startBeat + GRID_BEATS
        if (entry.startBeat >= previousMinimumEnd + EPSILON_BEATS) {
          previous.endBeat = entry.startBeat
          normalized.push(entry)
          return
        }

        const previousConfidence = previous.renderNote.note.confidence ?? 0
        const entryConfidence = entry.renderNote.note.confidence ?? 0
        if (entryConfidence > previousConfidence + 0.08) {
          normalized[normalized.length - 1] = entry
        }
        return
      }

      normalized.push(entry)
    })

  return normalized
}

function addRestEvents(events: EngravingEvent[], startBeat: number, gapBeats: number, keyPrefix: string) {
  const notatedGapBeats = roundToGrid(gapBeats)
  if (notatedGapBeats < MIN_SPACER_REST_BEATS) {
    return
  }

  let cursor = startBeat
  const hidden = notatedGapBeats < MIN_VISIBLE_REST_BEATS
  decomposeDuration(notatedGapBeats).forEach((duration, index) => {
    events.push({
      duration,
      durationBeats: duration.beats,
      eventKey: `${keyPrefix}-rest-${index}`,
      hidden,
      kind: 'rest',
      renderNote: null,
      startBeat: cursor,
      tieStart: false,
      tieStop: false,
    })
    cursor += duration.beats
  })
}

function buildMeasureEvents(
  measureNotes: TrackRenderNote[],
  measureStartBeat: number,
  measureEndBeat: number,
  measureIndex: number,
): EngravingEvent[] {
  const normalizedNotes = normalizeMeasureNotes(measureNotes, measureStartBeat, measureEndBeat)
  const events: EngravingEvent[] = []

  if (normalizedNotes.length === 0) {
    const measureBeats = measureEndBeat - measureStartBeat
    if (Math.abs(measureBeats - WHOLE_REST.beats) <= EPSILON_BEATS) {
      return [
        {
          duration: WHOLE_REST,
          durationBeats: measureBeats,
          eventKey: `measure-${measureIndex}-whole-rest`,
          hidden: false,
          kind: 'rest',
          renderNote: null,
          startBeat: measureStartBeat,
          tieStart: false,
          tieStop: false,
        },
      ]
    }
    let cursor = measureStartBeat
    return decomposeDuration(measureBeats).map((duration, index) => {
      const event: EngravingEvent = {
        duration,
        durationBeats: duration.beats,
        eventKey: `measure-${measureIndex}-meter-rest-${index}`,
        hidden: false,
        kind: 'rest',
        renderNote: null,
        startBeat: cursor,
        tieStart: false,
        tieStop: false,
      }
      cursor += duration.beats
      return event
    })
  }

  let cursorBeat = measureStartBeat
  normalizedNotes.forEach((entry, noteIndex) => {
    if (entry.startBeat > cursorBeat + EPSILON_BEATS) {
      addRestEvents(events, cursorBeat, entry.startBeat - cursorBeat, `measure-${measureIndex}-${noteIndex}`)
      cursorBeat = entry.startBeat
    }

    const pieces = decomposeDuration(entry.endBeat - entry.startBeat)
    let pieceStartBeat = cursorBeat
    pieces.forEach((duration, pieceIndex) => {
      events.push({
        duration,
        durationBeats: duration.beats,
        eventKey: `${entry.renderNote.renderKey}-piece-${pieceIndex}`,
        hidden: false,
        kind: 'note',
        renderNote: {
          ...entry.renderNote,
          displayBeat: pieceStartBeat,
          displayDurationBeats: duration.beats,
        },
        startBeat: pieceStartBeat,
        tieStart: pieceIndex < pieces.length - 1 || (pieceIndex === pieces.length - 1 && entry.renderNote.tieStart),
        tieStop: pieceIndex > 0 || (pieceIndex === 0 && entry.renderNote.tieStop),
      })
      pieceStartBeat += duration.beats
    })
    cursorBeat = Math.max(cursorBeat, entry.endBeat)
  })

  addRestEvents(events, cursorBeat, measureEndBeat - cursorBeat, `measure-${measureIndex}-tail`)
  return events
}

function getMeasureWidth(events: EngravingEvent[], measureIndex: number, keySignature: string | null = null): number {
  const noteEvents = events.filter((event) => event.kind === 'note')
  const shortEvents = events.filter((event) => event.duration.beats <= 0.5)
  const visibleRestEvents = events.filter((event) => event.kind === 'rest' && !event.hidden)
  const spacerRestEvents = events.filter((event) => event.kind === 'rest' && event.hidden)
  const accidentalCount = noteEvents.reduce((total, event) => total + (event.renderNote ? accidentalWeight(event.renderNote) : 0), 0)
  const tieCount = events.filter((event) => event.tieStart || event.tieStop).length
  const rawWidth =
    112 +
    noteEvents.length * 46 +
    visibleRestEvents.length * 26 +
    spacerRestEvents.length * 8 +
    shortEvents.length * 14 +
    accidentalCount * 12 +
    tieCount * 10 +
    (measureIndex === 0 ? FIRST_MEASURE_EXTRA_WIDTH_PX + getKeySignatureWidthAllowance(keySignature) : 0)
  return Math.round(clamp(rawWidth, MIN_MEASURE_WIDTH_PX, MAX_MEASURE_WIDTH_PX))
}

export function buildEngravingLayout(
  notes: TrackRenderNote[],
  measureCount: number,
  beatsPerMeasure: number,
  preferredMeasureWidths: number[] = [],
  keySignature: string | null = null,
): EngravingLayout {
  const safeBeatsPerMeasure = Math.max(GRID_BEATS, beatsPerMeasure)
  let cursorX = 0
  const measures = Array.from({ length: Math.max(1, measureCount) }, (_, measureIndex) => {
    const measureStartBeat = 1 + measureIndex * safeBeatsPerMeasure
    const measureEndBeat = measureStartBeat + safeBeatsPerMeasure
    const measureNotes = notes.filter(
      (note) => note.displayBeat >= measureStartBeat - EPSILON_BEATS && note.displayBeat < measureEndBeat - EPSILON_BEATS,
    )
    const events = buildMeasureEvents(measureNotes, measureStartBeat, measureEndBeat, measureIndex)
    const preferredWidth = preferredMeasureWidths[measureIndex]
    const width =
      typeof preferredWidth === 'number' && Number.isFinite(preferredWidth)
        ? Math.round(clamp(preferredWidth, MIN_MEASURE_WIDTH_PX, MAX_MEASURE_WIDTH_PX))
        : getMeasureWidth(events, measureIndex, keySignature)
    const measure: EngravingMeasure = {
      endBeat: measureEndBeat,
      events,
      measureIndex,
      measureNumber: measureIndex + 1,
      startBeat: measureStartBeat,
      width,
      x: cursorX,
    }
    cursorX += width
    return measure
  })

  const scoreWidth = Math.max(cursorX + SCORE_RIGHT_PADDING_PX, MIN_SCORE_WIDTH_PX)
  const averageBeatWidth =
    measures.reduce((total, measure) => total + Math.max(80, measure.width - MEASURE_LEFT_PADDING_PX - MEASURE_RIGHT_PADDING_PX), 0) /
    Math.max(1, measures.length) /
    safeBeatsPerMeasure
  return {
    measures,
    scoreWidth,
    syncPxPerBeat: Math.max(120, averageBeatWidth),
  }
}

export function buildEngravingMeasureWidths(
  notes: TrackRenderNote[],
  measureCount: number,
  beatsPerMeasure: number,
  keySignature: string | null = null,
): number[] {
  const safeBeatsPerMeasure = Math.max(GRID_BEATS, beatsPerMeasure)

  return Array.from({ length: Math.max(1, measureCount) }, (_, measureIndex) => {
    const measureStartBeat = 1 + measureIndex * safeBeatsPerMeasure
    const measureEndBeat = measureStartBeat + safeBeatsPerMeasure
    const measureNotes = notes.filter(
      (note) => note.displayBeat >= measureStartBeat - EPSILON_BEATS && note.displayBeat < measureEndBeat - EPSILON_BEATS,
    )
    return getMeasureWidth(
      buildMeasureEvents(measureNotes, measureStartBeat, measureEndBeat, measureIndex),
      measureIndex,
      keySignature,
    )
  })
}

function getEngravingXForBeat(displayBeat: number, layout: EngravingLayout, beatsPerMeasure: number): number {
  const safeBeatsPerMeasure = Math.max(GRID_BEATS, beatsPerMeasure)
  const lastMeasure = layout.measures[layout.measures.length - 1]
  const clampedBeat = Math.max(1, displayBeat)
  const rawMeasureIndex = Math.floor((clampedBeat - 1) / safeBeatsPerMeasure)
  const measureIndex = Math.min(layout.measures.length - 1, Math.max(0, rawMeasureIndex))
  const measure = layout.measures[measureIndex] ?? lastMeasure
  const beatWithinMeasure = (clampedBeat - 1) - measureIndex * safeBeatsPerMeasure
  const usableWidth = Math.max(1, measure.width - MEASURE_LEFT_PADDING_PX - MEASURE_RIGHT_PADDING_PX)
  const rawX = measure.x + MEASURE_LEFT_PADDING_PX + (beatWithinMeasure / safeBeatsPerMeasure) * usableWidth
  return clamp(rawX, 0, layout.scoreWidth - SCORE_RIGHT_PADDING_PX)
}

export function getEngravingXForSeconds(
  playheadSeconds: number,
  bpm: number,
  layout: EngravingLayout,
  beatsPerMeasure: number,
): number {
  const beatSeconds = 60 / Math.max(1, bpm)
  return getEngravingXForBeat(1 + playheadSeconds / beatSeconds, layout, beatsPerMeasure)
}

export function getEngravingPlayheadStyle(
  playheadSeconds: number,
  bpm: number,
  layout: EngravingLayout,
  beatsPerMeasure: number,
): CSSProperties {
  return {
    '--playhead-left': `${Math.round(getEngravingXForSeconds(playheadSeconds, bpm, layout, beatsPerMeasure) * 100) / 100}px`,
  } as CSSProperties
}

export function getEngravingMeasureLineStyle(measureIndex: number, layout: EngravingLayout): CSSProperties {
  const measure = layout.measures[measureIndex]
  const left = measure ? measure.x : layout.scoreWidth - SCORE_RIGHT_PADDING_PX
  return {
    '--line-left': `${Math.round(left)}px`,
  } as CSSProperties
}

export function getEngravingBeatLineStyle(beatOffset: number, layout: EngravingLayout, beatsPerMeasure: number): CSSProperties {
  const safeBeatsPerMeasure = Math.max(GRID_BEATS, beatsPerMeasure)
  const measureIndex = Math.floor(beatOffset / safeBeatsPerMeasure)
  const measure = layout.measures[Math.min(layout.measures.length - 1, Math.max(0, measureIndex))]
  const beatWithinMeasure = beatOffset - measureIndex * safeBeatsPerMeasure
  const usableWidth = Math.max(1, measure.width - MEASURE_LEFT_PADDING_PX - MEASURE_RIGHT_PADDING_PX)
  return {
    '--line-left': `${Math.round(measure.x + MEASURE_LEFT_PADDING_PX + (beatWithinMeasure / safeBeatsPerMeasure) * usableWidth)}px`,
  } as CSSProperties
}

export function getEngravingMarkerNoteStyle(
  renderNote: TrackRenderNote,
  layout: EngravingLayout,
  beatsPerMeasure: number,
  syncShiftPx = 0,
): CSSProperties {
  return {
    '--note-left': `${Math.round(getEngravingXForBeat(renderNote.displayBeat, layout, beatsPerMeasure) + syncShiftPx)}px`,
  } as CSSProperties
}
