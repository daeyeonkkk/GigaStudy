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

type NoteDurationGlyph = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'

type TrackRenderModel = {
  beatsPerMeasure: number
  measureCount: number
  beatGuideOffsets: number[]
  measureBoundaryOffsets: number[]
  notes: TrackRenderNote[]
}

const SAME_ONSET_CLUSTER_EPSILON_BEATS = 0.035
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

function parsePitchLabel(label: string): { octave: number; semitone: number } | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/u.exec(label.trim())
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
    semitone: ((semitone % 12) + 12) % 12,
  }
}

function getNoteFrequency(label: string): number | null {
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

function getMeasureIndexFromDisplayBeat(displayBeat: number, beatsPerMeasure: number): number {
  const normalizedBeat = Math.max(1, displayBeat)
  return Math.floor((normalizedBeat - 1) / Math.max(0.25, beatsPerMeasure))
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
    whole: 'whole note',
    half: 'half note',
    quarter: 'quarter note',
    eighth: 'eighth note',
    sixteenth: 'sixteenth note',
  }
  const rounded = Math.round(durationBeats * 100) / 100
  return `${labels[glyph]} - ${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} beats`
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
    tieStart: segment.segmentIndex < segmentCount - 1,
    tieStop: segment.segmentIndex > 0,
    clusterIndex: 0,
    clusterSize: 1,
  }))
}

function markExplicitTieContinuations(segments: TrackRenderNote[]): TrackRenderNote[] {
  const marked = segments.map((segment) => ({ ...segment }))
  marked.forEach((segment, index) => {
    if (index === 0 || segment.tieStop) {
      return
    }

    const previousIndex = [...marked]
      .slice(0, index)
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .reverse()
      .find(({ candidate }) => {
        const candidateEnd = candidate.displayBeat + candidate.displayDurationBeats
        return (
          pitchIdentity(candidate.note) === pitchIdentity(segment.note) &&
          Math.abs(candidateEnd - segment.displayBeat) <= 0.06
        )
      })?.candidateIndex

    if (previousIndex === undefined) {
      return
    }
    const previous = marked[previousIndex]
    if (previous.note.is_tied !== true && segment.note.is_tied !== true) {
      return
    }
    marked[previousIndex] = { ...previous, tieStart: true }
    marked[index] = { ...segment, tieStop: true }
  })
  return marked
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
  const totalQuarterBeats = measureCount * beatsPerMeasure
  const beatGuideOffsets = Array.from({ length: Math.floor(totalQuarterBeats) + 1 }, (_, index) => index).filter(
    (beatOffset) => !isMeasureDownbeat(beatOffset, beatsPerMeasure),
  )
  const measureBoundaryOffsets = Array.from({ length: measureCount + 1 }, (_, index) => index * beatsPerMeasure)

  return {
    beatsPerMeasure,
    measureCount,
    beatGuideOffsets,
    measureBoundaryOffsets,
    notes,
  }
}

export { formatBeatInMeasure }
