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
  diagnostics: CandidateMetric[]
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

const VOICE_LEADING_PROFILE_LABELS: Record<string, string> = {
  balanced: '균형형',
  lower_support: '낮은 받침',
  moving_counterline: '대선율',
  upper_blend: '위성부 블렌드',
  open_voicing: '넓은 간격',
}

const RISK_TAG_LABELS: Record<string, string> = {
  range: '음역 확인',
  motion: '진행 확인',
  rhythm: '리듬 확인',
  spacing: '간격 확인',
  tension: '긴장도 확인',
  overlap: '성부 겹침 확인',
  leap: '도약 확인',
}

const HARMONY_GOAL_LABELS: Record<string, string> = {
  rehearsal_safe: '연습 안정형',
  counterline: '대선율형',
  open_support: '넓은 받침',
  upper_blend: '위성부 블렌드',
  active_motion: '움직임 강조',
}

const RHYTHM_POLICY_LABELS: Record<string, string> = {
  follow_context: '기존 리듬 추종',
  simplify: '읽기 쉽게 단순화',
  answer_melody: '멜로디 응답',
  sustain_support: '길게 받치기',
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
  const diagnostics = getCandidateDiagnostics(candidate)
  const reviewHint = getReviewHintSummary(candidate)
  const llmInsight = getDeepSeekDecisionInsight(candidate)

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
      diagnostics,
      technical: [
        { label: 'engine', value: candidate.method },
        { label: 'source', value: candidate.source_label },
        ...getTechnicalDiagnostics(candidate),
      ],
    }
  }

  const sourceLabel = sourceDecisionLabels[candidate.source_kind]
  const title =
    candidate.source_kind === 'ai'
      ? (llmInsight?.title ?? `${register.shortLabel} · ${movement.shortLabel}`)
      : `${sourceLabel} · ${range}`
  const headline =
    candidate.source_kind === 'ai'
      ? (llmInsight?.headline ?? `${targetTrack?.name ?? '선택 트랙'}에 ${register.headline} 후보입니다.`)
      : `${sourceLabel} 결과를 ${targetTrack?.name ?? '선택 트랙'}에 등록할 수 있습니다.`
  const support = [
    candidate.source_kind === 'ai' && llmInsight?.role ? `역할: ${llmInsight.role}.` : '',
    `${range} 범위, ${startEnd}.`,
    `${movement.detail}.`,
    `${rhythm.detail}.`,
    candidate.source_kind === 'ai' && llmInsight?.selectionHint ? `선택 기준: ${llmInsight.selectionHint}` : '',
    reviewHint?.sentence ?? '',
  ]
    .filter((sentence) => sentence.length > 0)
    .join(' ')

  return {
    title,
    headline,
    support,
    tags: [
      sourceLabel,
      llmInsight?.profileLabel ?? '',
      register.tag,
      movement.tag,
      rhythm.tag,
      contour.tag,
      ...(llmInsight?.riskTags ?? []),
      reviewHint?.tag ?? '',
    ].filter((tag) => tag.length > 0),
    phrasePreview: getCandidatePhrasePreview(candidate),
    metrics: [
      { label: '음역', value: `${range}${register.averageLabel ? ` · 중심 ${register.averageLabel}` : ''}` },
      { label: '움직임', value: `${movement.label} · 도약 ${movement.leapCount}회` },
      { label: '리듬', value: rhythm.label },
      { label: '시작/끝', value: startEnd },
      { label: '신뢰도', value: confidence },
      { label: '길이', value: `${durationSeconds.toFixed(2)}s · ${candidate.notes.length} notes` },
    ],
    diagnostics,
    technical: [
      { label: 'engine', value: candidate.method },
      { label: 'source', value: candidate.source_label },
      { label: 'raw preview', value: getCandidatePreviewText(candidate) },
      ...getTechnicalDiagnostics(candidate),
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

function getDeepSeekDecisionInsight(candidate: ExtractionCandidate): {
  headline: string | null
  profileLabel: string
  riskTags: string[]
  role: string | null
  selectionHint: string | null
  title: string | null
} | null {
  if (candidate.source_kind !== 'ai') {
    return null
  }
  const diagnostics = candidate.diagnostics ?? {}
  const profileName = getDiagnosticString(diagnostics, 'llm_profile')
  const profileLabel = profileName ? formatVoiceLeadingProfile(profileName) : ''
  const role = getDiagnosticString(diagnostics, 'candidate_role')
  const selectionHint = getDiagnosticString(diagnostics, 'selection_hint')
  const riskTags = getDiagnosticStringList(diagnostics, 'risk_tags').map(formatRiskTag)
  const title = candidate.variant_label || (profileLabel ? `${profileLabel} 후보` : null)
  const headline =
    role && selectionHint
      ? `${role} ${selectionHint}`
      : role || selectionHint || (profileLabel ? `${profileLabel} 방향으로 만든 화음 후보입니다.` : null)

  if (!profileLabel && !role && !selectionHint && riskTags.length === 0 && !title) {
    return null
  }
  return { headline, profileLabel, riskTags, role, selectionHint, title }
}

function getCandidateDiagnostics(candidate: ExtractionCandidate): CandidateMetric[] {
  const diagnostics = candidate.diagnostics ?? {}
  const metrics: CandidateMetric[] = []
  const llmRole = getDiagnosticString(diagnostics, 'candidate_role')
  const llmSelectionHint = getDiagnosticString(diagnostics, 'selection_hint')
  const llmProfile = getDiagnosticString(diagnostics, 'llm_profile')
  const llmGoal = getDiagnosticString(diagnostics, 'llm_goal')
  const llmRhythmPolicy = getDiagnosticString(diagnostics, 'llm_rhythm_policy')
  const llmPhraseSummary = getDiagnosticString(diagnostics, 'llm_phrase_summary')
  const llmPlanConfidence = getDiagnosticNumber(diagnostics, 'llm_plan_confidence')
  const llmRevisionCycles = getDiagnosticNumber(diagnostics, 'llm_revision_cycles')
  const riskTags = getDiagnosticStringList(diagnostics, 'risk_tags').map(formatRiskTag)

  if (llmProfile) {
    metrics.push({ label: '생성 방향', value: formatVoiceLeadingProfile(llmProfile) })
  }
  if (llmGoal) {
    metrics.push({ label: '후보 목표', value: formatHarmonyGoal(llmGoal) })
  }
  if (llmRhythmPolicy) {
    metrics.push({ label: '리듬 정책', value: formatRhythmPolicy(llmRhythmPolicy) })
  }
  if (llmRole) {
    metrics.push({ label: '화음 역할', value: llmRole })
  }
  if (llmSelectionHint) {
    metrics.push({ label: '선택 이유', value: llmSelectionHint })
  }
  if (llmPhraseSummary) {
    metrics.push({ label: '곡 흐름', value: llmPhraseSummary })
  }
  if (llmPlanConfidence !== null) {
    metrics.push({ label: '계획 신뢰도', value: formatRatio(llmPlanConfidence) })
  }
  if (llmRevisionCycles !== null && llmRevisionCycles > 0) {
    metrics.push({ label: '내부 수정', value: `${llmRevisionCycles}회` })
  }
  if (riskTags.length > 0) {
    metrics.push({ label: '확인 포인트', value: riskTags.join(', ') })
  }

  const documentPageCount = getDiagnosticNumber(diagnostics, 'document_page_count')
  const candidatePageCount = getDiagnosticNumber(diagnostics, 'candidate_page_count')
  if (documentPageCount !== null || candidatePageCount !== null) {
    metrics.push({
      label: '페이지',
      value:
        documentPageCount !== null && candidatePageCount !== null
          ? `${candidatePageCount}/${documentPageCount}`
          : `${candidatePageCount ?? documentPageCount}`,
    })
  }

  const measureCount = getDiagnosticNumber(diagnostics, 'measure_count')
  const noteCount = getDiagnosticNumber(diagnostics, 'note_count') ?? candidate.notes.length
  metrics.push({
    label: '감지량',
    value: `${measureCount !== null ? `${measureCount}마디` : '마디 확인'} · ${noteCount} notes`,
  })

  const rangeFitRatio = getDiagnosticNumber(diagnostics, 'range_fit_ratio')
  if (rangeFitRatio !== null) {
    metrics.push({ label: '음역 적합', value: formatRatio(rangeFitRatio) })
  }

  const timingGridRatio = getDiagnosticNumber(diagnostics, 'timing_grid_ratio')
  if (timingGridRatio !== null) {
    metrics.push({ label: '리듬 격자', value: formatRatio(timingGridRatio) })
  }

  const density = getDiagnosticNumber(diagnostics, 'density_notes_per_measure')
  if (density !== null) {
    metrics.push({ label: '밀도', value: `${density.toFixed(1)} notes/measure` })
  }

  return metrics
}

function getReviewHintSummary(candidate: ExtractionCandidate): { tag: string; sentence: string } | null {
  const hint = getDiagnosticString(candidate.diagnostics ?? {}, 'review_hint')
  if (!hint) {
    return null
  }
  return (
    {
      few_notes: {
        tag: '음표 수 적음',
        sentence: '음표 수가 적어 파트 누락 여부를 확인하세요.',
      },
      low_note_confidence: {
        tag: '원본 대조 필요',
        sentence: '음표별 신뢰도가 낮아 원본 대조가 필요합니다.',
      },
      range_outliers: {
        tag: '음역 확인',
        sentence: '파트 음역 밖 음이 있어 트랙 배정을 확인하세요.',
      },
      rhythm_grid_review: {
        tag: '박자 확인',
        sentence: '리듬 격자가 불안정해 박자 판독을 확인하세요.',
      },
      partial_score_review: {
        tag: '파트 누락 확인',
        sentence: '일부 파트만 감지되어 누락 파트를 확인하세요.',
      },
      review_accidentals_and_rhythm: {
        tag: '조표/리듬 확인',
        sentence: '조표, 임시표, 리듬을 원본과 대조하세요.',
      },
      review_against_source: {
        tag: '원본 대조',
        sentence: '원본과 대조한 뒤 승인하세요.',
      },
    } satisfies Record<string, { tag: string; sentence: string }>
  )[hint] ?? null
}

function getTechnicalDiagnostics(candidate: ExtractionCandidate): CandidateMetric[] {
  const diagnostics = candidate.diagnostics ?? {}
  return [
    getDiagnosticString(diagnostics, 'engine')
      ? { label: 'diagnostic engine', value: getDiagnosticString(diagnostics, 'engine') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'candidate_method')
      ? { label: 'candidate method', value: getDiagnosticString(diagnostics, 'candidate_method') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'part_name')
      ? { label: 'part name', value: getDiagnosticString(diagnostics, 'part_name') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'review_hint')
      ? { label: 'review hint', value: getDiagnosticString(diagnostics, 'review_hint') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_provider')
      ? { label: 'llm provider', value: getDiagnosticString(diagnostics, 'llm_provider') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_model')
      ? { label: 'llm model', value: getDiagnosticString(diagnostics, 'llm_model') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_key')
      ? { label: 'llm key', value: getDiagnosticString(diagnostics, 'llm_key') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_mode')
      ? { label: 'llm mode', value: getDiagnosticString(diagnostics, 'llm_mode') ?? '' }
      : null,
    getDiagnosticStringList(diagnostics, 'llm_warnings').length > 0
      ? { label: 'llm warnings', value: getDiagnosticStringList(diagnostics, 'llm_warnings').join(', ') }
      : null,
  ].filter((metric): metric is CandidateMetric => metric !== null)
}

function getDiagnosticNumber(diagnostics: Record<string, unknown>, key: string): number | null {
  const value = diagnostics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getDiagnosticString(diagnostics: Record<string, unknown>, key: string): string | null {
  const value = diagnostics[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getDiagnosticStringList(diagnostics: Record<string, unknown>, key: string): string[] {
  const value = diagnostics[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function formatVoiceLeadingProfile(profileName: string): string {
  return VOICE_LEADING_PROFILE_LABELS[profileName] ?? profileName
}

function formatRiskTag(tag: string): string {
  return RISK_TAG_LABELS[tag] ?? tag
}

function formatHarmonyGoal(goal: string): string {
  return HARMONY_GOAL_LABELS[goal] ?? goal
}

function formatRhythmPolicy(policy: string): string {
  return RHYTHM_POLICY_LABELS[policy] ?? policy
}

function formatRatio(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}
