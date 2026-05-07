import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import {
  createScoringUploadTarget,
  putDirectUpload,
  scoreTrack,
} from '../../lib/api'
import {
  beginMicrophoneCapture,
  dataUrlToBlob,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
} from '../../lib/audio'
import {
  COUNT_IN_FIRST_PULSE_DELAY_MS,
  COUNT_IN_ZERO_HOLD_MS,
  disposePlaybackSession,
  formatTrackName,
  getBeatSeconds,
  getCountInCapturePrerollMs,
  getCountInDisplayValue,
  getCountInStartOffsetPulses,
  getCountInTotalPulses,
  startLoopingMetronomeSession,
  type MeterContext,
  type PlaybackRoute,
  type PlaybackSession,
} from '../../lib/studio'
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
  startPlaybackSession: (
    tracksToPlay: TrackSlot[],
    includeMetronome?: boolean,
    options?: {
      onStartScheduled?: (scheduledStartAtMs: number) => void
      onScheduledStart?: () => void
      route?: PlaybackRoute
      scheduledStartAtMs?: number
      scheduledStartLeadMs?: number
      startSeconds?: number
    },
  ) => Promise<boolean>
  stopPlaybackSession: () => void
  studio: Studio | null
  studioMeter: MeterContext
}

export type PendingScoreRecording = {
  audioDataUrl: string
  createdAtMs: number
  durationSeconds: number
  expiresAtMs: number
  filename: string
  includeMetronome: boolean
  referenceSlotIds: number[]
  scoreMode: ScoreSessionState['scoreMode']
  slotId: number
  trackName: string
}

const PENDING_SCORE_RECORDING_RETENTION_MS = 30 * 60 * 1000

export function isPendingScoreRecordingExpired(
  recording: PendingScoreRecording,
  nowMs = Date.now(),
): boolean {
  return recording.expiresAtMs <= nowMs
}

