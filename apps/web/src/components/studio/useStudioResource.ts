import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { getStudio } from '../../lib/api'
import type { Studio } from '../../types/studio'

type StudioLoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

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

export function useStudioResource(
  studioId: string | undefined,
  onPollingError: (message: string) => void,
): StudioResourceState {
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<StudioLoadState>({ phase: 'loading' })
  const pollingErrorRef = useRef(onPollingError)

  useEffect(() => {
    pollingErrorRef.current = onPollingError
  }, [onPollingError])

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
    () => studio?.jobs.filter((job) => job.status === 'queued' || job.status === 'running') ?? [],
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
          if (!ignore) {
            setStudio(nextStudio)
          }
        })
        .catch(() => {
          if (!ignore) {
            pollingErrorRef.current(
              '추출 작업 상태를 새로고침하지 못했습니다. 스튜디오를 확인한 뒤 잠시 후 다시 시도해 주세요.',
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
