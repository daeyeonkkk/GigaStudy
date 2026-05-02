import { useMemo, useState } from 'react'

import { formatTrackName, getJobStatusLabel } from '../../lib/studio'
import type { ExtractionCandidate, TrackExtractionJob, TrackSlot } from '../../types/studio'
import './ExtractionJobsPanel.css'

type JobFilter = 'attention' | 'failed' | 'all'

type ExtractionJobsPanelProps = {
  activeJobCount: number
  busy: boolean
  jobOverwriteApprovals: Record<string, boolean>
  lockedSlotIds: Set<number>
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
  busy,
  jobOverwriteApprovals,
  lockedSlotIds,
  tracks,
  visibleJobs,
  getPendingJobCandidates,
  jobWouldOverwrite,
  onApproveJobCandidates,
  onRetryJob,
  onUpdateJobOverwriteApproval,
}: ExtractionJobsPanelProps) {
  const [jobFilter, setJobFilter] = useState<JobFilter>('attention')
  const attentionJobs = useMemo(
    () => visibleJobs.filter((job) => job.status !== 'completed'),
    [visibleJobs],
  )
  const failedJobs = useMemo(
    () => visibleJobs.filter((job) => job.status === 'failed'),
    [visibleJobs],
  )
  const jobsToRender = useMemo(() => {
    if (jobFilter === 'failed') {
      return failedJobs
    }
    if (jobFilter === 'attention') {
      return attentionJobs
    }
    return visibleJobs
  }, [attentionJobs, failedJobs, jobFilter, visibleJobs])

  if (visibleJobs.length === 0) {
    return null
  }

  return (
    <section className="extraction-jobs" data-testid="extraction-jobs" aria-label="추출 작업">
      <div className="extraction-jobs__header">
        <div>
          <p className="eyebrow">엔진 대기열</p>
          <h2>추출 작업</h2>
          <p>대기, 실행, 승인 대기, 실패 작업을 한 곳에서 확인합니다.</p>
        </div>
        <strong>진행 중 {activeJobCount}</strong>
      </div>
      <div className="extraction-jobs__filters" role="group" aria-label="추출 작업 필터">
        <button
          className={jobFilter === 'attention' ? 'is-active' : ''}
          type="button"
          onClick={() => setJobFilter('attention')}
        >
          확인 필요 {attentionJobs.length}
        </button>
        <button
          className={jobFilter === 'failed' ? 'is-active' : ''}
          type="button"
          onClick={() => setJobFilter('failed')}
        >
          실패 {failedJobs.length}
        </button>
        <button
          className={jobFilter === 'all' ? 'is-active' : ''}
          type="button"
          onClick={() => setJobFilter('all')}
        >
          전체 {visibleJobs.length}
        </button>
      </div>
      <div className="extraction-jobs__list">
        {jobsToRender.length === 0 ? (
          <p className="extraction-jobs__empty">
            현재 필터에 해당하는 작업이 없습니다. 전체 탭에서 완료 이력까지 확인할 수 있습니다.
          </p>
        ) : null}
        {jobsToRender.map((job) => {
          const jobTrack = tracks.find((track) => track.slot_id === job.slot_id)
          const jobCandidates = getPendingJobCandidates(job.job_id)
          const canRegisterJob = job.status === 'needs_review' && jobCandidates.length > 0
          const canRetryJob = job.status === 'failed'
          const wouldOverwrite = jobWouldOverwrite(job.job_id)
          const allowOverwrite = jobOverwriteApprovals[job.job_id] === true
          const lockedByAnotherJob = jobCandidates.some((candidate) =>
            lockedSlotIds.has(candidate.suggested_slot_id),
          )
          const approveDisabled = busy || lockedByAnotherJob || (wouldOverwrite && !allowOverwrite)
          const jobKindLabel = job.job_type === 'voice' ? '음성 추출' : '문서 분석'
          const jobTargetLabel = job.parse_all_parts ? '전체 문서' : formatTrackName(jobTrack?.name ?? `Track ${job.slot_id}`)
          const candidateSummary = getJobCandidateSummary(jobCandidates, tracks)
          const recoveryHint = getJobRecoveryHint(job)
          const attemptLabel =
            job.attempt_count > 0 ? `${job.attempt_count}/${job.max_attempts}회 시도` : '대기 중'

          return (
            <article className="extraction-jobs__item" key={job.job_id}>
              <div>
                <strong>{job.source_label}</strong>
                <span>
                  {jobKindLabel} / {jobTargetLabel} / {attemptLabel}
                </span>
              </div>
              <span className={`extraction-jobs__status extraction-jobs__status--${job.status}`}>
                {getJobStatusLabel(job.status)}
              </span>
              <p>{job.message ?? job.method}</p>
              <p className="extraction-jobs__state-hint">{getJobStateHint(job)}</p>
              {candidateSummary ? <p className="extraction-jobs__candidate-strip">{candidateSummary}</p> : null}
              {lockedByAnotherJob ? (
                <p className="extraction-jobs__state-hint">
                  대상 트랙에 다른 추출 작업이 남아 있어 등록을 잠시 막았습니다.
                </p>
              ) : null}
              {canRegisterJob ? (
                <div className="extraction-jobs__actions">
                  <span>{jobCandidates.length}개 트랙 후보</span>
                  {wouldOverwrite ? (
                    <label>
                      <input
                        checked={allowOverwrite}
                        data-testid={`job-overwrite-${job.job_id}`}
                        disabled={busy}
                        type="checkbox"
                        onChange={(event) => onUpdateJobOverwriteApproval(job.job_id, event.target.checked)}
                      />
                      이미 등록된 트랙 덮어쓰기
                    </label>
                  ) : null}
                  <button
                    className="app-button"
                    data-testid={`job-approve-${job.job_id}`}
                    disabled={approveDisabled}
                    type="button"
                    onClick={() => onApproveJobCandidates(job.job_id)}
                  >
                    후보 등록
                  </button>
                </div>
              ) : null}
              {canRetryJob ? (
                <div className="extraction-jobs__actions">
                  <span className="extraction-jobs__failure">{recoveryHint}</span>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`job-retry-${job.job_id}`}
                    disabled={busy}
                    type="button"
                    onClick={() => onRetryJob(job.job_id)}
                  >
                    다시 시도
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
      const eventCount =
        getCandidateDiagnosticNumber(candidate, 'event_count') ??
        candidate.region.pitch_events.length
      const measureLabel = measureCount !== null ? `${measureCount}마디` : '마디 확인 필요'
      return `${formatTrackName(track?.name ?? `Track ${candidate.suggested_slot_id}`)} ${confidence} / ${measureLabel} / ${eventCount}개`
    })
    .join(' | ')
}

function getJobStateHint(job: TrackExtractionJob): string {
  if (job.status === 'queued') {
    return '대기열에 올라와 있습니다. 앞선 문서/음성 작업이 끝나면 자동으로 시작합니다.'
  }
  if (job.status === 'running') {
    return job.job_type === 'voice'
      ? '녹음 파일을 메트로놈 기준으로 정렬하고 음표 후보를 만드는 중입니다.'
      : '문서 파트와 트랙 후보를 추출하는 중입니다. 완료되면 등록 가능한 후보가 표시됩니다.'
  }
  if (job.status === 'needs_review') {
    return job.parse_all_parts
      ? '여러 파트 후보가 준비되었습니다. 트랙 배정과 덮어쓰기 여부를 확인한 뒤 등록하세요.'
      : '후보가 준비되었습니다. 등록하면 해당 트랙의 음표와 연주음에 반영됩니다.'
  }
  if (job.status === 'completed') {
    return '처리가 완료되었습니다.'
  }
  return '처리에 실패했습니다. 안내를 확인한 뒤 같은 입력으로 다시 시도할 수 있습니다.'
}

function getJobRecoveryHint(job: TrackExtractionJob): string {
  const message = `${job.message ?? ''} ${job.method}`.toLowerCase()
  if (job.job_type === 'voice' && (message.includes('stable voiced') || message.includes('no stable'))) {
    return '노래로 판단할 만큼 안정적인 음정 구간을 찾지 못했습니다. 배경 소음을 줄이고 실제 노래 구간만 다시 녹음해 보세요.'
  }
  if (job.job_type === 'document' && message.includes('vector fallback failed')) {
    return 'PDF에서 읽을 수 있는 벡터 데이터를 찾지 못했습니다. 더 선명한 원본, MusicXML, MIDI가 있으면 우선 사용하세요.'
  }
  if (job.job_type === 'document' && message.includes('timed out')) {
    return '문서 분석 시간이 초과되었습니다. 다시 시도하거나 가능하면 vector PDF/MusicXML/MIDI를 사용하세요.'
  }
  return '원본 파일은 남아 있습니다. 같은 입력으로 다시 처리할 수 있습니다.'
}

function getCandidateDiagnosticNumber(candidate: ExtractionCandidate, key: string): number | null {
  const value = candidate.diagnostics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
