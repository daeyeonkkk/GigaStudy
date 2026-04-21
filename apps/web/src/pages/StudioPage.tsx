import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

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
  prepareAudioFileForUpload,
} from '../lib/audioUpload'
import { getBrowserAudioContextConstructor } from '../lib/browserAudio'
import {
  createTone,
  disposePlaybackSession,
  scheduleMetronomeClicks,
  startLoopingMetronomeSession,
  type PlaybackNode,
  type PlaybackSession,
} from '../lib/scorePlayback'
import {
  getRecordingLevelPercent,
  startScoreRecorder,
  stopScoreRecorder,
  type ScoreRecorder,
} from '../lib/scoreRecorder'
import {
  DEFAULT_METER,
  formatBeatInMeasure,
  getDisplayBeat,
  getMeasureIndexFromBeat,
  getStudioMeter,
  isMeasureDownbeat,
} from '../lib/studioTiming'
import {
  TRACK_UPLOAD_ACCEPT,
  detectUploadKind,
  isOmrUpload,
} from '../lib/studioUploads'
import type {
  ExtractionCandidate,
  ReportIssue,
  ScoreNote,
  ScoringReport,
  SourceKind,
  Studio,
  TrackExtractionJob,
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

type ScoreSession = {
  targetSlotId: number
  selectedReferenceIds: number[]
  includeMetronome: boolean
  phase: 'ready' | 'listening' | 'analyzing'
}

type TrackRenderNote = {
  note: ScoreNote
  displayBeat: number
  clusterIndex: number
  clusterSize: number
}

type TrackRenderModel = {
  measureCount: number
  measures: number[]
  beatGuideOffsets: number[]
  measureBoundaryOffsets: number[]
  notes: TrackRenderNote[]
  keySignature: KeySignature
  keySignatureMarks: KeySignatureMark[]
  pxPerBeat: number
  measureWidth: number
  timelineWidth: number
}

type KeySignature = {
  tonic: string
  accidentalCount: number
}

type KeySignatureMark = {
  symbol: string
  left: number
  top: number
}

const noteSemitones: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const noteSteps: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

const SCORE_CLEF_GUTTER_PX = 126
const SCORE_END_PADDING_PX = 48
const MIN_SCORE_PX_PER_BEAT = 170
const MAX_SCORE_PX_PER_BEAT = 360
const NOTE_COLLISION_WIDTH_PX = 58
const STAFF_MIDDLE_LINE_Y = 62
const STAFF_STEP_PX = 5
const STAFF_NOTE_MIN_TOP = 18
const STAFF_NOTE_MAX_TOP = 98
const MAJOR_KEY_SIGNATURES: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
}
const KEY_TONIC_PITCH_CLASS: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
  Cb: 11,
}
const SHARP_KEY_STEPS: Record<'treble' | 'bass', Array<[string, number]>> = {
  treble: [
    ['F', 5],
    ['C', 5],
    ['G', 5],
    ['D', 5],
    ['A', 4],
    ['E', 5],
    ['B', 4],
  ],
  bass: [
    ['F', 3],
    ['C', 3],
    ['G', 3],
    ['D', 3],
    ['A', 2],
    ['E', 3],
    ['B', 2],
  ],
}
const FLAT_KEY_STEPS: Record<'treble' | 'bass', Array<[string, number]>> = {
  treble: [
    ['B', 4],
    ['E', 5],
    ['A', 4],
    ['D', 5],
    ['G', 4],
    ['C', 5],
    ['F', 4],
  ],
  bass: [
    ['B', 2],
    ['E', 3],
    ['A', 2],
    ['D', 3],
    ['G', 2],
    ['C', 3],
    ['F', 2],
  ],
}

const statusLabels: Record<TrackSlot['status'], string> = {
  empty: '공란',
  recording: '녹음 중',
  uploading: '업로드 중',
  extracting: '악보화 중',
  generating: 'AI 생성 중',
  needs_review: '검토 필요',
  registered: '등록 완료',
  failed: '등록 실패',
}

const sourceLabels: Record<SourceKind, string> = {
  recording: '녹음',
  audio: '음성파일',
  midi: 'MIDI',
  score: '악보',
  music: '음악',
  ai: 'AI 생성',
}

function getJobStatusLabel(status: TrackExtractionJob['status']): string {
  const labels: Record<TrackExtractionJob['status'], string> = {
    queued: 'Queued',
    running: 'Running',
    needs_review: 'Review ready',
    completed: 'Completed',
    failed: 'Failed',
  }
  return labels[status]
}

function safeDownloadName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9가-힣._-]+/g, '-')
  return normalized || 'gigastudy-score'
}

function formatSeconds(seconds: number): string {
  const sign = seconds > 0 ? '+' : ''
  return `${sign}${seconds.toFixed(2)}s`
}

