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
  getAudioExportDownloadUrl?: (jobId: string) => string
  getPendingJobCandidates: (jobId: string) => ExtractionCandidate[]
  jobWouldOverwrite: (jobId: string) => boolean
  onApproveJobCandidates: (jobId: string) => void
  onApproveJobTempo: (
    jobId: string,
    bpm: number,
    timeSignatureNumerator: number,
    timeSignatureDenominator: number,
  ) => void
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
  getAudioExportDownloadUrl,
  getPendingJobCandidates,
  jobWouldOverwrite,
  onApproveJobCandidates,
  onApproveJobTempo,
  onRetryJob,
  onUpdateJobOverwriteApproval,
}: ExtractionJobsPanelProps) {
  const [jobFilter, setJobFilter] = useState<JobFilter>('attention')
  const [tempoDrafts, setTempoDrafts] = useState<
    Record<string, { bpm: string; denominator: string; numerator: string }>
  >({})
  const attentionJobs = useMemo(
    () => visibleJobs.filter((job) => job.status !== 'completed' || job.job_type === 'export'),
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
          <p className="eyebrow">처리 중</p>
          <h2>업로드 처리</h2>
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
          const canApproveTempo = job.status === 'tempo_review_required'
          const canRetryJob = job.status === 'failed'
          const wouldOverwrite = jobWouldOverwrite(job.job_id)
          const allowOverwrite = jobOverwriteApprovals[job.job_id] === true
          const lockedByAnotherJob = jobCandidates.some((candidate) =>
            lockedSlotIds.has(candidate.suggested_slot_id),
          )
          const approveDisabled = busy || lockedByAnotherJob
          const jobKindLabel = getJobKindLabel(job)
          const jobTargetLabel = job.parse_all_parts ? '전체 문서' : formatTrackName(jobTrack?.name ?? `트랙 ${job.slot_id}`)
          const candidateSummary = getJobCandidateSummary(jobCandidates, tracks)
          const recoveryHint = getJobRecoveryHint(job)
          const attemptLabel =
            job.attempt_count > 0 ? `${job.attempt_count}/${job.max_attempts}회 시도` : '대기 중'
          const tempoDraft = getTempoDraft(job, tempoDrafts[job.job_id])
          const tempoValid = validateTempoDraft(tempoDraft)

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
              <p className="extraction-jobs__state-hint">{getJobStateHint(job)}</p>
              {candidateSummary ? <p className="extraction-jobs__candidate-strip">{candidateSummary}</p> : null}
              {canApproveTempo ? (
                <div className="extraction-jobs__tempo-form">
                  <div className="extraction-jobs__tempo-copy">
                    <strong>등록 기준 확인</strong>
                    <span>{getTempoEvidence(job)}</span>
                  </div>
                  <label>
                    BPM
                    <input
                      data-testid={`job-tempo-bpm-${job.job_id}`}
                      inputMode="numeric"
                      min={40}
                      max={240}
                      value={tempoDraft.bpm}
                      onChange={(event) =>
                        setTempoDrafts((drafts) => ({
                          ...drafts,
                          [job.job_id]: { ...tempoDraft, bpm: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    박자
                    <input
                      data-testid={`job-tempo-numerator-${job.job_id}`}
                      inputMode="numeric"
                      min={1}
                      max={32}
                      value={tempoDraft.numerator}
                      onChange={(event) =>
                        setTempoDrafts((drafts) => ({
                          ...drafts,
                          [job.job_id]: { ...tempoDraft, numerator: event.target.value },
                        }))
                      }
                    />
                    <select
                      data-testid={`job-tempo-denominator-${job.job_id}`}
                      value={tempoDraft.denominator}
                      onChange={(event) =>
                        setTempoDrafts((drafts) => ({
                          ...drafts,
                          [job.job_id]: { ...tempoDraft, denominator: event.target.value },
                        }))
                      }
                    >
                      {[1, 2, 4, 8, 16, 32].map((denominator) => (
                        <option key={denominator} value={denominator}>
                          /{denominator}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="app-button"
                    data-testid={`job-tempo-approve-${job.job_id}`}
                    disabled={busy || !tempoValid}
                    type="button"
                    onClick={() => {
                      if (!tempoValid) {
                        return
                      }
                      onApproveJobTempo(
                        job.job_id,
                        Number.parseInt(tempoDraft.bpm, 10),
                        Number.parseInt(tempoDraft.numerator, 10),
                        Number.parseInt(tempoDraft.denominator, 10),
                      )
                    }}
                  >
                    이 기준으로 등록
                  </button>
                </div>
              ) : null}
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
                      이미 등록된 트랙도 새 후보로 바꾸기
                    </label>
                  ) : null}
                  <button
                    className="app-button"
                    data-testid={`job-approve-${job.job_id}`}
                    disabled={approveDisabled}
                    type="button"
                    onClick={() => onApproveJobCandidates(job.job_id)}
                  >
                    {wouldOverwrite && !allowOverwrite ? '비어 있는 트랙만 등록' : '후보 등록'}
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
              {job.job_type === 'export' &&
              job.status === 'completed' &&
              job.output_path &&
              getAudioExportDownloadUrl ? (
                <div className="extraction-jobs__actions extraction-jobs__actions--download">
                  <span>오디오 파일이 준비되었습니다.</span>
                  <a
                    className="app-button app-button--secondary"
                    data-testid={`job-audio-export-download-${job.job_id}`}
                    href={getAudioExportDownloadUrl(job.job_id)}
                  >
                    다운로드
                  </a>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function getJobKindLabel(job: TrackExtractionJob): string {
  if (job.job_type === 'voice') {
    return '녹음파일 분석'
  }
  if (job.job_type === 'generation') {
    return 'AI 생성'
  }
  if (job.job_type === 'scoring') {
    return '채점'
  }
  if (job.job_type === 'export') {
    return '오디오 내보내기'
  }
  if (job.job_type === 'tuning') {
    return '편집 반영본 만들기'
  }
  return '악보 분석'
}

function getJobCandidateSummary(candidates: ExtractionCandidate[], tracks: TrackSlot[]): string {
  if (candidates.length === 0) {
    return ''
  }
  return candidates
    .map((candidate) => {
      const track = tracks.find((item) => item.slot_id === candidate.suggested_slot_id)
      const measureCount = getCandidateDiagnosticNumber(candidate, 'measure_count')
      const eventCount =
        getCandidateDiagnosticNumber(candidate, 'event_count') ??
        candidate.region.pitch_events.length
      const measureLabel = measureCount !== null ? `${measureCount}마디` : '마디 확인 필요'
      return `${formatTrackName(track?.name ?? `트랙 ${candidate.suggested_slot_id}`)}: ${measureLabel}, 음표 ${eventCount}개`
    })
    .join(' | ')
}

function getJobStateHint(job: TrackExtractionJob): string {
  if (job.status === 'tempo_review_required') {
    return '악보를 등록하기 전에 BPM과 박자표를 확인하세요. 필요하면 값을 고친 뒤 등록을 시작합니다.'
  }
  if (job.status === 'queued') {
    return '대기열에 올라와 있습니다. 앞선 문서/음성 작업이 끝나면 자동으로 시작합니다.'
  }
  if (job.status === 'running') {
    if (job.job_type === 'tuning') {
      return '저장된 음표에 맞춰 편집 내용을 녹음에 반영하는 중입니다.'
    }
    return job.job_type === 'voice'
      ? '녹음 파일을 메트로놈 기준으로 정렬하고 음표 후보를 만드는 중입니다.'
      : '문서 파트와 트랙 후보를 추출하는 중입니다. 완료되면 등록 가능한 후보가 표시됩니다.'
  }
  if (job.status === 'needs_review') {
    return job.parse_all_parts
      ? '후보가 준비되었습니다. 비어 있는 트랙은 바로 등록할 수 있고, 이미 등록된 트랙은 교체 확인이 필요합니다.'
      : '후보가 준비되었습니다. 등록하면 선택한 트랙에 새 음표와 연주음이 들어갑니다.'
  }
  if (job.status === 'completed') {
    return '처리가 완료되었습니다.'
  }
  return '처리에 실패했습니다. 안내를 확인한 뒤 같은 입력으로 다시 시도할 수 있습니다.'
}

function getTempoDraft(
  job: TrackExtractionJob,
  draft: { bpm: string; denominator: string; numerator: string } | undefined,
): { bpm: string; denominator: string; numerator: string } {
  if (draft) {
    return draft
  }
  return {
    bpm: String(getJobDiagnosticNumber(job, 'suggested_bpm') ?? 92),
    numerator: String(getJobDiagnosticNumber(job, 'suggested_time_signature_numerator') ?? 4),
    denominator: String(getJobDiagnosticNumber(job, 'suggested_time_signature_denominator') ?? 4),
  }
}

function validateTempoDraft(draft: { bpm: string; denominator: string; numerator: string }): boolean {
  const bpm = Number.parseInt(draft.bpm, 10)
  const numerator = Number.parseInt(draft.numerator, 10)
  const denominator = Number.parseInt(draft.denominator, 10)
  return (
    Number.isInteger(bpm) &&
    bpm >= 40 &&
    bpm <= 240 &&
    Number.isInteger(numerator) &&
    numerator >= 1 &&
    numerator <= 32 &&
    [1, 2, 4, 8, 16, 32].includes(denominator)
  )
}

function getTempoEvidence(job: TrackExtractionJob): string {
  const evidence = getJobDiagnosticStringList(job, 'tempo_evidence')
  if (evidence.length > 0) {
    return evidence.join(' · ')
  }
  const warnings = getJobDiagnosticStringList(job, 'tempo_warnings')
  if (warnings.length > 0) {
    return warnings.join(' · ')
  }
  return '파일에서 읽은 값이 애매하면 직접 수정해 주세요.'
}

function getJobDiagnosticNumber(job: TrackExtractionJob, key: string): number | null {
  const value = job.diagnostics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getJobDiagnosticStringList(job: TrackExtractionJob, key: string): string[] {
  const value = job.diagnostics?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getJobRecoveryHint(job: TrackExtractionJob): string {
  const message = `${job.message ?? ''} ${job.method}`.toLowerCase()
  if (job.job_type === 'voice' && (message.includes('stable voiced') || message.includes('no stable'))) {
    return '노래로 판단할 만큼 안정적인 음정 구간을 찾지 못했습니다. 배경 소음을 줄이고 실제 노래 구간만 다시 녹음해 보세요.'
  }
  if (job.job_type === 'document' && (message.includes('오선') || message.includes('음표'))) {
    return '가사나 일반 문서가 아닌 악보 PDF를 올려 주세요. 가능하면 MIDI 또는 MusicXML이 가장 안정적입니다.'
  }
  if (
    job.job_type === 'document' &&
    (message.includes('시간') || message.includes('크거나 복잡') || message.includes('멈춰'))
  ) {
    return '같은 파일을 다시 시도할 수 있지만, 가능하면 MIDI 또는 MusicXML로 시작하는 편이 안정적입니다.'
  }
  if (job.job_type === 'document') {
    return '악보 PDF 인식은 파일에 따라 실패할 수 있습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 보세요.'
  }
  return '원본 파일은 남아 있습니다. 같은 입력으로 다시 처리할 수 있습니다.'
}

function getCandidateDiagnosticNumber(candidate: ExtractionCandidate, key: string): number | null {
  const value = candidate.diagnostics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
