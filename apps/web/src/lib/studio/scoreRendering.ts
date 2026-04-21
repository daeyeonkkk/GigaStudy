import type { CSSProperties } from 'react'

import type { ScoreNote, TrackSlot } from '../../types/studio'
import {
  formatBeatInMeasure,
  getDisplayBeat,
  getMeasureIndexFromBeat,
  isMeasureDownbeat,
} from './timing'

export type TrackRenderNote = {
  note: ScoreNote
  displayBeat: number
  displayDurationBeats: number
  durationGlyph: NoteDurationGlyph
  durationLabel: string
  renderKey: string
  segmentIndex: number
  segmentCount: number
  tieStart: boolean
  tieStop: boolean
  clusterIndex: number
  clusterSize: number
}

export type NoteDurationGlyph = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'

export type TrackRenderModel = {
  beatsPerMeasure: number
  measureCount: number
  measures: number[]
  beatGuideOffsets: number[]
  measureBoundaryOffsets: number[]
  notes: TrackRenderNote[]
  pxPerBeat: number
  measureWidth: number
  timelineWidth: number
}

export const SCORE_CLEF_GUTTER_PX = 126

const SCORE_END_PADDING_PX = 48
const MEASURE_INSET_PX = 32
const NOTE_CENTER_GUARD_PX = 28
const MIN_SCORE_PX_PER_BEAT = 180
const MAX_SCORE_PX_PER_BEAT = 920
const NOTE_READABLE_GAP_PX = 64
const SAME_ONSET_CLUSTER_EPSILON_BEATS = 0.035
const STAFF_MIDDLE_LINE_Y = 62
const STAFF_STEP_PX = 5
const STAFF_NOTE_MIN_TOP = 18
const STAFF_NOTE_MAX_TOP = 98
const DURATION_EPSILON_BEATS = 0.001

const noteSemitones: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const noteSteps: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

function getDiatonicStep(noteName: string, octave: number): number {
  return octave * 7 + noteSteps[noteName]
}

