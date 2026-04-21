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
  clusterIndex: number
  clusterSize: number
}

export type TrackRenderModel = {
  measureCount: number
  measures: number[]
  beatGuideOffsets: number[]
  measureBoundaryOffsets: number[]
  notes: TrackRenderNote[]
  keySignature: KeySignature
  keySignatureMarks: KeySignatureMark[]
  pxPerBeat: number
  measureWidth: number
  timelineWidth: number
}

export type KeySignature = {
  tonic: string
  accidentalCount: number
}

export type KeySignatureMark = {
  symbol: string
  left: number
  top: number
}

export const SCORE_CLEF_GUTTER_PX = 126

const SCORE_END_PADDING_PX = 48
const MIN_SCORE_PX_PER_BEAT = 170
const MAX_SCORE_PX_PER_BEAT = 360
const NOTE_COLLISION_WIDTH_PX = 58
const STAFF_MIDDLE_LINE_Y = 62
const STAFF_STEP_PX = 5
const STAFF_NOTE_MIN_TOP = 18
const STAFF_NOTE_MAX_TOP = 98

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

const MAJOR_KEY_SIGNATURES: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
}

const KEY_TONIC_PITCH_CLASS: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
  Cb: 11,
}

const SHARP_KEY_STEPS: Record<'treble' | 'bass', Array<[string, number]>> = {
  treble: [
    ['F', 5],
    ['C', 5],
    ['G', 5],
    ['D', 5],
    ['A', 4],
    ['E', 5],
    ['B', 4],
  ],
  bass: [
    ['F', 3],
    ['C', 3],
    ['G', 3],
    ['D', 3],
    ['A', 2],
    ['E', 3],
    ['B', 2],
  ],
}

const FLAT_KEY_STEPS: Record<'treble' | 'bass', Array<[string, number]>> = {
  treble: [
    ['B', 4],
    ['E', 5],
    ['A', 4],
    ['D', 5],
    ['G', 4],
    ['C', 5],
    ['F', 4],
  ],
  bass: [
    ['B', 2],
    ['E', 3],
    ['A', 2],
    ['D', 3],
    ['G', 2],
    ['C', 3],
    ['F', 2],
  ],
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

function getMajorScalePitchClasses(tonic: string): number[] {
  const root = KEY_TONIC_PITCH_CLASS[tonic] ?? 0
  return [0, 2, 4, 5, 7, 9, 11].map((interval) => (root + interval) % 12)
}

function getNotePitchClass(note: ScoreNote): number | null {
  if (typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)) {
    return ((note.pitch_midi % 12) + 12) % 12
  }
  return parsePitchLabel(note.label)?.semitone ?? null
}

function estimateKeySignature(notes: ScoreNote[]): KeySignature {
  const pitchClasses = new Set(
    notes
      .filter((note) => note.is_rest !== true)
      .map(getNotePitchClass)
      .filter((pitchClass): pitchClass is number => pitchClass !== null),
  )
  if (pitchClasses.size === 0) {
    return { tonic: 'C', accidentalCount: 0 }
  }

  const scoredKeys = Object.entries(MAJOR_KEY_SIGNATURES)
    .map(([tonic, accidentalCount]) => {
      const scale = getMajorScalePitchClasses(tonic)
      const covered = [...pitchClasses].filter((pitchClass) => scale.includes(pitchClass)).length
      const misses = pitchClasses.size - covered
      return {
        tonic,
        accidentalCount,
        score: covered * 3 - misses * 4 - Math.abs(accidentalCount) * 0.32,
      }
    })
    .sort((left, right) => right.score - left.score || Math.abs(left.accidentalCount) - Math.abs(right.accidentalCount))

  const selected = scoredKeys[0] ?? { tonic: 'C', accidentalCount: 0 }
  return { tonic: selected.tonic, accidentalCount: selected.accidentalCount }
}

