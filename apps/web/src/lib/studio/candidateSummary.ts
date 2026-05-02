import type { ExtractionCandidate, PitchEvent, SourceKind, TrackSlot } from '../../types/studio'
import { formatTrackName } from './labels'

type CandidateMetric = {
  label: string
  value: string
}

type CandidateContourPoint = {
  label: string
  x: number
  y: number
}

type CandidateDecisionSummary = {
  title: string
  headline: string
  support: string
  tags: string[]
  phrasePreview: string
  metrics: CandidateMetric[]
  diagnostics: CandidateMetric[]
  technical: CandidateMetric[]
}

type PitchedCandidateEvent = PitchEvent & { pitch_midi: number }

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
  midi: 'MIDI 가져오기',
  document: '문서 추출',
  music: '음악 파일 추출',
  ai: 'AI 화음',
}

const VOICE_LEADING_PROFILE_LABELS: Record<string, string> = {
  balanced: '균형형',
  lower_support: '저역 보강',
  moving_counterline: '대선율',
  upper_blend: '상성부 블렌드',
  open_voicing: '오픈 보이싱',
}

const RISK_TAG_LABELS: Record<string, string> = {
  range: '음역 검토',
  motion: '진행 검토',
  rhythm: '리듬 검토',
  spacing: '간격 검토',
  tension: '긴장음 검토',
  overlap: '겹침 검토',
  leap: '도약 검토',
}

const HARMONY_GOAL_LABELS: Record<string, string> = {
  rehearsal_safe: '연습 안정형',
  counterline: '대선율',
  open_support: '열린 보강',
  upper_blend: '상성부 블렌드',
  active_motion: '능동 진행',
}

const RHYTHM_POLICY_LABELS: Record<string, string> = {
  follow_context: '문맥 리듬 추종',
  simplify: '리듬 단순화',
  answer_melody: '응답 선율',
  sustain_support: '지속음 보강',
}

function getCandidateDurationSeconds(candidate: ExtractionCandidate): number {
  const events = getCandidateEvents(candidate)
  if (events.length === 0) {
    return 0
  }
  return Math.max(...events.map((event) => event.start_seconds + event.duration_seconds))
}

function getCandidatePitchRange(candidate: ExtractionCandidate): string {
  const pitchedEvents = getPitchedEvents(candidate)
  if (pitchedEvents.length === 0) {
    return '-'
  }
  const midiEvents = getMidiEvents(pitchedEvents)
  if (midiEvents.length === 0) {
    return [...new Set(pitchedEvents.map((event) => event.label))].slice(0, 3).join(' / ')
  }
  const sorted = [...midiEvents].sort((left, right) => left.pitch_midi - right.pitch_midi)
  return `${sorted[0].label} - ${sorted[sorted.length - 1].label}`
}

export function getCandidatePreviewText(candidate: ExtractionCandidate): string {
  const events = getCandidateEvents(candidate)
  if (events.length === 0) {
    return '음표 없음'
  }
  return events
    .slice(0, 8)
    .map((event) => `${event.label}@${event.start_beat}`)
    .join(', ')
}

