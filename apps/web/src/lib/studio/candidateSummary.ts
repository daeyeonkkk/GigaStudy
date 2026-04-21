import type { ExtractionCandidate, ScoreNote, SourceKind, TrackSlot } from '../../types/studio'

type CandidateMetric = {
  label: string
  value: string
}

export type CandidateContourPoint = {
  label: string
  x: number
  y: number
}

export type CandidateDecisionSummary = {
  title: string
  headline: string
  support: string
  tags: string[]
  phrasePreview: string
  metrics: CandidateMetric[]
  technical: CandidateMetric[]
}

const TRACK_CENTER_MIDI: Record<number, number> = {
  1: 74,
  2: 67,
  3: 55,
  4: 50,
  5: 43,
  6: 38,
}

const sourceDecisionLabels: Record<SourceKind, string> = {
  recording: '녹음 추출',
  audio: '오디오 추출',
  midi: 'MIDI 파트',
  score: '악보 파트',
  music: '음원 추출',
  ai: 'AI 화음',
}

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

export function getCandidateDecisionSummary(
  candidate: ExtractionCandidate,
  targetTrack: TrackSlot | null,
  beatsPerMeasure: number,
): CandidateDecisionSummary {
  const pitchedNotes = getPitchedNotes(candidate)
  const midiNotes = getMidiNotes(pitchedNotes)
  const durationSeconds = getCandidateDurationSeconds(candidate)
  const range = getCandidatePitchRange(candidate)
  const register = getRegisterSummary(midiNotes, targetTrack)
  const movement = getMovementSummary(midiNotes)
  const rhythm = getRhythmSummary(candidate.notes, beatsPerMeasure)
  const contour = getContourSummary(midiNotes)
  const startEnd = getStartEndSummary(pitchedNotes)
  const confidence = `${Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100)}%`

  if (candidate.notes.length === 0) {
    return {
      title: '비어 있는 후보',
      headline: '등록할 음표가 없습니다.',
      support: '다른 후보를 선택하거나 입력 소스를 다시 확인하세요.',
      tags: ['음표 없음'],
      phrasePreview: '-',
      metrics: [
        { label: '음표', value: '0' },
        { label: '신뢰도', value: confidence },
      ],
      technical: [
        { label: 'engine', value: candidate.method },
        { label: 'source', value: candidate.source_label },
      ],
    }
  }

  const sourceLabel = sourceDecisionLabels[candidate.source_kind]
  const title =
    candidate.source_kind === 'ai'
      ? `${register.shortLabel} · ${movement.shortLabel}`
      : `${sourceLabel} · ${range}`
  const headline =
    candidate.source_kind === 'ai'
      ? `${targetTrack?.name ?? '선택 트랙'}에 ${register.headline} 후보입니다.`
      : `${sourceLabel} 결과를 ${targetTrack?.name ?? '선택 트랙'}에 등록할 수 있습니다.`
  const support = [
    `${range} 범위, ${startEnd}.`,
    `${movement.detail}.`,
    `${rhythm.detail}.`,
  ].join(' ')

  return {
    title,
    headline,
    support,
    tags: [
      sourceLabel,
      register.tag,
      movement.tag,
      rhythm.tag,
      contour.tag,
    ],
    phrasePreview: getCandidatePhrasePreview(candidate),
    metrics: [
      { label: '음역', value: `${range}${register.averageLabel ? ` · 중심 ${register.averageLabel}` : ''}` },
      { label: '움직임', value: `${movement.label} · 도약 ${movement.leapCount}회` },
      { label: '리듬', value: rhythm.label },
      { label: '시작/끝', value: startEnd },
      { label: '신뢰도', value: confidence },
      { label: '길이', value: `${durationSeconds.toFixed(2)}s · ${candidate.notes.length} notes` },
    ],
    technical: [
      { label: 'engine', value: candidate.method },
      { label: 'source', value: candidate.source_label },
      { label: 'raw preview', value: getCandidatePreviewText(candidate) },
    ],
  }
}