function getKeySignatureMarks(slotId: number, signature: KeySignature): KeySignatureMark[] {
  const accidentalCount = Math.max(-7, Math.min(7, signature.accidentalCount))
  if (accidentalCount === 0) {
    return []
  }
  const clef = getStaffClef(slotId)
  const symbol = accidentalCount > 0 ? '#' : 'b'
  const steps = accidentalCount > 0 ? SHARP_KEY_STEPS[clef] : FLAT_KEY_STEPS[clef]
  return steps.slice(0, Math.abs(accidentalCount)).map(([noteName, octave], index) => ({
    symbol,
    left: 68 + index * 9,
    top: getStaffTopFromStep(slotId, getDiatonicStep(noteName, octave)) - 12,
  }))
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

  const densityAwareWidth = NOTE_COLLISION_WIDTH_PX / smallestGap + 18
  return Math.round(Math.max(MIN_SCORE_PX_PER_BEAT, Math.min(MAX_SCORE_PX_PER_BEAT, densityAwareWidth)))
}

function getClusteredRenderNotes(
  notes: ScoreNote[],
  syncOffsetSeconds: number,
  bpm: number,
  pxPerBeat: number,
): TrackRenderNote[] {
  const baseNotes = notes
    .map((note) => ({
      note,
      displayBeat: getDisplayBeat(note, syncOffsetSeconds, bpm),
    }))
    .sort((left, right) => left.displayBeat - right.displayBeat || left.note.id.localeCompare(right.note.id))

  const clustered: TrackRenderNote[] = []
  let currentCluster: Array<{ note: ScoreNote; displayBeat: number }> = []
  const flushCluster = () => {
    const clusterSize = currentCluster.length
    currentCluster.forEach((entry, index) => {
      clustered.push({
        note: entry.note,
        displayBeat: entry.displayBeat,
        clusterIndex: index,
        clusterSize,
      })
    })
    currentCluster = []
  }

  baseNotes.forEach((entry) => {
    const previous = currentCluster[currentCluster.length - 1]
    if (previous && Math.abs(entry.displayBeat - previous.displayBeat) * pxPerBeat > NOTE_COLLISION_WIDTH_PX) {
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
  keyContextNotes: ScoreNote[],
): TrackRenderModel {
  const displayBeats = track.notes.map((note) => getDisplayBeat(note, track.sync_offset_seconds, bpm))
  const pxPerBeat = getScorePxPerBeat(displayBeats)
  const notes = getClusteredRenderNotes(track.notes, track.sync_offset_seconds, bpm, pxPerBeat)
  const keySignature = estimateKeySignature(keyContextNotes.length > 0 ? keyContextNotes : track.notes)
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
  const measureWidth = pxPerBeat * beatsPerMeasure
  const totalQuarterBeats = measureCount * beatsPerMeasure
  const beatGuideOffsets = Array.from({ length: Math.floor(totalQuarterBeats) + 1 }, (_, index) => index).filter(
    (beatOffset) => !isMeasureDownbeat(beatOffset, beatsPerMeasure),
  )
  const measureBoundaryOffsets = Array.from({ length: measureCount + 1 }, (_, index) => index * beatsPerMeasure)

  return {
    measureCount,
    measures: Array.from({ length: measureCount }, (_, index) => index + 1),
    beatGuideOffsets,
    measureBoundaryOffsets,
    notes,
    keySignature,
    keySignatureMarks: getKeySignatureMarks(track.slot_id, keySignature),
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

export function getScoreMeasureLabelStyle(measureIndex: number, model: TrackRenderModel): CSSProperties {
  return {
    '--label-left': `${SCORE_CLEF_GUTTER_PX + (measureIndex - 1) * model.measureWidth + 8}px`,
  } as CSSProperties
}

export function getTimelineNoteStyle(slotId: number, renderNote: TrackRenderNote, model: TrackRenderModel): CSSProperties {
  const clusterOffset = (renderNote.clusterIndex - (renderNote.clusterSize - 1) / 2) * 28
  const rawLeft = SCORE_CLEF_GUTTER_PX + (renderNote.displayBeat - 1) * model.pxPerBeat + clusterOffset
  const maxLeft = model.timelineWidth - SCORE_END_PADDING_PX
  const left = Math.max(26, Math.min(maxLeft, rawLeft))
  return {
    '--note-top': `${getNoteTopPx(slotId, renderNote.note)}px`,
    '--note-left': `${Math.round(left)}px`,
  } as CSSProperties
}

export { formatBeatInMeasure }
