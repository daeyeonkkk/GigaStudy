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
          const jobTargetLabel = job.parse_all_parts ? 'Full score' : (jobTrack?.name ?? `Track ${job.slot_id}`)
          const candidateSummary = getJobCandidateSummary(jobCandidates, tracks)
          const recoveryHint = getJobRecoveryHint(job)
          const attemptLabel =
            job.attempt_count > 0 ? `${job.attempt_count}/${job.max_attempts}회 시도` : '대기 중'

          return (
            <article className="extraction-jobs__item" key={job.job_id}>
              <div>
                <strong>{job.source_label}</strong>
                <span>
                  {jobKindLabel} · {jobTargetLabel} · {attemptLabel}
                </span>
              </div>
              <span className={`extraction-jobs__status extraction-jobs__status--${job.status}`}>
                {getJobStatusLabel(job.status)}
              </span>
              <p>{job.message ?? job.method}</p>
              {candidateSummary ? <p className="extraction-jobs__candidate-strip">{candidateSummary}</p> : null}
              {canRegisterJob ? (
                <div className="extraction-jobs__actions">
                  <span>{jobCandidates.length}개 트랙 후보</span>
                  {wouldOverwrite ? (
                    <label>
                      <input
                        checked={allowOverwrite}
                        data-testid={`job-overwrite-${job.job_id}`}
                        type="checkbox"
                        onChange={(event) => onUpdateJobOverwriteApproval(job.job_id, event.target.checked)}
                      />
                      이미 등록된 트랙 덮어쓰기
                    </label>
                  ) : null}
                  <button
                    className="app-button"
                    data-testid={`job-approve-${job.job_id}`}
                    disabled={wouldOverwrite && !allowOverwrite}
                    type="button"
                    onClick={() => onApproveJobCandidates(job.job_id)}
                  >
                    OMR 후보 등록
                  </button>
                </div>
              ) : null}
              {canRetryJob ? (
                <div className="extraction-jobs__actions">
                  <span className="extraction-jobs__failure">{recoveryHint}</span>
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

function getJobCandidateSummary(candidates: ExtractionCandidate[], tracks: TrackSlot[]): string {
  if (candidates.length === 0) {
    return ''
  }
  return candidates
    .map((candidate) => {
      const track = tracks.find((item) => item.slot_id === candidate.suggested_slot_id)
      const confidence = `${Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100)}%`
      const measureCount = getCandidateDiagnosticNumber(candidate, 'measure_count')
      const noteCount = getCandidateDiagnosticNumber(candidate, 'note_count') ?? candidate.notes.length
      const measureLabel = measureCount !== null ? `${measureCount}마디` : '마디 확인'
      return `${track?.name ?? `Track ${candidate.suggested_slot_id}`} ${confidence} · ${measureLabel}/${noteCount}음`
    })
    .join(' · ')
}

function getJobRecoveryHint(job: TrackExtractionJob): string {
  const message = `${job.message ?? ''} ${job.method}`.toLowerCase()
  if (job.job_type === 'voice' && (message.includes('stable voiced') || message.includes('no stable'))) {
    return '노래로 판단할 만큼 안정적인 음정 구간을 찾지 못했습니다. 배경 소음을 줄이고 실제 노래 구간만 다시 녹음해 보세요.'
  }
  if (job.job_type === 'omr' && message.includes('vector fallback failed')) {
    return '스캔/이미지 PDF일 가능성이 높습니다. 더 선명한 원본, MusicXML, MIDI가 있으면 우선 사용하세요.'
  }
  if (job.job_type === 'omr' && message.includes('timed out')) {
    return 'Audiveris 처리 시간이 초과됐습니다. 재시도하거나, vector PDF 후보가 생성됐는지 확인하세요.'
  }
  return '원본 파일이 남아 있으면 같은 입력으로 다시 처리합니다.'
}

function getCandidateDiagnosticNumber(candidate: ExtractionCandidate, key: string): number | null {
  const value = candidate.diagnostics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
