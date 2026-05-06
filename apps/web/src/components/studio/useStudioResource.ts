import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { getStudio, getStudioActivity } from '../../lib/api'
import type { Studio, StudioActivity, TrackExtractionJob } from '../../types/studio'

type StudioLoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

type JobActivityPhase = 'busy' | 'success'

type StudioResourceState = {
  activeExtractionJobs: Studio['jobs']
  loadState: StudioLoadState
  pendingCandidates: Studio['candidates']
  registeredSlotIds: number[]
  registeredTracks: Studio['tracks']
  setStudio: Dispatch<SetStateAction<Studio | null>>
  studio: Studio | null
  visibleExtractionJobs: Studio['jobs']
}

export function activeJobs(jobs: TrackExtractionJob[]): TrackExtractionJob[] {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'running')
}

export function getActivityPollingDelayMs(jobs: TrackExtractionJob[], pollCount: number): number {
  const active = activeJobs(jobs)
  if (active.some((job) => job.status === 'running')) {
    return 1200
  }
  if (active.some((job) => job.status === 'queued')) {
    return pollCount >= 4 ? 5000 : 2500
  }
  return 0
}

export function shouldRefreshStudioFromActivity(
  currentStudio: Studio | null,
  activity: StudioActivity,
  previousActiveJobCount: number,
): boolean {
  if (!currentStudio || currentStudio.studio_id !== activity.studio_id) {
    return true
  }
  if (
    activity.pending_candidate_count !==
    currentStudio.candidates.filter((candidate) => candidate.status === 'pending').length
  ) {
    return true
  }
  if (activity.report_count !== currentStudio.reports.length) {
    return true
  }
  if (
    activity.registered_track_count !==
    currentStudio.tracks.filter((track) => track.status === 'registered').length
  ) {
    return true
  }
  return previousActiveJobCount > 0 && activeJobs(activity.jobs).length === 0
}

function jobTargetLabel(job: TrackExtractionJob): string {
  if (job.parse_all_parts) {
    return '악보 파일'
  }
  return `트랙 ${job.slot_id}`
}

function describeJobActivity(jobs: TrackExtractionJob[]): string {
  if (jobs.length === 0) {
    return '분석이 끝났습니다. 준비된 결과를 확인해 주세요.'
  }

  const runningJobs = jobs.filter((job) => job.status === 'running')
  const queuedJobs = jobs.filter((job) => job.status === 'queued')
  const leadJob = runningJobs[0] ?? queuedJobs[0]
  const verb = leadJob.status === 'running' ? '처리 중' : '대기 중'
  const kind =
    leadJob.job_type === 'voice'
      ? '녹음 분석'
      : leadJob.job_type === 'generation'
        ? 'AI 생성'
        : leadJob.job_type === 'scoring'
          ? '채점'
          : '악보 분석'
  const queueTail = jobs.length > 1 ? `, 남은 작업 ${jobs.length - 1}개` : ''
  return `${jobTargetLabel(leadJob)} ${kind} ${verb}입니다${queueTail}.`
}

