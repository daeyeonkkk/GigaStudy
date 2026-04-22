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
  onRetryJob: (jobId: string) => void
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
  onRetryJob,
  onUpdateJobOverwriteApproval,
}: ExtractionJobsPanelProps) {
  if (visibleJobs.length === 0) {
    return null
  }

  return (
    <section className="extraction-jobs" data-testid="extraction-jobs" aria-label="Extraction jobs">
      <div className="extraction-jobs__header">
        <div>
          <p className="eyebrow">Engine queue</p>
          <h2>추출 작업</h2>
        </div>
        <strong>{activeJobCount} active</strong>
      </div>
      <div className="extraction-jobs__list">
        {visibleJobs.map((job) => {
          const jobTrack = tracks.find((track) => track.slot_id === job.slot_id)
          const jobCandidates = getPendingJobCandidates(job.job_id)
          const canRegisterJob = job.status === 'needs_review' && jobCandidates.length > 0
          const canRetryJob = job.status === 'failed'
          const wouldOverwrite = jobWouldOverwrite(job.job_id)
          const allowOverwrite = jobOverwriteApprovals[job.job_id] === true
          const jobKindLabel = job.job_type === 'voice' ? '음성 추출' : 'PDF/Image OMR'
          const attemptLabel =
            job.attempt_count > 0 ? `${job.attempt_count}/${job.max_attempts}회 시도` : '대기 중'

          return (
            <article className="extraction-jobs__item" key={job.job_id}>
              <div>
                <strong>{job.source_label}</strong>
                <span>
                  {jobKindLabel} · {jobTrack?.name ?? `Track ${job.slot_id}`} · {attemptLabel}
                </span>
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
              {canRetryJob ? (
                <div className="extraction-jobs__actions">
                  <span>원본 파일이 남아 있으면 같은 입력으로 다시 처리합니다.</span>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`job-retry-${job.job_id}`}
                    type="button"
                    onClick={() => onRetryJob(job.job_id)}
                  >
                    재시도
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
