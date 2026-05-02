import { useEffect, useRef, useState } from 'react'

import { uploadTrack } from '../../lib/api'
import {
  beginMicrophoneCapture,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
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
  startLoopingMetronomeSession,
  type MeterContext,
  type PlaybackSession,
} from '../../lib/studio'
import type { Studio, TrackSlot } from '../../types/studio'
import type { RunStudioAction, SetStudioActionState } from './studioActionState'

type TrackCountInState = {
  pulsesRemaining: number
  slotId: number
  totalPulses: number
}

export type PendingTrackRecording = {
  allowOverwrite: boolean
  audioDataUrl: string
  durationSeconds: number
  filename: string
  slotId: number
  trackName: string
}

type TrackRecordingMeter = {
  durationSeconds: number
  level: number
}

type UseStudioRecordingArgs = {
  metronomeEnabled: boolean
  runStudioAction: RunStudioAction
  setActionState: SetStudioActionState
  studio: Studio | null
  studioMeter: MeterContext
}

export function useStudioRecording({
  metronomeEnabled,
  runStudioAction,
  setActionState,
  studio,
  studioMeter,
}: UseStudioRecordingArgs) {
  const [trackCountIn, setTrackCountIn] = useState<TrackCountInState | null>(null)
  const [recordingSlotId, setRecordingSlotId] = useState<number | null>(null)
  const [trackRecordingMeter, setTrackRecordingMeter] = useState<TrackRecordingMeter>({
    durationSeconds: 0,
    level: 0,
  })
  const [pendingTrackRecording, setPendingTrackRecording] = useState<PendingTrackRecording | null>(null)
  const trackCountInRunIdRef = useRef(0)
  const trackCountInTimeoutIdsRef = useRef<number[]>([])
  const trackCountInEpochMsRef = useRef<number | null>(null)
  const recordingMetronomeSessionRef = useRef<PlaybackSession | null>(null)
  const trackRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const trackRecordingAllowOverwriteRef = useRef(false)

  function clearTrackCountInTimers() {
    trackCountInTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    trackCountInTimeoutIdsRef.current = []
  }

  useEffect(() => {
    return () => {
      clearTrackCountInTimers()
      trackCountInEpochMsRef.current = null
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      void stopMicrophoneRecorder(trackRecorderRef.current)
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
    }
  }, [])

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
    if ((recordingSlotId === null && trackCountIn === null) || !studio?.bpm) {
      return undefined
    }

    if (!metronomeEnabled) {
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      return undefined
    }

    if (!recordingMetronomeSessionRef.current) {
      recordingMetronomeSessionRef.current = startLoopingMetronomeSession(studio.bpm, studioMeter)
    }
    return undefined
  }, [metronomeEnabled, recordingSlotId, studio?.bpm, studioMeter, trackCountIn])

  function cancelTrackCountIn(message = '녹음 준비를 취소했습니다.') {
    trackCountInRunIdRef.current += 1
    clearTrackCountInTimers()
    trackCountInEpochMsRef.current = null
    setTrackCountIn(null)
    setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
    disposePlaybackSession(recordingMetronomeSessionRef.current)
    recordingMetronomeSessionRef.current = null
    const recorder = trackRecorderRef.current
    trackRecorderRef.current = null
    trackRecordingAllowOverwriteRef.current = false
    void stopMicrophoneRecorder(recorder)
    setActionState({ phase: 'success', message })
  }

  function startTrackCountIn(track: TrackSlot, recorder: MicrophoneRecorder) {
    if (!studio) {
      return
    }

    const runId = trackCountInRunIdRef.current + 1
    trackCountInRunIdRef.current = runId
    clearTrackCountInTimers()

    const totalPulses = getCountInTotalPulses(studioMeter)
    const pulseMilliseconds = getBeatSeconds(studio.bpm) * studioMeter.pulseQuarterBeats * 1000
    const downbeatDelayMilliseconds = COUNT_IN_FIRST_PULSE_DELAY_MS
    let countInEpochMilliseconds = performance.now() + downbeatDelayMilliseconds

    if (metronomeEnabled) {
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = startLoopingMetronomeSession(
        studio.bpm,
        studioMeter,
        downbeatDelayMilliseconds / 1000,
      )
      countInEpochMilliseconds = recordingMetronomeSessionRef.current?.firstPulseAtMs ?? countInEpochMilliseconds
    }

    const recordingDownbeatMilliseconds =
      countInEpochMilliseconds + getCountInStartOffsetPulses(totalPulses) * pulseMilliseconds
    const capturePrerollMs = getCountInCapturePrerollMs(pulseMilliseconds)
    const capturePrerollMilliseconds = Math.max(
      performance.now(),
      recordingDownbeatMilliseconds - capturePrerollMs,
    )
    trackCountInEpochMsRef.current = countInEpochMilliseconds

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
        disposePlaybackSession(recordingMetronomeSessionRef.current)
        recordingMetronomeSessionRef.current = null
        trackRecorderRef.current = null
        trackRecordingAllowOverwriteRef.current = false
        void stopMicrophoneRecorder(recorder)
        setActionState({ phase: 'error', message: '녹음을 시작하지 못했습니다. 다시 시도해 주세요.' })
        return false
      }
      captureStarted = true
      return true
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

    scheduleCountInAt(recordingDownbeatMilliseconds, () => {
      if (trackCountInRunIdRef.current !== runId) {
        return
      }
      clearTrackCountInTimers()
      setTrackCountIn({
        slotId: track.slot_id,
        pulsesRemaining: 0,
        totalPulses,
      })
      if (!startCapture()) {
        return
      }
      setRecordingSlotId(track.slot_id)
      setTrackRecordingMeter({ durationSeconds: 0, level: recorder.rmsLevel })
      setActionState({
        phase: 'success',
        message: `${track.name} 녹음을 시작했습니다. 메트로놈 기준으로 피치 이벤트를 기록합니다.`,
      })
      const hideZeroTimeoutId = window.setTimeout(() => {
        if (trackCountInRunIdRef.current !== runId) {
          return
        }
        trackCountInEpochMsRef.current = null
        setTrackCountIn(null)
      }, COUNT_IN_ZERO_HOLD_MS)
      trackCountInTimeoutIdsRef.current.push(hideZeroTimeoutId)
    })
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
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      setRecordingSlotId(null)
      setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
      setActionState({ phase: 'busy', message: `${track.name} 녹음을 정리하는 중입니다.` })
      try {
        const recordedAudioBase64 = await stopMicrophoneRecorder(recorder)
        if (!recordedAudioBase64) {
          throw new Error('녹음 오디오가 비어 있습니다. 마이크 입력을 확인하고 다시 녹음해 주세요.')
        }
        setPendingTrackRecording({
          allowOverwrite,
          audioDataUrl: recordedAudioBase64,
          durationSeconds: recordedDurationSeconds,
          filename: `${track.name}-recorded-take.wav`,
          slotId: track.slot_id,
          trackName: track.name,
        })
        setActionState({
          phase: 'success',
          message: `${track.name} 녹음을 보류했습니다. 들어본 뒤 트랙에 등록하거나 폐기하세요.`,
        })
      } catch (error) {
        setActionState({
          phase: 'error',
          message: error instanceof Error ? error.message : '녹음을 정리하지 못했습니다.',
        })
      }
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

    const existingRegion = studio.regions.find((region) => region.track_slot_id === track.slot_id)
    const wouldOverwrite =
      track.status === 'registered' ||
      Boolean(existingRegion && (existingRegion.pitch_events.length > 0 || existingRegion.audio_source_path))
    const allowOverwrite =
      !wouldOverwrite || window.confirm(`${track.name} 트랙의 기존 피치 이벤트를 새 녹음으로 덮어쓸까요?`)
    if (!allowOverwrite) {
      setActionState({ phase: 'idle' })
      return
    }

    const recorder = await startMicrophoneRecorder({ captureImmediately: false })
    if (!recorder) {
      setActionState({
        phase: 'error',
        message: '마이크를 열지 못했습니다. 브라우저 마이크 권한과 입력 장치를 확인해 주세요.',
      })
      return
    }

    trackRecorderRef.current = recorder
    trackRecordingAllowOverwriteRef.current = allowOverwrite
    setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
    startTrackCountIn(track, recorder)
    setActionState({
      phase: 'success',
      message: `${track.name} 녹음 준비 중입니다. 1마디 count-in 뒤 메트로놈 기준으로 기록합니다.`,
    })
  }

  async function handleRegisterPendingRecording() {
    if (!studio || !pendingTrackRecording) {
      return
    }

    const pendingRecording = pendingTrackRecording
    const succeeded = await runStudioAction(
      () =>
        uploadTrack(studio.studio_id, pendingRecording.slotId, {
          source_kind: 'audio',
          filename: pendingRecording.filename,
          content_base64: pendingRecording.audioDataUrl,
          review_before_register: false,
          allow_overwrite: pendingRecording.allowOverwrite,
        }),
      `${pendingRecording.trackName} 녹음 파일을 서버에 올리고 추출 대기열에 등록하는 중입니다.`,
      `${pendingRecording.trackName} 녹음을 대기열에 등록했습니다. 앞선 작업이 끝나면 자동으로 음성 추출을 시작합니다.`,
      [
        `${pendingRecording.trackName} 녹음 파일을 저장하는 중입니다.`,
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
      message: `${pendingTrackRecording.trackName} 녹음을 폐기했습니다. 트랙에는 아무 작업도 등록하지 않았습니다.`,
    })
    setPendingTrackRecording(null)
  }

  return {
    handleDiscardPendingRecording,
    handleRecord,
    handleRegisterPendingRecording,
    pendingTrackRecording,
    recordingSlotId,
    trackCountIn,
    trackRecordingMeter,
  }
}
