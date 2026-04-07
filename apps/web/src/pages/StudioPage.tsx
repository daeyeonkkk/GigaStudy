import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { currentLaneTickets } from '../data/phase1'
import { buildAudioPreviewFromBlob, buildAudioPreviewFromUrl, type AudioPreviewData } from '../lib/audioPreview'
import { buildApiUrl } from '../lib/api'
import {
  startArrangementPlayback,
  type ArrangementPlaybackController,
  type ArrangementPlaybackMixerState,
} from '../lib/arrangementPlayback'
import {
  getArrangementDurationMs,
  getArrangementPartColor,
  getDefaultArrangementPartVolume,
} from '../lib/arrangementParts'
import { renderOfflineMixdown, type RenderedMixdown } from '../lib/mixdownAudio'
import {
  pickSupportedRecordingMimeType,
  playCountInSequence,
  startMetronomeLoop,
  uploadBlobWithProgress,
  type MetronomeController,
} from '../lib/studioAudio'
import type { Project } from '../types/project'

type StudioState =
  | { phase: 'loading' }
  | { phase: 'ready'; project: Project }
  | { phase: 'error'; message: string }

type ActionState =
  | { phase: 'idle' }
  | { phase: 'submitting'; message?: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type DeviceProfile = {
  device_profile_id: string
  user_id: string
  browser: string
  os: string
  input_device_hash: string
  output_route: string
  requested_constraints_json: Record<string, unknown> | null
  applied_settings_json: Record<string, unknown> | null
  actual_sample_rate: number | null
  channel_count: number | null
  input_latency_est: number | null
  base_latency: number | null
  output_latency: number | null
  calibration_method: string | null
  calibration_confidence: number | null
  created_at: string
  updated_at: string
}

type GuideTrack = {
  track_id: string
  project_id: string
  track_role: string
  track_status: string
  source_format: string | null
  duration_ms: number | null
  actual_sample_rate: number | null
  storage_key: string | null
  checksum: string | null
  failure_message: string | null
  source_artifact_url: string | null
  guide_wav_artifact_url: string | null
  preview_data: AudioPreviewData | null
  created_at: string
  updated_at: string
}

type GuideUploadInitResponse = {
  track_id: string
  upload_url: string
  method: 'PUT'
  storage_key: string
}

type AnalysisFeedbackItem = {
  segment_index: number
  start_ms: number
  end_ms: number
  pitch_score: number
  rhythm_score: number
  harmony_fit_score: number
  message: string
}

type AnalysisJobSummary = {
  job_id: string
  project_id: string
  track_id: string
  job_type: string
  status: string
  model_version: string
  requested_at: string
  finished_at: string | null
  error_message: string | null
}

type TrackScoreSummary = {
  score_id: string
  project_id: string
  track_id: string
  pitch_score: number
  rhythm_score: number
  harmony_fit_score: number
  total_score: number
  feedback_json: AnalysisFeedbackItem[]
  created_at: string
  updated_at: string
}

type MelodyNote = {
  pitch_midi: number
  pitch_name: string
  start_ms: number
  end_ms: number
  duration_ms: number
  phrase_index: number
  velocity: number
}

type MelodyDraft = {
  melody_draft_id: string
  project_id: string
  track_id: string
  model_version: string
  key_estimate: string | null
  bpm: number | null
  grid_division: string
  phrase_count: number
  note_count: number
  notes_json: MelodyNote[]
  midi_artifact_url: string | null
  created_at: string
  updated_at: string
}

type ArrangementPart = {
  part_name: string
  role: string
  range_label: string
  notes: MelodyNote[]
}

type ArrangementComparisonSummary = {
  lead_range_fit_percent: number
  support_max_leap: number
  parallel_motion_alerts: number
  support_part_count: number
  beatbox_note_count: number
}

type ArrangementCandidate = {
  arrangement_id: string
  generation_id: string
  project_id: string
  melody_draft_id: string
  candidate_code: string
  title: string
  input_source_type: string
  style: string
  difficulty: string
  voice_mode: string
  part_count: number
  voice_range_preset: string | null
  beatbox_template: string | null
  constraint_json: Record<string, unknown> | null
  comparison_summary: ArrangementComparisonSummary | null
  parts_json: ArrangementPart[]
  midi_artifact_url: string | null
  musicxml_artifact_url: string | null
  created_at: string
  updated_at: string
}

type TakeTrack = {
  track_id: string
  project_id: string
  track_role: string
  track_status: string
  take_no: number | null
  part_type: string | null
  source_format: string | null
  duration_ms: number | null
  actual_sample_rate: number | null
  storage_key: string | null
  checksum: string | null
  failure_message: string | null
  alignment_offset_ms: number | null
  alignment_confidence: number | null
  recording_started_at: string | null
  recording_finished_at: string | null
  source_artifact_url: string | null
  preview_data: AudioPreviewData | null
  latest_score: TrackScoreSummary | null
  latest_analysis_job: AnalysisJobSummary | null
  latest_melody: MelodyDraft | null
  created_at: string
  updated_at: string
}

type TakeUploadInitResponse = {
  track_id: string
  upload_url: string
  method: 'PUT'
  storage_key: string
}

type MixdownTrack = {
  track_id: string
  project_id: string
  track_role: string
  track_status: string
  source_format: string | null
  duration_ms: number | null
  actual_sample_rate: number | null
  storage_key: string | null
  checksum: string | null
  failure_message: string | null
  source_artifact_url: string | null
  preview_data: AudioPreviewData | null
  created_at: string
  updated_at: string
}

type MixdownUploadInitResponse = {
  track_id: string
  upload_url: string
  method: 'PUT'
  storage_key: string
}

type StudioSnapshotResponse = {
  project: Project
  guide: GuideTrack | null
  takes: TakeTrack[]
  latest_device_profile: DeviceProfile | null
  mixdown: MixdownTrack | null
  arrangement_generation_id: string | null
  arrangements: ArrangementCandidate[]
}

type SnapshotSummary = {
  has_guide: boolean
  take_count: number
  ready_take_count: number
  arrangement_count: number
  has_mixdown: boolean
}

type ProjectVersionRecord = {
  version_id: string
  project_id: string
  source_type: string
  label: string
  note: string | null
  snapshot_summary: SnapshotSummary
  created_at: string
  updated_at: string
}

type ShareLinkRecord = {
  share_link_id: string
  project_id: string
  version_id: string
  label: string
  access_scope: string
  is_active: boolean
  expires_at: string | null
  last_accessed_at: string | null
  share_url: string
  created_at: string
  updated_at: string
}

type TrackAnalysisResponse = {
  track_id: string
  project_id: string
  guide_track_id: string
  alignment_offset_ms: number | null
  alignment_confidence: number | null
  latest_job: AnalysisJobSummary
  latest_score: TrackScoreSummary
}

type ArrangementConfig = {
  style: string
  difficulty: string
  voiceRangePreset: string
  beatboxTemplate: string
}

type DeviceProfileState =
  | { phase: 'loading'; profile: null }
  | { phase: 'ready'; profile: DeviceProfile | null }
  | { phase: 'error'; profile: null; message: string }

type GuideState =
  | { phase: 'loading'; guide: null }
  | { phase: 'ready'; guide: GuideTrack | null }
  | { phase: 'error'; guide: null; message: string }

type PermissionState =
  | { phase: 'idle' }
  | { phase: 'requesting' }
  | { phase: 'granted'; message: string }
  | { phase: 'error'; message: string }

type TakesState =
  | { phase: 'loading'; items: TakeTrack[] }
  | { phase: 'ready'; items: TakeTrack[] }
  | { phase: 'error'; items: TakeTrack[]; message: string }

type RecordingState =
  | { phase: 'idle'; message: string }
  | { phase: 'counting-in'; message: string }
  | { phase: 'recording'; message: string }
  | { phase: 'uploading'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type ConstraintDraft = {
  echoCancellation: boolean
  autoGainControl: boolean
  noiseSuppression: boolean
  channelCount: number
}

type FailedTakeUpload = {
  blob: Blob
  fileName: string
  contentType: string
  durationMs: number | null
  actualSampleRate: number | null
}

type MixdownPreview = RenderedMixdown & {
  preview_data: AudioPreviewData
  url: string
}

type MixerTrackState = {
  muted: boolean
  solo: boolean
  volume: number
}

type ArrangementTransportState =
  | { phase: 'idle'; message: string }
  | { phase: 'playing'; message: string }
  | { phase: 'error'; message: string }

type VersionsState =
  | { phase: 'loading'; items: ProjectVersionRecord[] }
  | { phase: 'ready'; items: ProjectVersionRecord[] }
  | { phase: 'error'; items: ProjectVersionRecord[]; message: string }

type ShareLinksState =
  | { phase: 'loading'; items: ShareLinkRecord[] }
  | { phase: 'ready'; items: ShareLinkRecord[] }
  | { phase: 'error'; items: ShareLinkRecord[]; message: string }

const defaultConstraintDraft: ConstraintDraft = {
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: true,
  channelCount: 1,
}

const defaultArrangementConfig: ArrangementConfig = {
  style: 'contemporary',
  difficulty: 'basic',
  voiceRangePreset: 'alto',
  beatboxTemplate: 'off',
}

const outputRouteOptions = [
  { value: 'headphones', label: 'Headphones recommended' },
  { value: 'speakers', label: 'Speakers / monitor' },
  { value: 'unknown', label: 'Unknown route' },
] as const

const noteNamesSharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const arrangementDifficultyOptions = [
  {
    value: 'beginner',
    label: 'Beginner',
    description: 'Shorter leaps and safer support motion for first-pass rehearsal.',
  },
  {
    value: 'basic',
    label: 'Basic',
    description: 'Balanced default preset with room for moderate movement.',
  },
  {
    value: 'strict',
    label: 'Strict',
    description: 'Tighter leap control and stronger parallel-motion avoidance.',
  },
] as const
const voiceRangePresetOptions = [
  {
    value: 'soprano',
    label: 'S (Soprano)',
    description: 'Bright top-line preset for higher lead takes.',
  },
  {
    value: 'alto',
    label: 'A (Alto)',
    description: 'Balanced default preset that matches the current MVP stack best.',
  },
  {
    value: 'tenor',
    label: 'T (Tenor)',
    description: 'Lower lead preset for tenor-centered practice takes.',
  },
  {
    value: 'bass',
    label: 'B (Bass)',
    description: 'Lowest lead preset with deeper support spacing.',
  },
  {
    value: 'baritone',
    label: 'Baritone',
    description: 'Middle-low lead preset between tenor agility and bass weight.',
  },
] as const
const beatboxTemplateOptions = [
  {
    value: 'off',
    label: 'Off',
    description: 'No beatbox layer in the candidate batch.',
  },
  {
    value: 'pulse',
    label: 'Pulse',
    description: 'Simple kick and snare pulse for rehearsal timing.',
  },
  {
    value: 'drive',
    label: 'Drive',
    description: 'Busier groove with hats and extra kick support.',
  },
  {
    value: 'halftime',
    label: 'Half-Time',
    description: 'Slower backbeat that leaves more space around phrases.',
  },
  {
    value: 'syncopated',
    label: 'Syncopated',
    description: 'Off-beat accents for a livelier comparison candidate.',
  },
] as const

function getOptionMeta<T extends { value: string; label: string; description: string }>(
  options: readonly T[],
  value: string | null | undefined,
): T {
  return options.find((option) => option.value === value) ?? options[0]!
}

function detectBrowserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) {
    return 'Edge'
  }
  if (/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) {
    return 'Chrome'
  }
  if (/Firefox\//.test(userAgent)) {
    return 'Firefox'
  }
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) {
    return 'Safari'
  }
  return 'Unknown browser'
}

