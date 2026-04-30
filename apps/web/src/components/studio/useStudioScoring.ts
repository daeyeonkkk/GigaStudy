import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { scoreTrack } from '../../lib/api'
import {
  beginMicrophoneCapture,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
} from '../../lib/audio'
import type { Studio, TrackSlot } from '../../types/studio'
import type { ScoreSessionState } from './ScoringDrawer'
import type { SetStudioActionState } from './studioActionState'

type UseStudioScoringArgs = {
  markReferencePlayback: (slotIds: number[]) => void
  metronomeEnabled: boolean
  recordingSlotId: number | null
  registeredSlotIds: number[]
  setActionState: SetStudioActionState
  setStudio: Dispatch<SetStateAction<Studio | null>>
  startMetronomeOnlyPlayback: () => boolean
  startPlaybackSession: (tracksToPlay: TrackSlot[], includeMetronome?: boolean) => Promise<boolean>
  stopPlaybackSession: () => void
  studio: Studio | null
}

export function useStudioScoring({
  markReferencePlayback,
  metronomeEnabled,
  recordingSlotId,
  registeredSlotIds,
  setActionState,
  setStudio,
  startMetronomeOnlyPlayback,
  startPlaybackSession,
  stopPlaybackSession,
  studio,
}: UseStudioScoringArgs) {
  const [scoreSession, setScoreSession] = useState<ScoreSessionState | null>(null)
  const scoreRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const scoreRunIdRef = useRef(0)

  const scoreTargetTrack = useMemo(
    () =>
      studio && scoreSession
        ? studio.tracks.find((track) => track.slot_id === scoreSession.targetSlotId) ?? null
        : null,
    [scoreSession, studio],
  )

  useEffect(() => {
    return () => {
      void stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
    }
  }, [])

  function openScoreSession(track: TrackSlot) {
    const references = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    if (track.status !== 'registered' && references.length === 0) {
      setActionState({
        phase: 'error',
        message: '정답 채점은 등록된 트랙이 필요하고, 화음 채점은 기준 트랙이 하나 이상 필요합니다.',
      })
      return
    }
    const scoreMode = track.status === 'registered' ? 'answer' : 'harmony'
    setScoreSession({
      targetSlotId: track.slot_id,
      scoreMode,
      selectedReferenceIds: references,
      playbackReferenceIds: references,
      includeMetronome: scoreMode === 'answer' ? metronomeEnabled || references.length === 0 : metronomeEnabled,
      phase: 'ready',
    })
  }

  function updateScoreMode(scoreMode: ScoreSessionState['scoreMode']) {
    setScoreSession((current) => {
      if (!current) {
        return current
      }
      const references = registeredSlotIds.filter((slotId) => slotId !== current.targetSlotId)
      const retainedSelectedReferenceIds = current.selectedReferenceIds.filter((slotId) =>
        references.includes(slotId),
      )
      const selectedReferenceIds =
        scoreMode === 'harmony' && retainedSelectedReferenceIds.length === 0
          ? references
          : retainedSelectedReferenceIds
      const retainedPlaybackReferenceIds = current.playbackReferenceIds.filter((slotId) =>
        selectedReferenceIds.includes(slotId),
      )
      const playbackReferenceIds =
        scoreMode === 'harmony' && retainedPlaybackReferenceIds.length === 0
          ? selectedReferenceIds
          : retainedPlaybackReferenceIds
      return {
        ...current,
        scoreMode,
        selectedReferenceIds,
        playbackReferenceIds,
        includeMetronome:
          scoreMode === 'answer'
            ? current.includeMetronome || selectedReferenceIds.length === 0
            : current.includeMetronome,
      }
    })
  }

  function toggleScoreReference(slotId: number) {
    setScoreSession((current) => {
      if (!current) {
        return current
      }
      const exists = current.selectedReferenceIds.includes(slotId)
      const selectedReferenceIds = exists
        ? current.selectedReferenceIds.filter((candidate) => candidate !== slotId)
        : [...current.selectedReferenceIds, slotId]
      const playbackReferenceIds = exists
        ? current.playbackReferenceIds.filter((candidate) => candidate !== slotId)
        : Array.from(new Set([...current.playbackReferenceIds, slotId]))
      return {
        ...current,
        selectedReferenceIds,
        playbackReferenceIds,
      }
    })
  }

  function toggleScoreReferencePlayback(slotId: number) {
    setScoreSession((current) => {
      if (!current || !current.selectedReferenceIds.includes(slotId)) {
        return current
      }
      const exists = current.playbackReferenceIds.includes(slotId)
      return {
        ...current,
        playbackReferenceIds: exists
          ? current.playbackReferenceIds.filter((candidate) => candidate !== slotId)
          : [...current.playbackReferenceIds, slotId],
      }
    })
  }

  function setScoreIncludeMetronome(includeMetronome: boolean) {
    setScoreSession((current) => current ? { ...current, includeMetronome } : current)
  }

  async function startScoreListening() {
    if (!scoreSession || !studio) {
      return
    }
    if (recordingSlotId !== null) {
      setActionState({
        phase: 'error',
        message: '트랙 녹음이 진행 중입니다. 먼저 현재 녹음을 중지하고 채점을 시작해 주세요.',
      })
      return
    }
    if (scoreSession.scoreMode === 'answer' && scoreTargetTrack?.status !== 'registered') {
      setActionState({ phase: 'error', message: '정답 채점은 먼저 대상 트랙이 등록되어 있어야 합니다.' })
      return
    }
    if (scoreSession.scoreMode === 'answer' && scoreSession.selectedReferenceIds.length === 0 && !scoreSession.includeMetronome) {
      setActionState({ phase: 'error', message: '정답 채점 기준으로 트랙이나 메트로놈을 하나 이상 선택하세요.' })
      return
    }
    if (scoreSession.scoreMode === 'harmony' && scoreSession.selectedReferenceIds.length === 0) {
      setActionState({ phase: 'error', message: '화음 채점은 기준 트랙을 하나 이상 선택해야 합니다.' })
      return
    }
    const runId = scoreRunIdRef.current + 1
    scoreRunIdRef.current = runId
    setActionState({ phase: 'busy', message: '채점용 마이크 입력을 준비합니다.' })
    const recorder = await startMicrophoneRecorder({ captureImmediately: false })
    if (scoreRunIdRef.current !== runId) {
      void stopMicrophoneRecorder(recorder)
      return
    }
    if (!recorder) {
      setActionState({
        phase: 'error',
        message: '마이크 입력을 열지 못했습니다. 브라우저 마이크 권한을 허용한 뒤 다시 시작해 주세요.',
      })
      return
    }

    const referenceTracks = studio.tracks.filter((track) =>
      scoreSession.selectedReferenceIds.includes(track.slot_id) &&
      scoreSession.playbackReferenceIds.includes(track.slot_id),
    )
    if (referenceTracks.length > 0) {
      setActionState({ phase: 'busy', message: '마이크와 기준 트랙을 같은 박자 기준으로 준비합니다.' })
      if (!(await startPlaybackSession(referenceTracks, scoreSession.includeMetronome))) {
        void stopMicrophoneRecorder(recorder)
        return
      }
      markReferencePlayback(referenceTracks.map((track) => track.slot_id))
    } else if (scoreSession.includeMetronome) {
      if (!startMetronomeOnlyPlayback()) {
        void stopMicrophoneRecorder(recorder)
        setActionState({
          phase: 'error',
          message: '메트로놈 재생용 오디오 장치를 열지 못했습니다.',
        })
        return
      }
    }

    if (!beginMicrophoneCapture(recorder)) {
      void stopMicrophoneRecorder(recorder)
      stopPlaybackSession()
      setActionState({
        phase: 'error',
        message: '마이크 입력 캡처를 시작하지 못했습니다. 다시 시도해 주세요.',
      })
      return
    }
    scoreRecorderRef.current = recorder
    setScoreSession({ ...scoreSession, phase: 'listening' })
    setActionState({
      phase: 'success',
      message:
        scoreSession.scoreMode === 'harmony'
          ? '선택한 트랙 위에 새 파트를 얹어 부르면 화음 완성도를 채점합니다.'
          : '선택한 기준 트랙과 동시에 채점 입력을 받습니다.',
    })
  }

  async function stopScoreListening() {
    if (!studio || !scoreSession) {
      return
    }

    const session = scoreSession
    if (session.scoreMode === 'answer' && scoreTargetTrack?.status !== 'registered') {
      setActionState({ phase: 'error', message: '정답 채점은 먼저 대상 트랙이 등록되어 있어야 합니다.' })
      return
    }
    if (session.scoreMode === 'answer' && session.selectedReferenceIds.length === 0 && !session.includeMetronome) {
      setActionState({ phase: 'error', message: '정답 채점 기준으로 트랙이나 메트로놈을 하나 이상 선택하세요.' })
      return
    }
    if (session.scoreMode === 'harmony' && session.selectedReferenceIds.length === 0) {
      setActionState({ phase: 'error', message: '화음 채점은 기준 트랙을 하나 이상 선택해야 합니다.' })
      return
    }

    setScoreSession({ ...session, phase: 'analyzing' })
    setActionState({
      phase: 'busy',
      message:
        session.scoreMode === 'harmony'
          ? '새 파트가 기준 트랙들과 어울리는지 분석하는 중입니다.'
          : '0.01s 단위로 박자와 음정을 채점하는 중입니다.',
    })
    try {
      scoreRunIdRef.current += 1
      const performanceAudioBase64 = await stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
      stopPlaybackSession()
      if (!performanceAudioBase64) {
        setScoreSession({ ...session, phase: 'ready' })
        setActionState({
          phase: 'error',
          message: '녹음된 채점 입력이 없습니다. 마이크 권한과 입력 레벨을 확인한 뒤 다시 시작해 주세요.',
        })
        return
      }
      const nextStudio = await scoreTrack(studio.studio_id, session.targetSlotId, {
        score_mode: session.scoreMode,
        reference_slot_ids: session.selectedReferenceIds,
        include_metronome: session.includeMetronome,
        performance_audio_base64: performanceAudioBase64,
        performance_filename: `${scoreTargetTrack?.name ?? 'track'}-score-take.wav`,
      })
      setStudio(nextStudio)
      setScoreSession(null)
      setActionState({
        phase: 'success',
        message:
          session.scoreMode === 'harmony'
            ? '화음 채점 리포트를 하단 피드에 등록했습니다.'
            : '채점 리포트를 하단 피드에 등록했습니다.',
      })
    } catch (error) {
      setScoreSession({ ...session, phase: 'ready' })
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '채점 리포트를 만들지 못했습니다.',
      })
    }
  }

  return {
    cancelScoreSession: () => setScoreSession(null),
    openScoreSession,
    scoreSession,
    scoreTargetTrack,
    setScoreIncludeMetronome,
    startScoreListening,
    stopScoreListening,
    toggleScoreReference,
    toggleScoreReferencePlayback,
    updateScoreMode,
  }
}
