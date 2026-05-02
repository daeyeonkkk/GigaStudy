import type { CSSProperties } from 'react'

import {
  getCandidateContourPoints,
  getCandidateDecisionSummary,
  getCandidatePreviewText,
  formatGeneratedLabel,
  getPitchEventRange,
  getPitchedEvents,
  formatSourceLabel,
  formatTrackName,
  sourceLabels,
  statusLabels,
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

function getEventTimelinePercent(seconds: number, startSeconds: number, durationSeconds: number): number {
  return Math.max(0, Math.min(100, ((seconds - startSeconds) / Math.max(0.25, durationSeconds)) * 100))
}

function getEventTopPercent(event: PitchEvent, events: PitchEvent[]): number {
  const pitchRange = getPitchEventRange(events)
  const midi = typeof event.pitch_midi === 'number' ? event.pitch_midi : pitchRange.minMidi
  const span = Math.max(1, pitchRange.maxMidi - pitchRange.minMidi)
  return Math.max(4, Math.min(86, ((pitchRange.maxMidi - midi) / span) * 82 + 4))
}

function getCandidateEventStyle(
  candidate: ExtractionCandidate,
  event: PitchEvent,
  events: PitchEvent[],
): CSSProperties {
  return {
    '--candidate-event-left': `${getEventTimelinePercent(
      event.start_seconds,
      candidate.region.start_seconds,
      candidate.region.duration_seconds,
    )}%`,
    '--candidate-event-top': `${getEventTopPercent(event, events)}%`,
    '--candidate-event-width': `${Math.max(
      2.4,
      getEventTimelinePercent(
        event.start_seconds + event.duration_seconds,
        event.start_seconds,
        candidate.region.duration_seconds,
      ),
    )}%`,
  } as CSSProperties
}

function CandidateRegionPreview({ candidate }: { candidate: ExtractionCandidate }) {
  const events = getPitchedEvents(candidate.region.pitch_events)

  return (
    <div className="candidate-review__region" data-testid={`candidate-region-${candidate.candidate_id}`}>
      <span>구간 후보</span>
      <div className="candidate-review__region-grid">
        {events.length === 0 ? (
          <p>음표 없음</p>
        ) : (
          events.slice(0, 32).map((event) => (
            <i
              aria-label={`${event.label} beat ${event.start_beat}`}
              key={event.event_id}
              style={getCandidateEventStyle(candidate, event, events)}
              title={`${event.label}@${event.start_beat}`}
            >
              {event.label}
            </i>
          ))
        )}
      </div>
    </div>
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
          <p className="eyebrow">검토 대기열</p>
          <h2>후보 선택 / 승인</h2>
        </div>
        <strong>{candidates.length}개 대기</strong>
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
          const contourPoints = getCandidateContourPoints(candidate)
          const engineLabel = getCandidateEngineLabel(candidate)
          const verdict = getCandidateVerdict(candidate, wouldOverwrite)
          const sourcePreviewUrl =
            candidate.job_id && shouldShowSourcePreview(candidate) && getJobSourcePreviewUrl
              ? getJobSourcePreviewUrl(candidate.job_id)
              : null
          const approveDisabled = busy || targetLocked || (wouldOverwrite && !allowOverwrite)

          return (
            <article className="candidate-review__item" key={candidate.candidate_id}>
              <div className="candidate-review__identity">
                <span>
                  {sourceLabels[candidate.source_kind]}
                  {candidate.variant_label ? ` · ${formatGeneratedLabel(candidate.variant_label)}` : ''}
                </span>
                <span className="candidate-review__engine">{engineLabel}</span>
                <h3>{formatTrackName(suggestedTrack?.name ?? `Track ${candidate.suggested_slot_id}`)} 후보</h3>
                <div className={`candidate-review__verdict candidate-review__verdict--${verdict.tone}`}>
                  <strong>{verdict.label}</strong>
                  <span>{verdict.reason}</span>
                </div>
                {targetLocked ? (
                  <div className="candidate-review__verdict candidate-review__verdict--review">
                    <strong>작업 중</strong>
                    <span>대상 트랙의 추출 작업이 끝난 뒤 등록할 수 있습니다.</span>
                  </div>
                ) : null}
                <strong>{decisionSummary.title}</strong>
                <p>{decisionSummary.headline}</p>
                <ul aria-label="후보 특징">
                  {decisionSummary.tags.map((tag) => (
                    <li key={`${candidate.candidate_id}-${tag}`}>{tag}</li>
                  ))}
                </ul>
              </div>

              <div className="candidate-review__decision" data-testid={`candidate-insight-${candidate.candidate_id}`}>
                <span>선택 기준</span>
                <p>{decisionSummary.support}</p>
                <div className="candidate-review__contour" aria-label="선율 흐름">
                  {contourPoints.map((point, index) => (
                    <i
                      aria-label={point.label}
                      key={`${candidate.candidate_id}-contour-${index}`}
                      style={
                        {
                          '--candidate-x': `${Math.max(0, Math.min(100, point.x))}%`,
                          '--candidate-y': `${Math.max(0, Math.min(100, point.y))}%`,
                        } as CSSProperties
                      }
                      title={point.label}
                    />
                  ))}
                </div>
                <CandidateRegionPreview candidate={candidate} />
              </div>

              {decisionSummary.diagnostics.length > 0 ? (
                <dl className="candidate-review__diagnostics" aria-label="판단 근거">
                  {decisionSummary.diagnostics.map((metric) => (
                    <div key={`${candidate.candidate_id}-diagnostic-${metric.label}`}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <dl className="candidate-review__metrics">
                {decisionSummary.metrics.map((metric) => (
                  <div key={`${candidate.candidate_id}-${metric.label}`}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="candidate-review__target">
                <label>
                  <span>대상 트랙</span>
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
                    <span>{formatTrackName(targetTrack?.name)} 덮어쓰기 확인</span>
                  </label>
                ) : null}
              </div>

              <div className="candidate-review__preview">
                <span>흐름</span>
                <strong>{decisionSummary.phrasePreview}</strong>
                <small>위치: {getCandidatePreviewText(candidate)}</small>
              </div>

              {sourcePreviewUrl ? (
                <details className="candidate-review__source-preview">
                  <summary>원본 문서 대조</summary>
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

              {candidate.message ? <p>{candidate.message}</p> : null}
              <details className="candidate-review__technical">
                <summary>엔진 정보</summary>
                <dl>
                  {decisionSummary.technical.map((metric) => (
                    <div key={`${candidate.candidate_id}-technical-${metric.label}`}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              <div className="candidate-review__actions">
                <button
                  className="app-button"
                  data-testid={`candidate-approve-${candidate.candidate_id}`}
                  disabled={approveDisabled}
                  type="button"
                  onClick={() => onApproveCandidate(candidate)}
                >
                  승인
                </button>
                <button
                  className="app-button app-button--secondary"
                  data-testid={`candidate-reject-${candidate.candidate_id}`}
                  disabled={busy}
                  type="button"
                  onClick={() => onRejectCandidate(candidate)}
                >
                  거절
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function getCandidateVerdict(candidate: ExtractionCandidate, wouldOverwrite: boolean): CandidateVerdict {
  if (candidate.region.pitch_events.length === 0) {
    return {
      label: '재시도 권장',
      reason: '등록할 수 있는 음표가 감지되지 않았습니다.',
      tone: 'retry',
    }
  }

  const diagnostics = candidate.diagnostics ?? {}
  const confidence = Math.max(0, Math.min(1, candidate.confidence))
  const reviewHint = getDiagnosticString(diagnostics, 'review_hint')
  const riskTags = getDiagnosticStringList(diagnostics, 'risk_tags')
  const rangeFitRatio = getDiagnosticNumber(diagnostics, 'range_fit_ratio')
  const timingGridRatio = getDiagnosticNumber(diagnostics, 'timing_grid_ratio')
  const density = getDiagnosticNumber(diagnostics, 'density_events_per_measure')

  if (confidence < 0.5 || reviewHint === 'few_events') {
    return {
      label: '재시도 권장',
      reason: '자동 추출 신뢰도가 낮거나 파트 누락 가능성이 큽니다.',
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
      label: '검토 필요',
      reason: wouldOverwrite
        ? '기존 트랙을 덮어씁니다. 대상 트랙과 후보 흐름을 확인하세요.'
        : '음역, 박자, 반복 중 확인할 지점이 있습니다.',
      tone: 'review',
    }
  }

  return {
    label: '추천',
    reason: '트랙 배정과 음표 추출 품질이 안정적인 후보입니다.',
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

function getCandidateEngineLabel(candidate: ExtractionCandidate): string {
  if (candidate.method.includes('deepseek')) {
    return '엔진: DeepSeek 편성 계획 + 성부 진행'
  }
  if (candidate.method.includes('rule_based')) {
    return '엔진: 규칙 기반 성부 진행'
  }
  return `엔진: ${candidate.method}`
}

function shouldShowSourcePreview(candidate: ExtractionCandidate): boolean {
  return (
    candidate.source_kind === 'document' &&
    candidate.job_id !== null &&
    (candidate.method.includes('document') || candidate.method.includes('score'))
  )
}
