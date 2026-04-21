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
            message: error instanceof Error ? error.message : '?ㅽ뒠?붿삤瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??',
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
  const registeredScoreNotes = useMemo(
    () => registeredTracks.flatMap((track) => track.notes),
    [registeredTracks],
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
        message: error instanceof Error ? error.message : '?붿껌??泥섎━?섏? 紐삵뻽?듬땲??',
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
        message: `${targetTrack?.name ?? '?좏깮???몃옓'}???대? ?깅줉???댁슜???덉뒿?덈떎. ??뼱?곌린 ?뺤씤??泥댄겕?섏꽭??`,
      })
      return
    }
    await runStudioAction(
      () => approveCandidate(studio.studio_id, candidate.candidate_id, targetSlotId, allowOverwrite),
      `${targetTrack?.name ?? 'Track'} ?꾨낫瑜??깅줉?섎뒗 以묒엯?덈떎.`,
      `${targetTrack?.name ?? 'Track'} ?몃옓???좏깮???꾨낫瑜??깅줉?덉뒿?덈떎.`,
    )
  }

  async function handleRejectCandidate(candidate: ExtractionCandidate) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
    await runStudioAction(
      () => rejectCandidate(studio.studio_id, candidate.candidate_id),
      `${targetTrack?.name ?? 'Track'} ?꾨낫瑜?嫄곗젅?섎뒗 以묒엯?덈떎.`,
      `${targetTrack?.name ?? 'Track'} ?꾨낫瑜?嫄곗젅?덉뒿?덈떎.`,
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
        message: 'OMR 寃곌낵媛 湲곗〈 ?깅줉 ?몃옓????뼱?곷땲?? ??뼱?곌린 ?뺤씤??泥댄겕?섏꽭??',
      })
      return
    }
    await runStudioAction(
      () => approveJobCandidates(studio.studio_id, jobId, allowOverwrite),
      'OMR 寃곌낵瑜?媛??몃옓???깅줉?섎뒗 以묒엯?덈떎.',
      'OMR 寃곌낵瑜??쒖븞???몃옓???깅줉?덉뒿?덈떎.',
    )
  }

  async function handleExportPdf() {
    if (!studio) {
      return
    }
    setActionState({ phase: 'busy', message: 'PDF ?낅낫瑜??앹꽦?섎뒗 以묒엯?덈떎.' })
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
      setActionState({ phase: 'success', message: 'PDF ?낅낫瑜??앹꽦?덉뒿?덈떎.' })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'PDF瑜??앹꽦?섏? 紐삵뻽?듬땲??',
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
      setActionState({ phase: 'error', message: '?ъ깮???낅낫媛 ?덈뒗 ?깅줉 ?몃옓???놁뒿?덈떎.' })
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
      setActionState({ phase: 'error', message: '?ㅻ뵒???μ튂瑜??댁? 紐삵뻽?듬땲?? 釉뚮씪?곗? 沅뚰븳???뺤씤??二쇱꽭??' })
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
      setActionState({ phase: 'error', message: '?ъ깮??以鍮꾪븯??以?臾몄젣媛 諛쒖깮?덉뒿?덈떎.' })
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
      setActionState({ phase: 'success', message: '?꾩껜 ?ъ깮???쇱떆?뺤??덉뒿?덈떎.' })
      return
    }

    if (registeredTracks.length === 0) {
      setActionState({ phase: 'error', message: '?ъ깮???깅줉 ?몃옓???놁뒿?덈떎.' })
      return
    }

    if (startPlaybackSession(registeredTracks)) {
      setPlayingSlots(new Set())
      setGlobalPlaying(true)
      setActionState({ phase: 'success', message: '?깅줉???몃옓 ?꾩껜瑜??꾩옱 ?깊겕 湲곗??쇰줈 ?ъ깮?⑸땲??' })
    }
  }

  function stopGlobalPlayback() {
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setActionState({
      phase: 'success',
      message: '?꾩껜 ?몃옓???깊겕媛 諛섏쁺??0s 吏?먯쑝濡??섎룎?몄뒿?덈떎.',
    })
  }

  function toggleTrackPlayback(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: `${track.name} ?몃옓? ?꾩쭅 ?깅줉?섏? ?딆븯?듬땲??` })
      return
    }

    if (playingSlots.has(track.slot_id)) {
      stopPlaybackSession()
      setPlayingSlots(new Set())
      setActionState({ phase: 'success', message: `${track.name} ?몃옓 ?ъ깮???쇱떆?뺤??덉뒿?덈떎.` })
      return
    }

    if (startPlaybackSession([track])) {
      setGlobalPlaying(false)
      setPlayingSlots(new Set([track.slot_id]))
      setActionState({ phase: 'success', message: `${track.name} ?몃옓???ъ깮?⑸땲??` })
    }
  }

  function stopTrackPlayback(track: TrackSlot) {
    stopPlaybackSession()
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
    setActionState({
      phase: 'success',
      message: `${track.name} ?몃옓???깊겕媛 諛섏쁺??0s 吏?먯쑝濡??섎룎?몄뒿?덈떎.`,
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
            throw new Error('?뱀쓬???ㅻ뵒?ㅺ? 鍮꾩뼱 ?덉뒿?덈떎. 留덉씠???낅젰???뺤씤?섍퀬 ?ㅼ떆 ?뱀쓬??二쇱꽭??')
          }
          return uploadTrack(studio.studio_id, track.slot_id, {
            source_kind: 'audio',
            filename: `${track.name}-recorded-take.wav`,
            content_base64: recordedAudioBase64,
            review_before_register: false,
            allow_overwrite: allowOverwrite,
          })
        },
        `${track.name} ?뱀쓬???낅낫?뷀븯??以묒엯?덈떎.`,
        `${track.name} ?몃옓???ㅼ젣 ?뱀쓬 湲곕컲 ?낅낫瑜??깅줉?덉뒿?덈떎.`,
      )
      return
    }

    if (recordingSlotId !== null) {
      setActionState({
        phase: 'error',
        message: '?대? ?뱀쓬 以묒씤 ?몃옓???덉뒿?덈떎. 癒쇱? ?꾩옱 ?뱀쓬??以묒???二쇱꽭??',
      })
      return
    }

    if (scoreSession?.phase === 'listening' || scoreSession?.phase === 'analyzing') {
      setActionState({
        phase: 'error',
        message: '梨꾩젏 ?뱀쓬??吏꾪뻾 以묒엯?덈떎. 癒쇱? 梨꾩젏??以묒??????몃옓 ?뱀쓬???쒖옉??二쇱꽭??',
      })
      return
    }

    const wouldOverwrite = track.status === 'registered' || track.notes.length > 0
    const allowOverwrite =
      !wouldOverwrite || window.confirm(`${track.name} ?몃옓??湲곗〈 ?낅낫瑜????뱀쓬?쇰줈 ??뼱?멸퉴??`)
    if (!allowOverwrite) {
      setActionState({ phase: 'idle' })
      return
    }

    const recorder = await startMicrophoneRecorder()
    if (!recorder) {
      setActionState({
        phase: 'error',
        message: '留덉씠?щ? ?댁? 紐삵뻽?듬땲?? 釉뚮씪?곗? 留덉씠??沅뚰븳怨??낅젰 ?μ튂瑜??뺤씤??二쇱꽭??',
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
        ? `${track.name} ?뱀쓬???쒖옉?섏뿀?듬땲?? 硫뷀듃濡쒕냸???④퍡 耳쒖쭛?덈떎.`
        : `${track.name} ?뱀쓬???쒖옉?섏뿀?듬땲??`,
    })
  }

  async function handleUpload(track: TrackSlot, file: File | null) {
    if (!studio || !file) {
      return
    }

    const sourceKind = detectUploadKind(file)
    if (!sourceKind) {
      setActionState({ phase: 'error', message: '吏?먰븯吏 ?딅뒗 ?뚯씪 ?뺤떇?낅땲??' })
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
      `${track.name} ?낅줈?쒕? ?낅낫?뷀븯??以묒엯?덈떎.`,
      `${track.name} ?몃옓??${file.name} 異붿텧 ?꾨낫瑜?留뚮뱾?덉뒿?덈떎.`,
    )
    if (uploadSucceeded && isOmrUpload(file)) {
      setActionState({
        phase: 'success',
        message: `${track.name} PDF/image OMR job queued. Review candidates will appear after extraction.`,
      })
    }
  }

  async function handleGenerate(track: TrackSlot) {
    if (!studio) {
      return
    }
    if (registeredSlotIds.length === 0) {
      setActionState({ phase: 'error', message: 'AI ?앹꽦? ?깅줉???몃옓???섎굹 ?댁긽 ?꾩슂?⑸땲??' })
      return
    }

    const otherRegisteredSlotIds = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    const contextSlotIds = otherRegisteredSlotIds.length > 0 ? otherRegisteredSlotIds : registeredSlotIds

    await runStudioAction(
      () => generateTrack(studio.studio_id, track.slot_id, contextSlotIds, false, 3),
      `${track.name} ?뚰듃 ?꾨낫瑜??앹꽦?섎뒗 以묒엯?덈떎.`,
      track.slot_id === 6
        ? '?쇱빱???몃옓??BPM 湲곕컲 鍮꾪듃 ?꾨낫 3媛쒕? 留뚮뱾?덉뒿?덈떎.'
        : `${track.name} ?몃옓??李멸퀬 ?몃옓 湲곕컲 ?낅낫 ?꾨낫 3媛쒕? 留뚮뱾?덉뒿?덈떎.`,
    )
  }

  async function handleSync(track: TrackSlot, nextOffset: number) {
    if (!studio) {
      return
    }
    const roundedOffset = Math.round(nextOffset * 100) / 100
    await runStudioAction(
      () => updateTrackSync(studio.studio_id, track.slot_id, roundedOffset),
      `${track.name} ?깊겕瑜???ν븯??以묒엯?덈떎.`,
      `${track.name} ?깊겕瑜?${formatSeconds(roundedOffset)}濡?留욎톬?듬땲??`,
    )
  }

  function openScoreSession(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: '?깅줉???몃옓留?梨꾩젏?????덉뒿?덈떎.' })
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
        message: '?몃옓 ?뱀쓬??吏꾪뻾 以묒엯?덈떎. 癒쇱? ?꾩옱 ?뱀쓬??以묒?????梨꾩젏???쒖옉??二쇱꽭??',
      })
      return
    }
    if (scoreSession.selectedReferenceIds.length === 0 && !scoreSession.includeMetronome) {
      setActionState({ phase: 'error', message: '湲곗? ?몃옓?대굹 硫뷀듃濡쒕냸???섎굹 ?댁긽 ?좏깮?섏꽭??' })
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
          message: '硫뷀듃濡쒕냸???ъ깮???ㅻ뵒???μ튂瑜??댁? 紐삵뻽?듬땲??',
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
      message: '?좏깮??湲곗? ?몃옓???ъ깮?섍퀬 ?ы썑 梨꾩젏 ?낅젰??諛쏆뒿?덈떎.',
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
        message: '留덉씠???낅젰???댁? 紐삵빐 湲곗? ?ъ깮留??좎??⑸땲?? ?ㅼ젣 梨꾩젏 ?뚯뒪?몄뿉?쒕뒗 釉뚮씪?곗? 留덉씠??沅뚰븳???뺤씤??二쇱꽭??',
      })
    }
  }

  async function stopScoreListening() {
    if (!studio || !scoreSession) {
      return
    }

    const session = scoreSession
    if (session.selectedReferenceIds.length === 0 && !session.includeMetronome) {
      setActionState({ phase: 'error', message: '湲곗? ?몃옓?대굹 硫뷀듃濡쒕냸???섎굹 ?댁긽 ?좏깮?섏꽭??' })
      return
    }

    setScoreSession({ ...session, phase: 'analyzing' })
    setActionState({ phase: 'busy', message: '0.01s ?⑥쐞濡?諛뺤옄? ?뚯젙??梨꾩젏?섎뒗 以묒엯?덈떎.' })
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
      setActionState({ phase: 'success', message: '梨꾩젏 由ы룷?몃? ?섎떒 ?쇰뱶???깅줉?덉뒿?덈떎.' })
    } catch (error) {
      setScoreSession({ ...session, phase: 'ready' })
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '梨꾩젏 由ы룷?몃? 留뚮뱾吏 紐삵뻽?듬땲??',
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
          <h1>?ㅽ뒠?붿삤瑜??????놁뒿?덈떎</h1>
          <p>?ㅽ뒠?붿삤 二쇱냼媛 ?щ컮瑜댁? ?딆뒿?덈떎.</p>
          <Link className="app-button" to="/">
            ?덉쑝濡?
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
          <h1>?몃옓??遺덈윭?ㅻ뒗 以묒엯?덈떎</h1>
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
          <h1>?ㅽ뒠?붿삤瑜??????놁뒿?덈떎</h1>
          <p>{loadState.phase === 'error' ? loadState.message : '?????녿뒗 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.'}</p>
          <Link className="app-button" to="/">
            ?덉쑝濡?
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
                {studio.bpm} BPM 쨌 {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} 쨌 ?깅줉{' '}
                {registeredTracks.length}/6 쨌 由ы룷??{studio.reports.length}
              </p>
            </div>

            <TrackBoard
              beatsPerMeasure={studioBeatsPerMeasure}
              bpm={studio.bpm}
              globalPlaying={globalPlaying}
              keyContextNotes={registeredScoreNotes}
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
              candidateOverwriteApprovals={candidateOverwriteApprovals}
              candidates={pendingCandidates}
              tracks={studio.tracks}
              candidateWouldOverwrite={candidateWouldOverwrite}
              getSelectedCandidateSlotId={getSelectedCandidateSlotId}
              onApproveCandidate={(candidate) => void handleApproveCandidate(candidate)}
              onRejectCandidate={(candidate) => void handleRejectCandidate(candidate)}
              onUpdateCandidateOverwriteApproval={updateCandidateOverwriteApproval}
              onUpdateCandidateTargetSlot={updateCandidateTargetSlot}
            />          </div>
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
      />    </main>
  )
}
