import {
  formatDurationSeconds,
  formatPercent,
  getCandidateDurationSeconds,
  getCandidatePitchRange,
  getCandidatePreviewText,
  sourceLabels,
  statusLabels,
} from '../../lib/studio'
import type { ExtractionCandidate, TrackSlot } from '../../types/studio'

type CandidateReviewPanelProps = {
  candidateOverwriteApprovals: Record<string, boolean>
  candidates: ExtractionCandidate[]
  tracks: TrackSlot[]
  candidateWouldOverwrite: (candidate: ExtractionCandidate) => boolean
  getSelectedCandidateSlotId: (candidate: ExtractionCandidate) => number
  onApproveCandidate: (candidate: ExtractionCandidate) => void
  onRejectCandidate: (candidate: ExtractionCandidate) => void
  onUpdateCandidateOverwriteApproval: (candidate: ExtractionCandidate, allowOverwrite: boolean) => void
  onUpdateCandidateTargetSlot: (candidate: ExtractionCandidate, targetSlotId: number) => void
}

export function CandidateReviewPanel({
  candidateOverwriteApprovals,
  candidates,
  tracks,
  candidateWouldOverwrite,
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

          return (
            <article className="candidate-review__item" key={candidate.candidate_id}>
              <div>
                <span>{sourceLabels[candidate.source_kind]}</span>
                <h3>
                  {suggestedTrack?.name ?? `Track ${candidate.suggested_slot_id}`} 후보
                  {candidate.variant_label ? ` - ${candidate.variant_label}` : ''}
                </h3>
                <p>{candidate.source_label}</p>
              </div>
              <dl>
                <div>
                  <dt>method</dt>
                  <dd>{candidate.method}</dd>
                </div>
                <div>
                  <dt>confidence</dt>
                  <dd>{formatPercent(candidate.confidence)}</dd>
                </div>
                <div>
                  <dt>notes</dt>
                  <dd>{candidate.notes.length}</dd>
                </div>
                <div>
                  <dt>duration</dt>
                  <dd>{formatDurationSeconds(getCandidateDurationSeconds(candidate))}</dd>
                </div>
                <div>
                  <dt>range</dt>
                  <dd>{getCandidatePitchRange(candidate)}</dd>
                </div>
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
              <p className="candidate-review__preview">Preview: {getCandidatePreviewText(candidate)}</p>
              {candidate.message ? <p>{candidate.message}</p> : null}
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