function detectOsName(userAgent: string): string {
  if (/Windows NT/.test(userAgent)) {
    return 'Windows'
  }
  if (/Mac OS X/.test(userAgent)) {
    return 'macOS'
  }
  if (/Android/.test(userAgent)) {
    return 'Android'
  }
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'iOS'
  }
  if (/Linux/.test(userAgent)) {
    return 'Linux'
  }
  return 'Unknown OS'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'Not captured yet'
  }

  return `${(durationMs / 1000).toFixed(2)} sec`
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'Not scored yet'
  }

  return `${value.toFixed(1)} / 100`
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${Math.round(value)}%`
}

function formatConfidence(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'Pending'
  }

  return `${Math.round(value * 100)}%`
}

function formatOffsetMs(value: number | null): string {
  if (value === null) {
    return 'Pending'
  }

  if (value === 0) {
    return 'Aligned'
  }

  return `${value > 0 ? '+' : ''}${value} ms`
}

function midiToPitchName(pitchMidi: number): string {
  const octave = Math.floor(pitchMidi / 12) - 1
  return `${noteNamesSharp[((pitchMidi % 12) + 12) % 12]}${octave}`
}

function normalizeMelodyNote(note: MelodyNote): MelodyNote {
  const safeStart = Math.max(0, note.start_ms)
  const safeEnd = Math.max(safeStart + 1, note.end_ms)
  const safePitch = Math.min(127, Math.max(0, note.pitch_midi))
  const safeVelocity = Math.min(127, Math.max(1, note.velocity))
  const safePhrase = Math.max(0, note.phrase_index)

  return {
    pitch_midi: safePitch,
    pitch_name: midiToPitchName(safePitch),
    start_ms: safeStart,
    end_ms: safeEnd,
    duration_ms: safeEnd - safeStart,
    phrase_index: safePhrase,
    velocity: safeVelocity,
  }
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getRequestedAudioConstraints(
  profile: DeviceProfile | null,
): Record<string, unknown> | null {
  if (!profile?.requested_constraints_json) {
    return null
  }

  const nestedAudio = profile.requested_constraints_json.audio
  if (nestedAudio && typeof nestedAudio === 'object') {
    return nestedAudio as Record<string, unknown>
  }

  return profile.requested_constraints_json
}

function getAudioContextOutputLatency(audioContext: AudioContext): number | null {
  const maybeWithOutput = audioContext as AudioContext & { outputLatency?: number }
  return pickNumber(maybeWithOutput.outputLatency)
}

function serializeTrackSettings(settings: MediaTrackSettings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter((entry) => entry[1] !== undefined),
  )
}

function getTrackLatency(settings: MediaTrackSettings): number | null {
  const withLatency = settings as MediaTrackSettings & { latency?: number }
  return pickNumber(withLatency.latency)
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === 'string') {
      return payload.detail
    }
  } catch {
    return fallback
  }

  return fallback
}

async function hashValue(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return value
  }

  const encoded = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

async function extractAudioFileMetadata(file: File): Promise<{
  actualSampleRate: number | null
  durationMs: number | null
}> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return { actualSampleRate: null, durationMs: null }
  }

  const audioContext = new AudioContext()

  try {
    const encodedAudio = await file.arrayBuffer()
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio.slice(0))
    return {
      actualSampleRate: decodedAudio.sampleRate,
      durationMs: Math.round(decodedAudio.duration * 1000),
    }
  } catch {
    return { actualSampleRate: null, durationMs: null }
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

function buildRequestedAudioConstraints(
  constraintDraft: ConstraintDraft,
  selectedInputId: string,
): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: constraintDraft.echoCancellation,
      autoGainControl: constraintDraft.autoGainControl,
      noiseSuppression: constraintDraft.noiseSuppression,
      channelCount: constraintDraft.channelCount,
      ...(selectedInputId ? { deviceId: { exact: selectedInputId } } : {}),
    },
  }
}

function getAccentEvery(timeSignature: string | null): number {
  if (!timeSignature) {
    return 4
  }

  const [numerator] = timeSignature.split('/')
  const parsed = Number(numerator)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4
}

function syncMixerState(
  current: Record<string, MixerTrackState>,
  trackIds: string[],
  guideTrackId: string | null,
): Record<string, MixerTrackState> {
  const next: Record<string, MixerTrackState> = {}

  for (const trackId of trackIds) {
    next[trackId] =
      current[trackId] ??
      ({
        muted: false,
        solo: false,
        volume: trackId === guideTrackId ? 0.85 : 1,
      } satisfies MixerTrackState)
  }

  return next
}

function formatPlaybackClock(positionMs: number, durationMs: number): string {
  const safePosition = Math.max(0, Math.round(positionMs / 1000))
  const safeDuration = Math.max(0, Math.round(durationMs / 1000))
  const positionMinutes = Math.floor(safePosition / 60)
  const positionSeconds = safePosition % 60
  const durationMinutes = Math.floor(safeDuration / 60)
  const durationSeconds = safeDuration % 60

  return `${positionMinutes}:${positionSeconds.toString().padStart(2, '0')} / ${durationMinutes}:${durationSeconds
    .toString()
    .padStart(2, '0')}`
}

function syncArrangementPartMixerState(
  current: Record<string, ArrangementPlaybackMixerState>,
  parts: ArrangementPart[],
): Record<string, ArrangementPlaybackMixerState> {
  const next: Record<string, ArrangementPlaybackMixerState> = {}

  for (const part of parts) {
    next[part.part_name] = current[part.part_name] ?? {
      enabled: true,
      solo: false,
      volume: getDefaultArrangementPartVolume(part.role),
    }
  }

  return next
}

export function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [studioState, setStudioState] = useState<StudioState>({ phase: 'loading' })
  const [guideState, setGuideState] = useState<GuideState>({
    phase: 'loading',
    guide: null,
  })
  const [guideFile, setGuideFile] = useState<File | null>(null)
  const [guideUploadState, setGuideUploadState] = useState<ActionState>({ phase: 'idle' })
  const [permissionState, setPermissionState] = useState<PermissionState>({ phase: 'idle' })
  const [deviceProfileState, setDeviceProfileState] = useState<DeviceProfileState>({
    phase: 'loading',
    profile: null,
  })
  const [saveDeviceState, setSaveDeviceState] = useState<ActionState>({ phase: 'idle' })
  const [takesState, setTakesState] = useState<TakesState>({
    phase: 'loading',
    items: [],
  })
  const [recordingState, setRecordingState] = useState<RecordingState>({
    phase: 'idle',
    message: 'Ready to record the next take.',
  })
  const [metronomePreviewState, setMetronomePreviewState] = useState<ActionState>({
    phase: 'idle',
  })
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [outputRoute, setOutputRoute] = useState('headphones')
  const [constraintDraft, setConstraintDraft] =
    useState<ConstraintDraft>(defaultConstraintDraft)
  const [appliedSettingsPreview, setAppliedSettingsPreview] =
    useState<Record<string, unknown> | null>(null)
  const [countInBeats, setCountInBeats] = useState(4)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [takeUploadProgress, setTakeUploadProgress] = useState<Record<string, number>>({})
  const [failedTakeUploads, setFailedTakeUploads] = useState<
    Record<string, FailedTakeUpload>
  >({})
  const [takePreviewUrls, setTakePreviewUrls] = useState<Record<string, string>>({})
  const [audioPreviews, setAudioPreviews] = useState<Record<string, AudioPreviewData>>({})
  const [waveformState, setWaveformState] = useState<ActionState>({ phase: 'idle' })
  const [analysisState, setAnalysisState] = useState<ActionState>({ phase: 'idle' })
  const [melodyState, setMelodyState] = useState<ActionState>({ phase: 'idle' })
  const [melodySaveState, setMelodySaveState] = useState<ActionState>({ phase: 'idle' })
  const [melodyNotesDraft, setMelodyNotesDraft] = useState<MelodyNote[]>([])
  const [arrangementState, setArrangementState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementSaveState, setArrangementSaveState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementGenerationId, setArrangementGenerationId] = useState<string | null>(null)
  const [arrangements, setArrangements] = useState<ArrangementCandidate[]>([])
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)
  const [arrangementTitleDraft, setArrangementTitleDraft] = useState('')
  const [arrangementJsonDraft, setArrangementJsonDraft] = useState('[]')
  const [arrangementConfig, setArrangementConfig] =
    useState<ArrangementConfig>(defaultArrangementConfig)
  const [arrangementPartMixerState, setArrangementPartMixerState] = useState<
    Record<string, ArrangementPlaybackMixerState>
  >({})
  const [guideModeEnabled, setGuideModeEnabled] = useState(false)
  const [guideFocusPartName, setGuideFocusPartName] = useState<string | null>(null)
  const [arrangementTransportState, setArrangementTransportState] =
    useState<ArrangementTransportState>({
      phase: 'idle',
      message: 'Select a candidate to render the score and preview the harmony stack.',
    })
  const [arrangementPlaybackPositionMs, setArrangementPlaybackPositionMs] = useState(0)
  const [mixerState, setMixerState] = useState<Record<string, MixerTrackState>>({})
  const [mixdownSummary, setMixdownSummary] = useState<MixdownTrack | null>(null)
  const [mixdownPreviewState, setMixdownPreviewState] = useState<ActionState>({ phase: 'idle' })
  const [mixdownSaveState, setMixdownSaveState] = useState<ActionState>({ phase: 'idle' })
  const [mixdownPreview, setMixdownPreview] = useState<MixdownPreview | null>(null)
  const [versionsState, setVersionsState] = useState<VersionsState>({
    phase: 'loading',
    items: [],
  })
  const [shareLinksState, setShareLinksState] = useState<ShareLinksState>({
    phase: 'loading',
    items: [],
  })
  const [versionCreateState, setVersionCreateState] = useState<ActionState>({ phase: 'idle' })
  const [shareCreateState, setShareCreateState] = useState<ActionState>({ phase: 'idle' })
  const [shareDeactivateState, setShareDeactivateState] = useState<ActionState>({ phase: 'idle' })
  const [shareCopyState, setShareCopyState] = useState<ActionState>({ phase: 'idle' })
  const [versionLabelDraft, setVersionLabelDraft] = useState('')
  const [versionNoteDraft, setVersionNoteDraft] = useState('')
  const [shareLabelDraft, setShareLabelDraft] = useState('')
  const [shareExpiryDays, setShareExpiryDays] = useState(7)
  const [activeUploadTrackId, setActiveUploadTrackId] = useState<string | null>(null)
  const guideFileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<Date | null>(null)
  const recordingMimeTypeRef = useRef('audio/webm')
  const metronomeControllerRef = useRef<MetronomeController | null>(null)
  const arrangementPlaybackRef = useRef<ArrangementPlaybackController | null>(null)
  const mixdownPreviewUrlRef = useRef<string | null>(null)
  const takePreviewUrlsRef = useRef<Record<string, string>>({})
  const applyStudioSnapshotRef = useRef<(snapshot: StudioSnapshotResponse) => void>(() => undefined)

  function hydrateDeviceDraft(profile: DeviceProfile): void {
    setOutputRoute(profile.output_route)

    const requestedAudio = getRequestedAudioConstraints(profile)
    if (!requestedAudio) {
      return
    }

    setConstraintDraft({
      echoCancellation:
        typeof requestedAudio.echoCancellation === 'boolean'
          ? requestedAudio.echoCancellation
          : defaultConstraintDraft.echoCancellation,
      autoGainControl:
        typeof requestedAudio.autoGainControl === 'boolean'
          ? requestedAudio.autoGainControl
          : defaultConstraintDraft.autoGainControl,
      noiseSuppression:
        typeof requestedAudio.noiseSuppression === 'boolean'
          ? requestedAudio.noiseSuppression
          : defaultConstraintDraft.noiseSuppression,
      channelCount:
        typeof requestedAudio.channelCount === 'number'
          ? requestedAudio.channelCount
          : defaultConstraintDraft.channelCount,
    })
  }

  async function refreshAudioInputs(preferredDeviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Media device enumeration is not available in this browser.')
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((device) => device.kind === 'audioinput')
    setAudioInputs(inputs)

    setSelectedInputId((current) => {
      if (preferredDeviceId && inputs.some((device) => device.deviceId === preferredDeviceId)) {
        return preferredDeviceId
      }

      if (current && inputs.some((device) => device.deviceId === current)) {
        return current
      }

      return inputs[0]?.deviceId ?? ''
    })
  }

  function setTakePreviewUrl(trackId: string, blob: Blob): void {
    setTakePreviewUrls((current) => {
      const previousUrl = current[trackId]
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl)
      }

      const next = {
        ...current,
        [trackId]: URL.createObjectURL(blob),
      }
      takePreviewUrlsRef.current = next
      return next
    })
  }

  function replaceMixdownPreview(nextPreview: (RenderedMixdown & { preview_data: AudioPreviewData }) | null): void {
    setMixdownPreview((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url)
      }

      if (nextPreview === null) {
        mixdownPreviewUrlRef.current = null
        return null
      }

      const nextUrl = URL.createObjectURL(nextPreview.blob)
      mixdownPreviewUrlRef.current = nextUrl
      return {
        ...nextPreview,
        url: nextUrl,
      }
    })
  }

  async function stopActiveMetronome(): Promise<void> {
    const activeMetronome = metronomeControllerRef.current
    metronomeControllerRef.current = null
    if (activeMetronome) {
      await activeMetronome.stop()
    }
  }

  async function stopArrangementPlayback(resetPosition = true): Promise<void> {
    const activePlayback = arrangementPlaybackRef.current
    arrangementPlaybackRef.current = null
    if (activePlayback) {
      await activePlayback.stop(resetPosition)
    }
    if (resetPosition) {
      setArrangementPlaybackPositionMs(0)
    }
    setArrangementTransportState({
      phase: 'idle',
      message: 'Arrangement playback is ready.',
    })
  }

  async function cleanupRecordingResources(): Promise<void> {
    await stopActiveMetronome()

    mediaRecorderRef.current = null
    recordingChunksRef.current = []
    recordingStartedAtRef.current = null

    const activeStream = recordingStreamRef.current
    if (activeStream) {
      activeStream.getTracks().forEach((streamTrack) => streamTrack.stop())
      recordingStreamRef.current = null
    }
  }

  applyStudioSnapshotRef.current = (snapshot: StudioSnapshotResponse) => {
    setStudioState({ phase: 'ready', project: snapshot.project })
    setGuideState({ phase: 'ready', guide: snapshot.guide })
    setTakesState({ phase: 'ready', items: snapshot.takes })
    setMixdownSummary(snapshot.mixdown)
    setArrangementGenerationId(snapshot.arrangement_generation_id)
    setArrangements(snapshot.arrangements)
    setAudioPreviews((current) => {
      const next = { ...current }

      for (const track of snapshot.takes) {
        if (track.preview_data && !next[track.track_id]) {
          next[track.track_id] = track.preview_data
        }
      }

      return next
    })

    if (snapshot.latest_device_profile) {
      hydrateDeviceDraft(snapshot.latest_device_profile)
      setAppliedSettingsPreview(snapshot.latest_device_profile.applied_settings_json)
    }

    setDeviceProfileState({
      phase: 'ready',
      profile: snapshot.latest_device_profile,
    })

    setMixerState((current) =>
      syncMixerState(
        current,
        [
          ...(snapshot.guide ? [snapshot.guide.track_id] : []),
          ...snapshot.takes.map((track) => track.track_id),
        ],
        snapshot.guide?.track_id ?? null,
      ),
    )
  }

  async function refreshStudioSnapshot(): Promise<StudioSnapshotResponse | null> {
    if (!projectId) {
      return null
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/studio`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Unable to refresh the studio snapshot.'))
    }

    const snapshot = (await response.json()) as StudioSnapshotResponse
    applyStudioSnapshotRef.current(snapshot)
    return snapshot
  }

  async function refreshProjectVersions(): Promise<ProjectVersionRecord[]> {
    if (!projectId) {
      return []
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/versions`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Unable to load project versions.'))
    }

    const payload = (await response.json()) as { items: ProjectVersionRecord[] }
    setVersionsState({ phase: 'ready', items: payload.items })
    return payload.items
  }

  async function refreshShareLinks(): Promise<ShareLinkRecord[]> {
    if (!projectId) {
      return []
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/share-links`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Unable to load share links.'))
    }

    const payload = (await response.json()) as { items: ShareLinkRecord[] }
    setShareLinksState({ phase: 'ready', items: payload.items })
    return payload.items
  }

  useEffect(() => {
    if (!projectId) {
      setStudioState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    const controller = new AbortController()

    async function loadStudio(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/studio`), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(
            response.status === 404 ? 'Project was not found.' : `HTTP ${response.status}`,
          )
        }

        const snapshot = (await response.json()) as StudioSnapshotResponse
        applyStudioSnapshotRef.current(snapshot)
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setStudioState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Unable to load the studio.',
        })
      }
    }

    void loadStudio()

    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setVersionsState({ phase: 'error', items: [], message: 'Project id is missing.' })
      return
    }

    let isActive = true
    setVersionsState({ phase: 'loading', items: [] })

    async function loadVersions(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/versions`))
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Unable to load project versions.'))
        }

        const payload = (await response.json()) as { items: ProjectVersionRecord[] }
        if (!isActive) {
          return
        }

        setVersionsState({ phase: 'ready', items: payload.items })
      } catch (error) {
        if (!isActive) {
          return
        }

        setVersionsState({
          phase: 'error',
          items: [],
          message: error instanceof Error ? error.message : 'Unable to load project versions.',
        })
      }
    }

    void loadVersions()

    return () => {
      isActive = false
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setShareLinksState({ phase: 'error', items: [], message: 'Project id is missing.' })
      return
    }

    let isActive = true
    setShareLinksState({ phase: 'loading', items: [] })

    async function loadShareLinks(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/share-links`))
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Unable to load share links.'))
        }

        const payload = (await response.json()) as { items: ShareLinkRecord[] }
        if (!isActive) {
          return
        }

        setShareLinksState({ phase: 'ready', items: payload.items })
      } catch (error) {
        if (!isActive) {
          return
        }

        setShareLinksState({
          phase: 'error',
          items: [],
          message: error instanceof Error ? error.message : 'Unable to load share links.',
        })
      }
    }

    void loadShareLinks()

    return () => {
      isActive = false
    }
  }, [projectId])

  useEffect(() => {
    void refreshAudioInputs().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (selectedTakeId) {
      return
    }

    const firstTake = takesState.items[0]
    if (firstTake) {
      setSelectedTakeId(firstTake.track_id)
    }
  }, [selectedTakeId, takesState.items])

  useEffect(() => {
    setMixerState((current) =>
      syncMixerState(
        current,
        [
          ...(guideState.guide ? [guideState.guide.track_id] : []),
          ...takesState.items.map((track) => track.track_id),
        ],
        guideState.guide?.track_id ?? null,
      ),
    )
  }, [guideState.guide, takesState.items])

  useEffect(() => {
    takePreviewUrlsRef.current = takePreviewUrls
  }, [takePreviewUrls])

  useEffect(() => {
    return () => {
      const activeMetronome = metronomeControllerRef.current
      if (activeMetronome) {
        void activeMetronome.stop()
      }

      const activeStream = recordingStreamRef.current
      if (activeStream) {
        activeStream.getTracks().forEach((streamTrack) => streamTrack.stop())
      }

      Object.values(takePreviewUrlsRef.current).forEach((previewUrl) => URL.revokeObjectURL(previewUrl))
      if (mixdownPreviewUrlRef.current) {
        URL.revokeObjectURL(mixdownPreviewUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const selectedTrack = takesState.items.find((take) => take.track_id === selectedTakeId)
    if (!selectedTrack) {
      setWaveformState({ phase: 'idle' })
      return
    }

    if (audioPreviews[selectedTrack.track_id]) {
      setWaveformState({
        phase: 'success',
        message: 'Waveform and contour preview are ready.',
      })
      return
    }

    const failedUpload = failedTakeUploads[selectedTrack.track_id]
    const previewTask = failedUpload
      ? buildAudioPreviewFromBlob(failedUpload.blob)
      : selectedTrack.source_artifact_url
        ? buildAudioPreviewFromUrl(selectedTrack.source_artifact_url)
        : null

    if (!previewTask) {
      setWaveformState({
        phase: 'idle',
      })
      return
    }

    let cancelled = false
    setWaveformState({ phase: 'submitting' })

    void previewTask
      .then((preview) => {
        if (cancelled) {
          return
        }

        setAudioPreviews((current) => ({
          ...current,
          [selectedTrack.track_id]: preview,
        }))
        setWaveformState({
          phase: 'success',
          message:
            preview.source === 'local'
              ? 'Waveform preview generated from the latest local take.'
              : 'Waveform preview reloaded from stored source audio.',
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setWaveformState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Waveform preview failed.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [audioPreviews, failedTakeUploads, selectedTakeId, takesState.items])

  useEffect(() => {
    replaceMixdownPreview(null)
    setMixdownPreviewState({ phase: 'idle' })
    setMixdownSaveState({ phase: 'idle' })
  }, [guideState.guide, mixerState, selectedTakeId, takePreviewUrls, takesState.items])

  useEffect(() => {
    setAnalysisState({ phase: 'idle' })
  }, [selectedTakeId])

  useEffect(() => {
    setMelodyState({ phase: 'idle' })
    setMelodySaveState({ phase: 'idle' })
    setArrangementState({ phase: 'idle' })
  }, [selectedTakeId])

  useEffect(() => {
    setArrangementSaveState({ phase: 'idle' })
  }, [selectedArrangementId])

  useEffect(() => {
    const selectedTrack =
      takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
    setMelodyNotesDraft(selectedTrack?.latest_melody?.notes_json ?? [])
  }, [selectedTakeId, takesState.items])

  useEffect(() => {
    if (selectedArrangementId && arrangements.some((item) => item.arrangement_id === selectedArrangementId)) {
      return
    }

    setSelectedArrangementId(arrangements[0]?.arrangement_id ?? null)
  }, [arrangements, selectedArrangementId])

  useEffect(() => {
    const selectedArrangement =
      arrangements.find((item) => item.arrangement_id === selectedArrangementId) ?? arrangements[0] ?? null
    setArrangementTitleDraft(selectedArrangement?.title ?? '')
    setArrangementJsonDraft(JSON.stringify(selectedArrangement?.parts_json ?? [], null, 2))
  }, [arrangements, selectedArrangementId])

  useEffect(() => {
    const selectedArrangement =
      arrangements.find((item) => item.arrangement_id === selectedArrangementId) ?? arrangements[0] ?? null
    const arrangementParts = selectedArrangement?.parts_json ?? []
    setArrangementPartMixerState((current) =>
      syncArrangementPartMixerState(current, arrangementParts),
    )
    if (arrangementParts.length === 0) {
      setGuideFocusPartName(null)
      setGuideModeEnabled(false)
      setArrangementPlaybackPositionMs(0)
      setArrangementTransportState({
        phase: 'idle',
        message: 'Select a candidate to render the score and preview the harmony stack.',
      })
      return
    }

    setGuideFocusPartName((current) =>
      current && arrangementParts.some((part) => part.part_name === current)
        ? current
        : arrangementParts.find((part) => part.role === 'MELODY')?.part_name ?? arrangementParts[0]?.part_name ?? null,
    )
    const activePlayback = arrangementPlaybackRef.current
    arrangementPlaybackRef.current = null
    if (activePlayback) {
      void activePlayback.stop()
    }
    setArrangementPlaybackPositionMs(0)
    setArrangementTransportState({
      phase: 'idle',
      message: 'Arrangement playback is ready.',
    })
  }, [arrangements, selectedArrangementId])

  useEffect(() => {
    return () => {
      const activePlayback = arrangementPlaybackRef.current
      arrangementPlaybackRef.current = null
      if (activePlayback) {
        void activePlayback.stop()
      }
    }
  }, [])

  async function refreshTakes(): Promise<TakeTrack[]> {
    const snapshot = await refreshStudioSnapshot()
    return snapshot?.takes ?? []
  }

  async function handleCaptureVersion(): Promise<void> {
    if (!projectId) {
      setVersionCreateState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    setVersionCreateState({
      phase: 'submitting',
      message: 'Capturing the current studio snapshot into project history...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}/versions`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: versionLabelDraft || undefined,
          note: versionNoteDraft || undefined,
        }),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to capture project version.'))
      }

      const version = (await response.json()) as ProjectVersionRecord
      await refreshProjectVersions().catch(() => undefined)
      setVersionCreateState({
        phase: 'success',
        message: `Saved version "${version.label}" with ${version.snapshot_summary.take_count} take snapshot(s).`,
      })
      if (!versionLabelDraft) {
        setVersionLabelDraft(version.label)
      }
    } catch (error) {
      setVersionCreateState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to capture project version.',
      })
    }
  }

  async function handleCreateShareLink(): Promise<void> {
    if (!projectId) {
      setShareCreateState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    setShareCreateState({
      phase: 'submitting',
      message: 'Creating a read-only share link from the current studio snapshot...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}/share-links`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: shareLabelDraft || undefined,
          expires_in_days: shareExpiryDays,
        }),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to create share link.'))
      }

      const shareLink = (await response.json()) as ShareLinkRecord
      await Promise.all([
        refreshShareLinks().catch(() => undefined),
        refreshProjectVersions().catch(() => undefined),
      ])
      setShareCreateState({
        phase: 'success',
        message: `Created read-only share link "${shareLink.label}" through ${formatDate(shareLink.expires_at ?? shareLink.created_at)}.`,
      })
      if (!shareLabelDraft) {
        setShareLabelDraft(shareLink.label)
      }
    } catch (error) {
      setShareCreateState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to create share link.',
      })
    }
  }

  async function handleDeactivateShareLink(shareLinkId: string): Promise<void> {
    setShareDeactivateState({
      phase: 'submitting',
      message: 'Deactivating the selected share link...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/share-links/${shareLinkId}/deactivate`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to deactivate share link.'))
      }

      const shareLink = (await response.json()) as ShareLinkRecord
      await refreshShareLinks().catch(() => undefined)
      setShareDeactivateState({
        phase: 'success',
        message: `Deactivated "${shareLink.label}". Existing recipients will lose access immediately.`,
      })
    } catch (error) {
      setShareDeactivateState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to deactivate share link.',
      })
    }
  }

  async function handleCopyShareLink(shareUrl: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      setShareCopyState({
        phase: 'error',
        message: 'Clipboard access is unavailable in this browser.',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopyState({
        phase: 'success',
        message: 'Share URL copied to the clipboard.',
      })
    } catch (error) {
      setShareCopyState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to copy share URL.',
      })
    }
  }

  async function handleRunAnalysis(): Promise<void> {
    if (!projectId) {
      setAnalysisState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    if (!selectedTake) {
      setAnalysisState({
        phase: 'error',
        message: 'Select a take before running post-recording analysis.',
      })
      return
    }

    setAnalysisState({
      phase: 'submitting',
      message: 'Running coarse/fine alignment and score generation on the server...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/analysis`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to run track analysis.'))
      }

      const analysis = (await response.json()) as TrackAnalysisResponse
      await refreshStudioSnapshot().catch(() => null)
      setAnalysisState({
        phase: 'success',
        message: `Analysis saved. Total ${analysis.latest_score.total_score.toFixed(1)}, alignment confidence ${Math.round((analysis.alignment_confidence ?? 0) * 100)}%.`,
      })
    } catch (error) {
      setAnalysisState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to run track analysis.',
      })
    }
  }

  async function handleExtractMelody(): Promise<void> {
    if (!projectId) {
      setMelodyState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    if (!selectedTake) {
      setMelodyState({
        phase: 'error',
        message: 'Select a take before extracting a melody draft.',
      })
      return
    }

    setMelodyState({
      phase: 'submitting',
      message: 'Extracting a quantized melody draft from the selected take...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/melody`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to extract melody draft.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraft
      setMelodyNotesDraft(melodyDraft.notes_json)
      await refreshStudioSnapshot().catch(() => null)
      setMelodyState({
        phase: 'success',
        message: `Melody draft saved with ${melodyDraft.note_count} notes and key ${melodyDraft.key_estimate ?? 'estimate pending'}.`,
      })
    } catch (error) {
      setMelodyState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to extract melody draft.',
      })
    }
  }

  function updateMelodyNote(index: number, key: keyof MelodyNote, value: number): void {
    setMelodyNotesDraft((current) =>
      current.map((note, noteIndex) => {
        if (noteIndex !== index) {
          return note
        }

        return normalizeMelodyNote({
          ...note,
          [key]: value,
        })
      }),
    )
  }

  function handleAddMelodyNote(): void {
    setMelodyNotesDraft((current) => {
      const previous = current[current.length - 1]
      const startMs = previous ? previous.end_ms : 0
      const endMs = startMs + 250
      return [
        ...current,
        normalizeMelodyNote({
          pitch_midi: previous?.pitch_midi ?? 60,
          pitch_name: midiToPitchName(previous?.pitch_midi ?? 60),
          start_ms: startMs,
          end_ms: endMs,
          duration_ms: endMs - startMs,
          phrase_index: previous?.phrase_index ?? 0,
          velocity: previous?.velocity ?? 84,
        }),
      ]
    })
  }

  function handleRemoveMelodyNote(index: number): void {
    setMelodyNotesDraft((current) => current.filter((_, noteIndex) => noteIndex !== index))
  }

  async function handleSaveMelodyDraft(): Promise<void> {
    if (!selectedTake?.latest_melody) {
      setMelodySaveState({
        phase: 'error',
        message: 'Extract a melody draft before saving note edits.',
      })
      return
    }

    setMelodySaveState({
      phase: 'submitting',
      message: 'Saving note edits and rebuilding the MIDI draft...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/melody-drafts/${selectedTake.latest_melody.melody_draft_id}`),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key_estimate: selectedTake.latest_melody.key_estimate,
            notes: melodyNotesDraft.map((note) => normalizeMelodyNote(note)),
          }),
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to save melody draft.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraft
      setMelodyNotesDraft(melodyDraft.notes_json)
      await refreshStudioSnapshot().catch(() => null)
      setMelodySaveState({
        phase: 'success',
        message: `Saved ${melodyDraft.note_count} melody notes and rebuilt the MIDI draft.`,
      })
    } catch (error) {
      setMelodySaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to save melody draft.',
      })
    }
  }

  async function handleGenerateArrangements(): Promise<void> {
    if (!projectId) {
      setArrangementState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    if (!selectedTakeMelody) {
      setArrangementState({
        phase: 'error',
        message: 'Extract a melody draft before generating arrangement candidates.',
      })
      return
    }

    setArrangementState({
      phase: 'submitting',
      message: 'Generating arrangement candidates from the latest melody draft...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}/arrangements/generate`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          melody_draft_id: selectedTakeMelody.melody_draft_id,
          style: arrangementConfig.style,
          difficulty: arrangementConfig.difficulty,
          voice_range_preset: arrangementConfig.voiceRangePreset,
          beatbox_template: arrangementConfig.beatboxTemplate,
          candidate_count: 3,
        }),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to generate arrangements.'))
      }

      const payload = (await response.json()) as {
        generation_id: string
        items: ArrangementCandidate[]
      }
      setArrangementGenerationId(payload.generation_id)
      setArrangements(payload.items)
      setSelectedArrangementId(payload.items[0]?.arrangement_id ?? null)
      await refreshStudioSnapshot().catch(() => null)
      setArrangementState({
        phase: 'success',
        message: `${payload.items.length} arrangement candidates are ready for comparison.`,
      })
    } catch (error) {
      setArrangementState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to generate arrangements.',
      })
    }
  }

  async function handleSaveArrangement(): Promise<void> {
    if (!selectedArrangement) {
      setArrangementSaveState({
        phase: 'error',
        message: 'Select an arrangement candidate before saving edits.',
      })
      return
    }

    let parsedParts: ArrangementPart[]
    try {
      parsedParts = JSON.parse(arrangementJsonDraft) as ArrangementPart[]
      if (!Array.isArray(parsedParts) || parsedParts.length === 0) {
        throw new Error('Arrangement JSON must contain at least one part.')
      }
    } catch (error) {
      setArrangementSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Arrangement JSON could not be parsed.',
      })
      return
    }

    setArrangementSaveState({
      phase: 'submitting',
      message: 'Saving arrangement edits and rebuilding the MIDI artifact...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/arrangements/${selectedArrangement.arrangement_id}`),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: arrangementTitleDraft,
            parts_json: parsedParts,
          }),
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to save arrangement edits.'))
      }

      const updatedArrangement = (await response.json()) as ArrangementCandidate
      setArrangements((current) =>
        current.map((item) =>
          item.arrangement_id === updatedArrangement.arrangement_id ? updatedArrangement : item,
        ),
      )
      setSelectedArrangementId(updatedArrangement.arrangement_id)
      await refreshStudioSnapshot().catch(() => null)
      setArrangementSaveState({
        phase: 'success',
        message: `Saved arrangement ${updatedArrangement.candidate_code} and rebuilt its MIDI file.`,
      })
    } catch (error) {
      setArrangementSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to save arrangement edits.',
      })
    }
  }

  async function handleRetryAnalysisJob(): Promise<void> {
    if (!selectedTakeAnalysisJob || selectedTakeAnalysisJob.status !== 'FAILED') {
      setAnalysisState({
        phase: 'error',
        message: 'Select a take with a FAILED analysis job before retrying.',
      })
      return
    }

    setAnalysisState({
      phase: 'submitting',
      message: 'Retrying the failed analysis job with the same track and guide...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/analysis-jobs/${selectedTakeAnalysisJob.job_id}/retry`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to retry the analysis job.'))
      }

      const analysis = (await response.json()) as TrackAnalysisResponse
      await refreshStudioSnapshot().catch(() => null)
      setAnalysisState({
        phase: 'success',
        message: `Retried analysis with model ${analysis.latest_job.model_version} and stored a fresh score.`,
      })
    } catch (error) {
      setAnalysisState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to retry the analysis job.',
      })
    }
  }

  function updateArrangementPartMixer(
    partName: string,
    nextValue: Partial<ArrangementPlaybackMixerState>,
  ): void {
    setArrangementPartMixerState((current) => ({
      ...current,
      [partName]: current[partName]
        ? {
            ...current[partName],
            ...nextValue,
          }
        : {
            enabled: true,
            solo: false,
            volume: 0.8,
            ...nextValue,
          },
    }))
  }

  async function handlePlayArrangement(): Promise<void> {
    if (!selectedArrangement) {
      setArrangementTransportState({
        phase: 'error',
        message: 'Select an arrangement candidate before starting playback.',
      })
      return
    }

    const playableParts = selectedArrangement.parts_json.filter((part) => part.notes.length > 0)
    if (playableParts.length === 0) {
      setArrangementTransportState({
        phase: 'error',
        message: 'This arrangement does not contain playable notes yet.',
      })
      return
    }

    try {
      await stopArrangementPlayback()
      setArrangementPlaybackPositionMs(0)

      const controller = await startArrangementPlayback({
        parts: playableParts,
        mixerState: arrangementPartMixerState,
        guideModeEnabled,
        guideFocusPartName,
        onPositionChange: setArrangementPlaybackPositionMs,
        onEnded: () => {
          arrangementPlaybackRef.current = null
          setArrangementTransportState({
            phase: 'idle',
            message: 'Arrangement playback finished. Tweak parts or export from here.',
          })
        },
      })

      arrangementPlaybackRef.current = controller
      setArrangementTransportState({
        phase: 'playing',
        message: 'Playback is running through the separate arrangement preview engine.',
      })
    } catch (error) {
      setArrangementTransportState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Arrangement playback failed.',
      })
    }
  }

  function updateMixerTrack(trackId: string, nextValue: Partial<MixerTrackState>): void {
    const baseMixerState: MixerTrackState = {
      muted: false,
      solo: false,
      volume: 1,
    }

    setMixerState((current) => ({
      ...current,
      [trackId]: { ...(current[trackId] ?? baseMixerState), ...nextValue },
    }))
  }

  function isTrackMutedByMixer(trackId: string): boolean {
    const anySolo = Object.values(mixerState).some((entry) => entry.solo)
    const trackMixer = mixerState[trackId]
    if (!trackMixer) {
      return anySolo
    }

    if (trackMixer.muted) {
      return true
    }

    return anySolo && !trackMixer.solo
  }

  function getSelectedTakePlaybackUrl(track: TakeTrack | null): string | null {
    if (!track) {
      return null
    }

    return takePreviewUrls[track.track_id] ?? track.source_artifact_url ?? null
  }

  async function handleRenderMixdown(): Promise<void> {
    const selectedTakeTrack =
      takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
    const selectedTakeUrl = getSelectedTakePlaybackUrl(selectedTakeTrack)
    const mixdownSources = [
      ...(guide?.source_artifact_url && !isTrackMutedByMixer(guide.track_id)
        ? [
            {
              gain: guideMixer?.volume ?? 0.85,
              label: 'Guide',
              url: guide.source_artifact_url,
            },
          ]
        : []),
      ...(selectedTakeTrack && selectedTakeUrl && !isTrackMutedByMixer(selectedTakeTrack.track_id)
        ? [
            {
              gain: mixerState[selectedTakeTrack.track_id]?.volume ?? 1,
              label: `Take ${selectedTakeTrack.take_no ?? '?'}`,
              url: selectedTakeUrl,
            },
          ]
        : []),
    ]

    setMixdownPreviewState({ phase: 'submitting' })
    setMixdownSaveState({ phase: 'idle' })

    try {
      const renderedPreview = await renderOfflineMixdown(mixdownSources)
      const previewData = await buildAudioPreviewFromBlob(renderedPreview.blob)
      replaceMixdownPreview({
        ...renderedPreview,
        preview_data: previewData,
      })
      setMixdownPreviewState({
        phase: 'success',
        message: `Offline mixdown ready from ${renderedPreview.labels.join(' + ')}.`,
      })
    } catch (error) {
      replaceMixdownPreview(null)
      setMixdownPreviewState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Offline mixdown render failed.',
      })
    }
  }

  async function handleSaveMixdown(): Promise<void> {
    if (!projectId || !mixdownPreview) {
      setMixdownSaveState({
        phase: 'error',
        message: 'Render a local mixdown preview before saving it to the project.',
      })
      return
    }

    setMixdownSaveState({ phase: 'submitting' })

    try {
      const filename = `mixdown-${Date.now()}.wav`
      const initResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/mixdown/upload-url`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          content_type: 'audio/wav',
        }),
      })

      if (!initResponse.ok) {
        throw new Error(await readErrorMessage(initResponse, 'Mixdown upload could not start.'))
      }

      const uploadSession = (await initResponse.json()) as MixdownUploadInitResponse

      await uploadBlobWithProgress({
        url: uploadSession.upload_url,
        method: uploadSession.method,
        blob: mixdownPreview.blob,
        contentType: 'audio/wav',
      })

      const completeResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/mixdown/complete`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          track_id: uploadSession.track_id,
          source_format: 'audio/wav',
          duration_ms: mixdownPreview.durationMs,
          actual_sample_rate: mixdownPreview.actualSampleRate,
        }),
      })

      if (!completeResponse.ok) {
        throw new Error(
          await readErrorMessage(completeResponse, 'Mixdown upload could not be finalized.'),
        )
      }

      const savedMixdown = (await completeResponse.json()) as MixdownTrack
      setMixdownSummary(savedMixdown)
      await refreshStudioSnapshot().catch(() => null)
      setMixdownSaveState({
        phase: 'success',
        message: 'Mixdown saved to the project artifacts and refreshed in the studio snapshot.',
      })
    } catch (error) {
      setMixdownSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Mixdown save failed.',
      })
    }
  }

  async function uploadTakeForTrack(
    track: TakeTrack,
    upload: FailedTakeUpload,
  ): Promise<TakeTrack> {
    setActiveUploadTrackId(track.track_id)
    setTakeUploadProgress((current) => ({
      ...current,
      [track.track_id]: 0,
    }))

    try {
      const initResponse = await fetch(buildApiUrl(`/api/tracks/${track.track_id}/upload-url`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: upload.fileName,
          content_type: upload.contentType,
        }),
      })

      if (!initResponse.ok) {
        throw new Error(await readErrorMessage(initResponse, 'Take upload could not start.'))
      }

      const uploadSession = (await initResponse.json()) as TakeUploadInitResponse

      await uploadBlobWithProgress({
        url: uploadSession.upload_url,
        method: uploadSession.method,
        blob: upload.blob,
        contentType: upload.contentType,
        onProgress: (progress) =>
          setTakeUploadProgress((current) => ({
            ...current,
            [track.track_id]: progress,
          })),
      })

      const completeResponse = await fetch(buildApiUrl(`/api/tracks/${track.track_id}/complete`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_format: upload.contentType,
          duration_ms: upload.durationMs,
          actual_sample_rate: upload.actualSampleRate,
        }),
      })

      if (!completeResponse.ok) {
        throw new Error(
          await readErrorMessage(completeResponse, 'Take upload could not be finalized.'),
        )
      }

      const completedTake = (await completeResponse.json()) as TakeTrack
      setFailedTakeUploads((current) => {
        const next = { ...current }
        delete next[track.track_id]
        return next
      })
      return completedTake
    } finally {
      setActiveUploadTrackId(null)
    }
  }

  async function finalizeRecordedTake(
    blob: Blob,
    contentType: string,
    startedAt: Date,
    finishedAt: Date,
  ): Promise<void> {
    await cleanupRecordingResources()

    if (!projectId) {
      setRecordingState({
        phase: 'error',
        message: 'Project id is missing, so the take could not be saved.',
      })
      return
    }

    setRecordingState({
      phase: 'uploading',
      message: 'Creating a take record and uploading audio...',
    })

    const safeContentType = contentType || 'audio/webm'
    const extension = safeContentType.includes('ogg')
      ? 'ogg'
      : safeContentType.includes('mp4')
        ? 'm4a'
        : 'webm'
    const fileName = `take-${finishedAt.getTime()}.${extension}`
    const metadata = await extractAudioFileMetadata(
      new File([blob], fileName, { type: safeContentType }),
    )

    let createdTake: TakeTrack | null = null

    try {
      const createResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/tracks`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          part_type: 'LEAD',
          recording_started_at: startedAt.toISOString(),
          recording_finished_at: finishedAt.toISOString(),
        }),
      })

      if (!createResponse.ok) {
        throw new Error(await readErrorMessage(createResponse, 'Take creation failed.'))
      }

      const nextCreatedTake = (await createResponse.json()) as TakeTrack
      createdTake = nextCreatedTake
      setSelectedTakeId(nextCreatedTake.track_id)
      setTakePreviewUrl(nextCreatedTake.track_id, blob)
      void buildAudioPreviewFromBlob(blob)
        .then((preview) => {
          setAudioPreviews((current) => ({
            ...current,
            [nextCreatedTake.track_id]: preview,
          }))
        })
        .catch(() => undefined)
      setTakesState((current) => ({
        phase: 'ready',
        items: [
          nextCreatedTake,
          ...current.items.filter((item) => item.track_id !== nextCreatedTake.track_id),
        ],
      }))

      const completedTake = await uploadTakeForTrack(nextCreatedTake, {
        blob,
        fileName,
        contentType: safeContentType,
        durationMs: metadata.durationMs,
        actualSampleRate: metadata.actualSampleRate,
      })

      setTakesState((current) => ({
        phase: 'ready',
        items: current.items.map((item) =>
          item.track_id === completedTake.track_id ? completedTake : item,
        ),
      }))
      await refreshTakes().catch(() => undefined)
      setRecordingState({
        phase: 'success',
        message: `Take ${completedTake.take_no ?? '?'} uploaded and ready.`,
      })
    } catch (error) {
      if (createdTake) {
        const failedTake = createdTake
        setFailedTakeUploads((current) => ({
          ...current,
          [failedTake.track_id]: {
            blob,
            fileName,
            contentType: safeContentType,
            durationMs: metadata.durationMs,
            actualSampleRate: metadata.actualSampleRate,
          },
        }))
        await refreshTakes().catch(() => undefined)
        setRecordingState({
          phase: 'error',
          message: `Take ${failedTake.take_no ?? '?'} upload failed. Retry it or record a new take.`,
        })
        return
      }

      setRecordingState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Recording upload failed.',
      })
    }
  }

  async function handlePreviewMetronome(): Promise<void> {
    if (studioState.phase !== 'ready') {
      return
    }

    setMetronomePreviewState({ phase: 'submitting' })

    try {
      const accentEvery = getAccentEvery(studioState.project.time_signature)
      await playCountInSequence({
        bpm: studioState.project.bpm ?? 92,
        beats: countInBeats > 0 ? countInBeats : accentEvery,
        accentEvery,
      })
      setMetronomePreviewState({
        phase: 'success',
        message: 'Metronome preview finished.',
      })
    } catch (error) {
      setMetronomePreviewState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Metronome preview failed.',
      })
    }
  }

  async function handleStartRecording(): Promise<void> {
    if (studioState.phase !== 'ready') {
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingState({
        phase: 'error',
        message: 'getUserMedia is not available in this browser.',
      })
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      setRecordingState({
        phase: 'error',
        message: 'MediaRecorder is not available in this browser.',
      })
      return
    }

    try {
      const requestedConstraints = buildRequestedAudioConstraints(
        constraintDraft,
        selectedInputId,
      )
      const stream = await navigator.mediaDevices.getUserMedia(requestedConstraints)
      recordingStreamRef.current = stream

      if (countInBeats > 0) {
        setRecordingState({
          phase: 'counting-in',
          message: `Count-in ${countInBeats} beats...`,
        })
        await playCountInSequence({
          bpm: studioState.project.bpm ?? 92,
          beats: countInBeats,
          accentEvery: getAccentEvery(studioState.project.time_signature),
        })
      }

      const mimeType = pickSupportedRecordingMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      recordingChunksRef.current = []
      recordingMimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        void cleanupRecordingResources()
        setRecordingState({
          phase: 'error',
          message: 'The browser recorder reported an error.',
        })
      }
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || recordingMimeTypeRef.current,
        })
        const startedAt = recordingStartedAtRef.current ?? new Date()
        const finishedAt = new Date()
        void finalizeRecordedTake(
          blob,
          recorder.mimeType || recordingMimeTypeRef.current,
          startedAt,
          finishedAt,
        )
      }

      mediaRecorderRef.current = recorder
      recordingStartedAtRef.current = new Date()

      if (metronomeEnabled) {
        metronomeControllerRef.current = startMetronomeLoop({
          bpm: studioState.project.bpm ?? 92,
          beats: getAccentEvery(studioState.project.time_signature),
          accentEvery: getAccentEvery(studioState.project.time_signature),
        })
      }

      recorder.start(250)
      setRecordingState({
        phase: 'recording',
        message: 'Recording in progress. Stop when the take is done.',
      })
    } catch (error) {
      await cleanupRecordingResources()
      setRecordingState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to start recording.',
      })
    }
  }

  async function handleStopRecording(): Promise<void> {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return
    }

    await stopActiveMetronome()
    setRecordingState({
      phase: 'uploading',
      message: 'Stopping the take and preparing upload...',
    })
    recorder.stop()
  }

  async function handleRetryTakeUpload(track: TakeTrack): Promise<void> {
    const failedUpload = failedTakeUploads[track.track_id]
    if (!failedUpload) {
      return
    }

    setRecordingState({
      phase: 'uploading',
      message: `Retrying take ${track.take_no ?? '?'} upload...`,
    })

    try {
      const completedTake = await uploadTakeForTrack(track, failedUpload)
      setSelectedTakeId(track.track_id)
      void buildAudioPreviewFromBlob(failedUpload.blob)
        .then((preview) => {
          setAudioPreviews((current) => ({
            ...current,
            [track.track_id]: preview,
          }))
        })
        .catch(() => undefined)
      setTakesState((current) => ({
        phase: 'ready',
        items: current.items.map((item) =>
          item.track_id === completedTake.track_id ? completedTake : item,
        ),
      }))
      await refreshTakes().catch(() => undefined)
      setRecordingState({
        phase: 'success',
        message: `Take ${completedTake.take_no ?? '?'} uploaded and ready.`,
      })
    } catch (error) {
      setRecordingState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Retry upload failed. You can record a new take.',
      })
    }
  }

  async function handleRequestMicrophoneAccess(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState({
        phase: 'error',
        message: 'getUserMedia is not available in this browser.',
      })
      return
    }

    setPermissionState({ phase: 'requesting' })

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const [track] = permissionStream.getAudioTracks()
      const settings = track?.getSettings() ?? {}
      const serializedSettings = serializeTrackSettings(settings)

      setAppliedSettingsPreview(serializedSettings)
      await refreshAudioInputs(typeof settings.deviceId === 'string' ? settings.deviceId : undefined)

      permissionStream.getTracks().forEach((streamTrack) => streamTrack.stop())

      setPermissionState({
        phase: 'granted',
        message: 'Microphone access granted. Device labels are now available.',
      })
    } catch (error) {
      setPermissionState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Microphone permission request failed.',
      })
    }
  }

  async function handleSaveDeviceProfile(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSaveDeviceState({
        phase: 'error',
        message: 'getUserMedia is not available in this browser.',
      })
      return
    }

    setSaveDeviceState({ phase: 'submitting' })

    const requestedConstraints = buildRequestedAudioConstraints(
      constraintDraft,
      selectedInputId,
    )

    let captureStream: MediaStream | null = null
    let audioContext: AudioContext | null = null

    try {
      captureStream = await navigator.mediaDevices.getUserMedia(requestedConstraints)
      const track = captureStream.getAudioTracks()[0]
      const settings = track?.getSettings() ?? {}
      const serializedSettings = serializeTrackSettings(settings)
      setAppliedSettingsPreview(serializedSettings)

      audioContext = new AudioContext()
      const deviceHash = await hashValue(
        typeof settings.deviceId === 'string'
          ? settings.deviceId
          : selectedInputId || 'default-input',
      )

      const response = await fetch(buildApiUrl('/api/device-profiles'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          browser: detectBrowserName(navigator.userAgent),
          os: detectOsName(navigator.userAgent),
          input_device_hash: deviceHash,
          output_route: outputRoute,
          requested_constraints: requestedConstraints,
          applied_settings: serializedSettings,
          actual_sample_rate:
            pickNumber(settings.sampleRate) ?? pickNumber(audioContext.sampleRate),
          channel_count: pickNumber(settings.channelCount),
          input_latency_est: getTrackLatency(settings),
          base_latency: pickNumber(audioContext.baseLatency),
          output_latency: getAudioContextOutputLatency(audioContext),
          calibration_method: 'studio-device-panel',
          calibration_confidence: 0.25,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'DeviceProfile save failed.'))
      }

      const savedProfile = (await response.json()) as DeviceProfile
      hydrateDeviceDraft(savedProfile)
      setDeviceProfileState({ phase: 'ready', profile: savedProfile })
      await refreshStudioSnapshot().catch(() => null)
      setPermissionState({
        phase: 'granted',
        message: 'Microphone settings were captured and saved.',
      })
      setSaveDeviceState({
        phase: 'success',
        message: 'DeviceProfile saved with requested constraints and applied settings.',
      })
    } catch (error) {
      setSaveDeviceState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'DeviceProfile save failed.',
      })
    } finally {
      captureStream?.getTracks().forEach((streamTrack) => streamTrack.stop())
      await audioContext?.close().catch(() => undefined)
      await refreshAudioInputs(selectedInputId || undefined).catch(() => undefined)
    }
  }

  async function handleGuideUpload(): Promise<void> {
    if (!projectId) {
      setGuideUploadState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    if (!guideFile) {
      setGuideUploadState({ phase: 'error', message: 'Pick a guide audio file first.' })
      return
    }

    setGuideUploadState({ phase: 'submitting' })

    try {
      const initResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/guide/upload-url`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: guideFile.name,
          content_type: guideFile.type || null,
        }),
      })

      if (!initResponse.ok) {
        throw new Error(await readErrorMessage(initResponse, 'Guide upload could not start.'))
      }

      const uploadSession = (await initResponse.json()) as GuideUploadInitResponse
      const uploadResponse = await fetch(uploadSession.upload_url, {
        method: uploadSession.method,
        headers: guideFile.type
          ? {
              'Content-Type': guideFile.type,
            }
          : undefined,
        body: guideFile,
      })

      if (!uploadResponse.ok) {
        throw new Error(await readErrorMessage(uploadResponse, 'Guide file upload failed.'))
      }

      const metadata = await extractAudioFileMetadata(guideFile)
      const completeResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/guide/complete`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          track_id: uploadSession.track_id,
          source_format: guideFile.type || null,
          duration_ms: metadata.durationMs,
          actual_sample_rate: metadata.actualSampleRate,
        }),
      })

      if (!completeResponse.ok) {
        throw new Error(
          await readErrorMessage(completeResponse, 'Guide track could not be finalized.'),
        )
      }

      const guide = (await completeResponse.json()) as GuideTrack
      setGuideState({ phase: 'ready', guide })
      await refreshStudioSnapshot().catch(() => null)
      setGuideUploadState({
        phase: 'success',
        message: 'Guide uploaded, finalized, and attached to this project.',
      })
      setGuideFile(null)
      if (guideFileInputRef.current) {
        guideFileInputRef.current.value = ''
      }
    } catch (error) {
      setGuideUploadState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Guide upload failed.',
      })
    }
  }

  if (studioState.phase === 'loading') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>Loading project</h1>
          <p className="panel__summary">
            Pulling the project foundation state before the recording workflow opens.
          </p>
        </section>
      </div>
    )
  }

  if (studioState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>Studio unavailable</h1>
          <p className="form-error">{studioState.message}</p>
          <Link className="back-link" to="/">
            Back to projects
          </Link>
        </section>
      </div>
    )
  }

  const { project } = studioState
  const latestProfile = deviceProfileState.profile
  const guide = guideState.guide
  const inputSelectionDisabled =
    permissionState.phase === 'requesting' || saveDeviceState.phase === 'submitting'
  const transportBpm = project.bpm ?? 92
  const transportAccentEvery = getAccentEvery(project.time_signature)
  const selectedTake =
    takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
  const selectedTakePreview = selectedTake ? audioPreviews[selectedTake.track_id] ?? null : null
  const selectedTakePlaybackUrl = getSelectedTakePlaybackUrl(selectedTake)
  const selectedTakeScore = selectedTake?.latest_score ?? null
  const selectedTakeAnalysisJob = selectedTake?.latest_analysis_job ?? null
  const selectedTakeMelody = selectedTake?.latest_melody ?? null
  const selectedArrangement =
    arrangements.find((item) => item.arrangement_id === selectedArrangementId) ?? arrangements[0] ?? null
  const selectedDifficultyMeta = getOptionMeta(
    arrangementDifficultyOptions,
    arrangementConfig.difficulty,
  )
  const selectedVoiceRangeMeta = getOptionMeta(
    voiceRangePresetOptions,
    arrangementConfig.voiceRangePreset,
  )
  const selectedBeatboxMeta = getOptionMeta(
    beatboxTemplateOptions,
    arrangementConfig.beatboxTemplate,
  )
  const arrangementDurationMs = selectedArrangement
    ? getArrangementDurationMs(selectedArrangement.parts_json)
    : 0
  const arrangementPlaybackRatio =
    arrangementDurationMs > 0
      ? Math.min(1, arrangementPlaybackPositionMs / arrangementDurationMs)
      : 0
  const guideMixer = guide ? mixerState[guide.track_id] : null
  const guideWavExportUrl = guide?.guide_wav_artifact_url ?? null
  const mixdownPlaybackUrl = mixdownPreview?.url ?? mixdownSummary?.source_artifact_url ?? null
  const mixdownSourceLabel = mixdownPreview
    ? 'Local offline render'
    : mixdownSummary
      ? 'Saved project artifact'
      : 'Not generated yet'
  const mixdownPreviewSource =
    mixdownPreview?.preview_data ?? mixdownSummary?.preview_data ?? null
  const isRecordingBusy =
    recordingState.phase === 'counting-in' ||
    recordingState.phase === 'recording' ||
    recordingState.phase === 'uploading'

  return (
    <div className="page-shell">
      <section className="panel studio-panel">
        <div className="studio-header">
          <div>
            <p className="eyebrow">Studio Foundation</p>
            <h1>{project.title}</h1>
            <p className="panel__summary">
              This studio entry follows the PROJECT_FOUNDATION sequence: attach a guide,
              capture real microphone settings, then move into recording-ready flows.
            </p>
          </div>

          <Link className="back-link" to="/">
            Create another project
          </Link>
        </div>

        <div className="meta-grid">
          <article className="info-card">
            <h3>Project metadata</h3>
            <dl className="studio-meta">
              <div>
                <dt>ID</dt>
                <dd>{project.project_id}</dd>
              </div>
              <div>
                <dt>BPM</dt>
                <dd>{project.bpm ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Base key</dt>
                <dd>{project.base_key ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Time signature</dt>
                <dd>{project.time_signature ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{project.mode ?? 'practice'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(project.created_at)}</dd>
              </div>
            </dl>
          </article>

          <article className="info-card">
            <h3>Current lane tickets</h3>
            <ul>
              {currentLaneTickets.map((ticket) => (
                <li key={ticket}>{ticket}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">FE-02 and FE-03</p>
          <h2>Audio setup and guide connection</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Device Panel</p>
                <h2>Request mic access and save a DeviceProfile</h2>
              </div>
              <span
                className={`status-pill ${
                  permissionState.phase === 'granted'
                    ? 'status-pill--ready'
                    : permissionState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {permissionState.phase === 'granted'
                  ? 'Mic ready'
                  : permissionState.phase === 'error'
                    ? 'Mic blocked'
                    : permissionState.phase === 'requesting'
                      ? 'Requesting'
                      : 'Mic not requested'}
              </span>
            </div>

            <p className="panel__summary">
              Foundation rule: store the requested constraints and the real
              <code>getSettings()</code> result so later scoring work can explain device
              behavior instead of guessing it.
            </p>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={permissionState.phase === 'requesting'}
                onClick={() => void handleRequestMicrophoneAccess()}
              >
                {permissionState.phase === 'requesting'
                  ? 'Requesting access...'
                  : 'Request microphone access'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshAudioInputs().catch(() => undefined)}
              >
                Refresh input list
              </button>
            </div>

            {permissionState.phase === 'granted' || permissionState.phase === 'error' ? (
              <p
                className={
                  permissionState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {permissionState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                Grant access once so browser labels and live settings become visible.
              </p>
            )}

            <div className="field-grid">
              <label className="field">
                <span>Input device</span>
                <select
                  className="text-input"
                  value={selectedInputId}
                  disabled={inputSelectionDisabled || audioInputs.length === 0}
                  onChange={(event) => setSelectedInputId(event.target.value)}
                >
                  {audioInputs.length === 0 ? (
                    <option value="">No microphone detected yet</option>
                  ) : null}
                  {audioInputs.map((device, index) => (
                    <option key={device.deviceId || `audio-input-${index}`} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Output route</span>
                <select
                  className="text-input"
                  value={outputRoute}
                  onChange={(event) => setOutputRoute(event.target.value)}
                >
                  {outputRouteOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="toggle-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.echoCancellation}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      echoCancellation: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>echoCancellation</strong>
                  <span>Request browser echo control and capture what actually applies.</span>
                </div>
              </label>

              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.autoGainControl}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      autoGainControl: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>autoGainControl</strong>
                  <span>Keep AGC visible so later pitch scoring can account for device behavior.</span>
                </div>
              </label>

              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.noiseSuppression}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      noiseSuppression: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>noiseSuppression</strong>
                  <span>Track whether vocal input is being denoised by the browser stack.</span>
                </div>
              </label>
            </div>

            <label className="field field--compact">
              <span>Requested channel count</span>
              <input
                className="text-input"
                type="number"
                min={1}
                max={2}
                value={constraintDraft.channelCount}
                onChange={(event) =>
                  setConstraintDraft((current) => ({
                    ...current,
                    channelCount: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />
            </label>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={saveDeviceState.phase === 'submitting'}
                onClick={() => void handleSaveDeviceProfile()}
              >
                {saveDeviceState.phase === 'submitting'
                  ? 'Saving profile...'
                  : 'Save DeviceProfile'}
              </button>
            </div>

            {saveDeviceState.phase === 'success' || saveDeviceState.phase === 'error' ? (
              <p
                className={
                  saveDeviceState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {saveDeviceState.message}
              </p>
            ) : null}

            <div className="json-grid">
              <div>
                <p className="json-label">Requested constraints</p>
                <pre className="json-card">
                  {toPrettyJson({
                    audio: {
                      echoCancellation: constraintDraft.echoCancellation,
                      autoGainControl: constraintDraft.autoGainControl,
                      noiseSuppression: constraintDraft.noiseSuppression,
                      channelCount: constraintDraft.channelCount,
                      ...(selectedInputId ? { deviceId: { exact: selectedInputId } } : {}),
                    },
                  })}
                </pre>
              </div>

              <div>
                <p className="json-label">Latest getSettings() snapshot</p>
                <pre className="json-card">{toPrettyJson(appliedSettingsPreview)}</pre>
              </div>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Latest profile</span>
                <strong>
                  {deviceProfileState.phase === 'loading'
                    ? 'Loading...'
                    : latestProfile
                      ? formatDate(latestProfile.updated_at)
                      : 'No saved profile yet'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Actual sample rate</span>
                <strong>{latestProfile?.actual_sample_rate ?? 'Unknown'}</strong>
              </div>
              <div className="mini-card">
                <span>Channel count</span>
                <strong>{latestProfile?.channel_count ?? 'Unknown'}</strong>
              </div>
              <div className="mini-card">
                <span>Output route</span>
                <strong>{latestProfile?.output_route ?? outputRoute}</strong>
              </div>
            </div>

            {deviceProfileState.phase === 'error' ? (
              <p className="form-error">{deviceProfileState.message}</p>
            ) : null}

            {latestProfile ? (
              <div className="support-stack">
                <p className="json-label">Saved applied settings</p>
                <pre className="json-card">
                  {toPrettyJson(latestProfile.applied_settings_json)}
                </pre>
              </div>
            ) : null}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Guide Track</p>
                <h2>Upload one guide and keep it playable</h2>
              </div>
              <span
                className={`status-pill ${
                  guide
                    ? 'status-pill--ready'
                    : guideState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {guide
                  ? 'Guide connected'
                  : guideState.phase === 'error'
                    ? 'Guide error'
                    : 'Guide pending'}
              </span>
            </div>

            <p className="panel__summary">
              The backend upload lifecycle for SC-03 and BE-02 is active here:
              initialize track, upload bytes, finalize, then expose the latest guide for
              playback.
            </p>

            <label className="field">
              <span>Guide audio file</span>
              <input
                ref={guideFileInputRef}
                className="text-input"
                type="file"
                accept="audio/*"
                onChange={(event) => setGuideFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {guideFile ? (
              <p className="status-card__hint">
                Ready to upload: {guideFile.name} ({Math.round(guideFile.size / 1024)} KB)
              </p>
            ) : (
              <p className="status-card__hint">
                Pick a guide file to create the first source track for this project.
              </p>
            )}

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={guideUploadState.phase === 'submitting' || guideFile === null}
                onClick={() => void handleGuideUpload()}
              >
                {guideUploadState.phase === 'submitting'
                  ? 'Uploading guide...'
                  : 'Upload guide'}
              </button>
            </div>

            {guideUploadState.phase === 'success' || guideUploadState.phase === 'error' ? (
              <p
                className={
                  guideUploadState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {guideUploadState.message}
              </p>
            ) : null}

            {guideState.phase === 'error' ? <p className="form-error">{guideState.message}</p> : null}

            {guide ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Status</span>
                    <strong>{guide.track_status}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Format</span>
                    <strong>{guide.source_format ?? 'Unknown'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(guide.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Sample rate</span>
                    <strong>{guide.actual_sample_rate ?? 'Unknown'}</strong>
                  </div>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>Storage key</span>
                  <strong>{guide.storage_key ?? 'Not set'}</strong>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>Checksum</span>
                  <strong>{guide.checksum ?? 'Not available'}</strong>
                </div>

                {guide.failure_message ? (
                  <p className="form-error">{guide.failure_message}</p>
                ) : null}

                {guide.source_artifact_url ? (
                  <div className="audio-preview">
                    <p className="json-label">Guide playback</p>
                    <ManagedAudioPlayer
                      muted={guide ? isTrackMutedByMixer(guide.track_id) : false}
                      src={guide.source_artifact_url}
                      volume={guideMixer?.volume ?? 0.85}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No guide has been attached to this project yet.</p>
                <p>Upload one guide so recording, comparison, and mixdown flows share the same base track.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">FE-03 and FE-04</p>
          <h2>Transport prep and take recording</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Transport</p>
                <h2>Set tempo, count-in, and metronome before recording</h2>
              </div>
              <span
                className={`status-pill ${
                  metronomeEnabled ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {metronomeEnabled ? 'Metronome on' : 'Metronome off'}
              </span>
            </div>

            <p className="panel__summary">
              FE-03 calls for guide playback plus toggles that let the singer prepare before
              recording. Tempo, key, metronome, and count-in stay visible in one place here.
            </p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Tempo</span>
                <strong>{transportBpm} BPM</strong>
              </div>
              <div className="mini-card">
                <span>Key</span>
                <strong>{project.base_key ?? 'Unset'}</strong>
              </div>
              <div className="mini-card">
                <span>Time signature</span>
                <strong>{project.time_signature ?? '4/4'}</strong>
              </div>
              <div className="mini-card">
                <span>Accent cycle</span>
                <strong>{transportAccentEvery} beats</strong>
              </div>
            </div>

            <div className="toggle-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={metronomeEnabled}
                  onChange={(event) => setMetronomeEnabled(event.target.checked)}
                />
                <div>
                  <strong>Metronome during recording</strong>
                  <span>Keep guide tempo in the headphones while a take is being captured.</span>
                </div>
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Count-in length</span>
                <select
                  className="text-input"
                  value={countInBeats}
                  onChange={(event) => setCountInBeats(Number(event.target.value))}
                >
                  <option value={0}>Off</option>
                  <option value={2}>2 beats</option>
                  <option value={4}>4 beats</option>
                  <option value={8}>8 beats</option>
                </select>
              </label>

              <label className="field">
                <span>Selected take</span>
                <input
                  className="text-input"
                  value={selectedTake ? `Take ${selectedTake.take_no ?? '?'}` : 'No take yet'}
                  readOnly
                />
              </label>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={metronomePreviewState.phase === 'submitting'}
                onClick={() => void handlePreviewMetronome()}
              >
                {metronomePreviewState.phase === 'submitting'
                  ? 'Playing preview...'
                  : 'Preview metronome'}
              </button>
            </div>

            {metronomePreviewState.phase === 'success' || metronomePreviewState.phase === 'error' ? (
              <p
                className={
                  metronomePreviewState.phase === 'error'
                    ? 'form-error'
                    : 'status-card__hint'
                }
              >
                {metronomePreviewState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                Use preview to sanity-check beat feel before the next take.
              </p>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Recorder</p>
                <h2>Capture repeated takes and upload them with status</h2>
              </div>
              <span
                className={`status-pill ${
                  recordingState.phase === 'recording' || recordingState.phase === 'success'
                    ? 'status-pill--ready'
                    : recordingState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {recordingState.phase}
              </span>
            </div>

            <p className="panel__summary">
              FE-04 closes the loop here: start recording, stop recording, create a take,
              upload audio, keep progress visible, and retry failed uploads without losing the
              take slot.
            </p>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={isRecordingBusy}
                onClick={() => void handleStartRecording()}
              >
                {recordingState.phase === 'counting-in'
                  ? 'Counting in...'
                  : recordingState.phase === 'uploading'
                    ? 'Uploading...'
                    : 'Start take'}
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={recordingState.phase !== 'recording'}
                onClick={() => void handleStopRecording()}
              >
                Stop take
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshTakes().catch(() => undefined)}
              >
                Refresh take list
              </button>
            </div>

            <p
              className={
                recordingState.phase === 'error' ? 'form-error' : 'status-card__hint'
              }
            >
              {recordingState.message}
            </p>

            <div className="take-summary-grid">
              <div className="mini-card">
                <span>Take count</span>
                <strong>{takesState.items.length}</strong>
              </div>
              <div className="mini-card">
                <span>Latest ready take</span>
                <strong>
                  {takesState.items.find((take) => take.track_status === 'READY')?.take_no ??
                    'None'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Failed retries</span>
                <strong>{Object.keys(failedTakeUploads).length}</strong>
              </div>
              <div className="mini-card">
                <span>Active upload</span>
                <strong>{activeUploadTrackId ? 'Yes' : 'No'}</strong>
              </div>
            </div>

            {takesState.phase === 'error' ? <p className="form-error">{takesState.message}</p> : null}

            <div className="take-list">
              {takesState.items.length === 0 ? (
                <div className="empty-card">
                  <p>No takes yet.</p>
                  <p>Record one take to open the upload and retry flow.</p>
                </div>
              ) : (
                takesState.items.map((take) => {
                  const failedUpload = failedTakeUploads[take.track_id]
                  const progress = takeUploadProgress[take.track_id]
                  const previewUrl = take.source_artifact_url ?? takePreviewUrls[take.track_id] ?? null

                  return (
                    <article
                      className={`take-card ${
                        selectedTake?.track_id === take.track_id ? 'take-card--selected' : ''
                      }`}
                      key={take.track_id}
                    >
                      <div className="take-card__header">
                        <div>
                          <h3>Take {take.take_no ?? '?'}</h3>
                          <p className="take-card__subhead">
                            {take.part_type ?? 'LEAD'} | {take.track_status}
                          </p>
                        </div>

                        <button
                          className="button-secondary button-secondary--small"
                          type="button"
                          onClick={() => setSelectedTakeId(take.track_id)}
                        >
                          Select
                        </button>
                      </div>

                      <div className="mini-grid">
                        <div className="mini-card">
                          <span>Recorded</span>
                          <strong>
                            {take.recording_finished_at
                              ? formatDate(take.recording_finished_at)
                              : 'Unknown'}
                          </strong>
                        </div>
                        <div className="mini-card">
                          <span>Duration</span>
                          <strong>{formatDuration(take.duration_ms)}</strong>
                        </div>
                      </div>

                      {typeof progress === 'number' && progress < 100 ? (
                        <div className="progress-stack">
                          <div className="progress-bar" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <p className="status-card__hint">Upload progress: {progress}%</p>
                        </div>
                      ) : null}

                      {previewUrl ? (
                        <div className="audio-preview">
                          <p className="json-label">Take preview</p>
                          <ManagedAudioPlayer
                            muted={isTrackMutedByMixer(take.track_id)}
                            src={previewUrl}
                            volume={mixerState[take.track_id]?.volume ?? 1}
                          />
                        </div>
                      ) : null}

                      {failedUpload ? (
                        <div className="support-stack">
                          <p className="form-error">
                            Upload was not completed for this take. Retry the same audio or
                            record another one.
                          </p>
                          <div className="button-row">
                            <button
                              className="button-primary"
                              type="button"
                              disabled={activeUploadTrackId === take.track_id}
                              onClick={() => void handleRetryTakeUpload(take)}
                            >
                              {activeUploadTrackId === take.track_id
                                ? 'Retrying...'
                                : 'Retry upload'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">BE-05, FE-05, FE-06</p>
          <h2>Studio snapshot, track lane, and preview</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Track Lane</p>
                <h2>Manage guide and takes from one mixer view</h2>
              </div>
              <span className="status-pill status-pill--ready">
                {guide ? takesState.items.length + 1 : takesState.items.length} tracks
              </span>
            </div>

            <p className="panel__summary">
              This panel is driven by the studio snapshot endpoint so the studio can reload
              guide state, take state, the latest DeviceProfile, and mixdown presence in one
              request.
            </p>

            <div className="track-lane">
              {guide ? (
                <div className="track-row">
                  <div className="track-row__meta">
                    <strong>Guide</strong>
                    <span>{guide.track_status}</span>
                  </div>

                  <div className="track-row__controls">
                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() =>
                        updateMixerTrack(guide.track_id, {
                          muted: !(mixerState[guide.track_id]?.muted ?? false),
                        })
                      }
                    >
                      {(mixerState[guide.track_id]?.muted ?? false) ? 'Unmute' : 'Mute'}
                    </button>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() =>
                        updateMixerTrack(guide.track_id, {
                          solo: !(mixerState[guide.track_id]?.solo ?? false),
                        })
                      }
                    >
                      {(mixerState[guide.track_id]?.solo ?? false) ? 'Unsolo' : 'Solo'}
                    </button>

                    <label className="track-row__slider">
                      <span>Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={mixerState[guide.track_id]?.volume ?? 0.85}
                        onChange={(event) =>
                          updateMixerTrack(guide.track_id, {
                            volume: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {takesState.items.map((take) => (
                <div
                  className={`track-row ${
                    selectedTake?.track_id === take.track_id ? 'track-row--selected' : ''
                  }`}
                  key={`track-lane-${take.track_id}`}
                >
                  <div className="track-row__meta">
                    <strong>Take {take.take_no ?? '?'}</strong>
                    <span>{take.track_status}</span>
                  </div>

                  <div className="track-row__controls">
                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => setSelectedTakeId(take.track_id)}
                    >
                      {selectedTake?.track_id === take.track_id ? 'Selected' : 'Select'}
                    </button>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() =>
                        updateMixerTrack(take.track_id, {
                          muted: !(mixerState[take.track_id]?.muted ?? false),
                        })
                      }
                    >
                      {(mixerState[take.track_id]?.muted ?? false) ? 'Unmute' : 'Mute'}
                    </button>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() =>
                        updateMixerTrack(take.track_id, {
                          solo: !(mixerState[take.track_id]?.solo ?? false),
                        })
                      }
                    >
                      {(mixerState[take.track_id]?.solo ?? false) ? 'Unsolo' : 'Solo'}
                    </button>

                    <label className="track-row__slider">
                      <span>Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={mixerState[take.track_id]?.volume ?? 1}
                        onChange={(event) =>
                          updateMixerTrack(take.track_id, {
                            volume: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Snapshot guide</span>
                <strong>{guide ? guide.track_status : 'Missing'}</strong>
              </div>
              <div className="mini-card">
                <span>Snapshot takes</span>
                <strong>{takesState.items.length}</strong>
              </div>
              <div className="mini-card">
                <span>Latest DeviceProfile</span>
                <strong>{latestProfile ? formatDate(latestProfile.updated_at) : 'Missing'}</strong>
              </div>
              <div className="mini-card">
                <span>Mixdown</span>
                <strong>{mixdownSummary ? mixdownSummary.track_status : 'Not created yet'}</strong>
              </div>
            </div>
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Waveform</p>
                <h2>Preview the selected take immediately and after reload</h2>
              </div>
              <span
                className={`status-pill ${
                  waveformState.phase === 'success'
                    ? 'status-pill--ready'
                    : waveformState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {waveformState.phase === 'success'
                  ? 'Preview ready'
                  : waveformState.phase === 'error'
                    ? 'Preview error'
                    : waveformState.phase === 'submitting'
                      ? 'Loading preview'
                      : 'Preview idle'}
              </span>
            </div>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Selected take</span>
                    <strong>Take {selectedTake.take_no ?? '?'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Status</span>
                    <strong>{selectedTake.track_status}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(selectedTake.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Source</span>
                    <strong>
                      {selectedTakePreview
                        ? selectedTakePreview.source === 'local'
                          ? 'Latest local blob'
                          : 'Stored server audio'
                        : 'Waiting for preview'}
                    </strong>
                  </div>
                </div>

                {selectedTake.failure_message ? (
                  <p className="form-error">{selectedTake.failure_message}</p>
                ) : null}

                {waveformState.phase === 'error' ? (
                  <p className="form-error">{waveformState.message}</p>
                ) : (
                  <p className="status-card__hint">
                    {waveformState.phase === 'success'
                      ? waveformState.message
                      : 'Preview generation starts from the recorded blob, then falls back to stored audio on reload.'}
                  </p>
                )}

                {selectedTakePreview ? (
                  <WaveformPreview preview={selectedTakePreview} />
                ) : (
                  <div className="empty-card">
                    <p>No waveform preview is available yet.</p>
                    <p>Record a take or select one with stored source audio to generate it.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-card">
                <p>No take is selected.</p>
                <p>Select a take from the lane to inspect its waveform and contour.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 2</p>
          <h2>Post-recording alignment and scoring</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Alignment Engine</p>
                <h2>Run coarse/fine alignment and score the selected take</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeAnalysisJob?.status === 'SUCCEEDED'
                    ? 'status-pill--ready'
                    : analysisState.phase === 'error' || selectedTakeAnalysisJob?.status === 'FAILED'
                      ? 'status-pill--error'
                      : analysisState.phase === 'submitting'
                        ? 'status-pill--loading'
                        : 'status-pill--loading'
                }`}
              >
                {analysisState.phase === 'submitting'
                  ? 'Analyzing'
                  : selectedTakeAnalysisJob?.status ?? 'Not analyzed'}
              </span>
            </div>

            <p className="panel__summary">
              PROJECT_FOUNDATION puts post-recording alignment ahead of real-time scoring.
              This pass stores alignment confidence, three score axes, and segment feedback
              back into the studio snapshot.
            </p>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Selected take</span>
                    <strong>Take {selectedTake.take_no ?? '?'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Alignment confidence</span>
                    <strong>{formatConfidence(selectedTake.alignment_confidence)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Offset estimate</span>
                    <strong>{formatOffsetMs(selectedTake.alignment_offset_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Latest job</span>
                    <strong>{selectedTakeAnalysisJob?.status ?? 'Not started'}</strong>
                  </div>
                </div>

                <div className="score-grid">
                  <div className="score-card">
                    <span>Pitch</span>
                    <strong>{formatPercent(selectedTakeScore?.pitch_score ?? null)}</strong>
                  </div>
                  <div className="score-card">
                    <span>Rhythm</span>
                    <strong>{formatPercent(selectedTakeScore?.rhythm_score ?? null)}</strong>
                  </div>
                  <div className="score-card">
                    <span>Harmony fit</span>
                    <strong>{formatPercent(selectedTakeScore?.harmony_fit_score ?? null)}</strong>
                  </div>
                  <div className="score-card score-card--highlight">
                    <span>Total</span>
                    <strong>{formatPercent(selectedTakeScore?.total_score ?? null)}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    className="button-primary"
                    type="button"
                    disabled={analysisState.phase === 'submitting'}
                    onClick={() => void handleRunAnalysis()}
                  >
                    {analysisState.phase === 'submitting'
                      ? 'Running analysis...'
                      : 'Run post-recording analysis'}
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    disabled={
                      selectedTakeAnalysisJob?.status !== 'FAILED' ||
                      analysisState.phase === 'submitting'
                    }
                    onClick={() => void handleRetryAnalysisJob()}
                  >
                    Retry failed job
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
                  >
                    Refresh snapshot
                  </button>
                </div>

                {analysisState.phase === 'success' || analysisState.phase === 'error' ? (
                  <p
                    className={
                      analysisState.phase === 'error' ? 'form-error' : 'status-card__hint'
                    }
                  >
                    {analysisState.message}
                  </p>
                ) : selectedTakeAnalysisJob ? (
                  <div className="support-stack">
                    <p
                      className={
                        selectedTakeAnalysisJob.status === 'FAILED'
                          ? 'form-error'
                          : 'status-card__hint'
                      }
                    >
                      Latest job used model {selectedTakeAnalysisJob.model_version} at{' '}
                      {formatDate(selectedTakeAnalysisJob.requested_at)}.
                    </p>
                    {selectedTakeAnalysisJob.error_message ? (
                      <p className="form-error">{selectedTakeAnalysisJob.error_message}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="status-card__hint">
                    Run analysis after recording so the studio can store alignment confidence,
                    pitch, rhythm, harmony-fit, and segment feedback.
                  </p>
                )}
              </div>
            ) : (
              <div className="empty-card">
                <p>No take is selected.</p>
                <p>Select a take before running post-recording analysis.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Feedback JSON</p>
                <h2>Inspect phrase-by-phrase feedback from the latest score</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeScore ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {selectedTakeScore
                  ? `${selectedTakeScore.feedback_json.length} phrases`
                  : 'Waiting for score'}
              </span>
            </div>

            {selectedTakeScore ? (
              <div className="feedback-list">
                {selectedTakeScore.feedback_json.map((item) => (
                  <article className="feedback-card" key={`${selectedTakeScore.score_id}-${item.segment_index}`}>
                    <div className="feedback-card__header">
                      <strong>
                        Phrase {item.segment_index + 1}:{' '}
                        {formatDuration(item.start_ms).replace(' sec', '')} -{' '}
                        {formatDuration(item.end_ms).replace(' sec', '')}
                      </strong>
                      <span>{item.end_ms - item.start_ms} ms</span>
                    </div>

                    <div className="feedback-card__scores">
                      <span>Pitch {item.pitch_score.toFixed(1)}</span>
                      <span>Rhythm {item.rhythm_score.toFixed(1)}</span>
                      <span>Harmony {item.harmony_fit_score.toFixed(1)}</span>
                    </div>

                    <p>{item.message}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-card">
                <p>No score feedback is available yet.</p>
                <p>Run post-recording analysis to store the feedback JSON in the project.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 3</p>
          <h2>Audio-to-MIDI melody draft</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Melody Extraction</p>
                <h2>Turn the selected take into a quantized melody draft</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeMelody
                    ? 'status-pill--ready'
                    : melodyState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {melodyState.phase === 'submitting'
                  ? 'Extracting'
                  : selectedTakeMelody
                    ? 'Draft ready'
                    : 'No draft'}
              </span>
            </div>

            <p className="panel__summary">
              PROJECT_FOUNDATION puts melody extraction after scoring: build a usable MIDI
              draft, quantize it to the project grid, estimate the key, and leave the note
              list editable before arrangement starts.
            </p>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Selected take</span>
                    <strong>Take {selectedTake.take_no ?? '?'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Key estimate</span>
                    <strong>{selectedTakeMelody?.key_estimate ?? 'Pending'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Grid</span>
                    <strong>{selectedTakeMelody?.grid_division ?? '1/16 draft'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Notes</span>
                    <strong>{selectedTakeMelody?.note_count ?? 0}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    className="button-primary"
                    type="button"
                    disabled={melodyState.phase === 'submitting'}
                    onClick={() => void handleExtractMelody()}
                  >
                    {melodyState.phase === 'submitting'
                      ? 'Extracting melody...'
                      : 'Extract melody draft'}
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    disabled={selectedTakeMelody === null || melodySaveState.phase === 'submitting'}
                    onClick={() => void handleSaveMelodyDraft()}
                  >
                    {melodySaveState.phase === 'submitting' ? 'Saving draft...' : 'Save note edits'}
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    onClick={handleAddMelodyNote}
                  >
                    Add note
                  </button>

                  {selectedTakeMelody?.midi_artifact_url ? (
                    <a
                      className="button-secondary"
                      href={selectedTakeMelody.midi_artifact_url}
                    >
                      Download MIDI
                    </a>
                  ) : null}
                </div>

                {melodyState.phase === 'success' || melodyState.phase === 'error' ? (
                  <p
                    className={melodyState.phase === 'error' ? 'form-error' : 'status-card__hint'}
                  >
                    {melodyState.message}
                  </p>
                ) : (
                  <p className="status-card__hint">
                    Extract once to generate a quantized note draft and downloadable MIDI file
                    for this take.
                  </p>
                )}

                {melodySaveState.phase === 'success' || melodySaveState.phase === 'error' ? (
                  <p
                    className={
                      melodySaveState.phase === 'error' ? 'form-error' : 'status-card__hint'
                    }
                  >
                    {melodySaveState.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No take is selected.</p>
                <p>Select a take before extracting a melody draft.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Melody Editor</p>
                <h2>Review and adjust quantized notes before arrangement</h2>
              </div>
              <span
                className={`status-pill ${
                  melodyNotesDraft.length > 0 ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {melodyNotesDraft.length} notes
              </span>
            </div>

            {melodyNotesDraft.length > 0 ? (
              <div className="melody-note-list">
                {melodyNotesDraft.map((note, index) => (
                  <div className="melody-note-row" key={`melody-note-${index}`}>
                    <label>
                      <span>Pitch</span>
                      <input
                        className="text-input"
                        min={0}
                        max={127}
                        type="number"
                        value={note.pitch_midi}
                        onChange={(event) =>
                          updateMelodyNote(index, 'pitch_midi', Number(event.target.value))
                        }
                      />
                    </label>

                    <label>
                      <span>Start</span>
                      <input
                        className="text-input"
                        min={0}
                        type="number"
                        value={note.start_ms}
                        onChange={(event) =>
                          updateMelodyNote(index, 'start_ms', Number(event.target.value))
                        }
                      />
                    </label>

                    <label>
                      <span>End</span>
                      <input
                        className="text-input"
                        min={1}
                        type="number"
                        value={note.end_ms}
                        onChange={(event) =>
                          updateMelodyNote(index, 'end_ms', Number(event.target.value))
                        }
                      />
                    </label>

                    <label>
                      <span>Phrase</span>
                      <input
                        className="text-input"
                        min={0}
                        type="number"
                        value={note.phrase_index}
                        onChange={(event) =>
                          updateMelodyNote(index, 'phrase_index', Number(event.target.value))
                        }
                      />
                    </label>

                    <div className="melody-note-meta">
                      <strong>{note.pitch_name}</strong>
                      <span>{note.duration_ms} ms</span>
                    </div>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => handleRemoveMelodyNote(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-card">
                <p>No melody notes are loaded yet.</p>
                <p>Extract a melody draft to review the quantized note list here.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 4</p>
          <h2>Rule-based arrangement candidates</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Arrangement Engine</p>
                <h2>Generate candidate A/B/C from the latest melody draft</h2>
              </div>
              <span
                className={`status-pill ${
                  arrangements.length > 0
                    ? 'status-pill--ready'
                    : arrangementState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {arrangementState.phase === 'submitting'
                  ? 'Generating'
                  : arrangements.length > 0
                    ? `${arrangements.length} candidates`
                    : 'No candidates'}
              </span>
            </div>

            <p className="panel__summary">
              FOUNDATION Phase 5 asks for 2-3 arrangement candidates with range, leap, and
              parallel-motion constraints. Phase 8 polish adds difficulty presets, voice-range
              presets, and 3-5 beatbox template choices so the compare pass feels closer to the
              roadmap.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>Style</span>
                <select
                  className="text-input"
                  value={arrangementConfig.style}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({
                      ...current,
                      style: event.target.value,
                    }))
                  }
                >
                  <option value="contemporary">Contemporary</option>
                  <option value="ballad">Ballad</option>
                  <option value="anthem">Anthem</option>
                </select>
              </label>

              <label className="field">
                <span>Difficulty</span>
                <select
                  className="text-input"
                  value={arrangementConfig.difficulty}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({
                      ...current,
                      difficulty: event.target.value,
                    }))
                  }
                >
                  <option value="beginner">Beginner</option>
                  <option value="basic">Basic</option>
                  <option value="strict">Strict</option>
                </select>
              </label>

              <label className="field">
                <span>Lead range preset</span>
                <select
                  className="text-input"
                  value={arrangementConfig.voiceRangePreset}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({
                      ...current,
                      voiceRangePreset: event.target.value,
                    }))
                  }
                >
                  {voiceRangePresetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Beatbox template</span>
                <select
                  className="text-input"
                  value={arrangementConfig.beatboxTemplate}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({
                      ...current,
                      beatboxTemplate: event.target.value,
                    }))
                  }
                >
                  {beatboxTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mini-grid">
              <div className="mini-card mini-card--stack">
                <span>Difficulty preset</span>
                <strong>{selectedDifficultyMeta.label}</strong>
                <small>{selectedDifficultyMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>Lead range</span>
                <strong>{selectedVoiceRangeMeta.label}</strong>
                <small>{selectedVoiceRangeMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>Beatbox</span>
                <strong>{selectedBeatboxMeta.label}</strong>
                <small>{selectedBeatboxMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>Candidate batch</span>
                <strong>A / B / C compare</strong>
                <small>Generate three rule-based variations from the same melody draft.</small>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={arrangementState.phase === 'submitting'}
                onClick={() => void handleGenerateArrangements()}
              >
                {arrangementState.phase === 'submitting'
                  ? 'Generating arrangements...'
                  : 'Generate arrangement candidates'}
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={selectedArrangement === null || arrangementSaveState.phase === 'submitting'}
                onClick={() => void handleSaveArrangement()}
              >
                {arrangementSaveState.phase === 'submitting'
                  ? 'Saving arrangement...'
                  : 'Save arrangement edits'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
              >
                Refresh snapshot
              </button>
            </div>

            {arrangementState.phase === 'success' || arrangementState.phase === 'error' ? (
              <p
                className={
                  arrangementState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {arrangementState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                Generate candidates after melody cleanup so the rule engine can stack harmony
                parts around the cleaned draft.
              </p>
            )}

            {arrangementSaveState.phase === 'success' || arrangementSaveState.phase === 'error' ? (
              <p
                className={
                  arrangementSaveState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {arrangementSaveState.message}
              </p>
            ) : null}

            <div className="candidate-grid">
              {arrangements.length === 0 ? (
                <div className="empty-card">
                  <p>No arrangement candidates yet.</p>
                  <p>Extract a melody draft, then generate candidate A/B/C from it.</p>
                </div>
              ) : (
                arrangements.map((arrangement) => (
                  <article
                    className={`candidate-card ${
                      selectedArrangement?.arrangement_id === arrangement.arrangement_id
                        ? 'candidate-card--selected'
                        : ''
                    }`}
                    key={arrangement.arrangement_id}
                  >
                    <div className="candidate-card__header">
                      <div>
                        <strong>
                          {arrangement.candidate_code} - {arrangement.title}
                        </strong>
                        <span>
                          {arrangement.voice_mode} | {getOptionMeta(arrangementDifficultyOptions, arrangement.difficulty).label}
                        </span>
                      </div>

                      <button
                        className="button-secondary button-secondary--small"
                        type="button"
                        onClick={() => setSelectedArrangementId(arrangement.arrangement_id)}
                      >
                        {selectedArrangement?.arrangement_id === arrangement.arrangement_id
                          ? 'Selected'
                          : 'Select'}
                      </button>
                    </div>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>Lead fit</span>
                        <strong>{formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Max leap</span>
                        <strong>{arrangement.comparison_summary?.support_max_leap ?? 'n/a'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Parallel alerts</span>
                        <strong>{arrangement.comparison_summary?.parallel_motion_alerts ?? 0}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Beatbox hits</span>
                        <strong>{arrangement.comparison_summary?.beatbox_note_count ?? 0}</strong>
                      </div>
                    </div>

                    <div className="candidate-chip-row">
                      <span className="candidate-chip">
                        {getOptionMeta(voiceRangePresetOptions, arrangement.voice_range_preset).label}
                      </span>
                      <span className="candidate-chip">
                        {getOptionMeta(beatboxTemplateOptions, arrangement.beatbox_template).label}
                      </span>
                      <span className="candidate-chip">{arrangement.style}</span>
                      <span className="candidate-chip">
                        {arrangementGenerationId
                          ? arrangementGenerationId.slice(0, 8)
                          : arrangement.generation_id.slice(0, 8)}
                      </span>
                    </div>

                    <div className="mini-card mini-card--stack">
                      <span>Comparison summary</span>
                      <strong>
                        {arrangement.parts_json
                          .map((part) => `${part.part_name} (${part.notes.length})`)
                          .join(' / ')}
                      </strong>
                      <small>
                        {getOptionMeta(voiceRangePresetOptions, arrangement.voice_range_preset).description}
                      </small>
                    </div>

                    {arrangement.midi_artifact_url ? (
                      <a className="button-secondary" href={arrangement.midi_artifact_url}>
                        Download arrangement MIDI
                      </a>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Arrangement Editor</p>
                <h2>Review and edit the selected candidate JSON</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedArrangement ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {selectedArrangement ? selectedArrangement.candidate_code : 'Waiting'}
              </span>
            </div>

            {selectedArrangement ? (
              <div className="support-stack">
                <div className="field-grid">
                  <label className="field">
                    <span>Candidate title</span>
                    <input
                      className="text-input"
                      value={arrangementTitleDraft}
                      onChange={(event) => setArrangementTitleDraft(event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Source melody draft</span>
                    <input
                      className="text-input"
                      value={selectedArrangement.melody_draft_id}
                      readOnly
                    />
                  </label>
                </div>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Constraint max leap</span>
                    <strong>
                      {typeof selectedArrangement.constraint_json?.max_leap === 'number'
                        ? selectedArrangement.constraint_json.max_leap
                        : 'n/a'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>Parallel avoidance</span>
                    <strong>
                      {selectedArrangement.constraint_json?.parallel_avoidance ? 'On' : 'Off'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>Lead range preset</span>
                    <strong>
                      {getOptionMeta(voiceRangePresetOptions, selectedArrangement.voice_range_preset).label}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>Beatbox template</span>
                    <strong>
                      {getOptionMeta(beatboxTemplateOptions, selectedArrangement.beatbox_template).label}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>Lead fit</span>
                    <strong>{formatCompactPercent(selectedArrangement.comparison_summary?.lead_range_fit_percent)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Candidate parts</span>
                    <strong>{selectedArrangement.part_count}</strong>
                  </div>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>Compare readout</span>
                  <strong>
                    {selectedArrangement.comparison_summary?.parallel_motion_alerts ?? 0} parallel alerts,{' '}
                    {selectedArrangement.comparison_summary?.support_max_leap ?? 0} semitone max leap,{' '}
                    {selectedArrangement.comparison_summary?.beatbox_note_count ?? 0} beatbox hits
                  </strong>
                  <small>
                    {getOptionMeta(voiceRangePresetOptions, selectedArrangement.voice_range_preset).description}
                  </small>
                </div>

                <div className="support-stack">
                  <p className="json-label">Editable parts JSON</p>
                  <textarea
                    className="json-card json-card--editor"
                    value={arrangementJsonDraft}
                    onChange={(event) => setArrangementJsonDraft(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="empty-card">
                <p>No arrangement candidate is selected.</p>
                <p>Generate candidates and choose one to inspect or tweak its parts JSON.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 6</p>
          <h2>Score rendering, guide playback, and export</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Score View</p>
                <h2>Render the selected candidate as MusicXML</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedArrangement?.musicxml_artifact_url
                    ? 'status-pill--ready'
                    : 'status-pill--loading'
                }`}
              >
                {selectedArrangement?.musicxml_artifact_url ? 'MusicXML ready' : 'Waiting for MusicXML'}
              </span>
            </div>

            <p className="panel__summary">
              FOUNDATION Phase 6 asks for OSMD-based score rendering while keeping playback
              separate. This panel stays focused on the score artifact and export surface.
            </p>

            <div className="button-row">
              {selectedArrangement?.musicxml_artifact_url ? (
                <a className="button-primary" href={selectedArrangement.musicxml_artifact_url}>
                  Export MusicXML
                </a>
              ) : null}

              {selectedArrangement?.midi_artifact_url ? (
                <a className="button-secondary" href={selectedArrangement.midi_artifact_url}>
                  Export arrangement MIDI
                </a>
              ) : null}

              {guideWavExportUrl ? (
                <a className="button-secondary" href={guideWavExportUrl}>
                  Export guide WAV
                </a>
              ) : null}
            </div>

            {selectedArrangement ? (
              <ArrangementScore
                musicXmlUrl={selectedArrangement.musicxml_artifact_url}
                playheadRatio={arrangementPlaybackRatio}
                renderKey={`${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`}
              />
            ) : (
              <div className="empty-card">
                <p>No arrangement candidate is selected.</p>
                <p>Generate or choose a candidate before opening the score and export tools.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Playback Engine</p>
                <h2>Preview parts with guide mode and synchronized transport</h2>
              </div>
              <span
                className={`status-pill ${
                  arrangementTransportState.phase === 'playing'
                    ? 'status-pill--ready'
                    : arrangementTransportState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {arrangementTransportState.phase === 'playing'
                  ? 'Playing'
                  : arrangementTransportState.phase === 'error'
                    ? 'Playback error'
                    : 'Playback ready'}
              </span>
            </div>

            <p className="panel__summary">
              Playback stays outside the score renderer on purpose. Solo, guide focus, and
              part balance all route through a separate Web Audio preview engine.
            </p>

            <div className="transport-card">
              <div className="transport-card__row">
                <strong>
                  {formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}
                </strong>
                <span>
                  {selectedArrangement
                    ? `${selectedArrangement.part_count} parts`
                    : 'No arrangement selected'}
                </span>
              </div>
              <div className="transport-progress" aria-hidden="true">
                <div
                  className="transport-progress__fill"
                  style={{ width: `${Math.min(100, arrangementPlaybackRatio * 100)}%` }}
                />
              </div>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={selectedArrangement === null}
                onClick={() => void handlePlayArrangement()}
              >
                Play arrangement preview
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
                onClick={() => void stopArrangementPlayback()}
              >
                Stop playback
              </button>
            </div>

            <label className="toggle-card">
              <input
                type="checkbox"
                checked={guideModeEnabled}
                onChange={(event) => setGuideModeEnabled(event.target.checked)}
              />
              <div>
                <strong>Guide mode</strong>
                <span>Keep the guide-focus part loud while the rest of the stack drops back.</span>
              </div>
            </label>

            <p
              className={
                arrangementTransportState.phase === 'error' ? 'form-error' : 'status-card__hint'
              }
            >
              {arrangementTransportState.message}
            </p>

            {selectedArrangement ? (
              <div className="arrangement-part-list">
                {selectedArrangement.parts_json.map((part, index) => {
                  const partMixer = arrangementPartMixerState[part.part_name] ?? {
                    enabled: true,
                    solo: false,
                    volume: getDefaultArrangementPartVolume(part.role),
                  }
                  const isGuideFocus = guideFocusPartName === part.part_name
                  return (
                    <div className="arrangement-part-row" key={part.part_name}>
                      <div className="arrangement-part-row__identity">
                        <span
                          className="arrangement-part-swatch"
                          style={{ backgroundColor: getArrangementPartColor(part.role, index) }}
                        />
                        <div>
                          <strong>{part.part_name}</strong>
                          <span>
                            {part.role} | {part.notes.length} notes
                          </span>
                        </div>
                      </div>

                      <label className="toggle-inline">
                        <input
                          type="checkbox"
                          checked={partMixer.enabled}
                          onChange={(event) =>
                            updateArrangementPartMixer(part.part_name, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        <span>Active</span>
                      </label>

                      <button
                        className={`button-secondary button-secondary--small ${
                          partMixer.solo ? 'button-secondary--active' : ''
                        }`}
                        type="button"
                        onClick={() =>
                          updateArrangementPartMixer(part.part_name, {
                            solo: !partMixer.solo,
                          })
                        }
                      >
                        {partMixer.solo ? 'Solo on' : 'Solo'}
                      </button>

                      <button
                        className={`button-secondary button-secondary--small ${
                          isGuideFocus ? 'button-secondary--active' : ''
                        }`}
                        type="button"
                        onClick={() =>
                          setGuideFocusPartName((current) =>
                            current === part.part_name ? null : part.part_name,
                          )
                        }
                      >
                        {isGuideFocus ? 'Guide focus' : 'Focus'}
                      </button>

                      <label className="arrangement-part-volume">
                        <span>{partMixer.volume.toFixed(2)}</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={partMixer.volume}
                          onChange={(event) =>
                            updateArrangementPartMixer(part.part_name, {
                              volume: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-card">
                <p>No candidate is selected for playback.</p>
                <p>Choose a candidate to enable part solo, guide focus, and transport sync.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">BE-06 and FE-07</p>
          <h2>Offline mixdown preview and save</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Mixdown Render</p>
                <h2>Render the current guide and selected take offline</h2>
              </div>
              <span
                className={`status-pill ${
                  mixdownPreviewState.phase === 'success'
                    ? 'status-pill--ready'
                    : mixdownPreviewState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {mixdownPreviewState.phase === 'success'
                  ? 'Preview ready'
                  : mixdownPreviewState.phase === 'error'
                    ? 'Preview error'
                    : mixdownPreviewState.phase === 'submitting'
                      ? 'Rendering'
                      : 'Preview idle'}
              </span>
            </div>

            <p className="panel__summary">
              Foundation FE-07 keeps this intentionally simple: render the audible guide and
              selected take with the current mixer values, listen locally, then save the
              result as a project artifact when it sounds right.
            </p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Guide source</span>
                <strong>
                  {guide?.source_artifact_url
                    ? isTrackMutedByMixer(guide.track_id)
                      ? 'Muted by mixer'
                      : 'Included'
                    : 'Missing'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Selected take</span>
                <strong>
                  {selectedTake
                    ? selectedTakePlaybackUrl
                      ? isTrackMutedByMixer(selectedTake.track_id)
                        ? 'Muted by mixer'
                        : `Take ${selectedTake.take_no ?? '?'}`
                      : 'No playable audio'
                    : 'Missing'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Guide volume</span>
                <strong>{guide ? (guideMixer?.volume ?? 0.85).toFixed(2) : 'n/a'}</strong>
              </div>
              <div className="mini-card">
                <span>Take volume</span>
                <strong>
                  {selectedTake ? (mixerState[selectedTake.track_id]?.volume ?? 1).toFixed(2) : 'n/a'}
                </strong>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={mixdownPreviewState.phase === 'submitting'}
                onClick={() => void handleRenderMixdown()}
              >
                {mixdownPreviewState.phase === 'submitting'
                  ? 'Rendering mixdown...'
                  : 'Render mixdown preview'}
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={mixdownPreview === null || mixdownSaveState.phase === 'submitting'}
                onClick={() => void handleSaveMixdown()}
              >
                {mixdownSaveState.phase === 'submitting' ? 'Saving mixdown...' : 'Save mixdown'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
              >
                Refresh studio snapshot
              </button>
            </div>

            {mixdownPreviewState.phase === 'success' || mixdownPreviewState.phase === 'error' ? (
              <p
                className={
                  mixdownPreviewState.phase === 'error'
                    ? 'form-error'
                    : 'status-card__hint'
                }
              >
                {mixdownPreviewState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                Re-render after changing take selection, mute or solo state, or volume.
              </p>
            )}

            {mixdownSaveState.phase === 'success' || mixdownSaveState.phase === 'error' ? (
              <p
                className={
                  mixdownSaveState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {mixdownSaveState.message}
              </p>
            ) : null}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Mixdown Player</p>
                <h2>Listen locally first, then keep the saved artifact in snapshot</h2>
              </div>
              <span
                className={`status-pill ${
                  mixdownSummary?.track_status === 'READY'
                    ? 'status-pill--ready'
                    : mixdownSaveState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {mixdownSummary?.track_status ?? 'Not saved'}
              </span>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Playback source</span>
                <strong>{mixdownSourceLabel}</strong>
              </div>
              <div className="mini-card">
                <span>Duration</span>
                <strong>
                  {mixdownPreview
                    ? formatDuration(mixdownPreview.durationMs)
                    : formatDuration(mixdownSummary?.duration_ms ?? null)}
                </strong>
              </div>
              <div className="mini-card">
                <span>Sample rate</span>
                <strong>
                  {mixdownPreview?.actualSampleRate ?? mixdownSummary?.actual_sample_rate ?? 'Unknown'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Updated</span>
                <strong>{mixdownSummary ? formatDate(mixdownSummary.updated_at) : 'Not saved yet'}</strong>
              </div>
            </div>

            {mixdownPlaybackUrl ? (
              <div className="support-stack">
                <div className="mini-card mini-card--stack">
                  <span>Included tracks</span>
                  <strong>
                    {mixdownPreview
                      ? mixdownPreview.labels.join(' + ')
                      : mixdownSummary
                        ? `Latest saved mixdown (${mixdownSummary.track_status})`
                        : 'Render a preview to inspect the current source set.'}
                  </strong>
                </div>

                <div className="audio-preview">
                  <p className="json-label">Mixdown playback</p>
                  <ManagedAudioPlayer muted={false} src={mixdownPlaybackUrl} volume={1} />
                </div>

                {mixdownPreviewSource ? <WaveformPreview preview={mixdownPreviewSource} /> : null}

                {mixdownSummary ? (
                  <div className="mini-card mini-card--stack">
                    <span>Storage key</span>
                    <strong>{mixdownSummary.storage_key ?? 'Not available'}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No mixdown preview is ready yet.</p>
                <p>Render the current guide and selected take to open the preview and save flow.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 8</p>
          <h2>Project history and read-only sharing</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Version History</p>
                <h2>Capture project snapshots before larger edits or reviews</h2>
              </div>
              <span
                className={`status-pill ${
                  versionsState.phase === 'ready'
                    ? 'status-pill--ready'
                    : versionsState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {versionsState.phase === 'ready'
                  ? `${versionsState.items.length} versions`
                  : versionsState.phase === 'error'
                    ? 'Versions error'
                    : 'Loading versions'}
              </span>
            </div>

            <p className="panel__summary">
              FOUNDATION Phase 8 calls for lightweight project version history. This pass stores
              a snapshot of the current studio state so we can keep a readable trail before
              sharing or major arrangement edits.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>Snapshot label</span>
                <input
                  className="text-input"
                  value={versionLabelDraft}
                  onChange={(event) => setVersionLabelDraft(event.target.value)}
                  placeholder="Phase 8 check-in"
                />
              </label>

              <label className="field">
                <span>Snapshot note</span>
                <input
                  className="text-input"
                  value={versionNoteDraft}
                  onChange={(event) => setVersionNoteDraft(event.target.value)}
                  placeholder="What changed or why this snapshot matters"
                />
              </label>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={versionCreateState.phase === 'submitting'}
                onClick={() => void handleCaptureVersion()}
              >
                {versionCreateState.phase === 'submitting'
                  ? 'Capturing snapshot...'
                  : 'Capture project snapshot'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshProjectVersions().catch(() => undefined)}
              >
                Refresh versions
              </button>
            </div>

            {versionCreateState.phase === 'success' || versionCreateState.phase === 'error' ? (
              <p className={versionCreateState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {versionCreateState.message}
              </p>
            ) : versionsState.phase === 'error' ? (
              <p className="form-error">{versionsState.message}</p>
            ) : null}

            <div className="history-list">
              {versionsState.items.length === 0 ? (
                <div className="empty-card">
                  <p>No project versions yet.</p>
                  <p>Capture a snapshot before sharing or before larger arrangement edits.</p>
                </div>
              ) : (
                versionsState.items.map((version) => (
                  <article className="history-card" key={version.version_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>{version.label}</strong>
                        <span>{version.source_type} | {formatDate(version.created_at)}</span>
                      </div>
                      <span className="candidate-chip">{version.version_id.slice(0, 8)}</span>
                    </div>

                    {version.note ? <p className="status-card__hint">{version.note}</p> : null}

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>Guide</span>
                        <strong>{version.snapshot_summary.has_guide ? 'Yes' : 'No'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Takes</span>
                        <strong>{version.snapshot_summary.take_count}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Ready takes</span>
                        <strong>{version.snapshot_summary.ready_take_count}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Arrangements</span>
                        <strong>{version.snapshot_summary.arrangement_count}</strong>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Share Links</p>
                <h2>Create read-only share URLs tied to a frozen snapshot</h2>
              </div>
              <span
                className={`status-pill ${
                  shareLinksState.phase === 'ready'
                    ? 'status-pill--ready'
                    : shareLinksState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {shareLinksState.phase === 'ready'
                  ? `${shareLinksState.items.length} links`
                  : shareLinksState.phase === 'error'
                    ? 'Share error'
                    : 'Loading shares'}
              </span>
            </div>

            <p className="panel__summary">
              The master plan leaves the sharing scope open, so this slice assumes read-only links.
              Each link freezes a version first, then opens a public viewer route without editing
              controls.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>Share label</span>
                <input
                  className="text-input"
                  value={shareLabelDraft}
                  onChange={(event) => setShareLabelDraft(event.target.value)}
                  placeholder="Coach review"
                />
              </label>

              <label className="field field--compact">
                <span>Expires in days</span>
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={90}
                  value={shareExpiryDays}
                  onChange={(event) => setShareExpiryDays(Number(event.target.value) || 7)}
                />
              </label>
            </div>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={shareCreateState.phase === 'submitting'}
                onClick={() => void handleCreateShareLink()}
              >
                {shareCreateState.phase === 'submitting'
                  ? 'Creating share link...'
                  : 'Create read-only share link'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshShareLinks().catch(() => undefined)}
              >
                Refresh share links
              </button>
            </div>

            {shareCreateState.phase === 'success' || shareCreateState.phase === 'error' ? (
              <p className={shareCreateState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {shareCreateState.message}
              </p>
            ) : shareLinksState.phase === 'error' ? (
              <p className="form-error">{shareLinksState.message}</p>
            ) : null}

            {shareDeactivateState.phase === 'success' || shareDeactivateState.phase === 'error' ? (
              <p className={shareDeactivateState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {shareDeactivateState.message}
              </p>
            ) : null}

            {shareCopyState.phase === 'success' || shareCopyState.phase === 'error' ? (
              <p className={shareCopyState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {shareCopyState.message}
              </p>
            ) : null}

            <div className="history-list">
              {shareLinksState.items.length === 0 ? (
                <div className="empty-card">
                  <p>No share links yet.</p>
                  <p>Create a read-only share URL to send the current studio snapshot to reviewers.</p>
                </div>
              ) : (
                shareLinksState.items.map((shareLink) => (
                  <article className="history-card" key={shareLink.share_link_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>{shareLink.label}</strong>
                        <span>
                          {shareLink.is_active ? 'Active' : 'Inactive'} | expires{' '}
                          {shareLink.expires_at ? formatDate(shareLink.expires_at) : 'never'}
                        </span>
                      </div>
                      <span className="candidate-chip">{shareLink.access_scope}</span>
                    </div>

                    <div className="mini-card mini-card--stack">
                      <span>Share URL</span>
                      <strong>{shareLink.share_url}</strong>
                    </div>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>Version</span>
                        <strong>{shareLink.version_id.slice(0, 8)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Last opened</span>
                        <strong>{shareLink.last_accessed_at ? formatDate(shareLink.last_accessed_at) : 'Not yet'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Created</span>
                        <strong>{formatDate(shareLink.created_at)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Status</span>
                        <strong>{shareLink.is_active ? 'Live' : 'Closed'}</strong>
                      </div>
                    </div>

                    <div className="button-row">
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={() => void handleCopyShareLink(shareLink.share_url)}
                      >
                        Copy URL
                      </button>
                      <a className="button-secondary" href={shareLink.share_url} target="_blank" rel="noreferrer">
                        Open share view
                      </a>
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={!shareLink.is_active || shareDeactivateState.phase === 'submitting'}
                        onClick={() => void handleDeactivateShareLink(shareLink.share_link_id)}
                      >
                        {shareLink.is_active ? 'Deactivate' : 'Already inactive'}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}

