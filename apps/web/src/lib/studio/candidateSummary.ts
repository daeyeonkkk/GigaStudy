import type { ExtractionCandidate, PitchEvent, SourceKind, TrackSlot } from '../../types/studio'

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
  recording: 'Recording extraction',
  audio: 'Audio extraction',
  midi: 'MIDI import',
  document: 'Document extraction',
  music: 'Music import',
  ai: 'AI harmony',
}

const VOICE_LEADING_PROFILE_LABELS: Record<string, string> = {
  balanced: 'Balanced',
  lower_support: 'Lower support',
  moving_counterline: 'Moving counterline',
  upper_blend: 'Upper blend',
  open_voicing: 'Open voicing',
}

const RISK_TAG_LABELS: Record<string, string> = {
  range: 'Range review',
  motion: 'Motion review',
  rhythm: 'Rhythm review',
  spacing: 'Spacing review',
  tension: 'Tension review',
  overlap: 'Overlap review',
  leap: 'Leap review',
}

const HARMONY_GOAL_LABELS: Record<string, string> = {
  rehearsal_safe: 'Rehearsal safe',
  counterline: 'Counterline',
  open_support: 'Open support',
  upper_blend: 'Upper blend',
  active_motion: 'Active motion',
}

const RHYTHM_POLICY_LABELS: Record<string, string> = {
  follow_context: 'Follow context',
  simplify: 'Simplify rhythm',
  answer_melody: 'Answer melody',
  sustain_support: 'Sustain support',
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
    return 'no events'
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
      title: 'Empty candidate',
      headline: 'No pitch events are available for registration.',
      support: 'Choose another candidate or check the imported source again.',
      tags: ['No events'],
      phrasePreview: '-',
      metrics: [
        { label: 'Events', value: '0' },
        { label: 'Confidence', value: confidence },
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
      ? (llmInsight?.title ?? `${register.shortLabel} - ${movement.shortLabel}`)
      : `${sourceLabel} - ${range}`
  const headline =
    candidate.source_kind === 'ai'
      ? (llmInsight?.headline ?? `${targetTrack?.name ?? 'Selected track'} receives a ${register.headline} candidate.`)
      : `${sourceLabel} can be registered to ${targetTrack?.name ?? 'the selected track'}.`
  const support = [
    candidate.source_kind === 'ai' && llmInsight?.role ? `Role: ${llmInsight.role}.` : '',
    `${range} range, ${startEnd}.`,
    `${movement.detail}.`,
    `${rhythm.detail}.`,
    candidate.source_kind === 'ai' && llmInsight?.selectionHint ? `Selection: ${llmInsight.selectionHint}` : '',
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
      { label: 'Range', value: `${range}${register.averageLabel ? ` - center ${register.averageLabel}` : ''}` },
      { label: 'Motion', value: `${movement.label} - ${movement.leapCount} leaps` },
      { label: 'Rhythm', value: rhythm.label },
      { label: 'Start/end', value: startEnd },
      { label: 'Confidence', value: confidence },
      { label: 'Length', value: `${durationSeconds.toFixed(2)}s - ${events.length} events` },
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
      headline: 'rhythm-only',
      shortLabel: 'Rhythm only',
      tag: 'Rhythm candidate',
    }
  }

  const averageMidi = midiEvents.reduce((sum, event) => sum + event.pitch_midi, 0) / midiEvents.length
  const averageLabel = getAverageMidiLabel(midiEvents)
  const targetCenter = TRACK_CENTER_MIDI[targetTrack?.slot_id ?? 0]
  if (!targetCenter) {
    return {
      averageLabel,
      headline: 'center-range',
      shortLabel: 'Center range',
      tag: `Center ${averageLabel}`,
    }
  }

  const delta = averageMidi - targetCenter
  if (delta <= -5) {
    return {
      averageLabel,
      headline: 'lower-register support',
      shortLabel: 'Lower support',
      tag: `Lower center ${averageLabel}`,
    }
  }
  if (delta >= 5) {
    return {
      averageLabel,
      headline: 'upper-register blend',
      shortLabel: 'Upper blend',
      tag: `Upper center ${averageLabel}`,
    }
  }
  return {
    averageLabel,
    headline: 'balanced-register',
    shortLabel: 'Balanced range',
    tag: `Center ${averageLabel}`,
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
      detail: 'Single pitched event, almost no melodic motion',
      label: 'Static',
      leapCount: 0,
      shortLabel: 'Static',
      tag: 'Low motion',
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
      detail: `Mostly stepwise motion (${stepwisePercent}% stepwise)`,
      label: 'Very smooth motion',
      leapCount,
      shortLabel: 'Smooth',
      tag: 'Stepwise',
    }
  }
  if (averageStep <= 2.8) {
    return {
      detail: `Balanced motion with stepwise anchors (${stepwisePercent}% stepwise)`,
      label: 'Balanced motion',
      leapCount,
      shortLabel: 'Balanced',
      tag: 'Balanced motion',
    }
  }
  return {
    detail: `Active contour with ${leapCount} larger leaps`,
    label: 'Active motion',
    leapCount,
    shortLabel: 'Active',
    tag: 'Active motion',
  }
}