export function useStudioResource(
  studioId: string | undefined,
  onPollingError: (message: string) => void,
  onJobActivity?: (message: string, phase?: JobActivityPhase) => void,
  view: 'full' | 'studio' | 'edit' | 'practice' = 'full',
): StudioResourceState {
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<StudioLoadState>({ phase: 'loading' })
  const pollingErrorRef = useRef(onPollingError)
  const jobActivityRef = useRef(onJobActivity)
  const previousActiveJobCountRef = useRef(0)
  const studioRef = useRef<Studio | null>(null)

  useEffect(() => {
    pollingErrorRef.current = onPollingError
  }, [onPollingError])

  useEffect(() => {
    jobActivityRef.current = onJobActivity
  }, [onJobActivity])

  useEffect(() => {
    studioRef.current = studio
  }, [studio])

  useEffect(() => {
    let ignore = false
    const controller = new AbortController()

    if (!studioId) {
      return () => {
        ignore = true
      }
    }

    getStudio(studioId, { signal: controller.signal, view })
      .then((nextStudio) => {
        if (!ignore) {
          previousActiveJobCountRef.current = activeJobs(nextStudio.jobs).length
          setStudio(nextStudio)
          setLoadState({ phase: 'ready' })
        }
      })
      .catch((error) => {
        if (!ignore && !controller.signal.aborted) {
          setLoadState({
            phase: 'error',
            message: error instanceof Error ? error.message : '스튜디오를 불러오지 못했습니다.',
          })
        }
      })

    return () => {
      ignore = true
      controller.abort()
    }
  }, [studioId, view])

  const registeredTracks = useMemo(
    () => studio?.tracks.filter((track) => track.status === 'registered') ?? [],
    [studio],
  )
  const registeredSlotIds = useMemo(
    () => registeredTracks.map((track) => track.slot_id),
    [registeredTracks],
  )
  const pendingCandidates = useMemo(
    () => studio?.candidates.filter((candidate) => candidate.status === 'pending') ?? [],
    [studio],
  )
  const activeExtractionJobs = useMemo(
    () => activeJobs(studio?.jobs ?? []),
    [studio],
  )
  const activeExtractionJobCount = activeExtractionJobs.length
  const visibleExtractionJobs = useMemo(
    () => studio?.jobs.slice().reverse() ?? [],
    [studio],
  )

  useEffect(() => {
    if (!studioId || activeExtractionJobCount === 0) {
      return undefined
    }

    let ignore = false
    let timeoutId = 0
    let pollCount = 0
    let controller: AbortController | null = null

    const scheduleNextPoll = (jobs: TrackExtractionJob[]) => {
      const delayMs = getActivityPollingDelayMs(jobs, pollCount)
      if (delayMs <= 0 || ignore) {
        return
      }
      timeoutId = window.setTimeout(pollActivity, delayMs)
    }

    const pollActivity = () => {
      pollCount += 1
      controller?.abort()
      controller = new AbortController()
      getStudioActivity(studioId, { signal: controller.signal })
        .then(async (activity) => {
          if (ignore) {
            return
          }
          const needsFullRefresh = shouldRefreshStudioFromActivity(
            studioRef.current,
            activity,
            previousActiveJobCountRef.current,
          )
          if (needsFullRefresh) {
            const nextStudio = await getStudio(studioId, { signal: controller?.signal, view })
            if (ignore) {
              return
            }
            const nextActiveJobs = activeJobs(nextStudio.jobs)
            setStudio(nextStudio)
            if (nextActiveJobs.length > 0) {
              jobActivityRef.current?.(describeJobActivity(nextActiveJobs), 'busy')
            } else if (previousActiveJobCountRef.current > 0) {
              jobActivityRef.current?.(describeJobActivity(nextActiveJobs), 'success')
            }
            previousActiveJobCountRef.current = nextActiveJobs.length
            scheduleNextPoll(nextStudio.jobs)
            return
          }

          const nextActiveJobs = activeJobs(activity.jobs)
          setStudio((current) =>
            current && current.studio_id === activity.studio_id
              ? {
                  ...current,
                  jobs: activity.jobs,
                  updated_at: activity.updated_at,
                }
              : current,
          )
          if (nextActiveJobs.length > 0) {
            jobActivityRef.current?.(describeJobActivity(nextActiveJobs), 'busy')
          }
          previousActiveJobCountRef.current = nextActiveJobs.length
          scheduleNextPoll(activity.jobs)
        })
        .catch(() => {
          if (!ignore && controller?.signal.aborted !== true) {
            pollingErrorRef.current(
              '작업 상태를 새로고침하지 못했습니다. 잠시 뒤 다시 확인해 주세요.',
            )
            scheduleNextPoll(studioRef.current?.jobs ?? [])
          }
        })
    }

    scheduleNextPoll(activeJobs(studioRef.current?.jobs ?? []))

    return () => {
      ignore = true
      controller?.abort()
      window.clearTimeout(timeoutId)
    }
  }, [activeExtractionJobCount, studioId, view])

  return {
    activeExtractionJobs,
    loadState,
    pendingCandidates,
    registeredSlotIds,
    registeredTracks,
    setStudio,
    studio,
    visibleExtractionJobs,
  }
}
