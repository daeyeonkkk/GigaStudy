import type { TrackExtractionJob } from '../../types/studio'
import type { StudioActionState } from './studioActionState'

export const NOTICE_META_BLOCKLIST = [
  'API',
  '서버',
  '엔진',
  'LLM',
  '대기열',
  'queue',
  'polling',
  'diagnostics',
  'payload',
  'Audiveris',
  'OOM',
] as const

const JOB_MESSAGES: Record<TrackExtractionJob['job_type'], string> = {
  document: '악보를 읽고 파트를 나누는 중입니다.',
  voice: '녹음파일에서 음을 찾는 중입니다.',
  generation: '선택한 기준 트랙을 바탕으로 새 성부를 만드는 중입니다.',
  scoring: '녹음한 연주를 기준 트랙과 맞춰보는 중입니다.',
}

const JOB_ESTIMATE_LABELS: Record<TrackExtractionJob['job_type'], string> = {
  document: '예상 소요: 보통 1-3분',
  voice: '예상 소요: 보통 1-2분',
  generation: '예상 소요: 보통 30초-2분',
  scoring: '예상 소요: 보통 30초-1분',
}

export function noticeHasMetaLanguage(value: string): boolean {
  const normalized = value.toLowerCase()
  return NOTICE_META_BLOCKLIST.some((term) =>
    term === 'API' || term === 'LLM'
      ? normalized.includes(term.toLowerCase())
      : value.includes(term) || normalized.includes(term.toLowerCase()),
  )
}

export function sanitizeNoticeText(
  value: string | undefined,
  phase: Exclude<StudioActionState['phase'], 'idle'>,
): string | undefined {
  if (!value) {
    return undefined
  }
  if (!noticeHasMetaLanguage(value)) {
    return value
  }
  if (phase === 'error') {
    return '연결이 잠시 불안정합니다. 잠시 뒤 다시 확인해 주세요.'
  }
  if (phase === 'warning') {
    return '상태 확인이 잠시 늦어지고 있습니다. 작업은 계속 진행됩니다.'
  }
  if (phase === 'success') {
    return '작업이 끝났습니다. 결과를 확인해 주세요.'
  }
  return '작업을 진행하고 있습니다.'
}

export function getNoticeProgressPercent(job: TrackExtractionJob): number | undefined {
  const completedUnits = job.progress?.completed_units
  const totalUnits = job.progress?.total_units
  if (
    typeof completedUnits !== 'number' ||
    typeof totalUnits !== 'number' ||
    !Number.isFinite(completedUnits) ||
    !Number.isFinite(totalUnits) ||
    totalUnits <= 0
  ) {
    return undefined
  }
  return Math.max(0, Math.min(100, Math.round((completedUnits / totalUnits) * 100)))
}

export function buildJobNotice(
  jobs: TrackExtractionJob[],
  nowMs: number = Date.now(),
): StudioActionState {
  if (jobs.length === 0) {
    return {
      phase: 'success',
      message: '작업이 끝났습니다. 결과를 확인해 주세요.',
      source: 'job',
    }
  }

  const runningJobs = jobs.filter((job) => job.status === 'running')
  const queuedJobs = jobs.filter((job) => job.status === 'queued')
  const leadJob = runningJobs[0] ?? queuedJobs[0] ?? jobs[0]
  const progressPercent = getNoticeProgressPercent(leadJob)
  const progress = leadJob.progress
  const startedAtMs = Date.parse(leadJob.created_at)
  const detailParts: string[] = []

  if (progressPercent !== undefined && progress?.total_units) {
    const unitLabel = progress.unit_label ?? '개'
    detailParts.push(`${progress.completed_units ?? 0}/${progress.total_units}${unitLabel} 완료`)
  } else if (progress?.stage_label) {
    detailParts.push(progress.stage_label)
  }

  if (progressPercent === undefined) {
    detailParts.push(JOB_ESTIMATE_LABELS[leadJob.job_type])
  }
  if (jobs.length > 1) {
    detailParts.push(`함께 진행 중인 작업 ${jobs.length - 1}개`)
  }

  const elapsedSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
    : undefined

  return {
    phase: 'busy',
    message: sanitizeNoticeText(JOB_MESSAGES[leadJob.job_type], 'busy') ?? JOB_MESSAGES[leadJob.job_type],
    detail: sanitizeNoticeText(detailParts.join(' · '), 'busy'),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : undefined,
    elapsedSeconds,
    estimatedSecondsRemaining: progress?.estimated_seconds_remaining ?? undefined,
    progressPercent,
    source: 'job',
  }
}

export function buildPollingDelayNotice(failureCount: number): StudioActionState {
  if (failureCount >= 3) {
    return {
      phase: 'error',
      message: '상태 확인이 오래 지연되고 있습니다. 잠시 뒤 다시 확인해 주세요.',
      detail: '진행 중이던 작업은 중단하지 않았습니다.',
      source: 'activity',
    }
  }
  return {
    phase: 'warning',
    message: '상태 확인이 잠시 늦어지고 있습니다. 작업은 계속 진행됩니다.',
    detail: '화면은 곧 다시 확인합니다.',
    source: 'activity',
  }
}

export function sanitizeNoticeState(state: StudioActionState): StudioActionState {
  if (state.phase === 'idle') {
    return state
  }
  return {
    ...state,
    message: sanitizeNoticeText(state.message, state.phase) ?? state.message,
    detail: sanitizeNoticeText(state.detail, state.phase),
  }
}
