import type { CSSProperties } from 'react'

import {
  formatGeneratedLabel,
  formatSourceLabel,
  formatTrackName,
  getCandidateDecisionSummary,
  getPitchEventRange,
  getPitchedEvents,
  sourceLabels,
  statusLabels,
  STUDIO_TIME_PRECISION_SECONDS,
} from '../../lib/studio'
import type { ExtractionCandidate, PitchEvent, TrackSlot } from '../../types/studio'
import './CandidateReviewPanel.css'

type CandidateReviewPanelProps = {
  beatsPerMeasure: number
  busy: boolean
  candidateOverwriteApprovals: Record<string, boolean>
  candidates: ExtractionCandidate[]
  lockedSlotIds: Set<number>
  tracks: TrackSlot[]
  candidateWouldOverwrite: (candidate: ExtractionCandidate) => boolean
  getJobSourcePreviewUrl?: (jobId: string) => string
  getSelectedCandidateSlotId: (candidate: ExtractionCandidate) => number
  onApproveCandidate: (candidate: ExtractionCandidate) => void
  onRejectCandidate: (candidate: ExtractionCandidate) => void
  onUpdateCandidateOverwriteApproval: (candidate: ExtractionCandidate, allowOverwrite: boolean) => void
  onUpdateCandidateTargetSlot: (candidate: ExtractionCandidate, targetSlotId: number) => void
}

type CandidateVerdict = {
  label: string
  reason: string
  tone: 'recommended' | 'review' | 'retry'
}

type CandidateFact = {
  label: string
  value: string
}

type CandidateTimelineBounds = {
  durationSeconds: number
  startSeconds: number
}

function getEventTimelinePercent(seconds: number, startSeconds: number, durationSeconds: number): number {
  return Math.max(
    0,
    Math.min(100, ((seconds - startSeconds) / Math.max(STUDIO_TIME_PRECISION_SECONDS, durationSeconds)) * 100),
  )
}

function getEventTopPercent(event: PitchEvent, events: PitchEvent[]): number {
  const pitchRange = getPitchEventRange(events)
  const midi = typeof event.pitch_midi === 'number' ? event.pitch_midi : pitchRange.minMidi
  const span = Math.max(1, pitchRange.maxMidi - pitchRange.minMidi)
  return Math.max(4, Math.min(86, ((pitchRange.maxMidi - midi) / span) * 82 + 4))
}

function getCandidateEventStyle(
  event: PitchEvent,
  events: PitchEvent[],
  bounds: CandidateTimelineBounds,
): CSSProperties {
  return {
    '--candidate-event-left': `${getEventTimelinePercent(
      event.start_seconds,
      bounds.startSeconds,
      bounds.durationSeconds,
    )}%`,
    '--candidate-event-top': `${getEventTopPercent(event, events)}%`,
    '--candidate-event-width': `${getEventTimelinePercent(
      event.start_seconds + event.duration_seconds,
      event.start_seconds,
      bounds.durationSeconds,
    )}%`,
  } as CSSProperties
}

function getApproveButtonLabel(wouldOverwrite: boolean, allowOverwrite: boolean): string {
  if (!wouldOverwrite) {
    return '등록'
  }
  return allowOverwrite ? '교체 등록' : '교체 확인 필요'
}

function getCandidateSourceText(candidate: ExtractionCandidate): string {
  const base = candidate.source_kind === 'ai' ? 'AI 생성 후보' : `${sourceLabels[candidate.source_kind]} 후보`
  return candidate.variant_label ? `${base} · ${formatGeneratedLabel(candidate.variant_label)}` : base
}

function getCandidateEventCount(candidate: ExtractionCandidate): number {
  return candidate.region.pitch_events.filter((event) => event.is_rest !== true).length
}

function getCandidateDurationSeconds(candidate: ExtractionCandidate): number {
  const events = getPitchedEvents(candidate.region.pitch_events)
  if (events.length === 0) {
    return Math.max(0, candidate.region.duration_seconds)
  }
  const endSeconds = Math.max(...events.map((event) => event.start_seconds + Math.max(0, event.duration_seconds)))
  return Math.max(candidate.region.duration_seconds, endSeconds - candidate.region.start_seconds)
}