function formatDurationSeconds(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(2)}s`
}

function getDiatonicStep(noteName: string, octave: number): number {
  return octave * 7 + noteSteps[noteName]
}

function parsePitchLabel(label: string): { octave: number; step: number; semitone: number } | null {
  const match = /^([A-G])([#b]?)(\d)$/u.exec(label.trim())
  if (!match) {
    return null
  }

  const [, noteName, accidental, octaveText] = match
  const octave = Number(octaveText)
  let semitone = noteSemitones[noteName]

  if (accidental === '#') {
    semitone += 1
  }
  if (accidental === 'b') {
    semitone -= 1
  }

  return {
    octave,
    step: getDiatonicStep(noteName, octave),
    semitone,
  }
}

function getNoteFrequency(label: string): number | null {
  const parsed = parsePitchLabel(label)
  if (!parsed) {
    return null
  }

  const midiNumber = (parsed.octave + 1) * 12 + parsed.semitone
  return 440 * 2 ** ((midiNumber - 69) / 12)
}

function getPercussionFrequency(label: string): number {
  const normalizedLabel = label.toLowerCase()
  if (normalizedLabel.includes('kick')) {
    return 92
  }
  if (normalizedLabel.includes('snare')) {
    return 185
  }
  if (normalizedLabel.includes('hat')) {
    return 720
  }
  return 260
}

function getNotePlaybackFrequency(note: ScoreNote): number | null {
  if (note.is_rest === true) {
    return null
  }
  if (typeof note.pitch_hz === 'number' && Number.isFinite(note.pitch_hz) && note.pitch_hz > 0) {
    return note.pitch_hz
  }
  if (typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)) {
    return 440 * 2 ** ((note.pitch_midi - 69) / 12)
  }
  return getNoteFrequency(note.label) ?? getPercussionFrequency(note.label)
}

function getPitchStepFromMidi(pitchMidi: number): number {
  const octave = Math.floor(pitchMidi / 12) - 1
  const pitchClass = ((pitchMidi % 12) + 12) % 12
  const closestNatural = [0, 2, 4, 5, 7, 9, 11].reduce((best, candidate) =>
    Math.abs(candidate - pitchClass) < Math.abs(best - pitchClass) ? candidate : best,
  )
  const noteName = Object.entries(noteSemitones).find(([, semitone]) => semitone === closestNatural)?.[0] ?? 'C'
  return getDiatonicStep(noteName, octave)
}

function getStaffClef(slotId: number): 'treble' | 'bass' {
  return slotId >= 4 ? 'bass' : 'treble'
}

function getStaffMiddleLineStep(slotId: number): number {
  return getStaffClef(slotId) === 'bass' ? getDiatonicStep('D', 3) : getDiatonicStep('B', 4)
}

function getStaffTopFromStep(slotId: number, step: number): number {
  const top = STAFF_MIDDLE_LINE_Y - (step - getStaffMiddleLineStep(slotId)) * STAFF_STEP_PX
  return Math.round(Math.max(STAFF_NOTE_MIN_TOP, Math.min(STAFF_NOTE_MAX_TOP, top)))
}

function getNoteTopPx(slotId: number, note: ScoreNote): number {
  if (slotId === 6) {
    const normalizedLabel = note.label.toLowerCase()
    if (normalizedLabel.includes('kick')) {
      return 48
    }
    if (normalizedLabel.includes('snare')) {
      return 33
    }
    if (normalizedLabel.includes('hat')) {
      return 18
    }
    return 33
  }

  if (note.is_rest === true) {
    return 33
  }

  const step =
    typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)
      ? getPitchStepFromMidi(note.pitch_midi)
      : parsePitchLabel(note.label)?.step
  if (step === undefined) {
    return 33
  }

  return getStaffTopFromStep(slotId, step)
}

function estimateKeySignature(notes: ScoreNote[]): KeySignature {
  const pitchClasses = new Set(
    notes
      .filter((note) => note.is_rest !== true && typeof note.pitch_midi === 'number')
      .map((note) => (note.pitch_midi ?? 0) % 12),
  )
  if (pitchClasses.size === 0) {
    return { tonic: 'C', accidentalCount: 0 }
  }

  const scoredKeys = Object.entries(MAJOR_KEY_SIGNATURES)
    .map(([tonic, accidentalCount]) => {
      const tonicPc = KEY_TONIC_PITCH_CLASS[tonic] ?? 0
      const scale = [0, 2, 4, 5, 7, 9, 11].map((step) => (tonicPc + step) % 12)
      const covered = [...pitchClasses].filter((pitchClass) => scale.includes(pitchClass)).length
      const misses = pitchClasses.size - covered
      return {
        tonic,
        accidentalCount,
        score: covered * 3 - misses * 4 - Math.abs(accidentalCount) * 0.32,
      }
    })
    .sort((left, right) => right.score - left.score || Math.abs(left.accidentalCount) - Math.abs(right.accidentalCount))

  const selected = scoredKeys[0] ?? { tonic: 'C', accidentalCount: 0 }
  return { tonic: selected.tonic, accidentalCount: selected.accidentalCount }
}

function getKeySignatureMarks(slotId: number, signature: KeySignature): KeySignatureMark[] {
  const accidentalCount = Math.max(-7, Math.min(7, signature.accidentalCount))
  if (accidentalCount === 0) {
    return []
  }
  const clef = getStaffClef(slotId)
  const symbol = accidentalCount > 0 ? '♯' : '♭'
  const steps = accidentalCount > 0 ? SHARP_KEY_STEPS[clef] : FLAT_KEY_STEPS[clef]
  return steps.slice(0, Math.abs(accidentalCount)).map(([noteName, octave], index) => ({
    symbol,
    left: 68 + index * 9,
    top: getStaffTopFromStep(slotId, getDiatonicStep(noteName, octave)) - 12,
  }))
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getTrackSourceLabel(track: TrackSlot): string {
  if (!track.source_kind) {
    return '아직 등록된 소스 없음'
  }
  return `${sourceLabels[track.source_kind]} · ${track.source_label ?? '소스'}`
}

function describeReferences(report: ScoringReport, tracks: TrackSlot[]): string {
  const referenceNames = report.reference_slot_ids
    .map((slotId) => tracks.find((track) => track.slot_id === slotId)?.name)
    .filter(Boolean)

  if (report.include_metronome) {
    referenceNames.push('Metronome')
  }

  return referenceNames.length > 0 ? referenceNames.join(', ') : '기준 없음'
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function formatNullableSeconds(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}s`
}