export function getCandidateContourPoints(candidate: ExtractionCandidate): CandidateContourPoint[] {
  const midiNotes = getMidiNotes(getPitchedNotes(candidate)).slice(0, 28)
  if (midiNotes.length === 0) {
    return []
  }

  const minMidi = Math.min(...midiNotes.map((note) => note.pitch_midi))
  const maxMidi = Math.max(...midiNotes.map((note) => note.pitch_midi))
  const midiSpan = Math.max(1, maxMidi - minMidi)
  const firstBeat = Math.min(...midiNotes.map((note) => note.beat))
  const lastBeat = Math.max(...midiNotes.map((note) => note.beat + Math.max(0.25, note.duration_beats)))
  const beatSpan = Math.max(0.25, lastBeat - firstBeat)

  return midiNotes.map((note) => ({
    label: `${note.label}@${note.beat}`,
    x: midiNotes.length === 1 ? 50 : ((note.beat - firstBeat) / beatSpan) * 100,
    y: 100 - ((note.pitch_midi - minMidi) / midiSpan) * 100,
  }))
}

function getPitchedNotes(candidate: ExtractionCandidate): ScoreNote[] {
  return candidate.notes
    .filter((note) => note.is_rest !== true)
    .sort((left, right) => left.beat - right.beat || left.id.localeCompare(right.id))
}

function getMidiNotes(notes: ScoreNote[]): Array<ScoreNote & { pitch_midi: number }> {
  return notes.filter(
    (note): note is ScoreNote & { pitch_midi: number } =>
      typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi),
  )
}

function getAverageMidiLabel(midiNotes: Array<ScoreNote & { pitch_midi: number }>): string {
  if (midiNotes.length === 0) {
    return ''
  }
  return getNearestNoteLabel(midiNotes.reduce((sum, note) => sum + note.pitch_midi, 0) / midiNotes.length)
}

