import { useEffect, useRef, useState } from 'react'

import {
  createTrackRecordingUploadTarget,
  putDirectUpload,
  readFileAsDataUrl,
  shouldUseBase64UploadFallback,
  uploadTrackRecordingFile,
} from '../../lib/api'
import {
  beginMicrophoneCapture,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
  type RecordedAudioBlob,
} from '../../lib/audio'
import {
  COUNT_IN_FIRST_PULSE_DELAY_MS,
  COUNT_IN_ZERO_HOLD_MS,
  disposePlaybackSession,
  getCountInCapturePrerollMs,
  getCountInDisplayValue,
  getCountInStartOffsetPulses,
  getCountInTotalPulses,
  getBeatSeconds,
  formatTrackName,
  startLoopingMetronomeSession,
  type MeterContext,
  type PlaybackRoute,
  type PlaybackSession,
} from '../../lib/studio'
import type { Studio, TrackSlot } from '../../types/studio'
import {
  getDefaultRecordingReferenceSlotIds,
  getRecordingGuideLabel,
  isRecordingReferenceTrackAvailable,
  toggleRecordingReferenceSlot,
  type RecordingReferenceSetup,
} from './recordingReferences'
import type { RunStudioAction, SetStudioActionState } from './studioActionState'

type TrackCountInState = {
  pulsesRemaining: number
  slotId: number
  totalPulses: number
}

export type PendingTrackRecording = {
  allowOverwrite: boolean
  audioBlob: Blob
  audioObjectUrl: string
  contentType: string
  createdAtMs: number
  durationSeconds: number
  encoding: RecordedAudioBlob['encoding']
  expiresAtMs: number
  filename: string
  sizeBytes: number
  slotId: number
  trackName: string
}

type TrackRecordingMeter = {
  durationSeconds: number
  level: number
}