export function getCandidateDecisionSummary(
  candidate: ExtractionCandidate,
  targetTrack: TrackSlot | null,
  beatsPerMeasure: number,
): CandidateDecisionSummary {
  const events = getCandidateEvents(candidate)
  const pitchedEvents = getPitchedEvents(candidate)
  const midiEvents = getMidiEvents(pitchedEvents)
  const durationSeconds = getCandidateDurationSeconds(candidate)
  const range = getCandidatePitchRange(candidate)
  const register = getRegisterSummary(midiEvents, targetTrack)
  const movement = getMovementSummary(midiEvents)
  const rhythm = getRhythmSummary(events, beatsPerMeasure)
  const contour = getContourSummary(midiEvents)
  const startEnd = getStartEndSummary(pitchedEvents)
  const confidence = `${Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100)}%`
  const diagnostics = getCandidateDiagnostics(candidate)
  const reviewHint = getReviewHintSummary(candidate)
  const llmInsight = getDeepSeekDecisionInsight(candidate)

  if (events.length === 0) {
    return {
      title: '빈 후보',
      headline: '등록할 수 있는 음표가 없습니다.',
      support: '다른 후보를 선택하거나 원본을 다시 확인하세요.',
      tags: ['음표 없음'],
      phrasePreview: '-',
      metrics: [
        { label: '음표', value: '0' },
        { label: '신뢰도', value: confidence },
      ],
      diagnostics,
      technical: [
        { label: '엔진', value: candidate.method },
        { label: '소스', value: candidate.source_label },
        ...getTechnicalDiagnostics(candidate),
      ],
    }
  }

  const sourceLabel = sourceDecisionLabels[candidate.source_kind]
  const title =
    candidate.source_kind === 'ai'
      ? (llmInsight?.title ?? `${register.shortLabel} - ${movement.shortLabel}`)
      : `${sourceLabel} - ${range}`
  const headline =
    candidate.source_kind === 'ai'
      ? (llmInsight?.headline ?? `${formatTrackName(targetTrack?.name)}에 ${register.headline} 후보를 배치합니다.`)
      : `${sourceLabel} 결과를 ${formatTrackName(targetTrack?.name)}에 등록할 수 있습니다.`
  const support = [
    candidate.source_kind === 'ai' && llmInsight?.role ? `역할: ${llmInsight.role}.` : '',
    `음역 ${range}, 시작/끝 ${startEnd}.`,
    `${movement.detail}.`,
    `${rhythm.detail}.`,
    candidate.source_kind === 'ai' && llmInsight?.selectionHint ? `선택 이유: ${llmInsight.selectionHint}` : '',
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
      { label: '음역', value: `${range}${register.averageLabel ? ` - 중심 ${register.averageLabel}` : ''}` },
      { label: '진행', value: `${movement.label} - 도약 ${movement.leapCount}회` },
      { label: '리듬', value: rhythm.label },
      { label: '시작/끝', value: startEnd },
      { label: '신뢰도', value: confidence },
      { label: '길이', value: `${durationSeconds.toFixed(2)}초 - 음표 ${events.length}개` },
    ],
    diagnostics,
    technical: [
      { label: '엔진', value: candidate.method },
      { label: '소스', value: candidate.source_label },
      { label: '원본 미리보기', value: getCandidatePreviewText(candidate) },
      ...getTechnicalDiagnostics(candidate),
    ],
  }
}

export function getCandidateContourPoints(candidate: ExtractionCandidate): CandidateContourPoint[] {
  const midiEvents = getMidiEvents(getPitchedEvents(candidate)).slice(0, 28)
  if (midiEvents.length === 0) {
    return []
  }

  const minMidi = Math.min(...midiEvents.map((event) => event.pitch_midi))
  const maxMidi = Math.max(...midiEvents.map((event) => event.pitch_midi))
  const midiSpan = Math.max(1, maxMidi - minMidi)
  const firstBeat = Math.min(...midiEvents.map((event) => event.start_beat))
  const lastBeat = Math.max(...midiEvents.map((event) => event.start_beat + Math.max(0.25, event.duration_beats)))
  const beatSpan = Math.max(0.25, lastBeat - firstBeat)

  return midiEvents.map((event) => ({
    label: `${event.label}@${event.start_beat}`,
    x: midiEvents.length === 1 ? 50 : ((event.start_beat - firstBeat) / beatSpan) * 100,
    y: 100 - ((event.pitch_midi - minMidi) / midiSpan) * 100,
  }))
}

function getCandidateEvents(candidate: ExtractionCandidate): PitchEvent[] {
  return candidate.region.pitch_events
    .slice()
    .sort((left, right) => left.start_beat - right.start_beat || left.event_id.localeCompare(right.event_id))
}

function getPitchedEvents(candidate: ExtractionCandidate): PitchEvent[] {
  return getCandidateEvents(candidate).filter((event) => event.is_rest !== true)
}

