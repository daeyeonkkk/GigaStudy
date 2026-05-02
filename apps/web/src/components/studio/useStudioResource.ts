import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { getStudio } from '../../lib/api'
import type { Studio, TrackExtractionJob } from '../../types/studio'

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

function activeJobs(jobs: TrackExtractionJob[]): TrackExtractionJob[] {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'running')
}

function jobTargetLabel(job: TrackExtractionJob): string {
  if (job.parse_all_parts) {
    return '전체 문서'
  }
  return `Track ${job.slot_id}`
}

function describeJobActivity(jobs: TrackExtractionJob[]): string {
  if (jobs.length === 0) {
    return '추출 작업이 끝났습니다. 준비된 후보를 검토해 주세요.'
  }

  const runningJobs = jobs.filter((job) => job.status === 'running')
  const queuedJobs = jobs.filter((job) => job.status === 'queued')
  const leadJob = runningJobs[0] ?? queuedJobs[0]
  const verb = leadJob.status === 'running' ? '처리 중' : '대기 중'
  const kind = leadJob.job_type === 'voice' ? '음성 추출' : '문서 분석'
  const queueTail = jobs.length > 1 ? `, 남은 작업 ${jobs.length - 1}개` : ''
  return `${jobTargetLabel(leadJob)} ${kind} ${verb}입니다${queueTail}. 완료되면 후보 검토 목록에 표시됩니다.`
}

export function useStudioResource(
  studioId: string | undefined,
  onPollingError: (message: string) => void,
  onJobActivity?: (message: string, phase?: JobActivityPhase) => void,
): StudioResourceState {
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<StudioLoadState>({ phase: 'loading' })
  const pollingErrorRef = useRef(onPollingError)
  const jobActivityRef = useRef(onJobActivity)
  const previousActiveJobCountRef = useRef(0)

  useEffect(() => {
    pollingErrorRef.current = onPollingError
  }, [onPollingError])

  useEffect(() => {
    jobActivityRef.current = onJobActivity
  }, [onJobActivity])

  useEffect(() => {
    let ignore = false

    if (!studioId) {
      return () => {
        ignore = true
      }
    }

    getStudio(studioId)
      .then((nextStudio) => {
        if (!ignore) {
          previousActiveJobCountRef.current = activeJobs(nextStudio.jobs).length
          setStudio(nextStudio)
          setLoadState({ phase: 'ready' })
        }
      })
      .catch((error) => {
        if (!ignore) {
          setLoadState({
            phase: 'error',
            message: error instanceof Error ? error.message : '스튜디오를 불러오지 못했습니다.',
          })
        }
      })

    return () => {
      ignore = true
    }
  }, [studioId])

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
  const visibleExtractionJobs = useMemo(
    () => studio?.jobs.slice().reverse() ?? [],
    [studio],
  )

  useEffect(() => {
    if (!studioId || activeExtractionJobs.length === 0) {
      return undefined
    }

    let ignore = false
    const intervalId = window.setInterval(() => {
      getStudio(studioId)
        .then((nextStudio) => {
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
        })
        .catch(() => {
          if (!ignore) {
            pollingErrorRef.current(
              '추출 작업 상태를 새로고침하지 못했습니다. 스튜디오를 확인한 뒤 다시 시도해 주세요.',
            )
          }
        })
    }, 1200)

    return () => {
      ignore = true
      window.clearInterval(intervalId)
    }
  }, [activeExtractionJobs.length, studioId])

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
