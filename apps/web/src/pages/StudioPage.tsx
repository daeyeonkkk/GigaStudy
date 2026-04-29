import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { CandidateReviewPanel } from '../components/studio/CandidateReviewPanel'
import { ExtractionJobsPanel } from '../components/studio/ExtractionJobsPanel'
import { ReportFeed } from '../components/studio/ReportFeed'
import { ScoringDrawer, type ScoreSessionState } from '../components/studio/ScoringDrawer'
import { StudioToolbar } from '../components/studio/StudioToolbar'
import { TrackBoard } from '../components/studio/TrackBoard'

import {
  approveJobCandidates,
  approveCandidate,
  createTrackUploadTarget,
  exportStudioPdf,
  getOmrJobSourcePreviewUrl,
  generateTrack,
  getStudio,
  getTrackAudioUrl,
  putDirectUpload,
  readFileAsDataUrl,
  rejectCandidate,
  retryExtractionJob,
  scoreTrack,
  updateTrackSync,
  uploadTrack,
} from '../lib/api'
import {
  beginMicrophoneCapture,
  getBrowserAudioContextConstructor,
  prepareAudioFileForUpload,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
} from '../lib/audio'
import {
  createAudioBufferPlayback,
  createTone,
  DEFAULT_METER,
  detectUploadKind,
  disposePlaybackSession,
  formatDurationSeconds,
  formatSeconds,
  fetchAudioArrayBuffer,
  getBeatSeconds,
  getNotePlaybackFrequency,
  getStudioMeter,
  isMeasureDownbeat,
  isOmrUpload,
  safeDownloadName,
  startLoopingMetronomeSession,
  type MeterContext,
  type PlaybackNode,
  type PlaybackSession,
  type PlaybackSourceMode,
} from '../lib/studio'
import type {
  ExtractionCandidate,
  Studio,
  TrackSlot,
} from '../types/studio'
import './StudioPage.css'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