type UseStudioRecordingArgs = {
  metronomeEnabled: boolean
  markReferencePlayback: (slotIds: number[]) => void
  runStudioAction: RunStudioAction
  setActionState: SetStudioActionState
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

export const PENDING_RECORDING_RETENTION_MS = 30 * 60 * 1000

export function isPendingRecordingExpired(recording: PendingTrackRecording, nowMs = Date.now()): boolean {
  return recording.expiresAtMs <= nowMs
}

export function useStudioRecording({
  metronomeEnabled,
  markReferencePlayback,
  runStudioAction,
  setActionState,
  startPlaybackSession,
  stopPlaybackSession,
  studio,
  studioMeter,
}: UseStudioRecordingArgs) {
  const [trackCountIn, setTrackCountIn] = useState<TrackCountInState | null>(null)
  const [recordingSlotId, setRecordingSlotId] = useState<number | null>(null)
  const [recordingSetup, setRecordingSetup] = useState<RecordingReferenceSetup | null>(null)
  const [trackRecordingMeter, setTrackRecordingMeter] = useState<TrackRecordingMeter>({
    durationSeconds: 0,
    level: 0,
  })
  const [pendingTrackRecording, setPendingTrackRecording] = useState<PendingTrackRecording | null>(null)
  const [activeRecordingGuide, setActiveRecordingGuide] = useState({
    includeMetronome: false,
    referenceSlotIds: [] as number[],
  })
  const trackCountInRunIdRef = useRef(0)
  const trackCountInTimeoutIdsRef = useRef<number[]>([])
  const trackCountInEpochMsRef = useRef<number | null>(null)
  const recordingMetronomeSessionRef = useRef<PlaybackSession | null>(null)
  const trackRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const trackRecordingAllowOverwriteRef = useRef(false)
  const stopPlaybackSessionRef = useRef(stopPlaybackSession)

  function clearTrackCountInTimers() {
    trackCountInTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    trackCountInTimeoutIdsRef.current = []
  }

  function clearRecordingGuidePlayback() {
    disposePlaybackSession(recordingMetronomeSessionRef.current)
    recordingMetronomeSessionRef.current = null
    stopPlaybackSession()
    markReferencePlayback([])
    setActiveRecordingGuide({ includeMetronome: false, referenceSlotIds: [] })
  }

  function getRecordingReferenceTracks(setup: RecordingReferenceSetup): TrackSlot[] {
    if (!studio) {
      return []
    }
    return studio.tracks.filter(
      (track) =>
        setup.selectedReferenceSlotIds.includes(track.slot_id) &&
        isRecordingReferenceTrackAvailable(track),
    )
  }

  useEffect(() => {
    stopPlaybackSessionRef.current = stopPlaybackSession
  }, [stopPlaybackSession])

  useEffect(() => {
    return () => {
      clearTrackCountInTimers()
      trackCountInEpochMsRef.current = null
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      stopPlaybackSessionRef.current()
      void stopMicrophoneRecorder(trackRecorderRef.current)
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
    }
  }, [])

  useEffect(() => {
    if (pendingTrackRecording === null) {
      return undefined
    }
    return () => window.URL.revokeObjectURL(pendingTrackRecording.audioObjectUrl)
  }, [pendingTrackRecording])

  useEffect(() => {
    if (recordingSlotId === null && trackCountIn === null) {
      return undefined
    }

    const updateMeter = () => {
      const recorder = trackRecorderRef.current
      if (!recorder) {
        return
      }
      setTrackRecordingMeter({
        durationSeconds: recorder.capturing ? (performance.now() - recorder.startedAt) / 1000 : 0,
        level: recorder.rmsLevel,
      })
    }

    updateMeter()
    const intervalId = window.setInterval(updateMeter, 120)
    return () => window.clearInterval(intervalId)
  }, [recordingSlotId, trackCountIn])

  useEffect(() => {
    if (pendingTrackRecording === null) {
      return undefined
    }
    const expiresInMs = pendingTrackRecording.expiresAtMs - Date.now()
    if (isPendingRecordingExpired(pendingTrackRecording, Date.now())) {
      setActionState({
        phase: 'success',
        message: `${formatTrackName(pendingTrackRecording.trackName)} 녹음 보관 시간이 지나 임시 녹음을 비웠습니다.`,
      })
      setPendingTrackRecording(null)
      return undefined
    }
    const timeoutId = window.setTimeout(() => {
      setPendingTrackRecording((current) => {
        if (!current || !isPendingRecordingExpired(current, Date.now())) {
          return current
        }
        setActionState({
          phase: 'success',
          message: `${formatTrackName(current.trackName)} 녹음 보관 시간이 지나 임시 녹음을 비웠습니다.`,
        })
        return null
      })
    }, expiresInMs)
    return () => window.clearTimeout(timeoutId)
  }, [pendingTrackRecording, setActionState])

  function cancelTrackCountIn(message = '녹음 준비를 취소했습니다.') {
    trackCountInRunIdRef.current += 1
    clearTrackCountInTimers()
    trackCountInEpochMsRef.current = null
    setTrackCountIn(null)
    setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
    clearRecordingGuidePlayback()
    const recorder = trackRecorderRef.current
    trackRecorderRef.current = null
    trackRecordingAllowOverwriteRef.current = false
    void stopMicrophoneRecorder(recorder)
    setActionState({ phase: 'success', message })
  }

  async function startTrackCountIn(
    track: TrackSlot,
    recorder: MicrophoneRecorder,
    referenceTracks: TrackSlot[],
    includeMetronome: boolean,
  ): Promise<boolean> {
    if (!studio) {
      return false
    }

    const runId = trackCountInRunIdRef.current + 1
    trackCountInRunIdRef.current = runId
    clearTrackCountInTimers()
    clearRecordingGuidePlayback()

    const totalPulses = getCountInTotalPulses(studioMeter)
    const pulseMilliseconds = getBeatSeconds(studio.bpm) * studioMeter.pulseQuarterBeats * 1000
    const countInLeadMilliseconds =
      COUNT_IN_FIRST_PULSE_DELAY_MS + getCountInStartOffsetPulses(totalPulses) * pulseMilliseconds
    const referenceSlotIds = referenceTracks.map((referenceTrack) => referenceTrack.slot_id)
    setActiveRecordingGuide({ includeMetronome, referenceSlotIds })

    const scheduleCountInAt = (targetMilliseconds: number, callback: () => void) => {
      const timeoutId = window.setTimeout(callback, Math.max(0, Math.round(targetMilliseconds - performance.now())))
      trackCountInTimeoutIdsRef.current.push(timeoutId)
    }

    let captureStarted = false
    const startCapture = () => {
      if (captureStarted) {
        return true
      }
      if (!beginMicrophoneCapture(recorder)) {
        trackCountInRunIdRef.current += 1
        clearTrackCountInTimers()
        trackCountInEpochMsRef.current = null
        setTrackCountIn(null)
        setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
        clearRecordingGuidePlayback()
        trackRecorderRef.current = null
        trackRecordingAllowOverwriteRef.current = false
        void stopMicrophoneRecorder(recorder)
        setActionState({ phase: 'error', message: '녹음을 시작하지 못했습니다. 다시 시도해 주세요.' })
        return false
      }
      captureStarted = true
      return true
    }

    const finishCountIn = (keepCountInMetronomeRunning: boolean) => {
      if (trackCountInRunIdRef.current !== runId) {
        return
      }
      clearTrackCountInTimers()
      if (!keepCountInMetronomeRunning) {
        disposePlaybackSession(recordingMetronomeSessionRef.current)
        recordingMetronomeSessionRef.current = null
      }
      setTrackCountIn({
        slotId: track.slot_id,
        pulsesRemaining: 0,
        totalPulses,
      })
      if (!startCapture()) {
        return
      }
      if (referenceSlotIds.length > 0) {
        markReferencePlayback(referenceSlotIds)
      }
      setRecordingSlotId(track.slot_id)
      setTrackRecordingMeter({ durationSeconds: 0, level: recorder.rmsLevel })
      const trackLabel = formatTrackName(track.name)
      setActionState({
        phase: 'success',
        message: `${trackLabel} 녹음을 시작했습니다. ${getRecordingGuideLabel(referenceSlotIds.length, includeMetronome)} 기준으로 기록합니다.`,
      })
      const hideZeroTimeoutId = window.setTimeout(() => {
        if (trackCountInRunIdRef.current !== runId) {
          return
        }
        trackCountInEpochMsRef.current = null
        setTrackCountIn(null)
      }, COUNT_IN_ZERO_HOLD_MS)
      trackCountInTimeoutIdsRef.current.push(hideZeroTimeoutId)
    }

    const scheduleVisibleCountIn = (recordingDownbeatMilliseconds: number) => {
      if (trackCountInRunIdRef.current !== runId) {
        return
      }
      const countInEpochMilliseconds =
        recordingDownbeatMilliseconds - getCountInStartOffsetPulses(totalPulses) * pulseMilliseconds
      const capturePrerollMilliseconds = Math.max(
        performance.now(),
        recordingDownbeatMilliseconds - getCountInCapturePrerollMs(pulseMilliseconds),
      )
      trackCountInEpochMsRef.current = countInEpochMilliseconds

      if (includeMetronome) {
        disposePlaybackSession(recordingMetronomeSessionRef.current)
        recordingMetronomeSessionRef.current = startLoopingMetronomeSession(
          studio.bpm,
          studioMeter,
          Math.max(0.02, (countInEpochMilliseconds - performance.now()) / 1000),
        )
      }

      setTrackCountIn({
        slotId: track.slot_id,
        pulsesRemaining: getCountInDisplayValue(totalPulses, 0),
        totalPulses,
      })
      setTrackRecordingMeter({ durationSeconds: 0, level: 0 })

      for (let pulseIndex = 1; pulseIndex < totalPulses - 1; pulseIndex += 1) {
        scheduleCountInAt(countInEpochMilliseconds + pulseIndex * pulseMilliseconds, () => {
          if (trackCountInRunIdRef.current !== runId) {
            return
          }
          setTrackCountIn({
            slotId: track.slot_id,
            pulsesRemaining: getCountInDisplayValue(totalPulses, pulseIndex),
            totalPulses,
          })
        })
      }

      scheduleCountInAt(capturePrerollMilliseconds, () => {
        if (trackCountInRunIdRef.current !== runId) {
          return
        }
        startCapture()
      })
    }

    if (referenceTracks.length > 0) {
      setActionState({
        phase: 'busy',
        message: '기준 트랙을 카운트인 뒤 같은 박자에 맞춰 준비합니다.',
      })
      const playbackStarted = await startPlaybackSession(referenceTracks, includeMetronome, {
        onStartScheduled: scheduleVisibleCountIn,
        onScheduledStart: () => finishCountIn(false),
        route: 'recording',
        scheduledStartLeadMs: countInLeadMilliseconds,
        startSeconds: 0,
      })
      if (!playbackStarted) {
        trackCountInRunIdRef.current += 1
        clearTrackCountInTimers()
        trackCountInEpochMsRef.current = null
        setTrackCountIn(null)
        setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
        clearRecordingGuidePlayback()
        trackRecorderRef.current = null
        trackRecordingAllowOverwriteRef.current = false
        void stopMicrophoneRecorder(recorder)
        return false
      }
      return true
    }

    const recordingDownbeatMilliseconds = performance.now() + countInLeadMilliseconds
    scheduleVisibleCountIn(recordingDownbeatMilliseconds)
    scheduleCountInAt(recordingDownbeatMilliseconds, () => finishCountIn(includeMetronome))
    return true
  }

  function cancelRecordingSetup() {
    setRecordingSetup(null)
    setActionState({ phase: 'success', message: '녹음 준비를 취소했습니다.' })
  }

  function toggleRecordingReference(slotId: number) {
    setRecordingSetup((current) => {
      if (!current || !studio) {
        return current
      }
      const track = studio.tracks.find((candidate) => candidate.slot_id === slotId)
      if (!track || !isRecordingReferenceTrackAvailable(track)) {
        return current
      }
      return {
        ...current,
        selectedReferenceSlotIds: toggleRecordingReferenceSlot(current.selectedReferenceSlotIds, slotId),
      }
    })
  }

  function selectAllRecordingReferences() {
    setRecordingSetup((current) => {
      if (!current || !studio) {
        return current
      }
      return {
        ...current,
        selectedReferenceSlotIds: studio.tracks
          .filter(isRecordingReferenceTrackAvailable)
          .map((track) => track.slot_id),
      }
    })
  }

  function clearRecordingReferences() {
    setRecordingSetup((current) => (current ? { ...current, selectedReferenceSlotIds: [] } : current))
  }

  function setRecordingReferenceMetronomeEnabled(includeMetronome: boolean) {
    setRecordingSetup((current) => (current ? { ...current, includeMetronome } : current))
  }

  async function startRecordingFromSetup() {
    if (!studio || !recordingSetup) {
      return
    }

    const setup = recordingSetup
    const track = studio.tracks.find((candidate) => candidate.slot_id === setup.targetSlotId)
    if (!track) {
      setRecordingSetup(null)
      setActionState({ phase: 'error', message: '녹음할 트랙을 찾지 못했습니다.' })
      return
    }

    const existingRegion = studio.regions.find((region) => region.track_slot_id === track.slot_id)
    const wouldOverwrite =
      track.status === 'registered' ||
      Boolean(existingRegion && (existingRegion.pitch_events.length > 0 || existingRegion.audio_source_path))
    const allowOverwrite =
      !wouldOverwrite || window.confirm(`${formatTrackName(track.name)} 트랙의 기존 음표를 새 녹음으로 덮어쓸까요?`)
    if (!allowOverwrite) {
      setActionState({ phase: 'idle' })
      return
    }

    setActionState({ phase: 'busy', message: '마이크 입력을 준비하는 중입니다.' })
    const recorder = await startMicrophoneRecorder({ captureImmediately: false })
    if (!recorder) {
      setActionState({
        phase: 'error',
        message: '마이크를 열지 못했습니다. 브라우저 마이크 권한과 입력 장치를 확인해 주세요.',
      })
      return
    }

    const referenceTracks = getRecordingReferenceTracks(setup)
    setRecordingSetup(null)
    trackRecorderRef.current = recorder
    trackRecordingAllowOverwriteRef.current = allowOverwrite
    setTrackRecordingMeter({ durationSeconds: 0, level: 0 })

    const started = await startTrackCountIn(track, recorder, referenceTracks, setup.includeMetronome)
    if (started) {
      setActionState({
        phase: 'success',
        message: `${formatTrackName(track.name)} 녹음 준비 중입니다. 1마디 카운트인 뒤 ${getRecordingGuideLabel(
          referenceTracks.length,
          setup.includeMetronome,
        )} 기준으로 기록합니다.`,
      })
    }
  }

  async function handleRecord(track: TrackSlot) {
    if (!studio) {
      return
    }

    if (recordingSlotId === track.slot_id) {
      const recorder = trackRecorderRef.current
      const allowOverwrite = trackRecordingAllowOverwriteRef.current
      const recordedDurationSeconds = trackRecordingMeter.durationSeconds
      trackCountInRunIdRef.current += 1
      clearTrackCountInTimers()
      trackCountInEpochMsRef.current = null
      setTrackCountIn(null)
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
      clearRecordingGuidePlayback()
      setRecordingSlotId(null)
      setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
      const trackLabel = formatTrackName(track.name)
      setActionState({ phase: 'busy', message: `${trackLabel} 녹음을 정리하는 중입니다.` })
      try {
        const recordedAudio = await stopMicrophoneRecorder(recorder)
        if (!recordedAudio) {
          throw new Error('녹음 오디오가 비어 있습니다. 마이크 입력을 확인하고 다시 녹음해 주세요.')
        }
        const createdAtMs = Date.now()
        setPendingTrackRecording({
          allowOverwrite,
          audioBlob: recordedAudio.blob,
          audioObjectUrl: window.URL.createObjectURL(recordedAudio.blob),
          contentType: recordedAudio.contentType,
          createdAtMs,
          durationSeconds: recordedDurationSeconds,
          encoding: recordedAudio.encoding,
          expiresAtMs: createdAtMs + PENDING_RECORDING_RETENTION_MS,
          filename: `${track.name}-recorded-take${recordedAudio.extension}`,
          sizeBytes: recordedAudio.sizeBytes,
          slotId: track.slot_id,
          trackName: track.name,
        })
        setActionState({
          phase: 'success',
          message: `${trackLabel} 녹음을 보류했습니다. 들어본 뒤 트랙에 등록하거나 폐기하세요.`,
        })
      } catch (error) {
        setActionState({
          phase: 'error',
          message: error instanceof Error ? error.message : '녹음을 정리하지 못했습니다.',
        })
      }
      return
    }

    if (recordingSetup?.targetSlotId === track.slot_id) {
      cancelRecordingSetup()
      return
    }

    if (recordingSetup !== null) {
      setActionState({
        phase: 'error',
        message: '다른 트랙의 녹음 기준을 선택하는 중입니다. 먼저 현재 준비를 취소해 주세요.',
      })
      return
    }

    if (trackCountIn?.slotId === track.slot_id) {
      cancelTrackCountIn()
      return
    }

    if (trackCountIn !== null) {
      setActionState({
        phase: 'error',
        message: '다른 트랙이 녹음 준비 중입니다. 먼저 현재 준비를 취소해 주세요.',
      })
      return
    }

    if (recordingSlotId !== null) {
      setActionState({
        phase: 'error',
        message: '이미 녹음 중인 트랙이 있습니다. 먼저 현재 녹음을 중지해 주세요.',
      })
      return
    }

    if (pendingTrackRecording !== null) {
      setActionState({
        phase: 'error',
        message: '등록 여부를 기다리는 녹음이 있습니다. 먼저 등록하거나 폐기해 주세요.',
      })
      return
    }

    setRecordingSetup({
      targetSlotId: track.slot_id,
      selectedReferenceSlotIds: getDefaultRecordingReferenceSlotIds(studio.tracks, track.slot_id),
      includeMetronome: metronomeEnabled,
    })
    setActionState({
      phase: 'success',
      message: `${formatTrackName(track.name)} 녹음 기준을 선택하세요.`,
    })
  }

  async function handleRegisterPendingRecording() {
    if (!studio || !pendingTrackRecording) {
      return
    }

    const pendingRecording = pendingTrackRecording
    const trackLabel = formatTrackName(pendingRecording.trackName)
    if (isPendingRecordingExpired(pendingRecording)) {
      setPendingTrackRecording(null)
      setActionState({
        phase: 'error',
        message: `${trackLabel} 임시 녹음 보관 시간이 지났습니다. 다시 녹음해 주세요.`,
      })
      return
    }
    const succeeded = await runStudioAction(
      async () => {
        let uploadPayload:
          | { asset_path: string; content_base64?: never }
          | { content_base64: string; asset_path?: never } = {
          content_base64: '',
        }
        try {
          const uploadTarget = await createTrackRecordingUploadTarget(studio.studio_id, pendingRecording.slotId, {
            source_kind: 'audio',
            filename: pendingRecording.filename,
            size_bytes: pendingRecording.audioBlob.size,
            content_type: pendingRecording.contentType,
          })
          await putDirectUpload(uploadTarget, pendingRecording.audioBlob)
          uploadPayload = { asset_path: uploadTarget.asset_path }
        } catch (error) {
          if (!shouldUseBase64UploadFallback(error, pendingRecording.audioBlob)) {
            throw error
          }
          uploadPayload = { content_base64: await readFileAsDataUrl(pendingRecording.audioBlob) }
        }
        return uploadTrackRecordingFile(studio.studio_id, pendingRecording.slotId, {
          source_kind: 'audio',
          filename: pendingRecording.filename,
          review_before_register: false,
          allow_overwrite: pendingRecording.allowOverwrite,
          ...uploadPayload,
        })
      },
      `${trackLabel} 녹음 파일을 서버에 올리고 추출 대기열에 등록하는 중입니다.`,
      `${trackLabel} 녹음을 대기열에 등록했습니다. 앞선 작업이 끝나면 자동으로 음성 추출을 시작합니다.`,
      [
        `${trackLabel} 녹음 파일을 저장하는 중입니다.`,
        '음성 추출 작업을 대기열에 배치하는 중입니다.',
        '후보가 준비되면 검토 목록에 표시됩니다.',
      ],
    )
    if (succeeded) {
      setPendingTrackRecording(null)
    }
  }

  function handleDiscardPendingRecording() {
    if (!pendingTrackRecording) {
      return
    }

    setActionState({
      phase: 'success',
      message: `${formatTrackName(pendingTrackRecording.trackName)} 녹음을 폐기했습니다. 트랙에는 아무 작업도 등록하지 않았습니다.`,
    })
    setPendingTrackRecording(null)
  }

  return {
    activeRecordingGuideLabel: getRecordingGuideLabel(
      activeRecordingGuide.referenceSlotIds.length,
      activeRecordingGuide.includeMetronome,
    ),
    cancelRecordingSetup,
    clearRecordingReferences,
    handleDiscardPendingRecording,
    handleRecord,
    handleRegisterPendingRecording,
    pendingTrackRecording,
    recordingSetup,
    recordingSlotId,
    selectAllRecordingReferences,
    setRecordingReferenceMetronomeEnabled,
    startRecordingFromSetup,
    trackCountIn,
    trackRecordingMeter,
    toggleRecordingReference,
  }
}