function getMidiEvents(events: PitchEvent[]): PitchedCandidateEvent[] {
  return events.filter(
    (event): event is PitchedCandidateEvent =>
      typeof event.pitch_midi === 'number' && Number.isFinite(event.pitch_midi),
  )
}

function getAverageMidiLabel(midiEvents: PitchedCandidateEvent[]): string {
  if (midiEvents.length === 0) {
    return ''
  }
  return getNearestPitchLabel(midiEvents.reduce((sum, event) => sum + event.pitch_midi, 0) / midiEvents.length)
}

function getNearestPitchLabel(midi: number): string {
  const rounded = Math.round(midi)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pitchClass = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${names[pitchClass]}${octave}`
}

function getRegisterSummary(
  midiEvents: PitchedCandidateEvent[],
  targetTrack: TrackSlot | null,
): { averageLabel: string; headline: string; shortLabel: string; tag: string } {
  if (midiEvents.length === 0) {
    return {
      averageLabel: '',
      headline: '리듬 전용',
      shortLabel: '리듬 전용',
      tag: '리듬 후보',
    }
  }

  const averageMidi = midiEvents.reduce((sum, event) => sum + event.pitch_midi, 0) / midiEvents.length
  const averageLabel = getAverageMidiLabel(midiEvents)
  const targetCenter = TRACK_CENTER_MIDI[targetTrack?.slot_id ?? 0]
  if (!targetCenter) {
    return {
      averageLabel,
      headline: '중심 음역',
      shortLabel: '중심 음역',
      tag: `중심 ${averageLabel}`,
    }
  }

  const delta = averageMidi - targetCenter
  if (delta <= -5) {
    return {
      averageLabel,
      headline: '저역 보강',
      shortLabel: '저역 보강',
      tag: `낮은 중심 ${averageLabel}`,
    }
  }
  if (delta >= 5) {
    return {
      averageLabel,
      headline: '상성부 블렌드',
      shortLabel: '상성부 블렌드',
      tag: `높은 중심 ${averageLabel}`,
    }
  }
  return {
    averageLabel,
    headline: '균형 음역',
    shortLabel: '균형 음역',
    tag: `중심 ${averageLabel}`,
  }
}

function getMovementSummary(midiEvents: PitchedCandidateEvent[]): {
  detail: string
  label: string
  leapCount: number
  shortLabel: string
  tag: string
} {
  if (midiEvents.length < 2) {
    return {
      detail: '음표가 하나라 선율 움직임이 거의 없습니다',
      label: '정적 진행',
      leapCount: 0,
      shortLabel: '정적',
      tag: '움직임 적음',
    }
  }

  const intervals = midiEvents.slice(1).map((event, index) => event.pitch_midi - midiEvents[index].pitch_midi)
  const absoluteIntervals = intervals.map((interval) => Math.abs(interval))
  const averageStep = absoluteIntervals.reduce((sum, interval) => sum + interval, 0) / absoluteIntervals.length
  const leapCount = absoluteIntervals.filter((interval) => interval >= 5).length
  const stepwisePercent = Math.round(
    (absoluteIntervals.filter((interval) => interval <= 2).length / absoluteIntervals.length) * 100,
  )

  if (averageStep <= 1.25) {
    return {
      detail: `대부분 순차 진행입니다(순차 ${stepwisePercent}%)`,
      label: '매끄러운 진행',
      leapCount,
      shortLabel: '매끄러움',
      tag: '순차 진행',
    }
  }
  if (averageStep <= 2.8) {
    return {
      detail: `순차 진행을 중심으로 균형 있게 움직입니다(순차 ${stepwisePercent}%)`,
      label: '균형 진행',
      leapCount,
      shortLabel: '균형',
      tag: '균형 진행',
    }
  }
  return {
    detail: `큰 도약 ${leapCount}회를 포함한 능동적인 윤곽입니다`,
    label: '능동 진행',
    leapCount,
    shortLabel: '능동',
    tag: '능동 진행',
  }
}

function getRhythmSummary(events: PitchEvent[], beatsPerMeasure: number): {
  detail: string
  label: string
  tag: string
} {
  if (events.length === 0) {
    return {
      detail: '리듬 데이터가 없습니다',
      label: '-',
      tag: '리듬 없음',
    }
  }

  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const startBeat = Math.min(...events.map((event) => event.start_beat))
  const endBeat = Math.max(...events.map((event) => event.start_beat + Math.max(0.25, event.duration_beats)))
  const measureSpan = Math.max(1, Math.ceil((endBeat - startBeat) / safeBeatsPerMeasure))
  const eventsPerMeasure = events.length / measureSpan
  const shortestDuration = Math.min(...events.map((event) => Math.max(0.25, event.duration_beats)))

  const densityLabel =
    eventsPerMeasure >= 7 ? '촘촘한 리듬' : eventsPerMeasure >= 4 ? '보통 밀도 리듬' : '여유 있는 리듬'
  return {
    detail: `마디당 ${eventsPerMeasure.toFixed(1)}개 음표, 최단 길이 ${shortestDuration.toFixed(2)}박`,
    label: `${densityLabel} - 마디당 ${eventsPerMeasure.toFixed(1)}개`,
    tag: densityLabel,
  }
}

function getContourSummary(midiEvents: PitchedCandidateEvent[]): { tag: string } {
  if (midiEvents.length < 2) {
    return { tag: '평평한 윤곽' }
  }
  const first = midiEvents[0].pitch_midi
  const last = midiEvents[midiEvents.length - 1].pitch_midi
  if (last - first >= 3) {
    return { tag: '상행 윤곽' }
  }
  if (first - last >= 3) {
    return { tag: '하행 윤곽' }
  }
  return { tag: '수평 윤곽' }
}

function getStartEndSummary(events: PitchEvent[]): string {
  if (events.length === 0) {
    return '-'
  }
  const first = events[0]
  const last = events[events.length - 1]
  return `${first.label}@${first.start_beat} → ${last.label}@${last.start_beat}`
}

function getCandidatePhrasePreview(candidate: ExtractionCandidate): string {
  const events = getPitchedEvents(candidate)
  if (events.length === 0) {
    return getCandidatePreviewText(candidate)
  }

  const labels = events.slice(0, 12).map((event) => event.label)
  const suffix = events.length > labels.length ? ' ...' : ''
  return `${labels.join(' → ')}${suffix}`
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
  const title = candidate.variant_label ? formatGeneratedLabel(candidate.variant_label) : (profileLabel ? `${profileLabel} 후보` : null)
  const headline =
    role && selectionHint
      ? `${role} ${selectionHint}`
      : role || selectionHint || (profileLabel ? `${profileLabel} 방향의 화음 후보입니다.` : null)

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
    metrics.push({ label: '프레이즈 흐름', value: llmPhraseSummary })
  }
  if (llmPlanConfidence !== null) {
    metrics.push({ label: '계획 신뢰도', value: formatRatio(llmPlanConfidence) })
  }
  if (llmRevisionCycles !== null && llmRevisionCycles > 0) {
    metrics.push({ label: '내부 보정', value: `${llmRevisionCycles}회` })
  }
  if (riskTags.length > 0) {
    metrics.push({ label: '검토 신호', value: riskTags.join(', ') })
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
  const eventCount =
    getDiagnosticNumber(diagnostics, 'event_count') ??
    candidate.region.pitch_events.length
  metrics.push({
    label: '감지 결과',
    value: `${measureCount !== null ? `${measureCount}마디` : '마디 확인 필요'} - 음표 ${eventCount}개`,
  })

  const rangeFitRatio = getDiagnosticNumber(diagnostics, 'range_fit_ratio')
  if (rangeFitRatio !== null) {
    metrics.push({ label: '음역 적합도', value: formatRatio(rangeFitRatio) })
  }

  const timingGridRatio = getDiagnosticNumber(diagnostics, 'timing_grid_ratio')
  if (timingGridRatio !== null) {
    metrics.push({ label: '리듬 그리드', value: formatRatio(timingGridRatio) })
  }

  const density = getDiagnosticNumber(diagnostics, 'density_events_per_measure')
  if (density !== null) {
    metrics.push({ label: '밀도', value: `마디당 ${density.toFixed(1)}개` })
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
      few_events: {
        tag: '음표 적음',
        sentence: '감지된 음표 수가 적습니다. 원본이 일부만 들어왔는지 확인하세요.',
      },
      low_event_confidence: {
        tag: '원본 대조',
        sentence: '음표 신뢰도가 낮으므로 원본과 비교하세요.',
      },
      range_outliers: {
        tag: '음역 검토',
        sentence: '일부 음이 목표 트랙의 예상 음역을 벗어납니다. 트랙 배정을 확인하세요.',
      },
      rhythm_grid_review: {
        tag: '리듬 검토',
        sentence: '리듬 그리드가 불안정합니다. 승인 전 타이밍을 확인하세요.',
      },
      partial_document_review: {
        tag: '부분 문서',
        sentence: '문서 일부만 감지되었습니다. 누락된 트랙이 없는지 확인하세요.',
      },
      review_accidentals_and_rhythm: {
        tag: '음정/리듬 검토',
        sentence: '임시표, 붙임줄, 리듬을 원본과 비교하세요.',
      },
      review_against_source: {
        tag: '원본 대조',
        sentence: '승인 전 후보를 원본과 비교하세요.',
      },
    } satisfies Record<string, { tag: string; sentence: string }>
  )[hint] ?? null
}

function getTechnicalDiagnostics(candidate: ExtractionCandidate): CandidateMetric[] {
  const diagnostics = candidate.diagnostics ?? {}
  return [
    getDiagnosticString(diagnostics, 'engine')
      ? { label: '진단 엔진', value: getDiagnosticString(diagnostics, 'engine') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'candidate_method')
      ? { label: '후보 방식', value: getDiagnosticString(diagnostics, 'candidate_method') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'part_name')
      ? { label: '파트 이름', value: getDiagnosticString(diagnostics, 'part_name') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'review_hint')
      ? { label: '검토 힌트', value: getDiagnosticString(diagnostics, 'review_hint') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_provider')
      ? { label: 'LLM 공급자', value: getDiagnosticString(diagnostics, 'llm_provider') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_model')
      ? { label: 'LLM 모델', value: getDiagnosticString(diagnostics, 'llm_model') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_key')
      ? { label: 'LLM 키', value: getDiagnosticString(diagnostics, 'llm_key') ?? '' }
      : null,
    getDiagnosticString(diagnostics, 'llm_mode')
      ? { label: 'LLM 모드', value: getDiagnosticString(diagnostics, 'llm_mode') ?? '' }
      : null,
    getDiagnosticStringList(diagnostics, 'llm_warnings').length > 0
      ? { label: 'LLM 경고', value: getDiagnosticStringList(diagnostics, 'llm_warnings').join(', ') }
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

export function formatGeneratedLabel(value: string): string {
  return value
    .replaceAll('Lower support', '저역 보강')
    .replaceAll('Upper blend', '상성부 블렌드')
    .replaceAll('Balanced', '균형형')
    .replaceAll('stepwise', '순차 진행')
    .replaceAll('active leaps', '도약 진행')
    .replaceAll('gentle motion', '완만한 진행')
    .replaceAll('rising', '상행')
    .replaceAll('falling', '하행')
    .replaceAll('level', '수평')
    .replaceAll('avg', '중심')
    .replaceAll('Candidate', '후보')
    .replaceAll('Groove', '그루브')
    .replaceAll('kick-led', '킥 중심')
    .replaceAll('snare-led', '스네어 중심')
    .replaceAll('balanced', '균형형')
}

function formatRatio(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}