function formatNullableSemitones(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} st`
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%'
  }
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function getCandidateDurationSeconds(candidate: ExtractionCandidate): number {
  if (candidate.notes.length === 0) {
    return 0
  }
  return Math.max(...candidate.notes.map((note) => note.onset_seconds + note.duration_seconds))
}

function getCandidatePitchRange(candidate: ExtractionCandidate): string {
  const pitchedNotes = candidate.notes.filter((note) => note.is_rest !== true)
  if (pitchedNotes.length === 0) {
    return '-'
  }
  const midiNotes = pitchedNotes.filter(
    (note): note is ScoreNote & { pitch_midi: number } =>
      typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi),
  )
  if (midiNotes.length === 0) {
    return [...new Set(pitchedNotes.map((note) => note.label))].slice(0, 3).join(' / ')
  }
  const sorted = [...midiNotes].sort((left, right) => left.pitch_midi - right.pitch_midi)
  return `${sorted[0].label} - ${sorted[sorted.length - 1].label}`
}

function getCandidatePreviewText(candidate: ExtractionCandidate): string {
  if (candidate.notes.length === 0) {
    return 'no notes'
  }
  return candidate.notes
    .slice(0, 8)
    .map((note) => `${note.label}@${note.beat}`)
    .join(', ')
}

function getIssueLabel(issue: ReportIssue): string {
  if (issue.issue_type === 'pitch_rhythm') {
    return 'Pitch + Rhythm'
  }
  return issue.issue_type.charAt(0).toUpperCase() + issue.issue_type.slice(1)
}

function getClefSymbol(slotId: number): string {
  return String.fromCodePoint(getStaffClef(slotId) === 'bass' ? 0x1d122 : 0x1d11e)
}

function getScorePxPerBeat(displayBeats: number[]): number {
  const uniqueBeats = [...new Set(displayBeats.map((beat) => Math.round(beat * 1000) / 1000))].sort(
    (left, right) => left - right,
  )
  const smallestGap = uniqueBeats.reduce<number | null>((currentSmallest, beat, index) => {
    if (index === 0) {
      return currentSmallest
    }
    const gap = beat - uniqueBeats[index - 1]
    if (gap <= 0.001) {
      return currentSmallest
    }
    return currentSmallest === null ? gap : Math.min(currentSmallest, gap)
  }, null)

  if (smallestGap === null) {
    return MIN_SCORE_PX_PER_BEAT
  }

  const densityAwareWidth = NOTE_COLLISION_WIDTH_PX / smallestGap + 18
  return Math.round(Math.max(MIN_SCORE_PX_PER_BEAT, Math.min(MAX_SCORE_PX_PER_BEAT, densityAwareWidth)))
}

function getClusteredRenderNotes(notes: ScoreNote[], syncOffsetSeconds: number, bpm: number, pxPerBeat: number) {
  const sortedNotes = notes
    .map((note) => ({
      note,
      displayBeat: getDisplayBeat(note, syncOffsetSeconds, bpm),
    }))
    .sort((left, right) => left.displayBeat - right.displayBeat)
  const clusteredNotes: TrackRenderNote[] = []
  let cluster: typeof sortedNotes = []

  function flushCluster() {
    cluster.forEach((entry, index) => {
      clusteredNotes.push({
        ...entry,
        clusterIndex: index,
        clusterSize: cluster.length,
      })
    })
    cluster = []
  }

  sortedNotes.forEach((entry) => {
    const previous = cluster[cluster.length - 1]
    if (previous && (entry.displayBeat - previous.displayBeat) * pxPerBeat >= NOTE_COLLISION_WIDTH_PX) {
      flushCluster()
    }
    cluster.push(entry)
  })
  flushCluster()

  return clusteredNotes
}

function getTrackRenderModel(
  track: TrackSlot,
  bpm: number,
  beatsPerMeasure: number,
  keyContextNotes: ScoreNote[],
): TrackRenderModel {
  const displayBeats = track.notes.map((note) => getDisplayBeat(note, track.sync_offset_seconds, bpm))
  const pxPerBeat = getScorePxPerBeat(displayBeats)
  const notes = getClusteredRenderNotes(track.notes, track.sync_offset_seconds, bpm, pxPerBeat)
  const keySignature = estimateKeySignature(keyContextNotes.length > 0 ? keyContextNotes : track.notes)
  const baseMaxBeatEnd = Math.max(
    beatsPerMeasure,
    ...track.notes.map((note) => note.beat + Math.max(0.25, note.duration_beats) - 0.001),
  )
  const syncedMaxBeatEnd = Math.max(
    beatsPerMeasure,
    ...notes.map(({ note, displayBeat }) => Math.max(note.beat, displayBeat) + Math.max(0.25, note.duration_beats) - 0.001),
  )
  const baseMeasureCount = getMeasureIndexFromBeat(baseMaxBeatEnd, beatsPerMeasure) + 1
  const measureCount = Math.max(1, baseMeasureCount, getMeasureIndexFromBeat(syncedMaxBeatEnd, beatsPerMeasure))
  const measureWidth = pxPerBeat * beatsPerMeasure
  const totalQuarterBeats = measureCount * beatsPerMeasure
  const beatGuideOffsets = Array.from({ length: Math.floor(totalQuarterBeats) + 1 }, (_, index) => index).filter(
    (beatOffset) => !isMeasureDownbeat(beatOffset, beatsPerMeasure),
  )
  const measureBoundaryOffsets = Array.from({ length: measureCount + 1 }, (_, index) => index * beatsPerMeasure)

  return {
    measureCount,
    measures: Array.from({ length: measureCount }, (_, index) => index + 1),
    beatGuideOffsets,
    measureBoundaryOffsets,
    notes,
    keySignature,
    keySignatureMarks: getKeySignatureMarks(track.slot_id, keySignature),
    pxPerBeat,
    measureWidth,
    timelineWidth: SCORE_CLEF_GUTTER_PX + measureCount * measureWidth + SCORE_END_PADDING_PX,
  }
}

function getScoreTimelineStyle(model: TrackRenderModel): CSSProperties {
  return {
    '--score-width': `${model.timelineWidth}px`,
    '--measure-width': `${model.measureWidth}px`,
    '--clef-gutter': `${SCORE_CLEF_GUTTER_PX}px`,
  } as CSSProperties
}

function getScoreLineStyle(leftPx: number): CSSProperties {
  return {
    '--line-left': `${Math.round(leftPx)}px`,
  } as CSSProperties
}

function getScoreMeasureLabelStyle(measureIndex: number, model: TrackRenderModel): CSSProperties {
  return {
    '--label-left': `${SCORE_CLEF_GUTTER_PX + (measureIndex - 1) * model.measureWidth + 8}px`,
  } as CSSProperties
}

function getTimelineNoteStyle(slotId: number, renderNote: TrackRenderNote, model: TrackRenderModel): CSSProperties {
  const clusterOffset = (renderNote.clusterIndex - (renderNote.clusterSize - 1) / 2) * 28
  const rawLeft = SCORE_CLEF_GUTTER_PX + (renderNote.displayBeat - 1) * model.pxPerBeat + clusterOffset
  const maxLeft = model.timelineWidth - SCORE_END_PADDING_PX
  const left = Math.max(26, Math.min(maxLeft, rawLeft))
  return {
    '--note-top': `${getNoteTopPx(slotId, renderNote.note)}px`,
    '--note-left': `${Math.round(left)}px`,
  } as CSSProperties
}

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
  const [scoreSession, setScoreSession] = useState<ScoreSession | null>(null)
  const [candidateTargetSlots, setCandidateTargetSlots] = useState<Record<string, number>>({})
  const [candidateOverwriteApprovals, setCandidateOverwriteApprovals] = useState<Record<string, boolean>>({})
  const [jobOverwriteApprovals, setJobOverwriteApprovals] = useState<Record<string, boolean>>({})
  const playbackSessionRef = useRef<PlaybackSession | null>(null)
  const recordingMetronomeSessionRef = useRef<PlaybackSession | null>(null)
  const trackRecorderRef = useRef<ScoreRecorder | null>(null)
  const trackRecordingAllowOverwriteRef = useRef(false)
  const scoreRecorderRef = useRef<ScoreRecorder | null>(null)
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
      void stopScoreRecorder(trackRecorderRef.current)
      trackRecorderRef.current = null
      trackRecordingAllowOverwriteRef.current = false
      void stopScoreRecorder(scoreRecorderRef.current)
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
        message: 'OMR 결과가 기존 등록 트랙을 덮어씁니다. 덮어쓰기 확인을 체크하세요.',
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
      message: '전체 트랙을 싱크가 반영된 0s 지점으로 되돌렸습니다.',
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
      message: `${track.name} 트랙을 싱크가 반영된 0s 지점으로 되돌렸습니다.`,
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
          const recordedAudioBase64 = await stopScoreRecorder(recorder)
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

    const recorder = await startScoreRecorder()
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
        ? `${track.name} 녹음이 시작되었습니다. 메트로놈이 함께 켜집니다.`
        : `${track.name} 녹음이 시작되었습니다.`,
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
        message: `${track.name} PDF/image OMR job queued. Review candidates will appear after extraction.`,
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
        message: '트랙 녹음이 진행 중입니다. 먼저 현재 녹음을 중지한 뒤 채점을 시작해 주세요.',
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
          message: '메트로놈을 재생할 오디오 장치를 열지 못했습니다.',
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
      message: '선택한 기준 트랙을 재생하고 사후 채점 입력을 받습니다.',
    })
    const recorder = await startScoreRecorder()
    if (scoreRunIdRef.current !== runId) {
      void stopScoreRecorder(recorder)
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
      const performanceAudioBase64 = await stopScoreRecorder(scoreRecorderRef.current)
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
          <h1>스튜디오를 열 수 없습니다</h1>
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
          <h1>스튜디오를 열 수 없습니다</h1>
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
        <header className="composer-titlebar">
          <Link className="composer-app-mark" to="/" aria-label="홈으로">
            GS
          </Link>
          <span>GigaStudy - {studio.title}</span>
          <div className="composer-window-buttons" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </header>

        <nav className="composer-menubar" aria-label="스튜디오 메뉴">
          <span>File</span>
          <span>Track</span>
          <span>Play</span>
          <span>Score</span>
          <span>Tools</span>
          <span>Help</span>
        </nav>

        <div className="composer-toolbar" aria-label="전체 트랙 재생 제어">
          <Link className="composer-tool" to="/" aria-label="홈으로">
            <span aria-hidden="true">⌂</span>
          </Link>
          <button
            aria-label={globalPlaying ? '전체 일시정지' : '전체 재생'}
            className="composer-tool composer-tool--primary"
            data-testid="global-play-button"
            type="button"
            onClick={toggleGlobalPlayback}
          >
            <span aria-hidden="true">{globalPlaying ? 'Ⅱ' : '▶'}</span>
          </button>
          <button
            aria-label="전체 중지"
            className="composer-tool"
            data-testid="global-stop-button"
            type="button"
            onClick={stopGlobalPlayback}
          >
            <span aria-hidden="true">■</span>
          </button>
          <button className="composer-tool" type="button" aria-label="확대">
            <span aria-hidden="true">＋</span>
          </button>
          <button className="composer-tool" type="button" aria-label="축소">
            <span aria-hidden="true">－</span>
          </button>
          <label className="composer-metronome">
            <input
              checked={metronomeEnabled}
              type="checkbox"
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            <span aria-hidden="true">♪</span>
            메트로놈
          </label>
          <button
            className="composer-tool composer-tool--text"
            data-testid="export-pdf-button"
            disabled={registeredTracks.length === 0 || actionState.phase === 'busy'}
            type="button"
            onClick={() => void handleExportPdf()}
          >
            PDF
          </button>
        </div>

        <section className="studio-status-line" aria-live="polite">
          <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
          <p>
            {actionState.phase === 'idle'
              ? '트랙을 녹음, 업로드, AI 생성으로 채운 뒤 0.01s 단위로 맞춰보세요.'
              : actionState.message}
          </p>
        </section>

        <section className="composer-score-viewport">
          <div className="composer-score-paper">
            <div className="composer-score-heading">
              <h1>{studio.title}</h1>
              <p>
                {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} · 등록{' '}
                {registeredTracks.length}/6 · 리포트 {studio.reports.length}
              </p>
            </div>

            <section className="studio-tracks" aria-label="6개 트랙">
              <div className="studio-tracks__header">
                <div>
                  <p className="eyebrow">Track board</p>
                  <h2>6 Track Score</h2>
                </div>
                <div className="studio-tracks__summary">
                  <span>{registeredTracks.length} registered</span>
                  <span>{pendingCandidates.length} review</span>
                  <span>{playingSlots.size + (globalPlaying ? registeredTracks.length : 0)} playing</span>
                </div>
              </div>

              <div className="track-stack">
                {studio.tracks.map((track) => {
                  const isRegistered = track.status === 'registered'
                  const needsReview = track.status === 'needs_review'
                  const isRecording = recordingSlotId === track.slot_id
                  const isPlaying = globalPlaying || playingSlots.has(track.slot_id)
                  const canGenerateTrack = registeredTracks.some(
                    (registeredTrack) => registeredTrack.slot_id !== track.slot_id,
                  )
                  const scoreModel = getTrackRenderModel(
                    track,
                    studio.bpm,
                    studioBeatsPerMeasure,
                    registeredScoreNotes,
                  )
                  const recordingMeterStyle = {
                    '--recording-level': `${getRecordingLevelPercent(
                      isRecording ? trackRecordingMeter.level : 0,
                    )}%`,
                  } as CSSProperties
                  return (
                    <article
                      className={`track-card track-card--slot-${track.slot_id} ${
                        isRegistered ? 'track-card--ready' : needsReview ? 'track-card--review' : 'track-card--empty'
                      }`}
                      data-testid={`track-card-${track.slot_id}`}
                      key={track.slot_id}
                    >
                      <header className="track-card__header">
                        <div className="track-card__identity">
                          <span>{String(track.slot_id).padStart(2, '0')}</span>
                          <div>
                            <h3>{track.name}</h3>
                            <p>{getTrackSourceLabel(track)}</p>
                          </div>
                        </div>
                        <div className="track-card__state">
                          <strong>{statusLabels[track.status]}</strong>
                          <span>sync {formatSeconds(track.sync_offset_seconds)}</span>
                        </div>
                      </header>

                      <div className="track-card__score" aria-label={`${track.name} 악보`}>
                        {isRegistered ? (
                          <div
                            className="track-card__measure-strip"
                            data-testid={`track-score-strip-${track.slot_id}`}
                            style={getScoreTimelineStyle(scoreModel)}
                          >
                            <span className="track-card__clef" aria-hidden="true">
                              {getClefSymbol(track.slot_id)}
                            </span>
                            <span
                              aria-label={`${scoreModel.keySignature.tonic} key signature`}
                              className="track-card__key-signature"
                              data-testid={`track-key-signature-${track.slot_id}`}
                            >
                              {scoreModel.keySignatureMarks.map((mark, index) => (
                                <span
                                  aria-hidden="true"
                                  key={`${track.slot_id}-key-signature-${index}`}
                                  style={
                                    {
                                      '--key-mark-left': `${mark.left}px`,
                                      '--key-mark-top': `${mark.top}px`,
                                    } as CSSProperties
                                  }
                                >
                                  {mark.symbol}
                                </span>
                              ))}
                            </span>
                            {scoreModel.beatGuideOffsets.map((beatOffset) => (
                              <span
                                aria-hidden="true"
                                className="track-card__beat-line"
                                key={`${track.slot_id}-beat-line-${beatOffset}`}
                                style={getScoreLineStyle(SCORE_CLEF_GUTTER_PX + beatOffset * scoreModel.pxPerBeat)}
                              />
                            ))}
                            {scoreModel.measureBoundaryOffsets.map((beatOffset) => (
                              <span
                                aria-hidden="true"
                                className="track-card__beat-line track-card__beat-line--measure"
                                key={`${track.slot_id}-measure-line-${beatOffset}`}
                                style={getScoreLineStyle(SCORE_CLEF_GUTTER_PX + beatOffset * scoreModel.pxPerBeat)}
                              />
                            ))}
                            {scoreModel.measures.map((measureIndex) => (
                              <span
                                className="track-card__measure-label"
                                key={`${track.slot_id}-measure-label-${measureIndex}`}
                                style={getScoreMeasureLabelStyle(measureIndex, scoreModel)}
                              >
                                {measureIndex}
                              </span>
                            ))}
                            {scoreModel.notes.map((renderNote) => (
                              <span
                                className={
                                  renderNote.note.is_rest === true
                                    ? 'track-card__measure-note track-card__note--rest'
                                    : 'track-card__measure-note'
                                }
                                key={renderNote.note.id}
                                style={getTimelineNoteStyle(track.slot_id, renderNote, scoreModel)}
                              >
                                <small>{formatBeatInMeasure(renderNote.displayBeat, studioBeatsPerMeasure)}</small>
                                <strong>{renderNote.note.label}</strong>
                              </span>
                            ))}
                            {/* Legacy measure renderer removed after timeline renderer migration.
                              <div
                                className={`track-card__measure ${
                                  measure.measureIndex === 1 ? 'track-card__measure--first' : ''
                                }`}
                                key={`${track.slot_id}-measure-${measure.measureIndex}`}
                              >
                                <span className="track-card__measure-label">{measure.measureIndex}</span>
                                {measure.measureIndex === 1 ? (
                                  <span className="track-card__clef" aria-hidden="true">
                                    {track.slot_id >= 5 ? '𝄢' : '𝄞'}
                                  </span>
                                ) : null}
                                {measure.notes.map((note) => (
                                  <span
                                    className={
                                      note.is_rest === true
                                        ? 'track-card__measure-note track-card__note--rest'
                                        : 'track-card__measure-note'
                                    }
                                    key={note.id}
                                    style={getMeasureNoteStyle(track.slot_id, note, measure.measureIndex)}
                                  >
                                    <small>{getBeatInMeasure(note)}</small>
                                    <strong>{note.label}</strong>
                                  </span>
                                ))}
                              </div>
                            */}
                          </div>
                        ) : (
                          <p>{needsReview ? '검토 대기 트랙' : '공란 트랙'}</p>
                        )}
                      </div>

                      <div className="track-card__controls">
                        <div className="track-card__primary-actions">
                          <button
                            className={`app-button app-button--record ${isRecording ? 'is-active' : ''}`}
                            data-testid={`track-record-${track.slot_id}`}
                            type="button"
                            onClick={() => void handleRecord(track)}
                          >
                            <span aria-hidden="true">{isRecording ? '■' : '●'}</span>
                            {isRecording ? '중지' : '녹음'}
                          </button>
                          <label className="app-button app-button--secondary track-upload">
                            <span aria-hidden="true">↥</span>
                            업로드
                            <input
                              accept={TRACK_UPLOAD_ACCEPT}
                              aria-label={`${track.name} 업로드`}
                              type="file"
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null
                                event.currentTarget.value = ''
                                void handleUpload(track, file)
                              }}
                            />
                          </label>
                          <button
                            className="app-button app-button--secondary"
                            data-testid={`track-generate-${track.slot_id}`}
                            disabled={!canGenerateTrack}
                            type="button"
                            onClick={() => void handleGenerate(track)}
                          >
                            <span aria-hidden="true">✦</span>
                            AI 생성
                          </button>
                        </div>

                        <div className="track-card__secondary-actions">
                          <button
                            aria-label={`${track.name} 싱크 0.01초 빠르게`}
                            className="studio-step-button"
                            data-testid={`track-sync-earlier-${track.slot_id}`}
                            type="button"
                            onClick={() => void handleSync(track, track.sync_offset_seconds - 0.01)}
                          >
                            -0.01
                          </button>
                          <button
                            aria-label={`${track.name} 싱크 0.01초 늦게`}
                            className="studio-step-button"
                            data-testid={`track-sync-later-${track.slot_id}`}
                            type="button"
                            onClick={() => void handleSync(track, track.sync_offset_seconds + 0.01)}
                          >
                            +0.01
                          </button>
                          <button
                            aria-label={isPlaying ? `${track.name} 일시정지` : `${track.name} 재생`}
                            className="studio-icon-button"
                            disabled={!isRegistered}
                            type="button"
                            onClick={() => toggleTrackPlayback(track)}
                          >
                            <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
                          </button>
                          <button
                            aria-label={`${track.name} 중지`}
                            className="studio-icon-button"
                            disabled={!isRegistered}
                            type="button"
                            onClick={() => stopTrackPlayback(track)}
                          >
                            <span aria-hidden="true">■</span>
                          </button>
                          <button
                            className="app-button app-button--secondary"
                            data-testid={`track-score-${track.slot_id}`}
                            disabled={!isRegistered}
                            type="button"
                            onClick={() => openScoreSession(track)}
                          >
                            채점
                          </button>
                        </div>
                        {isRecording ? (
                          <div
                            className="track-card__recording-meter"
                            data-testid={`track-recording-meter-${track.slot_id}`}
                            style={recordingMeterStyle}
                          >
                            <span>{formatDurationSeconds(trackRecordingMeter.durationSeconds)}</span>
                            <i aria-hidden="true" />
                            <em>{metronomeEnabled ? 'metronome on' : 'metronome off'}</em>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            {visibleExtractionJobs.length > 0 ? (
              <section className="extraction-jobs" data-testid="extraction-jobs" aria-label="Extraction jobs">
                <div className="extraction-jobs__header">
                  <div>
                    <p className="eyebrow">OMR queue</p>
                    <h2>PDF/Image extraction</h2>
                  </div>
                  <strong>{activeExtractionJobs.length} active</strong>
                </div>
                <div className="extraction-jobs__list">
                  {visibleExtractionJobs.map((job) => {
                    const jobTrack = studio.tracks.find((track) => track.slot_id === job.slot_id)
                    const jobCandidates = getPendingJobCandidates(job.job_id)
                    const canRegisterJob = job.status === 'needs_review' && jobCandidates.length > 0
                    const wouldOverwrite = jobWouldOverwrite(job.job_id)
                    const allowOverwrite = jobOverwriteApprovals[job.job_id] === true
                    return (
                      <article className="extraction-jobs__item" key={job.job_id}>
                        <div>
                          <strong>{job.source_label}</strong>
                          <span>{jobTrack?.name ?? `Track ${job.slot_id}`}</span>
                        </div>
                        <span className={`extraction-jobs__status extraction-jobs__status--${job.status}`}>
                          {getJobStatusLabel(job.status)}
                        </span>
                        <p>{job.message ?? job.method}</p>
                        {canRegisterJob ? (
                          <div className="extraction-jobs__actions">
                            <span>{jobCandidates.length} track candidates</span>
                            {wouldOverwrite ? (
                              <label>
                                <input
                                  checked={allowOverwrite}
                                  data-testid={`job-overwrite-${job.job_id}`}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updateJobOverwriteApproval(job.job_id, event.target.checked)
                                  }
                                />
                                overwrite occupied tracks
                              </label>
                            ) : null}
                            <button
                              className="app-button"
                              data-testid={`job-approve-${job.job_id}`}
                              disabled={wouldOverwrite && !allowOverwrite}
                              type="button"
                              onClick={() => void handleApproveJobCandidates(job.job_id)}
                            >
                              Register OMR
                            </button>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {pendingCandidates.length > 0 ? (
              <section className="candidate-review" data-testid="candidate-review" aria-label="후보 검토">
                <div className="candidate-review__header">
                  <div>
                    <p className="eyebrow">Review queue</p>
                    <h2>후보 선택 / 승인</h2>
                  </div>
                  <strong>{pendingCandidates.length} pending</strong>
                </div>

                <div className="candidate-review__list">
                  {pendingCandidates.map((candidate) => {
                    const suggestedTrack = studio.tracks.find(
                      (track) => track.slot_id === candidate.suggested_slot_id,
                    )
                    const selectedSlotId = getSelectedCandidateSlotId(candidate)
                    const targetTrack =
                      studio.tracks.find((track) => track.slot_id === selectedSlotId) ?? suggestedTrack
                    const wouldOverwrite = candidateWouldOverwrite(candidate)
                    const allowOverwrite = candidateOverwriteApprovals[candidate.candidate_id] === true
                    return (
                      <article className="candidate-review__item" key={candidate.candidate_id}>
                        <div>
                          <span>{sourceLabels[candidate.source_kind]}</span>
                          <h3>
                            {suggestedTrack?.name ?? `Track ${candidate.suggested_slot_id}`} 후보
                            {candidate.variant_label ? ` · ${candidate.variant_label}` : ''}
                          </h3>
                          <p>{candidate.source_label}</p>
                        </div>
                        <dl>
                          <div>
                            <dt>method</dt>
                            <dd>{candidate.method}</dd>
                          </div>
                          <div>
                            <dt>confidence</dt>
                            <dd>{formatPercent(candidate.confidence)}</dd>
                          </div>
                          <div>
                            <dt>notes</dt>
                            <dd>{candidate.notes.length}</dd>
                          </div>
                          <div>
                            <dt>duration</dt>
                            <dd>{formatDurationSeconds(getCandidateDurationSeconds(candidate))}</dd>
                          </div>
                          <div>
                            <dt>range</dt>
                            <dd>{getCandidatePitchRange(candidate)}</dd>
                          </div>
                        </dl>
                        <div className="candidate-review__target">
                          <label>
                            <span>대상 트랙</span>
                            <select
                              data-testid={`candidate-target-${candidate.candidate_id}`}
                              value={selectedSlotId}
                              onChange={(event) =>
                                updateCandidateTargetSlot(candidate, Number(event.target.value))
                              }
                            >
                              {studio.tracks.map((track) => (
                                <option key={track.slot_id} value={track.slot_id}>
                                  {String(track.slot_id).padStart(2, '0')} {track.name} ·{' '}
                                  {statusLabels[track.status]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {wouldOverwrite ? (
                            <label className="candidate-review__overwrite">
                              <input
                                checked={allowOverwrite}
                                data-testid={`candidate-overwrite-${candidate.candidate_id}`}
                                type="checkbox"
                                onChange={(event) =>
                                  updateCandidateOverwriteApproval(candidate, event.target.checked)
                                }
                              />
                              <span>{targetTrack?.name ?? '선택한 트랙'} 덮어쓰기 확인</span>
                            </label>
                          ) : null}
                        </div>
                        <p className="candidate-review__preview">
                          Preview: {getCandidatePreviewText(candidate)}
                        </p>
                        {candidate.message ? <p>{candidate.message}</p> : null}
                        <div className="candidate-review__actions">
                          <button
                            className="app-button"
                            data-testid={`candidate-approve-${candidate.candidate_id}`}
                            disabled={wouldOverwrite && !allowOverwrite}
                            type="button"
                            onClick={() => void handleApproveCandidate(candidate)}
                          >
                            승인
                          </button>
                          <button
                            className="app-button app-button--secondary"
                            data-testid={`candidate-reject-${candidate.candidate_id}`}
                            type="button"
                            onClick={() => void handleRejectCandidate(candidate)}
                          >
                            거절
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <footer className="composer-statusbar">
          <span>{globalPlaying || playingSlots.size > 0 ? 'Playing' : 'Ready'}</span>
          <span>Bar 1</span>
          <span>0:00 / 0:08</span>
          <span>Sync step 0.01s</span>
        </footer>
      </section>

      <section className="report-feed" data-testid="report-feed" aria-label="채점 리포트">
        <div className="report-feed__header">
          <p className="eyebrow">Report feed</p>
          <h2>채점 리포트</h2>
        </div>

        {studio.reports.length === 0 ? (
          <div className="report-empty">
            <strong>아직 리포트가 없습니다.</strong>
            <p>등록된 트랙에서 채점을 시작하면 음정과 박자 피드백이 게시글처럼 쌓입니다.</p>
          </div>
        ) : (
          <div className="report-list">
            {[...studio.reports].reverse().map((report) => (
              <article className="report-card" key={report.report_id}>
                <header>
                  <div>
                    <span>{formatDate(report.created_at)}</span>
                    <h3>{report.target_track_name} 채점</h3>
                  </div>
                  <p>{describeReferences(report, studio.tracks)}</p>
                </header>
                <Link
                  className="report-card__open"
                  data-testid={`report-open-${report.report_id}`}
                  to={`/studios/${studio.studio_id}/reports/${report.report_id}`}
                >
                  리포트 열기
                </Link>
                {report.report_id === '' ? (
                  <>
                <div className="report-card__summary">
                  <p>
                    <strong>Overall</strong>
                    <span>{formatScore(report.overall_score)}</span>
                  </p>
                  <p>
                    <strong>Pitch</strong>
                    <span>{formatScore(report.pitch_score)}</span>
                  </p>
                  <p>
                    <strong>Rhythm</strong>
                    <span>{formatScore(report.rhythm_score)}</span>
                  </p>
                  <p>
                    <strong>Auto Sync</strong>
                    <span>{formatSeconds(report.alignment_offset_seconds)}</span>
                  </p>
                  <p>
                    <strong>Matched</strong>
                    <span>
                      {report.matched_note_count}/{report.answer_note_count}
                    </span>
                  </p>
                  <p>
                    <strong>Extra</strong>
                    <span>{report.extra_note_count}</span>
                  </p>
                </div>
                <ul>
                  {report.issues.map((issue) => (
                    <li key={`${report.report_id}-${issue.at_seconds}-${issue.issue_type}`}>
                      <strong>{formatSeconds(issue.at_seconds)}</strong>
                      <span>{getIssueLabel(issue)}</span>
                      <small>
                        expected {issue.answer_label ?? '-'} / actual {issue.performance_label ?? '-'} · Δtime{' '}
                        {formatNullableSeconds(issue.timing_error_seconds)} · Δpitch{' '}
                        {formatNullableSemitones(issue.pitch_error_semitones)}
                      </small>
                    </li>
                  ))}
                </ul>
                  </>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {scoreSession && scoreTargetTrack ? (
        <section className="score-drawer" aria-label="채점 체크리스트">
          <div className="score-drawer__panel">
            <header>
              <div>
                <p className="eyebrow">Scoring checklist</p>
                <h2>{scoreTargetTrack.name} 채점</h2>
              </div>
              <button
                aria-label="채점 체크리스트 닫기"
                className="studio-icon-button"
                type="button"
                onClick={() => setScoreSession(null)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <div className="score-checklist">
              {studio.tracks.map((track) => (
                <label
                  className={track.status === 'registered' ? '' : 'is-disabled'}
                  key={track.slot_id}
                >
                  <input
                    checked={scoreSession.selectedReferenceIds.includes(track.slot_id)}
                    disabled={track.status !== 'registered' || track.slot_id === scoreSession.targetSlotId}
                    type="checkbox"
                    onChange={() => toggleScoreReference(track.slot_id)}
                  />
                  <span>트랙 {track.slot_id}</span>
                  <strong>{track.name}</strong>
                </label>
              ))}
              <label>
                <input
                  checked={scoreSession.includeMetronome}
                  type="checkbox"
                  onChange={(event) =>
                    setScoreSession({ ...scoreSession, includeMetronome: event.target.checked })
                  }
                />
                <span>기준</span>
                <strong>메트로놈</strong>
              </label>
            </div>

            <div className="score-drawer__actions">
              <button
                className="app-button"
                data-testid="score-start-button"
                disabled={scoreSession.phase !== 'ready'}
                type="button"
                onClick={() => void startScoreListening()}
              >
                시작
              </button>
              <button
                className="app-button app-button--record"
                data-testid="score-stop-button"
                disabled={scoreSession.phase === 'analyzing'}
                type="button"
                onClick={() => void stopScoreListening()}
              >
                중지
              </button>
              <button
                className="app-button app-button--secondary"
                type="button"
                onClick={() => setScoreSession(null)}
              >
                취소
              </button>
            </div>

            <p className="score-drawer__hint">
              {scoreSession.phase === 'listening'
                ? '선택한 트랙을 동시에 재생하고 마이크 입력을 받고 있습니다.'
                : '체크한 트랙과 메트로놈을 기준으로 0.01s 단위 리포트를 생성합니다.'}
            </p>
          </div>
        </section>
      ) : null}
    </main>
  )
}
