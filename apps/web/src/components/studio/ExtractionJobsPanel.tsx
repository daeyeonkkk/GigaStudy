import {
  getJobStatusLabel,
} from '../../lib/studio'
import type { ExtractionCandidate, TrackExtractionJob, TrackSlot } from '../../types/studio'

type ExtractionJobsPanelProps = {
  activeJobCount: number
  jobOverwriteApprovals: Record<string, boolean>
  tracks: TrackSlot[]
  visibleJobs: TrackExtractionJob[]
  getPendingJobCandidates: (jobId: string) => ExtractionCandidate[]
  jobWouldOverwrite: (jobId: string) => boolean
  onApproveJobCandidates: (jobId: string) => void
  onUpdateJobOverwriteApproval: (jobId: string, allowOverwrite: boolean) => void
}

export function ExtractionJobsPanel({
  activeJobCount,
  jobOverwriteApprovals,
  tracks,
  visibleJobs,
  getPendingJobCandidates,
  jobWouldOverwrite,
  onApproveJobCandidates,
  onUpdateJobOverwriteApproval,
}: ExtractionJobsPanelProps) {
  if (visibleJobs.length === 0) {
    return null
  }

  return (
    <section className="extraction-jobs" data-testid="extraction-jobs" aria-label="Extraction jobs">
      <div className="extraction-jobs__header">
        <div>
          <p className="eyebrow">OMR queue</p>
          <h2>PDF/Image extraction</h2>
        </div>
        <strong>{activeJobCount} active</strong>
      </div>
      <div className="extraction-jobs__list">
        {visibleJobs.map((job) => {
          const jobTrack = tracks.find((track) => track.slot_id === job.slot_id)
          const jobCandidates = getPendingJobCandidates(job.job_id)
          const canRegisterJob = job.status === 'needs_review' && jobCandidates.length > 0
          const wouldOverwrite = jobWouldOverwrite(job.job_id)
          const allowOverwrite = jobOverwriteApprovals[job.job_id] === true

          return (
            <article className="extraction-jobs__item" key={job.job_id}>
              <div>
                <strong>{job.source_label}</strong>
                <span>{jobTrack?.name ?? `Track ${job.slot_id}`}</span>
              </div>
              <span className={`extraction-jobs__status extraction-jobs__status--${job.status}`}>
                {getJobStatusLabel(job.status)}
              </span>
              <p>{job.message ?? job.method}</p>
              {canRegisterJob ? (
                <div className="extraction-jobs__actions">
                  <span>{jobCandidates.length} track candidates</span>
                  {wouldOverwrite ? (
                    <label>
                      <input
                        checked={allowOverwrite}
                        data-testid={`job-overwrite-${job.job_id}`}
                        type="checkbox"
                        onChange={(event) => onUpdateJobOverwriteApproval(job.job_id, event.target.checked)}
                      />
                      overwrite occupied tracks
                    </label>
                  ) : null}
                  <button
                    className="app-button"
                    data-testid={`job-approve-${job.job_id}`}
                    disabled={wouldOverwrite && !allowOverwrite}
                    type="button"
                    onClick={() => onApproveJobCandidates(job.job_id)}
                  >
                    Register OMR
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