function parsePitchLabel(label: string): { octave: number; step: number; semitone: number } | null {
  const match = /^([A-G])([#b]?)(\d)$/u.exec(label.trim())
  if (!match) {
    return null
  }

  const [, noteName, accidental, octaveText] = match
  const octave = Number(octaveText)
  let semitone = noteSemitones[noteName]
  if (accidental === '#') {
    semitone += 1
  } else if (accidental === 'b') {
    semitone -= 1
  }

  return {
    octave,
    step: getDiatonicStep(noteName, octave),
    semitone: ((semitone % 12) + 12) % 12,
  }
}

export function getNoteFrequency(label: string): number | null {
  const parsed = parsePitchLabel(label)
  if (!parsed) {
    return null
  }

  const octaveOffset = parsed.octave - 4
  const pitchClassOffset = parsed.semitone - 9
  return 440 * 2 ** ((octaveOffset * 12 + pitchClassOffset) / 12)
}

function getPercussionFrequency(label: string): number {
  const normalized = label.toLowerCase()
  if (normalized.includes('kick')) {
    return 90
  }
  if (normalized.includes('snare')) {
    return 180
  }
  if (normalized.includes('hat')) {
    return 620
  }
  return 260
}

export function getNotePlaybackFrequency(note: ScoreNote): number | null {
  if (note.is_rest === true) {
    return null
  }
  if (note.pitch_hz && Number.isFinite(note.pitch_hz)) {
    return note.pitch_hz
  }
  if (note.pitch_midi === 35 || note.label.toLowerCase().includes('kick')) {
    return getPercussionFrequency(note.label)
  }
  return getNoteFrequency(note.label)
}

function getPitchStepFromMidi(pitchMidi: number): number {
  const octave = Math.floor(pitchMidi / 12) - 1
  const pitchClass = ((pitchMidi % 12) + 12) % 12
  const pitchClassToStep: Record<number, number> = {
    0: 0,
    1: 0,
    2: 1,
    3: 1,
    4: 2,
    5: 3,
    6: 3,
    7: 4,
    8: 4,
    9: 5,
    10: 5,
    11: 6,
  }
  return octave * 7 + pitchClassToStep[pitchClass]
}

function getStaffClef(slotId: number): 'treble' | 'bass' {
  return slotId >= 5 ? 'bass' : 'treble'
}

function getStaffMiddleLineStep(slotId: number): number {
  return getStaffClef(slotId) === 'bass' ? getDiatonicStep('D', 3) : getDiatonicStep('B', 4)
}

function getStaffTopFromStep(slotId: number, step: number): number {
  const top = STAFF_MIDDLE_LINE_Y - (step - getStaffMiddleLineStep(slotId)) * STAFF_STEP_PX
  return Math.max(STAFF_NOTE_MIN_TOP, Math.min(STAFF_NOTE_MAX_TOP, top))
}

function getNoteTopPx(slotId: number, note: ScoreNote): number {
  if (note.is_rest === true) {
    return STAFF_MIDDLE_LINE_Y - 12
  }
  if (typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)) {
    return getStaffTopFromStep(slotId, getPitchStepFromMidi(note.pitch_midi))
  }
  const parsed = parsePitchLabel(note.label)
  if (parsed) {
    return getStaffTopFromStep(slotId, parsed.step)
  }
  return STAFF_MIDDLE_LINE_Y
}

export function getClefSymbol(slotId: number): string {
  return String.fromCodePoint(getStaffClef(slotId) === 'bass' ? 0x1d122 : 0x1d11e)
}

function getScorePxPerBeat(displayBeats: number[]): number {
  const uniqueBeats = [...new Set(displayBeats.map((beat) => Math.round(beat * 1000) / 1000))].sort(
    (left, right) => left - right,
  )
  const smallestGap = uniqueBeats.reduce<number | null>((currentSmallest, beat, index) => {
    if (index === 0) {
      return currentSmallest
    }
    const gap = beat - uniqueBeats[index - 1]
    if (gap <= 0.001) {
      return currentSmallest
    }
    return currentSmallest === null ? gap : Math.min(currentSmallest, gap)
  }, null)

  if (smallestGap === null) {
    return MIN_SCORE_PX_PER_BEAT
  }

  const densityAwareWidth = NOTE_READABLE_GAP_PX / smallestGap + 18
  return Math.round(Math.max(MIN_SCORE_PX_PER_BEAT, Math.min(MAX_SCORE_PX_PER_BEAT, densityAwareWidth)))
}

function getMeasureStartPx(measureIndex: number, model: TrackRenderModel): number {
  return SCORE_CLEF_GUTTER_PX + measureIndex * model.measureWidth
}

function getMeasureIndexFromDisplayBeat(displayBeat: number, beatsPerMeasure: number): number {
  const normalizedBeat = Math.max(1, displayBeat)
  return Math.floor((normalizedBeat - 1) / Math.max(0.25, beatsPerMeasure))
}

function getBeatOffsetWithinMeasure(displayBeat: number, beatsPerMeasure: number): number {
  const normalizedBeat = Math.max(1, displayBeat)
  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  return (normalizedBeat - 1) - getMeasureIndexFromDisplayBeat(normalizedBeat, safeBeatsPerMeasure) * safeBeatsPerMeasure
}

function clampToMeasureInterior(leftPx: number, measureIndex: number, model: TrackRenderModel): number {
  const measureStart = getMeasureStartPx(measureIndex, model)
  const measureEnd = measureStart + model.measureWidth
  return Math.max(measureStart + NOTE_CENTER_GUARD_PX, Math.min(measureEnd - NOTE_CENTER_GUARD_PX, leftPx))
}

function getDurationGlyph(durationBeats: number): NoteDurationGlyph {
  if (durationBeats >= 3.5) {
    return 'whole'
  }
  if (durationBeats >= 1.5) {
    return 'half'
  }
  if (durationBeats >= 0.75) {
    return 'quarter'
  }
  if (durationBeats >= 0.375) {
    return 'eighth'
  }
  return 'sixteenth'
}

function getDurationLabel(durationBeats: number): string {
  const glyph = getDurationGlyph(durationBeats)
  const labels: Record<NoteDurationGlyph, string> = {
    whole: '온음표',
    half: '2분음표',
    quarter: '4분음표',
    eighth: '8분음표',
    sixteenth: '16분음표',
  }
  const rounded = Math.round(durationBeats * 100) / 100
  return `${labels[glyph]} · ${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}박`
}

function pitchIdentity(note: ScoreNote): string {
  if (typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)) {
    return `midi:${note.pitch_midi}`
  }
  return `label:${note.label}`
}

