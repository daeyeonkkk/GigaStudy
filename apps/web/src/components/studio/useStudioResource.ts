import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import {
  buildApiLoadingNotice,
  buildApiFailureNotice,
  buildApiRetryNotice,
  getApiRetryDelayMs,
  shouldRetryApiRequest,
} from '../../lib/apiRetry'
import { getStudio, getStudioActivity, recoverStaleDocumentJobs } from '../../lib/api'
import type { Studio, StudioActivity, TrackExtractionJob } from '../../types/studio'
import type { StudioActionState } from './studioActionState'
import { buildJobNotice, buildPollingDelayNotice } from './studioNoticePresenter'

type StudioLoadState =
  | { phase: 'loading'; message: string }
  | { phase: 'ready' }
  | { phase: 'error'; message: string; retrying: boolean }

type StudioResourceState = {
  activeExtractionJobs: Studio['jobs']
  loadState: StudioLoadState
  pendingCandidates: Studio['candidates']
  registeredSlotIds: number[]
  registeredTracks: Studio['tracks']
  reloadStudio: () => void
  setStudio: Dispatch<SetStateAction<Studio | null>>
  studio: Studio | null
  visibleExtractionJobs: Studio['jobs']
}

const ACTIVITY_REQUEST_TIMEOUT_MS = 5000
const DOCUMENT_JOB_STALE_MS = 30 * 60 * 1000

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

export function getActivityFailureDelayMs(failureCount: number): number {
  if (failureCount <= 1) {
    return 2500
  }
  if (failureCount === 2) {
    return 5000
  }
  return 12000
}