type ActionState =
  | { phase: 'idle' }
  | { phase: 'busy'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type PlaybackTimeline = {
  maxSeconds: number
  minSeconds: number
  startSeconds: number
  startedAtMs: number
}

type PlaybackStartOptions = {
  startSeconds?: number
}

type TrackCountInState = {
  pulsesRemaining: number
  slotId: number
  totalPulses: number
}

type PendingTrackRecording = {
  allowOverwrite: boolean
  audioDataUrl: string
  durationSeconds: number
  filename: string
  slotId: number
  trackName: string
}

const COUNT_IN_FIRST_PULSE_DELAY_MS = 80
const COUNT_IN_ZERO_HOLD_MS = 220

export function StudioPage() {
  const { studioId } = useParams()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })
  const [actionState, setActionState] = useState<ActionState>({ phase: 'idle' })
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [playbackSource, setPlaybackSource] = useState<PlaybackSourceMode>('audio')
  const [playbackPickerOpen, setPlaybackPickerOpen] = useState(false)
  const [selectedPlaybackSlotIds, setSelectedPlaybackSlotIds] = useState<Set<number>>(() => new Set())
  const [syncStepSeconds, setSyncStepSeconds] = useState(0.01)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [playingSlots, setPlayingSlots] = useState<Set<number>>(() => new Set())
  const [playbackTimeline, setPlaybackTimeline] = useState<PlaybackTimeline | null>(null)
  const [playheadSeconds, setPlayheadSeconds] = useState<number | null>(null)
  const [trackCountIn, setTrackCountIn] = useState<TrackCountInState | null>(null)
  const [recordingSlotId, setRecordingSlotId] = useState<number | null>(null)
  const [trackRecordingMeter, setTrackRecordingMeter] = useState({
    durationSeconds: 0,
    level: 0,
  })
  const [pendingTrackRecording, setPendingTrackRecording] = useState<PendingTrackRecording | null>(null)
  const [scoreSession, setScoreSession] = useState<ScoreSessionState | null>(null)
  const [candidateTargetSlots, setCandidateTargetSlots] = useState<Record<string, number>>({})
  const [candidateOverwriteApprovals, setCandidateOverwriteApprovals] = useState<Record<string, boolean>>({})
  const [jobOverwriteApprovals, setJobOverwriteApprovals] = useState<Record<string, boolean>>({})
  const playbackSessionRef = useRef<PlaybackSession | null>(null)
  const playbackRunIdRef = useRef(0)
  const trackCountInRunIdRef = useRef(0)
  const trackCountInTimeoutIdsRef = useRef<number[]>([])
  const trackCountInEpochMsRef = useRef<number | null>(null)
  const recordingMetronomeSessionRef = useRef<PlaybackSession | null>(null)
  const trackRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const trackRecordingAllowOverwriteRef = useRef(false)
  const scoreRecorderRef = useRef<MicrophoneRecorder | null>(null)
  const scoreRunIdRef = useRef(0)
  const studioMeter = useMemo(
    () => (studio ? getStudioMeter(studio) : DEFAULT_METER),
    [studio],
  )
  const studioBeatsPerMeasure = studioMeter.beatsPerMeasure

  function clearTrackCountInTimers() {
    trackCountInTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    trackCountInTimeoutIdsRef.current = []
  }

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

  useEffect(() => {
    return () => {
      clearTrackCountInTimers()
      trackCountInEpochMsRef.current = null
      disposePlaybackSession(playbackSessionRef.current)
      playbackSessionRef.current = null
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      void stopMicrophoneRecorder(trackRecorderRef.current)
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
      void stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!playbackTimeline) {
      return undefined
    }

    let animationFrameId = 0
    const updatePlayhead = () => {
      const elapsedSeconds = (performance.now() - playbackTimeline.startedAtMs) / 1000
      const nextPlayheadSeconds = Math.min(
        playbackTimeline.maxSeconds,
        playbackTimeline.startSeconds + elapsedSeconds,
      )
      setPlayheadSeconds(nextPlayheadSeconds)
      if (playbackTimeline.startSeconds + elapsedSeconds <= playbackTimeline.maxSeconds + 0.2) {
        animationFrameId = window.requestAnimationFrame(updatePlayhead)
      }
    }

    updatePlayhead()
    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [playbackTimeline])

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
    () => studio?.jobs.slice(-4).reverse() ?? [],
    [studio],
  )
  const scoreTargetTrack = useMemo(
    () =>
      studio && scoreSession
        ? studio.tracks.find((track) => track.slot_id === scoreSession.targetSlotId) ?? null
        : null,
    [scoreSession, studio],
  )

  useEffect(() => {
    setSelectedPlaybackSlotIds((current) => {
      const registeredSlotIdSet = new Set(registeredSlotIds)
      const retainedSlotIds = new Set(
        [...current].filter((slotId) => registeredSlotIdSet.has(slotId)),
      )
      if (current.size === 0 && registeredSlotIds.length > 0) {
        return new Set(registeredSlotIds)
      }
      if (retainedSlotIds.size === current.size) {
        return current
      }
      return retainedSlotIds
    })
  }, [registeredSlotIds])

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
            setActionState({
              phase: 'error',
              message: 'Could not refresh the PDF extraction job.',
            })
          }
        })
    }, 1200)

    return () => {
      ignore = true
      window.clearInterval(intervalId)
    }
  }, [activeExtractionJobs.length, studioId])

  async function runStudioAction(
    action: () => Promise<Studio>,
    busyMessage: string,
    successMessage: string,
  ): Promise<boolean> {
    setActionState({ phase: 'busy', message: busyMessage })
    try {
      const nextStudio = await action()
      setStudio(nextStudio)
      setActionState({ phase: 'success', message: successMessage })
      return true
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.',
      })
      return false
    }
  }

  function getSelectedCandidateSlotId(candidate: ExtractionCandidate): number {
    return candidateTargetSlots[candidate.candidate_id] ?? candidate.suggested_slot_id
  }

  function getSelectedCandidateTrack(candidate: ExtractionCandidate): TrackSlot | null {
    if (!studio) {
      return null
    }
    return (
      studio.tracks.find((track) => track.slot_id === getSelectedCandidateSlotId(candidate)) ?? null
    )
  }

  function candidateWouldOverwrite(candidate: ExtractionCandidate): boolean {
    const targetTrack = getSelectedCandidateTrack(candidate)
    if (!targetTrack) {
      return false
    }
    return targetTrack.status === 'registered' || targetTrack.notes.length > 0
  }

  function getPendingJobCandidates(jobId: string): ExtractionCandidate[] {
    return pendingCandidates.filter((candidate) => candidate.job_id === jobId)
  }

  function jobWouldOverwrite(jobId: string): boolean {
    return getPendingJobCandidates(jobId).some((candidate) => {
      const targetTrack = studio?.tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
      return targetTrack ? targetTrack.status === 'registered' || targetTrack.notes.length > 0 : false
    })
  }

  function updateCandidateTargetSlot(candidate: ExtractionCandidate, targetSlotId: number) {
    setCandidateTargetSlots((current) => ({
      ...current,
      [candidate.candidate_id]: targetSlotId,
    }))
    setCandidateOverwriteApprovals((current) => ({
      ...current,
      [candidate.candidate_id]: false,
    }))
  }

  function updateCandidateOverwriteApproval(candidate: ExtractionCandidate, allowOverwrite: boolean) {
    setCandidateOverwriteApprovals((current) => ({
      ...current,
      [candidate.candidate_id]: allowOverwrite,
    }))
  }

  function updateJobOverwriteApproval(jobId: string, allowOverwrite: boolean) {
    setJobOverwriteApprovals((current) => ({
      ...current,
      [jobId]: allowOverwrite,
    }))
  }

  async function handleApproveCandidate(candidate: ExtractionCandidate) {
    if (!studio) {
      return
    }
    const targetSlotId = getSelectedCandidateSlotId(candidate)
    const targetTrack = getSelectedCandidateTrack(candidate)
    const allowOverwrite = candidateOverwriteApprovals[candidate.candidate_id] === true
    if (candidateWouldOverwrite(candidate) && !allowOverwrite) {
      setActionState({
        phase: 'error',
        message: `${targetTrack?.name ?? '선택한 트랙'}에 이미 등록된 내용이 있습니다. 덮어쓰기 확인을 체크하세요.`,
      })
      return
    }
    await runStudioAction(
      () => approveCandidate(studio.studio_id, candidate.candidate_id, targetSlotId, allowOverwrite),
      `${targetTrack?.name ?? 'Track'} 후보를 등록하는 중입니다.`,
      `${targetTrack?.name ?? 'Track'} 트랙에 선택한 후보를 등록했습니다.`,
    )
  }

  async function handleRejectCandidate(candidate: ExtractionCandidate) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
    await runStudioAction(
      () => rejectCandidate(studio.studio_id, candidate.candidate_id),
      `${targetTrack?.name ?? 'Track'} 후보를 거절하는 중입니다.`,
      `${targetTrack?.name ?? 'Track'} 후보를 거절했습니다.`,
    )
  }

  async function handleApproveJobCandidates(jobId: string) {
    if (!studio) {
      return
    }
    const allowOverwrite = jobOverwriteApprovals[jobId] === true
    if (jobWouldOverwrite(jobId) && !allowOverwrite) {
      setActionState({
        phase: 'error',
        message: 'OMR 결과가 기존 등록 트랙에 덮어씁니다. 덮어쓰기 확인을 체크하세요.',
      })
      return
    }
    await runStudioAction(
      () => approveJobCandidates(studio.studio_id, jobId, allowOverwrite),
      'OMR 결과를 각 트랙에 등록하는 중입니다.',
      'OMR 결과를 제안된 트랙에 등록했습니다.',
    )
  }

  async function handleRetryJob(jobId: string) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => retryExtractionJob(studio.studio_id, jobId),
      '추출 작업을 다시 대기열에 올리는 중입니다.',
      '추출 작업을 다시 시작했습니다. 완료되면 후보가 표시됩니다.',
    )
  }

  async function handleExportPdf() {
    if (!studio) {
      return
    }
    setActionState({ phase: 'busy', message: 'PDF 악보를 생성하는 중입니다.' })
    try {
      const pdfBlob = await exportStudioPdf(studio.studio_id)
      const url = URL.createObjectURL(pdfBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeDownloadName(studio.title)}-score.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setActionState({ phase: 'success', message: 'PDF 악보를 생성했습니다.' })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'PDF를 생성하지 못했습니다.',
      })
    }
  }

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

    const totalPulses = Math.max(1, Math.round(studioMeter.beatsPerMeasure / studioMeter.pulseQuarterBeats))
    const pulseMilliseconds = getBeatSeconds(studio.bpm) * studioMeter.pulseQuarterBeats * 1000
    const downbeatDelayMilliseconds = COUNT_IN_FIRST_PULSE_DELAY_MS
    const countInMilliseconds = totalPulses * pulseMilliseconds
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

    const recordingDownbeatMilliseconds = countInEpochMilliseconds + countInMilliseconds
    trackCountInEpochMsRef.current = countInEpochMilliseconds

    const scheduleCountInAt = (targetMilliseconds: number, callback: () => void) => {
      const timeoutId = window.setTimeout(callback, Math.max(0, Math.round(targetMilliseconds - performance.now())))
      trackCountInTimeoutIdsRef.current.push(timeoutId)
    }

    setTrackCountIn({
      slotId: track.slot_id,
      pulsesRemaining: totalPulses,
      totalPulses,
    })
    setTrackRecordingMeter({ durationSeconds: 0, level: 0 })

    for (let pulseIndex = 1; pulseIndex < totalPulses; pulseIndex += 1) {
      scheduleCountInAt(countInEpochMilliseconds + pulseIndex * pulseMilliseconds, () => {
        if (trackCountInRunIdRef.current !== runId) {
          return
        }
        setTrackCountIn({
          slotId: track.slot_id,
          pulsesRemaining: totalPulses - pulseIndex,
          totalPulses,
        })
      })
    }

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
      if (!beginMicrophoneCapture(recorder)) {
        trackCountInEpochMsRef.current = null
        setTrackCountIn(null)
        setActionState({ phase: 'error', message: '녹음을 시작하지 못했습니다. 다시 시도해 주세요.' })
        return
      }
      setRecordingSlotId(track.slot_id)
      setTrackRecordingMeter({ durationSeconds: 0, level: recorder.rmsLevel })
      setActionState({
        phase: 'success',
        message: `${track.name} 녹음을 시작했습니다. 내부 메트로놈 기준으로 악보에 기록됩니다.`,
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

  function disposeCurrentPlaybackSession() {
    disposePlaybackSession(playbackSessionRef.current)
    playbackSessionRef.current = null
    setPlaybackTimeline(null)
    setPlayheadSeconds(null)
  }

  function stopPlaybackSession() {
    playbackRunIdRef.current += 1
    disposeCurrentPlaybackSession()
  }

  function trackHasPlayableScore(track: TrackSlot): boolean {
    return track.notes.some((note) => note.is_rest !== true)
  }

  function trackHasPlayableAudio(track: TrackSlot): boolean {
    return Boolean(track.audio_source_path)
  }

  function getTrackTimelineDurationSeconds(track: TrackSlot, beatSeconds: number): number {
    const noteEndSeconds = Math.max(
      0,
      ...track.notes.map((note) => (note.beat - 1 + note.duration_beats) * beatSeconds),
    )
    if (Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
      return Math.max(track.duration_seconds, noteEndSeconds)
    }
    return Math.max(0.25, noteEndSeconds)
  }

  function scheduleMetronomeClicksFromTimeline(
    context: AudioContext,
    nodes: PlaybackNode[],
    scheduledStart: number,
    startSeconds: number,
    maxBeat: number,
    bpm: number,
    meter: MeterContext,
    volume: number,
  ): number {
    const beatSeconds = getBeatSeconds(bpm)
    let latestStop = 0
    for (
      let quarterBeatOffset = 0;
      quarterBeatOffset <= Math.max(0, maxBeat - 1) + 0.001;
      quarterBeatOffset += meter.pulseQuarterBeats
    ) {
      const clickStartSeconds = quarterBeatOffset * beatSeconds
      if (clickStartSeconds + 0.045 < startSeconds) {
        continue
      }
      const relativeStartSeconds = Math.max(0, clickStartSeconds - startSeconds)
      const frequency = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure) ? 960 : 720
      nodes.push(
        createTone(
          context,
          scheduledStart + relativeStartSeconds,
          0.045,
          frequency,
          volume,
          'square',
        ),
      )
      latestStop = Math.max(latestStop, relativeStartSeconds + 0.045)
    }
    return latestStop
  }

  async function startPlaybackSession(
    tracksToPlay: TrackSlot[],
    includeMetronome = metronomeEnabled,
    options: PlaybackStartOptions = {},
  ): Promise<boolean> {
    if (!studio) {
      return false
    }

    const playableTracks = tracksToPlay.filter(
      (track) =>
        track.status === 'registered' &&
        (playbackSource === 'audio'
          ? trackHasPlayableAudio(track) || trackHasPlayableScore(track)
          : trackHasPlayableScore(track)),
    )
    if (playableTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return false
    }

    const runId = playbackRunIdRef.current + 1
    playbackRunIdRef.current = runId

    disposeCurrentPlaybackSession()

    const beatSeconds = 60 / studio.bpm
    const minTimelineSeconds = Math.min(0, ...playableTracks.map((track) => track.sync_offset_seconds))
    const startSeconds = Math.max(minTimelineSeconds, options.startSeconds ?? minTimelineSeconds)
    const mediaStartDelaySeconds = 0.08
    const audioTracks = playbackSource === 'audio' ? playableTracks.filter(trackHasPlayableAudio) : []
    const scoreTracks = playableTracks.filter(
      (track) => !(playbackSource === 'audio' && trackHasPlayableAudio(track)) && trackHasPlayableScore(track),
    )
    const needsAudioContext = audioTracks.length > 0 || scoreTracks.length > 0 || includeMetronome
    const nodes: PlaybackNode[] = []
    const timeoutIds: number[] = []
    let latestStop = 0
    let timelineEndSeconds = Math.max(startSeconds, minTimelineSeconds + 0.25)
    let maxBeat = 1
    let context: AudioContext | undefined
    let scheduledStart = 0

    const AudioContextConstructor = getBrowserAudioContextConstructor()
    if (needsAudioContext) {
      if (!AudioContextConstructor) {
        setActionState({ phase: 'error', message: '악보 음이나 메트로놈을 재생할 오디오 장치를 열지 못했습니다.' })
        return false
      }
      try {
        context = new AudioContextConstructor()
        scheduledStart = context.currentTime + mediaStartDelaySeconds
        await context.resume().catch(() => undefined)
      } catch {
        setActionState({ phase: 'error', message: '오디오 장치를 열지 못했습니다. 브라우저 권한을 확인해 주세요.' })
        return false
      }
    }

    try {
      let scheduledAnyTrack = false
      const audioTrackVolume = Math.max(0.28, Math.min(0.72, 0.72 / Math.sqrt(playableTracks.length)))
      const activeContext = context
      const preparedAudioTracks: Array<{ buffer: AudioBuffer; track: TrackSlot; trackStartSeconds: number }> = []

      if (audioTracks.length > 0) {
        if (!activeContext) {
          throw new Error('녹음 원본을 재생할 오디오 장치를 열지 못했습니다.')
        }
        const requiresSynchronizedStart = audioTracks.length > 1 || scoreTracks.length > 0 || includeMetronome
        const synchronizedParts = [
          `원음 ${audioTracks.length}개`,
          scoreTracks.length > 0 ? `악보 음 ${scoreTracks.length}개` : null,
          includeMetronome ? '메트로놈' : null,
        ].filter(Boolean)
        setActionState({
          phase: 'busy',
          message:
            requiresSynchronizedStart
              ? `${synchronizedParts.join(', ')}을 같은 오디오 clock에 맞춰 준비합니다.`
              : '녹음 원본을 오디오 clock에 올리는 중입니다.',
        })
        const decodedAudioTracks = await Promise.all(
          audioTracks.map(async (track) => {
            const audioUrl = getTrackAudioUrl(studio.studio_id, track.slot_id)
            const arrayBuffer = await fetchAudioArrayBuffer(audioUrl)
            const buffer = await activeContext.decodeAudioData(arrayBuffer.slice(0))
            return {
              buffer,
              track,
              trackStartSeconds: track.sync_offset_seconds,
            }
          }),
        )
        preparedAudioTracks.push(...decodedAudioTracks)
      }

      if (playbackRunIdRef.current !== runId) {
        disposePlaybackSession({ context, nodes, timeoutIds })
        return false
      }

      scheduledStart = activeContext ? activeContext.currentTime + mediaStartDelaySeconds : 0

      preparedAudioTracks.forEach(({ buffer, track, trackStartSeconds }) => {
        if (!activeContext) {
          return
        }
        const sourceOffsetSeconds = Math.max(0, startSeconds - trackStartSeconds)
        const relativeStartSeconds = Math.max(0, trackStartSeconds - startSeconds)
        const node = createAudioBufferPlayback(
          activeContext,
          buffer,
          scheduledStart + relativeStartSeconds,
          sourceOffsetSeconds,
          audioTrackVolume,
        )
        if (!node) {
          return
        }
        nodes.push(node)
        const trackDurationSeconds = Math.max(buffer.duration, getTrackTimelineDurationSeconds(track, beatSeconds))
        const trackEndSeconds = trackStartSeconds + trackDurationSeconds
        latestStop = Math.max(
          latestStop,
          Math.max(0, trackEndSeconds - startSeconds),
        )
        timelineEndSeconds = Math.max(timelineEndSeconds, trackEndSeconds)
        maxBeat = Math.max(maxBeat, Math.ceil(trackEndSeconds / beatSeconds) + 1)
        scheduledAnyTrack = true

        track.notes.forEach((note) => {
          maxBeat = Math.max(maxBeat, note.beat + note.duration_beats - 1)
        })
      })

      scoreTracks.forEach((track) => {
        if (!activeContext) {
          track.notes.forEach((note) => {
            maxBeat = Math.max(maxBeat, note.beat + note.duration_beats - 1)
          })
          return
        }

        track.notes.forEach((note) => {
          const frequency = getNotePlaybackFrequency(note)
          if (frequency === null) {
            return
          }
          const noteStartSeconds = (note.beat - 1) * beatSeconds + track.sync_offset_seconds
          const duration = Math.max(0.11, note.duration_beats * beatSeconds * 0.9)
          const noteEndSeconds = noteStartSeconds + duration
          timelineEndSeconds = Math.max(timelineEndSeconds, noteEndSeconds)
          if (noteEndSeconds <= startSeconds) {
            maxBeat = Math.max(maxBeat, note.beat + note.duration_beats - 1)
            return
          }
          const relativeStartSeconds = Math.max(0, noteStartSeconds - startSeconds)
          const remainingDuration = Math.max(
            0.05,
            noteEndSeconds - Math.max(noteStartSeconds, startSeconds),
          )
          const volume = track.slot_id === 6 ? 0.055 : 0.06
          const toneType: OscillatorType | 'piano' = track.slot_id === 6 ? 'square' : 'piano'

          nodes.push(
            createTone(
              activeContext,
              scheduledStart + relativeStartSeconds,
              remainingDuration,
              frequency,
              volume,
              toneType,
            ),
          )
          latestStop = Math.max(latestStop, relativeStartSeconds + remainingDuration)
          maxBeat = Math.max(maxBeat, note.beat + note.duration_beats - 1)
          scheduledAnyTrack = true
        })
      })

      if (!scheduledAnyTrack) {
        disposePlaybackSession({ context, nodes, timeoutIds })
        setActionState({ phase: 'error', message: '재생 가능한 녹음 파일이나 악보 음표가 없습니다.' })
        return false
      }

      if (includeMetronome && activeContext) {
        timelineEndSeconds = Math.max(timelineEndSeconds, maxBeat * beatSeconds)
        latestStop = Math.max(
          latestStop,
          scheduleMetronomeClicksFromTimeline(
            activeContext,
            nodes,
            scheduledStart,
            startSeconds,
            maxBeat,
            studio.bpm,
            studioMeter,
            0.035,
          ),
        )
      }
    } catch (error) {
      disposePlaybackSession({ context, nodes, timeoutIds })
      setActionState({
        phase: 'error',
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : '재생을 시작하지 못했습니다.',
      })
      return false
    }

    if (playbackRunIdRef.current !== runId) {
      disposePlaybackSession({ context, nodes, timeoutIds })
      return false
    }

    const playbackSession: PlaybackSession = { context, nodes, timeoutIds }
    const sessionDurationSeconds = Math.max(0.1, latestStop + 0.45)
    const timeoutId = window.setTimeout(() => {
      if (playbackSessionRef.current !== playbackSession) {
        return
      }

      disposePlaybackSession(playbackSession)
      playbackSessionRef.current = null
      setPlaybackTimeline(null)
      setPlayheadSeconds(null)
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
    }, Math.ceil(sessionDurationSeconds * 1000))

    playbackSession.timeoutIds.push(timeoutId)
    playbackSessionRef.current = playbackSession
    setPlaybackTimeline({
      maxSeconds: Math.max(timelineEndSeconds, startSeconds + latestStop),
      minSeconds: minTimelineSeconds,
      startSeconds,
      startedAtMs: performance.now() + mediaStartDelaySeconds * 1000,
    })
    return true
  }

  function togglePlaybackSelection(slotId: number) {
    setSelectedPlaybackSlotIds((current) => {
      const next = new Set(current)
      if (next.has(slotId)) {
        next.delete(slotId)
      } else {
        next.add(slotId)
      }
      return next
    })
  }

  function selectAllPlaybackTracks() {
    setSelectedPlaybackSlotIds(new Set(registeredSlotIds))
  }

  function openPlaybackPicker() {
    if (registeredTracks.length === 0) {
      setPlaybackPickerOpen(true)
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return
    }
    setSelectedPlaybackSlotIds(new Set(registeredSlotIds))
    setPlaybackPickerOpen(true)
    setActionState({ phase: 'success', message: '동시 재생할 트랙을 선택하세요.' })
  }

  function updateSyncStep(nextStepSeconds: number) {
    if (!Number.isFinite(nextStepSeconds) || nextStepSeconds <= 0) {
      return
    }
    setSyncStepSeconds(Math.round(Math.min(10, Math.max(0.001, nextStepSeconds)) * 1000) / 1000)
  }

  function getSelectedPlaybackTracks(): TrackSlot[] {
    if (!studio) {
      return []
    }
    return studio.tracks.filter(
      (track) => track.status === 'registered' && selectedPlaybackSlotIds.has(track.slot_id),
    )
  }

  async function startSelectedPlayback(startSeconds?: number) {
    const selectedTracks = getSelectedPlaybackTracks()
    if (selectedTracks.length === 0) {
      setPlaybackPickerOpen(true)
      setActionState({ phase: 'error', message: '동시 재생할 등록 트랙을 하나 이상 선택하세요.' })
      return
    }

    setActionState({
      phase: 'busy',
      message:
          playbackSource === 'audio'
            ? '선택한 트랙의 원음과 악보 음 시작점을 맞춥니다.'
            : '선택한 트랙을 악보 음 기준으로 재생합니다.',
    })
    if (await startPlaybackSession(selectedTracks, metronomeEnabled, { startSeconds })) {
      setPlaybackPickerOpen(true)
      setPlayingSlots(new Set(selectedTracks.map((track) => track.slot_id)))
      setGlobalPlaying(true)
      setActionState({
        phase: 'success',
        message:
          playbackSource === 'audio'
            ? `${selectedTracks.length}개 트랙을 같은 오디오 clock에서 재생합니다.`
            : `${selectedTracks.length}개 트랙을 악보 음 기준으로 동시에 재생합니다.`,
      })
    }
  }

  async function toggleGlobalPlayback() {
    if (globalPlaying) {
      stopPlaybackSession()
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
      setActionState({ phase: 'success', message: '선택 재생을 일시정지했습니다.' })
      return
    }

    if (registeredTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return
    }

    if (!playbackPickerOpen) {
      setPlaybackPickerOpen(true)
      setActionState({ phase: 'success', message: '동시 재생할 트랙을 선택하세요.' })
      return
    }

    await startSelectedPlayback()
  }

  function seekSelectedPlayback(nextSeconds: number) {
    if (!globalPlaying || !playbackTimeline) {
      return
    }
    const clampedSeconds = Math.max(
      playbackTimeline.minSeconds,
      Math.min(playbackTimeline.maxSeconds, nextSeconds),
    )
    void startSelectedPlayback(clampedSeconds)
  }

  function stopGlobalPlayback() {
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setActionState({
      phase: 'success',
      message: '선택한 트랙이 싱크가 반영된 0s 지점으로 돌아왔습니다.',
    })
  }

  function changePlaybackSource(nextSource: PlaybackSourceMode) {
    if (nextSource === playbackSource) {
      return
    }
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setPlaybackSource(nextSource)
    setActionState({
      phase: 'success',
      message: nextSource === 'audio' ? '재생 소스를 녹음 원본으로 전환했습니다.' : '재생 소스를 악보 음으로 전환했습니다.',
    })
  }

  async function toggleTrackPlayback(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: `${track.name} 트랙은 아직 등록되지 않았습니다.` })
      return
    }

    if (playingSlots.has(track.slot_id)) {
      stopPlaybackSession()
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
      setActionState({ phase: 'success', message: `${track.name} 트랙 재생을 일시정지했습니다.` })
      return
    }

    setActionState({
      phase: 'busy',
      message:
          playbackSource === 'audio' && track.audio_source_path
            ? `${track.name} 녹음 원본을 준비합니다. 메트로놈이나 악보 음이 있으면 함께 맞춰 시작합니다.`
            : `${track.name} 트랙을 악보 음 기준으로 재생합니다.`,
    })
    if (await startPlaybackSession([track])) {
      setGlobalPlaying(false)
      setPlayingSlots(new Set([track.slot_id]))
      setActionState({
        phase: 'success',
        message:
          playbackSource === 'audio' && track.audio_source_path
            ? `${track.name} 트랙의 녹음 원본을 재생합니다.`
            : `${track.name} 트랙을 악보 음 기준으로 재생합니다.`,
      })
    }
  }

  function stopTrackPlayback(track: TrackSlot) {
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setActionState({
      phase: 'success',
      message: `${track.name} 트랙이 싱크가 반영된 0s 지점으로 돌아왔습니다.`,
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
          throw new Error('녹음된 오디오가 비어 있습니다. 마이크 입력을 확인하고 다시 녹음해 주세요.')
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
          message: `${track.name} 녹음을 보류했습니다. 들어본 뒤 트랙에 등록하거나 삭제하세요.`,
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
        message: '등록 여부를 기다리는 녹음이 있습니다. 먼저 등록하거나 삭제해 주세요.',
      })
      return
    }

    if (scoreSession?.phase === 'listening' || scoreSession?.phase === 'analyzing') {
      setActionState({
        phase: 'error',
        message: '채점 녹음이 진행 중입니다. 먼저 채점을 중지한 뒤 트랙 녹음을 시작해 주세요.',
      })
      return
    }

    const wouldOverwrite = track.status === 'registered' || track.notes.length > 0
    const allowOverwrite =
      !wouldOverwrite || window.confirm(`${track.name} 트랙의 기존 악보를 새 녹음으로 덮어쓸까요?`)
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
      message: `${track.name} 녹음 준비 중입니다. 1마디 count-in 후 내부 메트로놈 기준으로 기록합니다.`,
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
      `${pendingRecording.trackName} 녹음을 악보화하는 중입니다.`,
      `${pendingRecording.trackName} 녹음의 음성 추출 작업을 시작했습니다. 완료되면 트랙에 등록됩니다.`,
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
      message: `${pendingTrackRecording.trackName} 녹음을 삭제했습니다. 트랙에는 아무 작업도 등록하지 않았습니다.`,
    })
    setPendingTrackRecording(null)
  }

  async function handleUpload(track: TrackSlot, file: File | null) {
    if (!studio || !file) {
      return
    }

    const sourceKind = detectUploadKind(file)
    if (!sourceKind) {
      setActionState({ phase: 'error', message: '지원하지 않는 파일 형식입니다.' })
      return
    }

    const uploadSucceeded = await runStudioAction(
      async () => {
        const preparedUpload =
          sourceKind === 'audio'
            ? await prepareAudioFileForUpload(file)
            : {
                filename: file.name,
                blob: file,
                contentType: file.type || 'application/octet-stream',
                contentBase64: undefined,
              }

        const uploadTarget = await createTrackUploadTarget(studio.studio_id, track.slot_id, {
          source_kind: sourceKind,
          filename: preparedUpload.filename,
          size_bytes: preparedUpload.blob.size,
          content_type: preparedUpload.contentType,
        })

        try {
          await putDirectUpload(uploadTarget, preparedUpload.blob)
        } catch {
          const fallbackContentBase64 =
            preparedUpload.contentBase64 ?? (await readFileAsDataUrl(file))
          return uploadTrack(studio.studio_id, track.slot_id, {
            source_kind: sourceKind,
            filename: preparedUpload.filename,
            content_base64: fallbackContentBase64,
            review_before_register: true,
          })
        }

        return uploadTrack(studio.studio_id, track.slot_id, {
          source_kind: sourceKind,
          filename: preparedUpload.filename,
          asset_path: uploadTarget.asset_path,
          review_before_register: true,
        })
      },
      `${track.name} 업로드를 악보화하는 중입니다.`,
      `${track.name} 트랙에 ${file.name} 추출 후보를 만들었습니다.`,
    )
    if (uploadSucceeded) {
      if (isOmrUpload(file)) {
        setActionState({
          phase: 'success',
          message: `${track.name} PDF/image OMR 작업을 시작했습니다. 추출 후 후보가 표시됩니다.`,
        })
      } else if (sourceKind === 'audio') {
        setActionState({
          phase: 'success',
          message: `${track.name} 음성 추출 작업을 시작했습니다. 추출 후 후보가 표시됩니다.`,
        })
      }
    }
  }

  async function handleGenerate(track: TrackSlot) {
    if (!studio) {
      return
    }
    if (registeredSlotIds.length === 0) {
      setActionState({ phase: 'error', message: 'AI 생성은 등록된 트랙이 하나 이상 필요합니다.' })
      return
    }

    const otherRegisteredSlotIds = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    const contextSlotIds = otherRegisteredSlotIds.length > 0 ? otherRegisteredSlotIds : registeredSlotIds

    await runStudioAction(
      () => generateTrack(studio.studio_id, track.slot_id, contextSlotIds, false, 3),
      `${track.name} 파트 후보를 생성하는 중입니다.`,
      track.slot_id === 6
        ? '퍼커션 트랙에 BPM 기반 비트 후보 3개를 만들었습니다.'
        : `${track.name} 트랙에 참고 트랙 기반 악보 후보 3개를 만들었습니다.`,
    )
  }

  async function handleSync(track: TrackSlot, nextOffset: number) {
    if (!studio) {
      return
    }
    const roundedOffset = Math.round(nextOffset * 1000) / 1000
    await runStudioAction(
      () => updateTrackSync(studio.studio_id, track.slot_id, roundedOffset),
      `${track.name} 싱크를 저장하는 중입니다.`,
      `${track.name} 싱크를 ${formatSeconds(roundedOffset)}로 맞췄습니다.`,
    )
  }

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
      return {
        ...current,
        scoreMode,
        selectedReferenceIds:
          scoreMode === 'harmony' && current.selectedReferenceIds.length === 0
            ? references
            : current.selectedReferenceIds,
        includeMetronome:
          scoreMode === 'answer'
            ? current.includeMetronome || current.selectedReferenceIds.length === 0
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
      return {
        ...current,
        selectedReferenceIds: exists
          ? current.selectedReferenceIds.filter((candidate) => candidate !== slotId)
          : [...current.selectedReferenceIds, slotId],
      }
    })
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
    const referenceTracks = studio.tracks.filter((track) =>
      scoreSession.selectedReferenceIds.includes(track.slot_id),
    )
    if (referenceTracks.length > 0) {
      setActionState({ phase: 'busy', message: '선택한 채점 기준 트랙을 재생합니다.' })
      if (!(await startPlaybackSession(referenceTracks, scoreSession.includeMetronome))) {
        return
      }
      setGlobalPlaying(false)
      setPlayingSlots(new Set(referenceTracks.map((track) => track.slot_id)))
    } else if (scoreSession.includeMetronome) {
      stopPlaybackSession()
      const metronomeSession = startLoopingMetronomeSession(studio.bpm, studioMeter)
      if (!metronomeSession) {
        setActionState({
          phase: 'error',
          message: '메트로놈 재생용 오디오 장치를 열지 못했습니다.',
        })
        return
      }
      playbackSessionRef.current = metronomeSession
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
    }
    const runId = scoreRunIdRef.current + 1
    scoreRunIdRef.current = runId
    setScoreSession({ ...scoreSession, phase: 'listening' })
    setActionState({
      phase: 'success',
      message:
        scoreSession.scoreMode === 'harmony'
          ? '선택한 트랙 위에 새 파트를 얹어 부르면 화음 완성도를 채점합니다.'
          : '선택한 기준 트랙을 재생하고 이후 채점 입력을 받습니다.',
    })
    const recorder = await startMicrophoneRecorder()
    if (scoreRunIdRef.current !== runId) {
      void stopMicrophoneRecorder(recorder)
      return
    }
    scoreRecorderRef.current = recorder
    if (!recorder) {
      setActionState({
        phase: 'success',
        message: '마이크 입력을 열지 못해 기준 재생만 유지합니다. 실제 채점 테스트에서는 브라우저 마이크 권한을 확인해 주세요.',
      })
    }
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
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
      const nextStudio = await scoreTrack(studio.studio_id, session.targetSlotId, {
        score_mode: session.scoreMode,
        reference_slot_ids: session.selectedReferenceIds,
        include_metronome: session.includeMetronome,
        ...(performanceAudioBase64
          ? {
              performance_audio_base64: performanceAudioBase64,
              performance_filename: `${scoreTargetTrack?.name ?? 'track'}-score-take.wav`,
            }
          : {}),
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

  if (!studioId) {
    return (
      <main className="app-shell studio-route-state">
        <div className="studio-route-state__meter" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Studio error</p>
          <h1>스튜디오를 찾을 수 없습니다</h1>
          <p>스튜디오 주소가 올바르지 않습니다.</p>
          <Link className="app-button" to="/">
            홈으로
          </Link>
        </div>
      </main>
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <main className="app-shell studio-route-state">
        <div className="studio-route-state__meter" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Studio loading</p>
          <h1>트랙을 불러오는 중입니다</h1>
        </div>
      </main>
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <main className="app-shell studio-route-state">
        <div className="studio-route-state__meter" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Studio error</p>
          <h1>스튜디오를 찾을 수 없습니다</h1>
          <p>{loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}</p>
          <Link className="app-button" to="/">
            홈으로
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell studio-page">
      <section className="composer-window" aria-label="GigaStudy composer studio">
        <StudioToolbar
          actionState={actionState}
          globalPlaying={globalPlaying}
          metronomeEnabled={metronomeEnabled}
          playbackPickerOpen={playbackPickerOpen}
          playbackRange={
            playbackTimeline
              ? { maxSeconds: playbackTimeline.maxSeconds, minSeconds: playbackTimeline.minSeconds }
              : null
          }
          playbackSource={playbackSource}
          playheadSeconds={playheadSeconds}
          registeredTrackCount={registeredTracks.length}
          registeredTracks={registeredTracks}
          selectedPlaybackSlotIds={selectedPlaybackSlotIds}
          studioTitle={studio.title}
          syncStepSeconds={syncStepSeconds}
          onExportPdf={() => void handleExportPdf()}
          onMetronomeChange={setMetronomeEnabled}
          onPlaybackSourceChange={changePlaybackSource}
          onSeekPlayback={seekSelectedPlayback}
          onSelectAllPlaybackTracks={selectAllPlaybackTracks}
          onStartSelectedPlayback={() => void startSelectedPlayback()}
          onStopGlobalPlayback={stopGlobalPlayback}
          onSyncStepChange={updateSyncStep}
          onTogglePlaybackPicker={openPlaybackPicker}
          onTogglePlaybackSelection={togglePlaybackSelection}
          onToggleGlobalPlayback={() => void toggleGlobalPlayback()}
        />
        <section className="composer-score-viewport">
          <div className="composer-score-paper">
            <div className="composer-score-heading">
              <h1>{studio.title}</h1>
              <p>
                {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} · 등록{' '}
                {registeredTracks.length}/6 · 리포트 {studio.reports.length}
              </p>
            </div>

            <TrackBoard
              beatsPerMeasure={studioBeatsPerMeasure}
              bpm={studio.bpm}
              metronomeEnabled={metronomeEnabled}
              pendingCandidateCount={pendingCandidates.length}
              playingSlots={playingSlots}
              playheadSeconds={playheadSeconds}
              registeredTracks={registeredTracks}
              syncStepSeconds={syncStepSeconds}
              trackCountIn={trackCountIn}
              recordingSlotId={recordingSlotId}
              trackRecordingMeter={trackRecordingMeter}
              tracks={studio.tracks}
              onGenerate={(track) => void handleGenerate(track)}
              onOpenScore={openScoreSession}
              onRecord={(track) => void handleRecord(track)}
              onStopPlayback={stopTrackPlayback}
              onSync={(track, nextOffset) => void handleSync(track, nextOffset)}
              onTogglePlayback={(track) => void toggleTrackPlayback(track)}
              onUpload={(track, file) => void handleUpload(track, file)}
            />
            <ExtractionJobsPanel
              activeJobCount={activeExtractionJobs.length}
              jobOverwriteApprovals={jobOverwriteApprovals}
              tracks={studio.tracks}
              visibleJobs={visibleExtractionJobs}
              getPendingJobCandidates={getPendingJobCandidates}
              jobWouldOverwrite={jobWouldOverwrite}
              onApproveJobCandidates={(jobId) => void handleApproveJobCandidates(jobId)}
              onRetryJob={(jobId) => void handleRetryJob(jobId)}
              onUpdateJobOverwriteApproval={updateJobOverwriteApproval}
            />

            <CandidateReviewPanel
              beatsPerMeasure={studioBeatsPerMeasure}
              candidateOverwriteApprovals={candidateOverwriteApprovals}
              candidates={pendingCandidates}
              tracks={studio.tracks}
              candidateWouldOverwrite={candidateWouldOverwrite}
              getJobSourcePreviewUrl={(jobId) => getOmrJobSourcePreviewUrl(studio.studio_id, jobId)}
              getSelectedCandidateSlotId={getSelectedCandidateSlotId}
              onApproveCandidate={(candidate) => void handleApproveCandidate(candidate)}
              onRejectCandidate={(candidate) => void handleRejectCandidate(candidate)}
              onUpdateCandidateOverwriteApproval={updateCandidateOverwriteApproval}
              onUpdateCandidateTargetSlot={updateCandidateTargetSlot}
            />
          </div>
        </section>

        <footer className="composer-statusbar">
          <span>{globalPlaying || playingSlots.size > 0 ? 'Playing' : 'Ready'}</span>
          <span>Bar 1</span>
          <span>
            {playheadSeconds === null ? '0:00' : formatDurationSeconds(playheadSeconds)} /{' '}
            {playbackTimeline ? formatDurationSeconds(playbackTimeline.maxSeconds) : '0:00'}
          </span>
          <span>Sync step {formatSeconds(syncStepSeconds).replace(/^\+/, '')}</span>
        </footer>
      </section>

      <ReportFeed reports={studio.reports} studioId={studio.studio_id} tracks={studio.tracks} />

      <ScoringDrawer
        scoreSession={scoreSession}
        targetTrack={scoreTargetTrack}
        tracks={studio.tracks}
        onCancel={() => setScoreSession(null)}
        onIncludeMetronomeChange={(includeMetronome) => {
          if (scoreSession) {
            setScoreSession({ ...scoreSession, includeMetronome })
          }
        }}
        onScoreModeChange={updateScoreMode}
        onStart={() => void startScoreListening()}
        onStop={() => void stopScoreListening()}
        onToggleReference={toggleScoreReference}
      />

      {pendingTrackRecording ? (
        <section
          aria-labelledby="pending-recording-title"
          aria-modal="true"
          className="recording-review-backdrop"
          data-testid="pending-recording-dialog"
          role="dialog"
        >
          <div className="recording-review-panel">
            <p className="eyebrow">Recording review</p>
            <h2 id="pending-recording-title">{pendingTrackRecording.trackName} 녹음 확인</h2>
            <p>
              아직 트랙에 등록하지 않았습니다. 원음을 확인한 뒤 악보화 작업을 시작하거나 녹음을 삭제하세요.
            </p>
            <dl>
              <div>
                <dt>대상 트랙</dt>
                <dd>{pendingTrackRecording.trackName}</dd>
              </div>
              <div>
                <dt>녹음 길이</dt>
                <dd>{formatDurationSeconds(pendingTrackRecording.durationSeconds)}</dd>
              </div>
            </dl>
            <audio controls src={pendingTrackRecording.audioDataUrl}>
              녹음 미리듣기를 지원하지 않는 브라우저입니다.
            </audio>
            <div className="recording-review-panel__actions">
              <button
                className="app-button app-button--secondary"
                data-testid="pending-recording-discard"
                disabled={actionState.phase === 'busy'}
                type="button"
                onClick={handleDiscardPendingRecording}
              >
                녹음 삭제
              </button>
              <button
                className="app-button"
                data-testid="pending-recording-register"
                disabled={actionState.phase === 'busy'}
                type="button"
                onClick={() => void handleRegisterPendingRecording()}
              >
                트랙 등록
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  )
}