function getNearestNoteLabel(midi: number): string {
  const rounded = Math.round(midi)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pitchClass = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${names[pitchClass]}${octave}`
}

function getRegisterSummary(
  midiNotes: Array<ScoreNote & { pitch_midi: number }>,
  targetTrack: TrackSlot | null,
): { averageLabel: string; headline: string; shortLabel: string; tag: string } {
  if (midiNotes.length === 0) {
    return {
      averageLabel: '',
      headline: '리듬 중심의',
      shortLabel: '리듬형',
      tag: '리듬 후보',
    }
  }

  const averageMidi = midiNotes.reduce((sum, note) => sum + note.pitch_midi, 0) / midiNotes.length
  const averageLabel = getAverageMidiLabel(midiNotes)
  const targetCenter = TRACK_CENTER_MIDI[targetTrack?.slot_id ?? 0]
  if (!targetCenter) {
    return {
      averageLabel,
      headline: '중심 음역이 뚜렷한',
      shortLabel: '중심 음역',
      tag: `중심 ${averageLabel}`,
    }
  }

  const delta = averageMidi - targetCenter
  if (delta <= -5) {
    return {
      averageLabel,
      headline: '아래에서 안정적으로 받치는',
      shortLabel: '낮은 받침',
      tag: `낮은 중심 ${averageLabel}`,
    }
  }
  if (delta >= 5) {
    return {
      averageLabel,
      headline: '위쪽으로 밝게 여는',
      shortLabel: '높은 선율',
      tag: `높은 중심 ${averageLabel}`,
    }
  }
  return {
    averageLabel,
    headline: '파트 중심 음역에 가까운',
    shortLabel: '균형 음역',
    tag: `중심 ${averageLabel}`,
  }
}

function getMovementSummary(midiNotes: Array<ScoreNote & { pitch_midi: number }>): {
  detail: string
  label: string
  leapCount: number
  shortLabel: string
  tag: string
} {
  if (midiNotes.length < 2) {
    return {
      detail: '한 음 중심이라 움직임이 거의 없습니다',
      label: '고정형',
      leapCount: 0,
      shortLabel: '고정형',
      tag: '움직임 적음',
    }
  }

  const intervals = midiNotes.slice(1).map((note, index) => note.pitch_midi - midiNotes[index].pitch_midi)
  const absoluteIntervals = intervals.map((interval) => Math.abs(interval))
  const averageStep = absoluteIntervals.reduce((sum, interval) => sum + interval, 0) / absoluteIntervals.length
  const leapCount = absoluteIntervals.filter((interval) => interval >= 5).length
  const stepwisePercent = Math.round(
    (absoluteIntervals.filter((interval) => interval <= 2).length / absoluteIntervals.length) * 100,
  )

  if (averageStep <= 1.25) {
    return {
      detail: `대부분 가까운 음으로 이어집니다(순차 ${stepwisePercent}%)`,
      label: '매우 부드러운 진행',
      leapCount,
      shortLabel: '부드러운 진행',
      tag: '순차 진행',
    }
  }
  if (averageStep <= 2.8) {
    return {
      detail: `순차 진행과 작은 도약이 섞여 있습니다(순차 ${stepwisePercent}%)`,
      label: '균형 잡힌 진행',
      leapCount,
      shortLabel: '균형 진행',
      tag: '균형 진행',
    }
  }
  return {
    detail: `선율 변화가 크고 도약이 ${leapCount}회 있습니다`,
    label: '활동적인 진행',
    leapCount,
    shortLabel: '활동형',
    tag: '활동형',
  }
}

function getRhythmSummary(notes: ScoreNote[], beatsPerMeasure: number): {
  detail: string
  label: string
  tag: string
} {
  if (notes.length === 0) {
    return {
      detail: '리듬 정보가 없습니다',
      label: '-',
      tag: '리듬 없음',
    }
  }

  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const startBeat = Math.min(...notes.map((note) => note.beat))
  const endBeat = Math.max(...notes.map((note) => note.beat + Math.max(0.25, note.duration_beats)))
  const measureSpan = Math.max(1, Math.ceil((endBeat - startBeat) / safeBeatsPerMeasure))
  const notesPerMeasure = notes.length / measureSpan
  const shortestDuration = Math.min(...notes.map((note) => Math.max(0.25, note.duration_beats)))

  const densityLabel =
    notesPerMeasure >= 7 ? '촘촘한 리듬' : notesPerMeasure >= 4 ? '보통 밀도' : '여유 있는 리듬'
  return {
    detail: `마디당 약 ${notesPerMeasure.toFixed(1)}개 음표, 최단 ${shortestDuration.toFixed(2)}박입니다`,
    label: `${densityLabel} · ${notesPerMeasure.toFixed(1)} notes/measure`,
    tag: densityLabel,
  }
}

function getContourSummary(midiNotes: Array<ScoreNote & { pitch_midi: number }>): { tag: string } {
  if (midiNotes.length < 2) {
    return { tag: '수평 흐름' }
  }
  const first = midiNotes[0].pitch_midi
  const last = midiNotes[midiNotes.length - 1].pitch_midi
  if (last - first >= 3) {
    return { tag: '상행 종지' }
  }
  if (first - last >= 3) {
    return { tag: '하행 종지' }
  }
  return { tag: '수평 종지' }
}

function getStartEndSummary(notes: ScoreNote[]): string {
  if (notes.length === 0) {
    return '-'
  }
  const first = notes[0]
  const last = notes[notes.length - 1]
  return `${first.label}@${first.beat} -> ${last.label}@${last.beat}`
}

function getCandidatePhrasePreview(candidate: ExtractionCandidate): string {
  const notes = getPitchedNotes(candidate)
  if (notes.length === 0) {
    return getCandidatePreviewText(candidate)
  }

  const labels = notes.slice(0, 12).map((note) => note.label)
  const suffix = notes.length > labels.length ? ' ...' : ''
  return `${labels.join(' -> ')}${suffix}`
}
