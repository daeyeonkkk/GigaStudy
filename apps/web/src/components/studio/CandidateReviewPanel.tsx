import type { CSSProperties } from 'react'

import {
  getCandidateContourPoints,
  getCandidateDecisionSummary,
  getCandidatePreviewText,
  sourceLabels,
  statusLabels,
} from '../../lib/studio'
import type { ExtractionCandidate, TrackSlot } from '../../types/studio'

type CandidateReviewPanelProps = {
  beatsPerMeasure: number
  candidateOverwriteApprovals: Record<string, boolean>
  candidates: ExtractionCandidate[]
  tracks: TrackSlot[]
  candidateWouldOverwrite: (candidate: ExtractionCandidate) => boolean
  getJobSourcePreviewUrl?: (jobId: string) => string
  getSelectedCandidateSlotId: (candidate: ExtractionCandidate) => number
  onApproveCandidate: (candidate: ExtractionCandidate) => void
  onRejectCandidate: (candidate: ExtractionCandidate) => void
  onUpdateCandidateOverwriteApproval: (candidate: ExtractionCandidate, allowOverwrite: boolean) => void
  onUpdateCandidateTargetSlot: (candidate: ExtractionCandidate, targetSlotId: number) => void
}

export function CandidateReviewPanel({
  beatsPerMeasure,
  candidateOverwriteApprovals,
  candidates,
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
          <p className="eyebrow">Review queue</p>
          <h2>후보 선택 / 승인</h2>
        </div>
        <strong>{candidates.length} pending</strong>
      </div>

      <div className="candidate-review__list">
        {candidates.map((candidate) => {
          const suggestedTrack = tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
          const selectedSlotId = getSelectedCandidateSlotId(candidate)
          const targetTrack = tracks.find((track) => track.slot_id === selectedSlotId) ?? suggestedTrack
          const wouldOverwrite = candidateWouldOverwrite(candidate)
          const allowOverwrite = candidateOverwriteApprovals[candidate.candidate_id] === true
          const decisionSummary = getCandidateDecisionSummary(candidate, targetTrack ?? null, beatsPerMeasure)
          const contourPoints = getCandidateContourPoints(candidate)
          const sourcePreviewUrl =
            candidate.job_id && shouldShowSourcePreview(candidate) && getJobSourcePreviewUrl
              ? getJobSourcePreviewUrl(candidate.job_id)
              : null

          return (
            <article className="candidate-review__item" key={candidate.candidate_id}>
              <div className="candidate-review__identity">
                <span>
                  {sourceLabels[candidate.source_kind]}
                  {candidate.variant_label ? ` · ${candidate.variant_label}` : ''}
                </span>
                <h3>{suggestedTrack?.name ?? `Track ${candidate.suggested_slot_id}`} 후보</h3>
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
              </div>

              {decisionSummary.diagnostics.length > 0 ? (
                <dl className="candidate-review__diagnostics" aria-label="판독 근거">
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
                    value={selectedSlotId}
                    onChange={(event) => onUpdateCandidateTargetSlot(candidate, Number(event.target.value))}
                  >
                    {tracks.map((track) => (
                      <option key={track.slot_id} value={track.slot_id}>
                        {String(track.slot_id).padStart(2, '0')} {track.name} - {statusLabels[track.status]}
                      </option>
                    ))}
                  </select>
                </label>
                {wouldOverwrite ? (
                  <label className="candidate-review__overwrite">
                    <input
                      checked={allowOverwrite}
                      data-testid={`candidate-overwrite-${candidate.candidate_id}`}
                      type="checkbox"
                      onChange={(event) => onUpdateCandidateOverwriteApproval(candidate, event.target.checked)}
                    />
                    <span>{targetTrack?.name ?? '선택한 트랙'} 덮어쓰기 확인</span>
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
                  <summary>원본 악보 대조</summary>
                  <div>
                    <img
                      alt={`${candidate.source_label} 원본 악보 첫 페이지`}
                      loading="lazy"
                      src={sourcePreviewUrl}
                    />
                    <span>원본 첫 페이지와 후보 음역, 리듬, 파트 위치를 비교한 뒤 승인하세요.</span>
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
                  disabled={wouldOverwrite && !allowOverwrite}
                  type="button"
                  onClick={() => onApproveCandidate(candidate)}
                >
                  승인
                </button>
                <button
                  className="app-button app-button--secondary"
                  data-testid={`candidate-reject-${candidate.candidate_id}`}
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

function shouldShowSourcePreview(candidate: ExtractionCandidate): boolean {
  return (
    candidate.source_kind === 'score' &&
    candidate.job_id !== null &&
    (candidate.method.includes('omr') || candidate.method.includes('score'))
  )
}