export function staleRunningDocumentJobs(
  jobs: TrackExtractionJob[],
  nowMs: number = Date.now(),
): TrackExtractionJob[] {
  return jobs.filter((job) => {
    if (job.job_type !== 'document' || job.status !== 'running') {
      return false
    }
    const updatedAtMs = Date.parse(job.updated_at)
    return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= DOCUMENT_JOB_STALE_MS
  })
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

export function shouldNotifyJobCompletionFromPoll(
  pollStartedWithActiveJobs: boolean,
  jobs: TrackExtractionJob[],
): boolean {
  return pollStartedWithActiveJobs && activeJobs(jobs).length === 0
}

export function useStudioResource(
  studioId: string | undefined,
  onPollingIssue: (notice: StudioActionState) => void,
  onJobActivity?: (notice: StudioActionState) => void,
  view: 'full' | 'studio' | 'edit' | 'practice' = 'full',
): StudioResourceState {
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<StudioLoadState>({
    phase: 'loading',
    message: buildApiLoadingNotice('스튜디오').message,
  })
  const [reloadKey, setReloadKey] = useState(0)
  const pollingIssueRef = useRef(onPollingIssue)
  const jobActivityRef = useRef(onJobActivity)
  const previousActiveJobCountRef = useRef(0)
  const studioRef = useRef<Studio | null>(null)
  const staleRecoveryAttemptedRef = useRef<Set<string>>(new Set())

  const reloadStudio = useCallback(() => {
    setLoadState({
      phase: 'loading',
      message: buildApiLoadingNotice('스튜디오', true).message,
    })
    setReloadKey((currentKey) => currentKey + 1)
  }, [])

  useEffect(() => {
    pollingIssueRef.current = onPollingIssue
  }, [onPollingIssue])

  useEffect(() => {
    jobActivityRef.current = onJobActivity
  }, [onJobActivity])

  useEffect(() => {
    studioRef.current = studio
  }, [studio])

  useEffect(() => {
    staleRecoveryAttemptedRef.current.clear()
  }, [studioId])

  useEffect(() => {
    let ignore = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    if (!studioId) {
      return () => {
        ignore = true
        clearRetryTimer()
      }
    }

    const loadStudio = (attemptIndex: number) => {
      controller?.abort()
      controller = new AbortController()
      if (attemptIndex === 0) {
        setLoadState({
          phase: 'loading',
          message: buildApiLoadingNotice('스튜디오').message,
        })
      } else {
        setLoadState((current) =>
          current.phase === 'error'
            ? { ...current, retrying: true }
            : {
                phase: 'loading',
                message: buildApiLoadingNotice('스튜디오', true).message,
              },
        )
      }

      getStudio(studioId, { signal: controller.signal, view })
        .then((nextStudio) => {
          if (!ignore) {
            clearRetryTimer()
            previousActiveJobCountRef.current = activeJobs(nextStudio.jobs).length
            setStudio(nextStudio)
            setLoadState({ phase: 'ready' })
            const nextActiveJobs = activeJobs(nextStudio.jobs)
            if (nextActiveJobs.length > 0) {
              jobActivityRef.current?.(buildJobNotice(nextActiveJobs))
            }
          }
        })
        .catch((error) => {
          if (ignore || controller?.signal.aborted) {
            return
          }
          if (!shouldRetryApiRequest(error)) {
            const notice = buildApiFailureNotice('스튜디오', error)
            setLoadState({ phase: 'error', message: notice.message, retrying: false })
            return
          }
          const delayMs = getApiRetryDelayMs(attemptIndex)
          const notice = buildApiRetryNotice('스튜디오', attemptIndex, delayMs, error)
          setLoadState(
            attemptIndex >= 2
              ? { phase: 'error', message: notice.message, retrying: true }
              : { phase: 'loading', message: notice.message },
          )
          clearRetryTimer()
          retryTimer = setTimeout(() => loadStudio(attemptIndex + 1), delayMs)
        })
    }

    loadStudio(0)

    return () => {
      ignore = true
      clearRetryTimer()
      controller?.abort()
    }
  }, [reloadKey, studioId, view])

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
    let requestTimeoutId = 0
    let pollCount = 0
    let failureCount = 0
    let controller: AbortController | null = null

    const clearRequestTimeout = () => {
      if (requestTimeoutId !== 0) {
        window.clearTimeout(requestTimeoutId)
        requestTimeoutId = 0
      }
    }

    const scheduleNextPoll = (jobs: TrackExtractionJob[], delayOverrideMs?: number) => {
      const delayMs = delayOverrideMs ?? getActivityPollingDelayMs(jobs, pollCount)
      if (delayMs <= 0 || ignore) {
        return
      }
      window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(pollActivity, delayMs)
    }

    const pollActivity = () => {
      pollCount += 1
      controller?.abort()
      controller = new AbortController()
      let timedOut = false
      requestTimeoutId = window.setTimeout(() => {
        timedOut = true
        controller?.abort()
      }, ACTIVITY_REQUEST_TIMEOUT_MS)

      getStudioActivity(studioId, { signal: controller.signal })
        .then(async (activity) => {
          clearRequestTimeout()
          if (ignore) {
            return
          }
          failureCount = 0
          const staleJobs = staleRunningDocumentJobs(activity.jobs)
          const unrecoveredStaleJob = staleJobs.find((job) => !staleRecoveryAttemptedRef.current.has(job.job_id))
          if (unrecoveredStaleJob) {
            staleRecoveryAttemptedRef.current.add(unrecoveredStaleJob.job_id)
            const recoveredStudio = await recoverStaleDocumentJobs(studioId)
            if (ignore) {
              return
            }
            const nextActiveJobs = activeJobs(recoveredStudio.jobs)
            setStudio(recoveredStudio)
            if (nextActiveJobs.length > 0) {
              jobActivityRef.current?.(buildJobNotice(nextActiveJobs))
            } else if (shouldNotifyJobCompletionFromPoll(activeExtractionJobCount > 0, recoveredStudio.jobs)) {
              jobActivityRef.current?.(buildJobNotice([]))
            }
            previousActiveJobCountRef.current = nextActiveJobs.length
            scheduleNextPoll(recoveredStudio.jobs)
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
              jobActivityRef.current?.(buildJobNotice(nextActiveJobs))
            } else if (shouldNotifyJobCompletionFromPoll(activeExtractionJobCount > 0, nextStudio.jobs)) {
              jobActivityRef.current?.(buildJobNotice([]))
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
            jobActivityRef.current?.(buildJobNotice(nextActiveJobs))
          } else if (shouldNotifyJobCompletionFromPoll(activeExtractionJobCount > 0, activity.jobs)) {
            jobActivityRef.current?.(buildJobNotice([]))
          }
          previousActiveJobCountRef.current = nextActiveJobs.length
          scheduleNextPoll(activity.jobs)
        })
        .catch(() => {
          clearRequestTimeout()
          if (ignore) {
            return
          }
          if (controller?.signal.aborted && !timedOut) {
            return
          }
          failureCount += 1
          pollingIssueRef.current(buildPollingDelayNotice(failureCount))
          scheduleNextPoll(studioRef.current?.jobs ?? [], getActivityFailureDelayMs(failureCount))
        })
    }

    scheduleNextPoll(activeJobs(studioRef.current?.jobs ?? []))

    return () => {
      ignore = true
      clearRequestTimeout()
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
    reloadStudio,
    setStudio,
    studio,
    visibleExtractionJobs,
  }
}