function getRhythmSummary(events: PitchEvent[], beatsPerMeasure: number): {
  detail: string
  label: string
  tag: string
} {
  if (events.length === 0) {
    return {
      detail: 'No rhythm data',
      label: '-',
      tag: 'No rhythm',
    }
  }

  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  const startBeat = Math.min(...events.map((event) => event.start_beat))
  const endBeat = Math.max(...events.map((event) => event.start_beat + Math.max(0.25, event.duration_beats)))
  const measureSpan = Math.max(1, Math.ceil((endBeat - startBeat) / safeBeatsPerMeasure))
  const eventsPerMeasure = events.length / measureSpan
  const shortestDuration = Math.min(...events.map((event) => Math.max(0.25, event.duration_beats)))

  const densityLabel =
    eventsPerMeasure >= 7 ? 'Dense rhythm' : eventsPerMeasure >= 4 ? 'Moderate rhythm' : 'Open rhythm'
  return {
    detail: `${eventsPerMeasure.toFixed(1)} events per measure, shortest duration ${shortestDuration.toFixed(2)} beats`,
    label: `${densityLabel} - ${eventsPerMeasure.toFixed(1)} events/measure`,
    tag: densityLabel,
  }
}

function getContourSummary(midiEvents: PitchedCandidateEvent[]): { tag: string } {
  if (midiEvents.length < 2) {
    return { tag: 'Flat contour' }
  }
  const first = midiEvents[0].pitch_midi
  const last = midiEvents[midiEvents.length - 1].pitch_midi
  if (last - first >= 3) {
    return { tag: 'Rising contour' }
  }
  if (first - last >= 3) {
    return { tag: 'Falling contour' }
  }
  return { tag: 'Level contour' }
}

function getStartEndSummary(events: PitchEvent[]): string {
  if (events.length === 0) {
    return '-'
  }
  const first = events[0]
  const last = events[events.length - 1]
  return `${first.label}@${first.start_beat} -> ${last.label}@${last.start_beat}`
}

function getCandidatePhrasePreview(candidate: ExtractionCandidate): string {
  const events = getPitchedEvents(candidate)
  if (events.length === 0) {
    return getCandidatePreviewText(candidate)
  }

  const labels = events.slice(0, 12).map((event) => event.label)
  const suffix = events.length > labels.length ? ' ...' : ''
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
  const title = candidate.variant_label || (profileLabel ? `${profileLabel} candidate` : null)
  const headline =
    role && selectionHint
      ? `${role} ${selectionHint}`
      : role || selectionHint || (profileLabel ? `${profileLabel} direction for the generated harmony candidate.` : null)

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
    metrics.push({ label: 'Generation direction', value: formatVoiceLeadingProfile(llmProfile) })
  }
  if (llmGoal) {
    metrics.push({ label: 'Candidate goal', value: formatHarmonyGoal(llmGoal) })
  }
  if (llmRhythmPolicy) {
    metrics.push({ label: 'Rhythm policy', value: formatRhythmPolicy(llmRhythmPolicy) })
  }
  if (llmRole) {
    metrics.push({ label: 'Harmony role', value: llmRole })
  }
  if (llmSelectionHint) {
    metrics.push({ label: 'Selection reason', value: llmSelectionHint })
  }
  if (llmPhraseSummary) {
    metrics.push({ label: 'Phrase flow', value: llmPhraseSummary })
  }
  if (llmPlanConfidence !== null) {
    metrics.push({ label: 'Plan confidence', value: formatRatio(llmPlanConfidence) })
  }
  if (llmRevisionCycles !== null && llmRevisionCycles > 0) {
    metrics.push({ label: 'Internal revisions', value: `${llmRevisionCycles}` })
  }
  if (riskTags.length > 0) {
    metrics.push({ label: 'Review signs', value: riskTags.join(', ') })
  }

  const documentPageCount = getDiagnosticNumber(diagnostics, 'document_page_count')
  const candidatePageCount = getDiagnosticNumber(diagnostics, 'candidate_page_count')
  if (documentPageCount !== null || candidatePageCount !== null) {
    metrics.push({
      label: 'Pages',
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
    label: 'Detected',
    value: `${measureCount !== null ? `${measureCount} measures` : 'measure review'} - ${eventCount} events`,
  })

  const rangeFitRatio = getDiagnosticNumber(diagnostics, 'range_fit_ratio')
  if (rangeFitRatio !== null) {
    metrics.push({ label: 'Range fit', value: formatRatio(rangeFitRatio) })
  }

  const timingGridRatio = getDiagnosticNumber(diagnostics, 'timing_grid_ratio')
  if (timingGridRatio !== null) {
    metrics.push({ label: 'Rhythm grid', value: formatRatio(timingGridRatio) })
  }

  const density = getDiagnosticNumber(diagnostics, 'density_events_per_measure')
  if (density !== null) {
    metrics.push({ label: 'Density', value: `${density.toFixed(1)} events/measure` })
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
        tag: 'Few events',
        sentence: 'Only a small number of events were detected; check whether the source was incomplete.',
      },
      low_event_confidence: {
        tag: 'Source review',
        sentence: 'Event-level confidence is low, so compare this candidate with the source.',
      },
      range_outliers: {
        tag: 'Range review',
        sentence: 'Some pitches sit outside the expected track range; confirm the track assignment.',
      },
      rhythm_grid_review: {
        tag: 'Rhythm review',
        sentence: 'The rhythm grid looks unstable; check the timing before approval.',
      },
      partial_document_review: {
        tag: 'Partial document',
        sentence: 'Only part of the document was detected; confirm missing tracks before approval.',
      },
      review_accidentals_and_rhythm: {
        tag: 'Pitch/rhythm review',
        sentence: 'Compare accidentals, ties, and rhythm against the source.',
      },
      review_against_source: {
        tag: 'Source review',
        sentence: 'Compare the candidate with the source before approval.',
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
