import type { ExtractionCandidate, ScoreNote } from '../../types/studio'

export function getCandidateDurationSeconds(candidate: ExtractionCandidate): number {
  if (candidate.notes.length === 0) {
    return 0
  }
  return Math.max(...candidate.notes.map((note) => note.onset_seconds + note.duration_seconds))
}

export function getCandidatePitchRange(candidate: ExtractionCandidate): string {
  const pitchedNotes = candidate.notes.filter((note) => note.is_rest !== true)
  if (pitchedNotes.length === 0) {
    return '-'
  }
  const midiNotes = pitchedNotes.filter(
    (note): note is ScoreNote & { pitch_midi: number } =>
      typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi),
  )
  if (midiNotes.length === 0) {
    return [...new Set(pitchedNotes.map((note) => note.label))].slice(0, 3).join(' / ')
  }
  const sorted = [...midiNotes].sort((left, right) => left.pitch_midi - right.pitch_midi)
  return `${sorted[0].label} - ${sorted[sorted.length - 1].label}`
}

export function getCandidatePreviewText(candidate: ExtractionCandidate): string {
  if (candidate.notes.length === 0) {
    return 'no notes'
  }
  return candidate.notes
    .slice(0, 8)
    .map((note) => `${note.label}@${note.beat}`)
    .join(', ')
}
