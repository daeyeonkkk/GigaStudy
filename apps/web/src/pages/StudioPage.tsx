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
  exportStudioPdf,
  generateTrack,
  getStudio,
  readFileAsDataUrl,
  rejectCandidate,
  scoreTrack,
  updateTrackSync,
  uploadTrack,
} from '../lib/api'
import {
  getBrowserAudioContextConstructor,
  prepareAudioFileForUpload,
  startMicrophoneRecorder,
  stopMicrophoneRecorder,
  type MicrophoneRecorder,
} from '../lib/audio'
import {
  createTone,
  DEFAULT_METER,
  detectUploadKind,
  disposePlaybackSession,
  formatSeconds,
  getNotePlaybackFrequency,
  getStudioMeter,
  isOmrUpload,
  safeDownloadName,
  scheduleMetronomeClicks,
  startLoopingMetronomeSession,
  type PlaybackNode,
  type PlaybackSession,
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

export function StudioPage() {
  const { studioId } = useParams()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })
  const [actionState, setActionState] = useState<ActionState>({ phase: 'idle' })
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [playingSlots, setPlayingSlots] = useState<Set<number>>(() => new Set())
  const [recordingSlotId, setRecordingSlotId] = useState<number | null>(null)
  const [trackRecordingMeter, setTrackRecordingMeter] = useState({
    durationSeconds: 0,
    level: 0,
  })
  const [scoreSession, setScoreSession] = useState<ScoreSessionState | null>(null)
  const [candidateTargetSlots, setCandidateTargetSlots] = useState<Record<string, number>>({})
  const [candidateOverwriteApprovals, setCandidateOverwriteApprovals] = useState<Record<string, boolean>>({})
  const [jobOverwriteApprovals, setJobOverwriteApprovals] = useState<Record<string, boolean>>({})
  const playbackSessionRef = useRef<PlaybackSession | null>(null)
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
    if (recordingSlotId === null) {
      return undefined
    }

    const updateMeter = () => {
      const recorder = trackRecorderRef.current
      if (!recorder) {
        return
      }
      setTrackRecordingMeter({
        durationSeconds: (performance.now() - recorder.startedAt) / 1000,
        level: recorder.rmsLevel,
      })
    }

    updateMeter()
    const intervalId = window.setInterval(updateMeter, 120)
    return () => window.clearInterval(intervalId)
  }, [recordingSlotId])

  useEffect(() => {
    disposePlaybackSession(recordingMetronomeSessionRef.current)
    recordingMetronomeSessionRef.current = null

    if (recordingSlotId === null || !metronomeEnabled || !studio?.bpm) {
      return undefined
    }

    recordingMetronomeSessionRef.current = startLoopingMetronomeSession(studio.bpm, studioMeter)
    return () => {
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
    }
  }, [metronomeEnabled, recordingSlotId, studio?.bpm, studioMeter])

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

  function stopPlaybackSession() {
    disposePlaybackSession(playbackSessionRef.current)
    playbackSessionRef.current = null
  }

  function startPlaybackSession(
    tracksToPlay: TrackSlot[],
    includeMetronome = metronomeEnabled,
  ): boolean {
    if (!studio) {
      return false
    }

    const playableTracks = tracksToPlay.filter(
      (track) => track.status === 'registered' && track.notes.some((note) => note.is_rest !== true),
    )
    if (playableTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생할 악보가 있는 등록 트랙이 없습니다.' })
      return false
    }

    const AudioContextConstructor = getBrowserAudioContextConstructor()
    if (!AudioContextConstructor) {
      stopPlaybackSession()

      const beatSeconds = 60 / studio.bpm
      const minOffsetSeconds = Math.min(0, ...playableTracks.map((track) => track.sync_offset_seconds))
      let latestStop = 0

      playableTracks.forEach((track) => {
        track.notes.forEach((note) => {
          if (note.is_rest === true) {
            return
          }
          const noteStart =
            (note.beat - 1) * beatSeconds + track.sync_offset_seconds - minOffsetSeconds
          const normalizedStart = Math.max(0, noteStart)
          const duration = Math.max(0.09, note.duration_beats * beatSeconds * 0.82)
          latestStop = Math.max(latestStop, normalizedStart + duration)
        })
      })

      const fallbackSession: PlaybackSession = { nodes: [], timeoutIds: [] }
      const timeoutId = window.setTimeout(() => {
        if (playbackSessionRef.current !== fallbackSession) {
          return
        }

        disposePlaybackSession(fallbackSession)
        playbackSessionRef.current = null
        setGlobalPlaying(false)
        setPlayingSlots(new Set())
      }, Math.ceil((latestStop + 0.45) * 1000))

      fallbackSession.timeoutIds.push(timeoutId)
      playbackSessionRef.current = fallbackSession
      return true
    }

    stopPlaybackSession()

    let context: AudioContext
    try {
      context = new AudioContextConstructor()
    } catch {
      setActionState({ phase: 'error', message: '오디오 장치를 열지 못했습니다. 브라우저 권한을 확인해 주세요.' })
      return false
    }

    const beatSeconds = 60 / studio.bpm
    const minOffsetSeconds = Math.min(0, ...playableTracks.map((track) => track.sync_offset_seconds))
    const scheduledStart = context.currentTime + 0.08
    const nodes: PlaybackNode[] = []
    let latestStop = 0
    let maxBeat = 1

    try {
      void context.resume().catch(() => undefined)

      playableTracks.forEach((track) => {
        track.notes.forEach((note) => {
          const frequency = getNotePlaybackFrequency(note)
          if (frequency === null) {
            return
          }
          const noteStart =
            (note.beat - 1) * beatSeconds + track.sync_offset_seconds - minOffsetSeconds
          const normalizedStart = Math.max(0, noteStart)
          const duration = Math.max(0.09, note.duration_beats * beatSeconds * 0.82)
          const volume = track.slot_id === 6 ? 0.06 : 0.045
          const toneType: OscillatorType = track.slot_id === 6 ? 'square' : 'sine'

          nodes.push(
            createTone(
              context,
              scheduledStart + normalizedStart,
              duration,
              frequency,
              volume,
              toneType,
            ),
          )
          latestStop = Math.max(latestStop, normalizedStart + duration)
          maxBeat = Math.max(maxBeat, note.beat + note.duration_beats - 1)
        })
      })

      if (includeMetronome) {
        latestStop = Math.max(
          latestStop,
          scheduleMetronomeClicks(context, nodes, scheduledStart, maxBeat, studio.bpm, studioMeter, 0.035),
        )
      }
    } catch {
      disposePlaybackSession({ context, nodes, timeoutIds: [] })
      setActionState({ phase: 'error', message: '재생을 준비하는 중 문제가 발생했습니다.' })
      return false
    }

    const playbackSession: PlaybackSession = { context, nodes, timeoutIds: [] }
    const timeoutId = window.setTimeout(() => {
      if (playbackSessionRef.current !== playbackSession) {
        return
      }

      disposePlaybackSession(playbackSession)
      playbackSessionRef.current = null
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
    }, Math.ceil((latestStop + 0.45) * 1000))

    playbackSession.timeoutIds.push(timeoutId)
    playbackSessionRef.current = playbackSession
    return true
  }

  function toggleGlobalPlayback() {
    if (globalPlaying) {
      stopPlaybackSession()
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
      setActionState({ phase: 'success', message: '전체 재생을 일시정지했습니다.' })
      return
    }

    if (registeredTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return
    }

    if (startPlaybackSession(registeredTracks)) {
      setPlayingSlots(new Set())
      setGlobalPlaying(true)
      setActionState({ phase: 'success', message: '등록된 트랙 전체를 현재 싱크 기준으로 재생합니다.' })
    }
  }

  function stopGlobalPlayback() {
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setActionState({
      phase: 'success',
      message: '전체 트랙이 싱크가 반영된 0s 지점으로 돌아왔습니다.',
    })
  }

  function toggleTrackPlayback(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: `${track.name} 트랙은 아직 등록되지 않았습니다.` })
      return
    }

    if (playingSlots.has(track.slot_id)) {
      stopPlaybackSession()
      setPlayingSlots(new Set())
      setActionState({ phase: 'success', message: `${track.name} 트랙 재생을 일시정지했습니다.` })
      return
    }

    if (startPlaybackSession([track])) {
      setGlobalPlaying(false)
      setPlayingSlots(new Set([track.slot_id]))
      setActionState({ phase: 'success', message: `${track.name} 트랙을 재생합니다.` })
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
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
      disposePlaybackSession(recordingMetronomeSessionRef.current)
      recordingMetronomeSessionRef.current = null
      setRecordingSlotId(null)
      setTrackRecordingMeter({ durationSeconds: 0, level: 0 })
      await runStudioAction(
        async () => {
          const recordedAudioBase64 = await stopMicrophoneRecorder(recorder)
          if (!recordedAudioBase64) {
            throw new Error('녹음된 오디오가 비어 있습니다. 마이크 입력을 확인하고 다시 녹음해 주세요.')
          }
          return uploadTrack(studio.studio_id, track.slot_id, {
            source_kind: 'audio',
            filename: `${track.name}-recorded-take.wav`,
            content_base64: recordedAudioBase64,
            review_before_register: false,
            allow_overwrite: allowOverwrite,
          })
        },
        `${track.name} 녹음을 악보화하는 중입니다.`,
        `${track.name} 트랙에 실제 녹음 기반 악보를 등록했습니다.`,
      )
      return
    }

    if (recordingSlotId !== null) {
      setActionState({
        phase: 'error',
        message: '이미 녹음 중인 트랙이 있습니다. 먼저 현재 녹음을 중지해 주세요.',
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

    const recorder = await startMicrophoneRecorder()
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
    setRecordingSlotId(track.slot_id)
    setActionState({
      phase: 'success',
      message: metronomeEnabled
        ? `${track.name} 녹음을 시작했습니다. 메트로놈이 함께 켜졌습니다.`
        : `${track.name} 녹음을 시작했습니다.`,
    })
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
                contentBase64: await readFileAsDataUrl(file),
              }
        return uploadTrack(studio.studio_id, track.slot_id, {
          source_kind: sourceKind,
          filename: preparedUpload.filename,
          content_base64: preparedUpload.contentBase64,
          review_before_register: true,
        })
      },
      `${track.name} 업로드를 악보화하는 중입니다.`,
      `${track.name} 트랙에 ${file.name} 추출 후보를 만들었습니다.`,
    )
    if (uploadSucceeded && isOmrUpload(file)) {
      setActionState({
        phase: 'success',
        message: `${track.name} PDF/image OMR 작업을 시작했습니다. 추출 후 후보가 표시됩니다.`,
      })
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
    const roundedOffset = Math.round(nextOffset * 100) / 100
    await runStudioAction(
      () => updateTrackSync(studio.studio_id, track.slot_id, roundedOffset),
      `${track.name} 싱크를 저장하는 중입니다.`,
      `${track.name} 싱크를 ${formatSeconds(roundedOffset)}로 맞췄습니다.`,
    )
  }

  function openScoreSession(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: '등록된 트랙만 채점할 수 있습니다.' })
      return
    }
    const references = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    setScoreSession({
      targetSlotId: track.slot_id,
      selectedReferenceIds: references,
      includeMetronome: metronomeEnabled || references.length === 0,
      phase: 'ready',
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
    if (scoreSession.selectedReferenceIds.length === 0 && !scoreSession.includeMetronome) {
      setActionState({ phase: 'error', message: '기준 트랙이나 메트로놈을 하나 이상 선택하세요.' })
      return
    }
    const referenceTracks = studio.tracks.filter((track) =>
      scoreSession.selectedReferenceIds.includes(track.slot_id),
    )
    if (referenceTracks.length > 0) {
      if (!startPlaybackSession(referenceTracks, scoreSession.includeMetronome)) {
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
      message: '선택한 기준 트랙을 재생하고 이후 채점 입력을 받습니다.',
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
    if (session.selectedReferenceIds.length === 0 && !session.includeMetronome) {
      setActionState({ phase: 'error', message: '기준 트랙이나 메트로놈을 하나 이상 선택하세요.' })
      return
    }

    setScoreSession({ ...session, phase: 'analyzing' })
    setActionState({ phase: 'busy', message: '0.01s 단위로 박자와 음정을 채점하는 중입니다.' })
    try {
      scoreRunIdRef.current += 1
      const performanceAudioBase64 = await stopMicrophoneRecorder(scoreRecorderRef.current)
      scoreRecorderRef.current = null
      stopPlaybackSession()
      setGlobalPlaying(false)
      setPlayingSlots(new Set())
      const nextStudio = await scoreTrack(studio.studio_id, session.targetSlotId, {
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
      setActionState({ phase: 'success', message: '채점 리포트를 하단 피드에 등록했습니다.' })
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
          registeredTrackCount={registeredTracks.length}
          studioTitle={studio.title}
          onExportPdf={() => void handleExportPdf()}
          onMetronomeChange={setMetronomeEnabled}
          onStopGlobalPlayback={stopGlobalPlayback}
          onToggleGlobalPlayback={toggleGlobalPlayback}
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
              globalPlaying={globalPlaying}
              metronomeEnabled={metronomeEnabled}
              pendingCandidateCount={pendingCandidates.length}
              playingSlots={playingSlots}
              registeredTracks={registeredTracks}
              recordingSlotId={recordingSlotId}
              trackRecordingMeter={trackRecordingMeter}
              tracks={studio.tracks}
              onGenerate={(track) => void handleGenerate(track)}
              onOpenScore={openScoreSession}
              onRecord={(track) => void handleRecord(track)}
              onStopPlayback={stopTrackPlayback}
              onSync={(track, nextOffset) => void handleSync(track, nextOffset)}
              onTogglePlayback={toggleTrackPlayback}
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
              onUpdateJobOverwriteApproval={updateJobOverwriteApproval}
            />

            <CandidateReviewPanel
              beatsPerMeasure={studioBeatsPerMeasure}
              candidateOverwriteApprovals={candidateOverwriteApprovals}
              candidates={pendingCandidates}
              tracks={studio.tracks}
              candidateWouldOverwrite={candidateWouldOverwrite}
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
          <span>0:00 / 0:08</span>
          <span>Sync step 0.01s</span>
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
        onStart={() => void startScoreListening()}
        onStop={() => void stopScoreListening()}
        onToggleReference={toggleScoreReference}
      />
    </main>
  )
}