function getCandidateTimelineBounds(candidate: ExtractionCandidate, events: PitchEvent[]): CandidateTimelineBounds {
  if (events.length === 0) {
    return {
      durationSeconds: Math.max(STUDIO_TIME_PRECISION_SECONDS, candidate.region.duration_seconds),
      startSeconds: candidate.region.start_seconds,
    }
  }

  const eventStart = Math.min(...events.map((event) => event.start_seconds))
  const eventEnd = Math.max(...events.map((event) => event.start_seconds + Math.max(0, event.duration_seconds)))
  const startSeconds = Math.min(candidate.region.start_seconds, eventStart)
  const endSeconds = Math.max(candidate.region.start_seconds + candidate.region.duration_seconds, eventEnd)
  return {
    durationSeconds: Math.max(STUDIO_TIME_PRECISION_SECONDS, endSeconds - startSeconds),
    startSeconds,
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)}초`
  }
  return `${Math.round(seconds)}초`
}

function getDecisionFacts(decisionSummary: ReturnType<typeof getCandidateDecisionSummary>): CandidateFact[] {
  const preferredOrder = ['분량', '대상', '음역', '움직임', '리듬', '시작/끝', '구간', '음표']
  const byLabel = new Map(decisionSummary.metrics.map((metric) => [metric.label, metric]))
  const ordered = preferredOrder
    .map((label) => byLabel.get(label))
    .filter((metric): metric is CandidateFact => Boolean(metric))

  if (ordered.length >= 4) {
    return ordered.slice(0, 4)
  }

  const orderedLabels = new Set(ordered.map((metric) => metric.label))
  return [...ordered, ...decisionSummary.metrics.filter((metric) => !orderedLabels.has(metric.label))].slice(0, 4)
}

function getCandidatePills(decisionSummary: ReturnType<typeof getCandidateDecisionSummary>): string[] {
  const blocked = new Set(['AI 화음', 'AI 생성', 'MIDI 가져오기', '문서 추출', '오디오 추출', '녹음 추출'])
  return decisionSummary.tags.filter((tag) => tag.length > 0 && !blocked.has(tag)).slice(0, 6)
}

function CandidateTargetControls({
  busy,
  candidate,
  selectedSlotId,
  targetTrack,
  tracks,
  wouldOverwrite,
  allowOverwrite,
  onUpdateCandidateOverwriteApproval,
  onUpdateCandidateTargetSlot,
}: {
  busy: boolean
  candidate: ExtractionCandidate
  selectedSlotId: number
  targetTrack: TrackSlot | undefined
  tracks: TrackSlot[]
  wouldOverwrite: boolean
  allowOverwrite: boolean
  onUpdateCandidateOverwriteApproval: (candidate: ExtractionCandidate, allowOverwrite: boolean) => void
  onUpdateCandidateTargetSlot: (candidate: ExtractionCandidate, targetSlotId: number) => void
}) {
  const targetName = formatTrackName(targetTrack?.name ?? `트랙 ${selectedSlotId}`)

  return (
    <div className="candidate-review__target">
      <label>
        <span>등록할 트랙</span>
        <select
          data-testid={`candidate-target-${candidate.candidate_id}`}
          disabled={busy}
          value={selectedSlotId}
          onChange={(event) => onUpdateCandidateTargetSlot(candidate, Number(event.target.value))}
        >
          {tracks.map((track) => (
            <option key={track.slot_id} value={track.slot_id}>
              {String(track.slot_id).padStart(2, '0')} {formatTrackName(track.name)} - {statusLabels[track.status]}
            </option>
          ))}
        </select>
      </label>
      {wouldOverwrite ? (
        <label className="candidate-review__overwrite">
          <input
            checked={allowOverwrite}
            data-testid={`candidate-overwrite-${candidate.candidate_id}`}
            disabled={busy}
            type="checkbox"
            onChange={(event) => onUpdateCandidateOverwriteApproval(candidate, event.target.checked)}
          />
          <span>{targetName}의 현재 내용을 이 후보로 바꾸기</span>
        </label>
      ) : null}
    </div>
  )
}

function CandidateActions({
  allowOverwrite,
  approveDisabled,
  busy,
  candidate,
  wouldOverwrite,
  onApproveCandidate,
  onRejectCandidate,
}: {
  allowOverwrite: boolean
  approveDisabled: boolean
  busy: boolean
  candidate: ExtractionCandidate
  wouldOverwrite: boolean
  onApproveCandidate: (candidate: ExtractionCandidate) => void
  onRejectCandidate: (candidate: ExtractionCandidate) => void
}) {
  return (
    <div className="candidate-review__actions">
      <button
        className="app-button"
        data-testid={`candidate-approve-${candidate.candidate_id}`}
        disabled={approveDisabled}
        type="button"
        onClick={() => onApproveCandidate(candidate)}
      >
        {getApproveButtonLabel(wouldOverwrite, allowOverwrite)}
      </button>
      <button
        className="app-button app-button--secondary"
        data-testid={`candidate-reject-${candidate.candidate_id}`}
        disabled={busy}
        type="button"
        onClick={() => onRejectCandidate(candidate)}
      >
        버리기
      </button>
    </div>
  )
}

function CandidateRegionPreview({ candidate }: { candidate: ExtractionCandidate }) {
  const events = getPitchedEvents(candidate.region.pitch_events)
  const visibleEvents = events.slice(0, 96)
  const bounds = getCandidateTimelineBounds(candidate, events)
  const eventCount = getCandidateEventCount(candidate)
  const durationSeconds = getCandidateDurationSeconds(candidate)

  return (
    <section className="candidate-review__music" data-testid={`candidate-region-${candidate.candidate_id}`}>
      <div className="candidate-review__music-header">
        <strong>음표 흐름</strong>
        <span>
          {eventCount}개 · {formatDuration(durationSeconds)}
        </span>
      </div>
      <div className="candidate-review__region-grid">
        {events.length === 0 ? (
          <p>등록할 음표가 없습니다</p>
        ) : (
          visibleEvents.map((event) => (
            <i
              aria-label={`${event.label} ${event.duration_beats.toFixed(2)}박`}
              key={event.event_id}
              style={getCandidateEventStyle(event, events, bounds)}
              title={`${event.label} · ${event.start_beat.toFixed(2)}박부터 ${event.duration_beats.toFixed(2)}박`}
            />
          ))
        )}
      </div>
      {events.length > visibleEvents.length ? (
        <span className="candidate-review__region-note">앞부분 {visibleEvents.length}개만 표시 중</span>
      ) : null}
    </section>
  )
}

function CandidateCard({
  allowOverwrite,
  approveDisabled,
  busy,
  candidate,
  decisionSummary,
  selectedSlotId,
  sourcePreviewUrl,
  targetLocked,
  targetTrack,
  tracks,
  verdict,
  wouldOverwrite,
  onApproveCandidate,
  onRejectCandidate,
  onUpdateCandidateOverwriteApproval,
  onUpdateCandidateTargetSlot,
}: {
  allowOverwrite: boolean
  approveDisabled: boolean
  busy: boolean
  candidate: ExtractionCandidate
  decisionSummary: ReturnType<typeof getCandidateDecisionSummary>
  selectedSlotId: number
  sourcePreviewUrl: string | null
  targetLocked: boolean
  targetTrack: TrackSlot | undefined
  tracks: TrackSlot[]
  verdict: CandidateVerdict
  wouldOverwrite: boolean
  onApproveCandidate: (candidate: ExtractionCandidate) => void
  onRejectCandidate: (candidate: ExtractionCandidate) => void
  onUpdateCandidateOverwriteApproval: (candidate: ExtractionCandidate, allowOverwrite: boolean) => void
  onUpdateCandidateTargetSlot: (candidate: ExtractionCandidate, targetSlotId: number) => void
}) {
  const facts = getDecisionFacts(decisionSummary)
  const pills = getCandidatePills(decisionSummary)
  const notes = decisionSummary.diagnostics.slice(0, 4)
  const itemClassName =
    candidate.source_kind === 'ai'
      ? 'candidate-review__item candidate-review__item--generated'
      : 'candidate-review__item'

  return (
    <article className={itemClassName}>
      <div className="candidate-review__topline">
        <div className="candidate-review__title">
          <span>{getCandidateSourceText(candidate)}</span>
          <h3>{decisionSummary.title}</h3>
          <p>{decisionSummary.headline}</p>
        </div>
        <div className={`candidate-review__verdict candidate-review__verdict--${verdict.tone}`}>
          <strong>{verdict.label}</strong>
          <span>{verdict.reason}</span>
        </div>
      </div>

      {targetLocked ? (
        <div className="candidate-review__verdict candidate-review__verdict--review">
          <strong>잠시 대기</strong>
          <span>대상 트랙 작업이 끝난 뒤 등록할 수 있습니다.</span>
        </div>
      ) : null}

      <div className="candidate-review__content">
        <CandidateRegionPreview candidate={candidate} />

        <aside className="candidate-review__review">
          <dl className="candidate-review__facts">
            {facts.map((fact) => (
              <div key={`${candidate.candidate_id}-${fact.label}`}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>

          {pills.length > 0 ? (
            <ul className="candidate-review__tags" aria-label="후보 특징">
              {pills.map((tag) => (
                <li key={`${candidate.candidate_id}-${tag}`}>{tag}</li>
              ))}
            </ul>
          ) : null}

          {decisionSummary.support ? <p className="candidate-review__support">{decisionSummary.support}</p> : null}

          {notes.length > 0 ? (
            <div className="candidate-review__notes">
              <strong>확인할 점</strong>
              <ul>
                {notes.map((note) => (
                  <li key={`${candidate.candidate_id}-note-${note.label}`}>
                    <span>{note.label}</span>
                    {note.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      {sourcePreviewUrl ? (
        <details className="candidate-review__source-preview">
          <summary>원본 문서 보기</summary>
          <div>
            <img
              alt={`${formatSourceLabel(candidate.source_label)} 원본 문서 첫 페이지`}
              loading="lazy"
              src={sourcePreviewUrl}
            />
            <span>원본 첫 페이지와 후보 구간, 리듬, 파트 위치를 비교해 확인하세요.</span>
          </div>
        </details>
      ) : null}

      <CandidateTargetControls
        allowOverwrite={allowOverwrite}
        busy={busy}
        candidate={candidate}
        selectedSlotId={selectedSlotId}
        targetTrack={targetTrack}
        tracks={tracks}
        wouldOverwrite={wouldOverwrite}
        onUpdateCandidateOverwriteApproval={onUpdateCandidateOverwriteApproval}
        onUpdateCandidateTargetSlot={onUpdateCandidateTargetSlot}
      />

      <CandidateActions
        allowOverwrite={allowOverwrite}
        approveDisabled={approveDisabled}
        busy={busy}
        candidate={candidate}
        wouldOverwrite={wouldOverwrite}
        onApproveCandidate={onApproveCandidate}
        onRejectCandidate={onRejectCandidate}
      />
    </article>
  )
}

export function CandidateReviewPanel({
  beatsPerMeasure,
  busy,
  candidateOverwriteApprovals,
  candidates,
  lockedSlotIds,
  tracks,
  candidateWouldOverwrite,
  getJobSourcePreviewUrl,
  getSelectedCandidateSlotId,
  onApproveCandidate,
  onRejectCandidate,
  onUpdateCandidateOverwriteApproval,
  onUpdateCandidateTargetSlot,
}: CandidateReviewPanelProps) {
  if (candidates.length === 0) {
    return null
  }

  return (
    <section className="candidate-review" data-testid="candidate-review" aria-label="후보 검토">
      <div className="candidate-review__header">
        <div>
          <p className="eyebrow">검토 대기</p>
          <h2>후보 선택</h2>
        </div>
        <strong>{candidates.length}개</strong>
      </div>

      <div className="candidate-review__list">
        {candidates.map((candidate) => {
          const suggestedTrack = tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
          const selectedSlotId = getSelectedCandidateSlotId(candidate)
          const targetTrack = tracks.find((track) => track.slot_id === selectedSlotId) ?? suggestedTrack
          const targetLocked = lockedSlotIds.has(selectedSlotId)
          const wouldOverwrite = candidateWouldOverwrite(candidate)
          const allowOverwrite = candidateOverwriteApprovals[candidate.candidate_id] === true
          const decisionSummary = getCandidateDecisionSummary(candidate, targetTrack ?? null, beatsPerMeasure)
          const verdict = getCandidateVerdict(candidate, wouldOverwrite, targetTrack)
          const sourcePreviewUrl =
            candidate.job_id && shouldShowSourcePreview(candidate) && getJobSourcePreviewUrl
              ? getJobSourcePreviewUrl(candidate.job_id)
              : null
          const approveDisabled = busy || targetLocked || (wouldOverwrite && !allowOverwrite)

          return (
            <CandidateCard
              allowOverwrite={allowOverwrite}
              approveDisabled={approveDisabled}
              busy={busy}
              candidate={candidate}
              decisionSummary={decisionSummary}
              key={candidate.candidate_id}
              selectedSlotId={selectedSlotId}
              sourcePreviewUrl={sourcePreviewUrl}
              targetLocked={targetLocked}
              targetTrack={targetTrack}
              tracks={tracks}
              verdict={verdict}
              wouldOverwrite={wouldOverwrite}
              onApproveCandidate={onApproveCandidate}
              onRejectCandidate={onRejectCandidate}
              onUpdateCandidateOverwriteApproval={onUpdateCandidateOverwriteApproval}
              onUpdateCandidateTargetSlot={onUpdateCandidateTargetSlot}
            />
          )
        })}
      </div>
    </section>
  )
}

function getCandidateVerdict(
  candidate: ExtractionCandidate,
  wouldOverwrite: boolean,
  targetTrack?: TrackSlot,
): CandidateVerdict {
  const targetName = formatTrackName(targetTrack?.name ?? `트랙 ${candidate.suggested_slot_id}`)
  if (candidate.region.pitch_events.length === 0) {
    return {
      label: candidate.source_kind === 'ai' ? '등록 불가' : '다시 확인',
      reason:
        candidate.source_kind === 'ai'
          ? '이 후보는 등록할 음표를 만들지 못했습니다.'
          : '등록할 수 있는 음표가 감지되지 않았습니다.',
      tone: 'retry',
    }
  }

  const diagnostics = candidate.diagnostics ?? {}
  const confidence = Math.max(0, Math.min(1, candidate.confidence))
  const reviewHint = getDiagnosticString(diagnostics, 'review_hint')
  const riskTags = getDiagnosticStringList(diagnostics, 'risk_tags')
  const generationWarnings = getDiagnosticStringList(diagnostics, 'generation_quality_warnings')
  const acappellaQualityScore = getDiagnosticNumber(diagnostics, 'acappella_quality_score')
  const rangeFitRatio = getDiagnosticNumber(diagnostics, 'range_fit_ratio')
  const timingGridRatio = getDiagnosticNumber(diagnostics, 'timing_grid_ratio')
  const density = getDiagnosticNumber(diagnostics, 'density_events_per_measure')

  if (candidate.source_kind === 'ai') {
    if (reviewHint === 'ai_regenerate_recommended' || (acappellaQualityScore !== null && acappellaQualityScore < 58)) {
      return {
        label: '다시 생성 권장',
        reason: '성부 진행이나 맞물림이 약해 보입니다.',
        tone: 'retry',
      }
    }
    if (wouldOverwrite || riskTags.length > 0 || generationWarnings.length > 0) {
      return {
        label: wouldOverwrite ? '교체 전 확인' : '들어보고 선택',
        reason: wouldOverwrite
          ? `${targetName}에 이미 등록된 내용이 있습니다.`
          : '등록 전에 확인할 지점이 있습니다.',
        tone: 'review',
      }
    }
    return {
      label: '등록 가능',
      reason: `${targetName}에 넣을 수 있는 생성안입니다.`,
      tone: 'recommended',
    }
  }

  if (confidence < 0.5 || reviewHint === 'few_events') {
    return {
      label: '다시 확인',
      reason: '감지된 음표가 적거나 누락 가능성이 큽니다.',
      tone: 'retry',
    }
  }

  if (
    wouldOverwrite ||
    confidence < 0.74 ||
    riskTags.length > 0 ||
    reviewHint !== null ||
    (rangeFitRatio !== null && rangeFitRatio < 0.72) ||
    (timingGridRatio !== null && timingGridRatio < 0.72) ||
    (density !== null && density > 11)
  ) {
    return {
      label: wouldOverwrite ? '교체 전 확인' : '확인 후 등록',
      reason: wouldOverwrite
        ? `${targetName}에 이미 등록된 내용이 있습니다.`
        : '음역, 박자, 반복 중 확인할 지점이 있습니다.',
      tone: 'review',
    }
  }

  return {
    label: '등록 가능',
    reason: '트랙 배정과 음표 흐름이 안정적인 후보입니다.',
    tone: 'recommended',
  }
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

function shouldShowSourcePreview(candidate: ExtractionCandidate): boolean {
  return (
    candidate.source_kind === 'document' &&
    candidate.job_id !== null &&
    (candidate.method.includes('document') || candidate.method.includes('score'))
  )
}