function getDisplaySegments(note: ScoreNote, displayBeat: number, beatsPerMeasure: number): TrackRenderNote[] {
  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const durationBeats = Math.max(0.25, note.duration_beats)
  const displayStart = Math.max(1, displayBeat)
  const displayEnd = Math.max(displayStart + 0.25, displayBeat + durationBeats)
  const segments: Array<Pick<
    TrackRenderNote,
    'note' | 'displayBeat' | 'displayDurationBeats' | 'durationGlyph' | 'durationLabel' | 'renderKey' | 'segmentIndex' | 'segmentCount' | 'tieStart' | 'tieStop'
  >> = []

  let cursor = displayStart
  while (cursor < displayEnd - DURATION_EPSILON_BEATS) {
    const measureIndex = getMeasureIndexFromDisplayBeat(cursor, safeBeatsPerMeasure)
    const measureEndBeat = 1 + (measureIndex + 1) * safeBeatsPerMeasure
    const segmentEnd = Math.min(displayEnd, measureEndBeat)
    const displayDurationBeats = Math.max(0.25, segmentEnd - cursor)
    const segmentIndex = segments.length
    segments.push({
      note,
      displayBeat: cursor,
      displayDurationBeats,
      durationGlyph: getDurationGlyph(displayDurationBeats),
      durationLabel: getDurationLabel(displayDurationBeats),
      renderKey: `${note.id}-${segmentIndex}`,
      segmentIndex,
      segmentCount: 1,
      tieStart: false,
      tieStop: false,
    })
    cursor = segmentEnd
  }

  const segmentCount = segments.length
  return segments.map((segment) => ({
    ...segment,
    segmentCount,
    tieStart: segment.segmentIndex < segmentCount - 1 || note.is_tied === true,
    tieStop: segment.segmentIndex > 0,
    clusterIndex: 0,
    clusterSize: 1,
  }))
}

function markExplicitTieContinuations(segments: TrackRenderNote[]): TrackRenderNote[] {
  return segments.map((segment, index) => {
    if (segment.tieStop || segment.note.is_tied !== true || index === 0) {
      return segment
    }

    const previous = [...segments]
      .slice(0, index)
      .reverse()
      .find((candidate) => {
        const candidateEnd = candidate.displayBeat + candidate.displayDurationBeats
        return (
          pitchIdentity(candidate.note) === pitchIdentity(segment.note) &&
          Math.abs(candidateEnd - segment.displayBeat) <= 0.06
        )
      })

    return previous ? { ...segment, tieStop: true } : segment
  })
}

function getClusteredRenderNotes(
  notes: ScoreNote[],
  syncOffsetSeconds: number,
  bpm: number,
  beatsPerMeasure: number,
): TrackRenderNote[] {
  const baseNotes = notes
    .flatMap((note) => getDisplaySegments(note, getDisplayBeat(note, syncOffsetSeconds, bpm), beatsPerMeasure))
    .sort((left, right) => left.displayBeat - right.displayBeat || left.renderKey.localeCompare(right.renderKey))

  const tiedBaseNotes = markExplicitTieContinuations(baseNotes)

  const clustered: TrackRenderNote[] = []
  let currentCluster: TrackRenderNote[] = []
  const flushCluster = () => {
    const clusterSize = currentCluster.length
    currentCluster.forEach((entry, index) => {
      clustered.push({
        ...entry,
        clusterIndex: index,
        clusterSize,
      })
    })
    currentCluster = []
  }

  tiedBaseNotes.forEach((entry) => {
    const clusterAnchor = currentCluster[0]
    if (
      clusterAnchor &&
      Math.abs(entry.displayBeat - clusterAnchor.displayBeat) > SAME_ONSET_CLUSTER_EPSILON_BEATS
    ) {
      flushCluster()
    }
    currentCluster.push(entry)
  })
  flushCluster()

  return clustered
}