export function useStudioScoring({
  markReferencePlayback,
  metronomeEnabled,
  recordingSlotId,
  registeredSlotIds,
  setActionState,
  setStudio,
  startPlaybackSession,
  stopPlaybackSession,
  studio,
  studioMeter,
}: UseStudioScoringArgs) {
  const [scoreSession, setScoreSession] = useState<ScoreSessionState | null>(null)
  const [pendingScoreRecording, setPendingScoreRecording] = useState<PendingScoreRecording | null>(null)
  const scoreCountInMetronomeSessionRef = useRef<PlaybackSession | null>(null)
  const scoreCountInTimeoutIdsRef = useRef<number[]>([])
  const scoreRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const scoreRunIdRef = useRef(0)

  const scoreTargetTrack = useMemo(
    () =>
      studio && scoreSession
        ? studio.tracks.find((track) => track.slot_id === scoreSession.targetSlotId) ?? null
        : null,
    [scoreSession, studio],
  )

  function clearScoreCountInTimers() {
    scoreCountInTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    scoreCountInTimeoutIdsRef.current = []
  }

  function disposeScoreCountInMetronome() {
    disposePlaybackSession(scoreCountInMetronomeSessionRef.current)
    scoreCountInMetronomeSessionRef.current = null
  }

  function stopScoreSessionPlayback() {
    clearScoreCountInTimers()
    disposeScoreCountInMetronome()
    stopPlaybackSession()
    markReferencePlayback([])
  }

  function cancelScoreSession() {
    scoreRunIdRef.current += 1
    stopScoreSessionPlayback()
    void stopMicrophoneRecorder(scoreRecorderRef.current)
    scoreRecorderRef.current = null
    setScoreSession(null)
  }

  useEffect(() => {
    return () => {
      clearScoreCountInTimers()
      disposePlaybackSession(scoreCountInMetronomeSessionRef.current)
      scoreCountInMetronomeSessionRef.current = null
      void stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
    }
  }, [])

  useEffect(() => {
    if (pendingScoreRecording === null) {
      return undefined
    }
    if (isPendingScoreRecordingExpired(pendingScoreRecording, Date.now())) {
      const timeoutId = window.setTimeout(() => {
        setActionState({
          phase: 'success',
          message: `${formatTrackName(pendingScoreRecording.trackName)} 채점 녹음 보관 시간이 지나 임시 녹음을 비웠습니다.`,
        })
        setPendingScoreRecording(null)
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }
    const timeoutId = window.setTimeout(() => {
      setPendingScoreRecording((current) => {
        if (!current || !isPendingScoreRecordingExpired(current, Date.now())) {
          return current
        }
        setActionState({
          phase: 'success',
          message: `${formatTrackName(current.trackName)} 채점 녹음 보관 시간이 지나 임시 녹음을 비웠습니다.`,
        })
        return null
      })
    }, pendingScoreRecording.expiresAtMs - Date.now())
    return () => window.clearTimeout(timeoutId)
  }, [pendingScoreRecording, setActionState])

  function openScoreSession(track: TrackSlot) {
    if (pendingScoreRecording !== null) {
      setActionState({
        phase: 'error',
        message: '확인 대기 중인 채점 녹음이 있습니다. 먼저 채점하거나 삭제해 주세요.',
      })
      return
    }
    const references = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    if (track.status !== 'registered' && references.length === 0) {
      setActionState({
        phase: 'error',
        message: '정답 채점에는 등록된 대상 트랙이 필요하고, 화음 채점에는 기준 트랙이 하나 이상 필요합니다.',
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
    setScoreSession((current) => (current ? { ...current, includeMetronome } : current))
  }

  function validateScoreSession(session: ScoreSessionState): boolean {
    if (session.scoreMode === 'answer' && scoreTargetTrack?.status !== 'registered') {
      setActionState({ phase: 'error', message: '정답 채점은 먼저 대상 트랙이 등록되어 있어야 합니다.' })
      return false
    }
    if (session.scoreMode === 'answer' && session.selectedReferenceIds.length === 0 && !session.includeMetronome) {
      setActionState({ phase: 'error', message: '정답 채점 기준으로 트랙이나 메트로놈을 하나 이상 선택하세요.' })
      return false
    }
    if (session.scoreMode === 'harmony' && session.selectedReferenceIds.length === 0) {
      setActionState({ phase: 'error', message: '화음 채점은 기준 트랙을 하나 이상 선택해야 합니다.' })
      return false
    }
    return true
  }

  async function startScoreListening() {
    if (!scoreSession || !studio) {
      return
    }
    const session = scoreSession
    if (recordingSlotId !== null) {
      setActionState({
        phase: 'error',
        message: '트랙 녹음이 진행 중입니다. 현재 녹음을 끝낸 뒤 채점을 시작해 주세요.',
      })
      return
    }
    if (pendingScoreRecording !== null) {
      setActionState({
        phase: 'error',
        message: '확인 대기 중인 채점 녹음이 있습니다. 먼저 채점하거나 삭제해 주세요.',
      })
      return
    }
    if (!validateScoreSession(session)) {
      return
    }

    const runId = scoreRunIdRef.current + 1
    scoreRunIdRef.current = runId
    stopScoreSessionPlayback()
    setActionState({ phase: 'busy', message: '채점 녹음을 준비하는 중입니다.' })
    const recorder = await startMicrophoneRecorder({ captureImmediately: false })
    if (scoreRunIdRef.current !== runId) {
      void stopMicrophoneRecorder(recorder)
      return
    }
    if (!recorder) {
      setActionState({
        phase: 'error',
        message: '마이크 입력을 열지 못했습니다. 브라우저 마이크 권한을 확인하고 다시 시작해 주세요.',
      })
      return
    }
    scoreRecorderRef.current = recorder

    const referenceTracks = studio.tracks.filter((track) =>
      session.selectedReferenceIds.includes(track.slot_id) &&
      session.playbackReferenceIds.includes(track.slot_id),
    )
    const totalPulses = getCountInTotalPulses(studioMeter)
    const pulseMilliseconds = getBeatSeconds(studio.bpm) * studioMeter.pulseQuarterBeats * 1000
    const countInLeadMilliseconds =
      COUNT_IN_FIRST_PULSE_DELAY_MS + getCountInStartOffsetPulses(totalPulses) * pulseMilliseconds
    const scheduleCountInAt = (targetMilliseconds: number, callback: () => void) => {
      const timeoutId = window.setTimeout(callback, Math.max(0, Math.round(targetMilliseconds - performance.now())))
      scoreCountInTimeoutIdsRef.current.push(timeoutId)
    }
    let captureStarted = false
    const startScoreCapture = () => {
      if (captureStarted) {
        return true
      }
      if (!beginMicrophoneCapture(recorder)) {
        scoreRunIdRef.current += 1
        stopScoreSessionPlayback()
        void stopMicrophoneRecorder(recorder)
        scoreRecorderRef.current = null
        setScoreSession({ ...session, phase: 'ready', countIn: null })
        setActionState({
          phase: 'error',
          message: '마이크 입력을 시작하지 못했습니다. 다시 시도해 주세요.',
        })
        return false
      }
      captureStarted = true
      return true
    }
    const finishScoreCountIn = (audibleSlotIds: number[], keepMetronomeRunning: boolean) => {
      if (scoreRunIdRef.current !== runId) {
        return
      }
      clearScoreCountInTimers()
      if (!keepMetronomeRunning) {
        disposeScoreCountInMetronome()
      }
      if (!startScoreCapture()) {
        return
      }
      if (audibleSlotIds.length > 0) {
        markReferencePlayback(audibleSlotIds)
      }
      setScoreSession({ ...session, phase: 'listening', countIn: { pulsesRemaining: 0, totalPulses } })
      setActionState({
        phase: 'success',
        message:
          session.scoreMode === 'harmony'
            ? '선택한 기준 트랙 위에 새 파트를 불러 주세요. 녹음이 끝나면 채점 여부를 확인합니다.'
            : '선택한 기준 소리를 들으며 불러 주세요. 녹음이 끝나면 채점 여부를 확인합니다.',
      })
      const hideZeroTimeoutId = window.setTimeout(() => {
        if (scoreRunIdRef.current !== runId) {
          return
        }
        setScoreSession((current) =>
          current?.phase === 'listening' ? { ...current, countIn: null } : current,
        )
      }, COUNT_IN_ZERO_HOLD_MS)
      scoreCountInTimeoutIdsRef.current.push(hideZeroTimeoutId)
    }
    const scheduleVisibleCountIn = (performanceStartAtMs: number) => {
      if (scoreRunIdRef.current !== runId) {
        return
      }
      const countInEpochMilliseconds =
        performanceStartAtMs - getCountInStartOffsetPulses(totalPulses) * pulseMilliseconds
      const capturePrerollAtMs = Math.max(
        performance.now(),
        performanceStartAtMs - getCountInCapturePrerollMs(pulseMilliseconds),
      )

      if (session.includeMetronome) {
        disposeScoreCountInMetronome()
        scoreCountInMetronomeSessionRef.current = startLoopingMetronomeSession(
          studio.bpm,
          studioMeter,
          Math.max(0.02, (countInEpochMilliseconds - performance.now()) / 1000),
        )
      }
      setScoreSession({
        ...session,
        phase: 'counting_in',
        countIn: {
          pulsesRemaining: getCountInDisplayValue(totalPulses, 0),
          totalPulses,
        },
      })
      setActionState({
        phase: 'success',
        message: '카운트인 뒤 기준 소리와 녹음이 같은 박자에서 시작됩니다.',
      })
      for (let pulseIndex = 1; pulseIndex < totalPulses - 1; pulseIndex += 1) {
        scheduleCountInAt(countInEpochMilliseconds + pulseIndex * pulseMilliseconds, () => {
          if (scoreRunIdRef.current !== runId) {
            return
          }
          setScoreSession({
            ...session,
            phase: 'counting_in',
            countIn: {
              pulsesRemaining: getCountInDisplayValue(totalPulses, pulseIndex),
              totalPulses,
            },
          })
        })
      }
      scheduleCountInAt(capturePrerollAtMs, () => {
        if (scoreRunIdRef.current !== runId) {
          return
        }
        startScoreCapture()
      })
    }

    if (referenceTracks.length > 0) {
      setActionState({ phase: 'busy', message: '기준 트랙을 카운트인 첫 박자에 맞춰 준비합니다.' })
      const playbackStarted = await startPlaybackSession(referenceTracks, session.includeMetronome, {
        onStartScheduled: scheduleVisibleCountIn,
        onScheduledStart: () => finishScoreCountIn(referenceTracks.map((track) => track.slot_id), false),
        route: 'scoring',
        scheduledStartLeadMs: countInLeadMilliseconds,
        startSeconds: 0,
      })
      if (!playbackStarted) {
        scoreRunIdRef.current += 1
        stopScoreSessionPlayback()
        void stopMicrophoneRecorder(recorder)
        scoreRecorderRef.current = null
        setScoreSession({ ...session, phase: 'ready', countIn: null })
      }
      return
    }

    const performanceStartAtMs = performance.now() + countInLeadMilliseconds
    scheduleVisibleCountIn(performanceStartAtMs)
    scheduleCountInAt(performanceStartAtMs, () => {
      finishScoreCountIn([], session.includeMetronome)
    })
  }

  async function stopScoreListening() {
    if (!scoreSession) {
      return
    }
    const session = scoreSession
    if (session.phase === 'counting_in') {
      scoreRunIdRef.current += 1
      stopScoreSessionPlayback()
      void stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
      setScoreSession({ ...session, phase: 'ready', countIn: null })
      setActionState({ phase: 'success', message: '채점 카운트인을 취소했습니다.' })
      return
    }
    if (session.phase !== 'listening') {
      return
    }
    if (!validateScoreSession(session)) {
      return
    }

    setScoreSession({ ...session, phase: 'analyzing' })
    setActionState({ phase: 'busy', message: '채점 녹음을 정리하는 중입니다.' })
    try {
      scoreRunIdRef.current += 1
      clearScoreCountInTimers()
      disposeScoreCountInMetronome()
      const recorder = scoreRecorderRef.current
      const recordedDurationSeconds = recorder
        ? Math.max(0, (performance.now() - recorder.startedAt) / 1000)
        : 0
      const performanceAudioBase64 = await stopMicrophoneRecorder(recorder)
      scoreRecorderRef.current = null
      stopPlaybackSession()
      markReferencePlayback([])
      if (!performanceAudioBase64) {
        setScoreSession({ ...session, phase: 'ready' })
        setActionState({
          phase: 'error',
          message: '채점할 녹음이 없습니다. 마이크 입력을 확인하고 다시 시작해 주세요.',
        })
        return
      }
      const performanceFilename = `${scoreTargetTrack?.name ?? 'track'}-score-take.wav`
      const createdAtMs = Date.now()
      setPendingScoreRecording({
        audioDataUrl: performanceAudioBase64,
        createdAtMs,
        durationSeconds: recordedDurationSeconds,
        expiresAtMs: createdAtMs + PENDING_SCORE_RECORDING_RETENTION_MS,
        filename: performanceFilename,
        includeMetronome: session.includeMetronome,
        referenceSlotIds: session.selectedReferenceIds,
        scoreMode: session.scoreMode,
        slotId: session.targetSlotId,
        trackName: scoreTargetTrack?.name ?? `Track ${session.targetSlotId}`,
      })
      setScoreSession(null)
      setActionState({
        phase: 'success',
        message: '채점 녹음을 보관했습니다. 들어본 뒤 채점을 시작하거나 삭제하세요.',
      })
    } catch (error) {
      clearScoreCountInTimers()
      disposeScoreCountInMetronome()
      setScoreSession({ ...session, phase: 'ready' })
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '채점 녹음을 정리하지 못했습니다.',
      })
    }
  }

  async function handleStartPendingScoreRecording() {
    if (!studio || !pendingScoreRecording) {
      return
    }
    const pendingRecording = pendingScoreRecording
    const trackLabel = formatTrackName(pendingRecording.trackName)
    if (isPendingScoreRecordingExpired(pendingRecording)) {
      setPendingScoreRecording(null)
      setActionState({
        phase: 'error',
        message: `${trackLabel} 채점 녹음 보관 시간이 지났습니다. 다시 녹음해 주세요.`,
      })
      return
    }

    setActionState({ phase: 'busy', message: `${trackLabel} 녹음을 채점하는 중입니다.` })
    try {
      const performanceBlob = dataUrlToBlob(pendingRecording.audioDataUrl)
      let performancePayload:
        | { performance_asset_path: string; performance_audio_base64?: never }
        | { performance_audio_base64: string; performance_asset_path?: never } = {
        performance_audio_base64: pendingRecording.audioDataUrl,
      }
      try {
        const uploadTarget = await createScoringUploadTarget(studio.studio_id, pendingRecording.slotId, {
          source_kind: 'audio',
          filename: pendingRecording.filename,
          size_bytes: performanceBlob.size,
          content_type: performanceBlob.type || 'audio/wav',
        })
        await putDirectUpload(uploadTarget, performanceBlob)
        performancePayload = {
          performance_asset_path: uploadTarget.asset_path,
        }
      } catch {
        performancePayload = {
          performance_audio_base64: pendingRecording.audioDataUrl,
        }
      }
      const nextStudio = await scoreTrack(studio.studio_id, pendingRecording.slotId, {
        score_mode: pendingRecording.scoreMode,
        reference_slot_ids: pendingRecording.referenceSlotIds,
        include_metronome: pendingRecording.includeMetronome,
        performance_filename: pendingRecording.filename,
        ...performancePayload,
      })
      setStudio(nextStudio)
      setPendingScoreRecording(null)
      setActionState({
        phase: 'success',
        message:
          pendingRecording.scoreMode === 'harmony'
            ? '화음 채점 리포트를 만들었습니다.'
            : '채점 리포트를 만들었습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '채점 리포트를 만들지 못했습니다.',
      })
    }
  }

  function handleDiscardPendingScoreRecording() {
    if (!pendingScoreRecording) {
      return
    }
    setActionState({
      phase: 'success',
      message: `${formatTrackName(pendingScoreRecording.trackName)} 채점 녹음을 삭제했습니다.`,
    })
    setPendingScoreRecording(null)
  }

  return {
    cancelScoreSession,
    handleDiscardPendingScoreRecording,
    handleStartPendingScoreRecording,
    openScoreSession,
    pendingScoreRecording,
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