export function getTrackRenderModel(
  track: TrackSlot,
  bpm: number,
  beatsPerMeasure: number,
): TrackRenderModel {
  const displayBeats = track.notes.map((note) => getDisplayBeat(note, track.sync_offset_seconds, bpm))
  const pxPerBeat = getScorePxPerBeat(displayBeats)
  const notes = getClusteredRenderNotes(track.notes, track.sync_offset_seconds, bpm, beatsPerMeasure)
  const baseMaxBeatEnd = Math.max(
    beatsPerMeasure,
    ...track.notes.map((note) => note.beat + Math.max(0.25, note.duration_beats) - 0.001),
  )
  const syncedMaxBeatEnd = Math.max(
    beatsPerMeasure,
    ...notes.map(({ note, displayBeat }) => Math.max(note.beat, displayBeat) + Math.max(0.25, note.duration_beats) - 0.001),
  )
  const baseMeasureCount = getMeasureIndexFromBeat(baseMaxBeatEnd, beatsPerMeasure) + 1
  const measureCount = Math.max(1, baseMeasureCount, getMeasureIndexFromBeat(syncedMaxBeatEnd, beatsPerMeasure))
  const measureWidth = MEASURE_INSET_PX * 2 + pxPerBeat * beatsPerMeasure
  const totalQuarterBeats = measureCount * beatsPerMeasure
  const beatGuideOffsets = Array.from({ length: Math.floor(totalQuarterBeats) + 1 }, (_, index) => index).filter(
    (beatOffset) => !isMeasureDownbeat(beatOffset, beatsPerMeasure),
  )
  const measureBoundaryOffsets = Array.from({ length: measureCount + 1 }, (_, index) => index * beatsPerMeasure)

  return {
    beatsPerMeasure,
    measureCount,
    measures: Array.from({ length: measureCount }, (_, index) => index + 1),
    beatGuideOffsets,
    measureBoundaryOffsets,
    notes,
    pxPerBeat,
    measureWidth,
    timelineWidth: SCORE_CLEF_GUTTER_PX + measureCount * measureWidth + SCORE_END_PADDING_PX,
  }
}

export function getScoreTimelineStyle(model: TrackRenderModel): CSSProperties {
  return {
    '--score-width': `${model.timelineWidth}px`,
    '--measure-width': `${model.measureWidth}px`,
    '--clef-gutter': `${SCORE_CLEF_GUTTER_PX}px`,
  } as CSSProperties
}

export function getScoreLineStyle(leftPx: number): CSSProperties {
  return {
    '--line-left': `${Math.round(leftPx)}px`,
  } as CSSProperties
}

export function getScoreBeatLineStyle(beatOffset: number, model: TrackRenderModel): CSSProperties {
  const measureIndex = Math.floor(beatOffset / Math.max(0.25, model.beatsPerMeasure))
  const beatWithinMeasure = beatOffset - measureIndex * model.beatsPerMeasure
  return getScoreLineStyle(
    getMeasureStartPx(measureIndex, model) + MEASURE_INSET_PX + beatWithinMeasure * model.pxPerBeat,
  )
}

export function getScoreMeasureBoundaryStyle(beatOffset: number, model: TrackRenderModel): CSSProperties {
  const measureIndex = Math.round(beatOffset / Math.max(0.25, model.beatsPerMeasure))
  return getScoreLineStyle(getMeasureStartPx(measureIndex, model))
}

export function getScoreMeasureLabelStyle(measureIndex: number, model: TrackRenderModel): CSSProperties {
  return {
    '--label-left': `${SCORE_CLEF_GUTTER_PX + (measureIndex - 1) * model.measureWidth + 8}px`,
  } as CSSProperties
}

export function getTimelineNoteStyle(slotId: number, renderNote: TrackRenderNote, model: TrackRenderModel): CSSProperties {
  const measureIndex = Math.min(
    model.measureCount - 1,
    getMeasureIndexFromDisplayBeat(renderNote.displayBeat, model.beatsPerMeasure),
  )
  const beatWithinMeasure = getBeatOffsetWithinMeasure(renderNote.displayBeat, model.beatsPerMeasure)
  const clusterOffset = (renderNote.clusterIndex - (renderNote.clusterSize - 1) / 2) * 22
  const rawLeft = getMeasureStartPx(measureIndex, model) + MEASURE_INSET_PX + beatWithinMeasure * model.pxPerBeat + clusterOffset
  const left = clampToMeasureInterior(rawLeft, measureIndex, model)
  const visualDurationPx = Math.max(28, renderNote.displayDurationBeats * model.pxPerBeat)
  return {
    '--note-top': `${getNoteTopPx(slotId, renderNote.note)}px`,
    '--note-left': `${Math.round(left)}px`,
    '--note-duration-width': `${Math.round(visualDurationPx)}px`,
    '--note-tie-width': `${Math.round(Math.max(34, visualDurationPx - 6))}px`,
    '--note-tie-stop-width': `${Math.round(Math.max(26, visualDurationPx * 0.36))}px`,
  } as CSSProperties
}

export function getTimelineNoteClass(renderNote: TrackRenderNote): string {
  const classes = ['track-card__measure-note', `track-card__note--${renderNote.durationGlyph}`]
  if (renderNote.note.is_rest === true) {
    classes.push('track-card__note--rest')
  }
  if (renderNote.tieStart) {
    classes.push('track-card__note--tie-start')
  }
  if (renderNote.tieStop) {
    classes.push('track-card__note--tie-stop')
  }
  return classes.join(' ')
}

export { formatBeatInMeasure }
