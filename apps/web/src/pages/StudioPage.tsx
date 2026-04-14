import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { buildAudioPreviewFromBlob, buildAudioPreviewFromUrl, type AudioPreviewData } from '../lib/audioPreview'
import { buildApiUrl, normalizeAssetUrl } from '../lib/api'
import { getAudioContextConstructor } from '../lib/audioContext'
import {
  collectBrowserAudioCapabilities,
  deriveBrowserAudioWarningFlags,
  getBrowserAudioWarningLabel,
  type BrowserAudioCapabilitySnapshot,
} from '../lib/browserAudioDiagnostics'
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
import {
  createLiveInputMeter,
  type LiveInputMeterController,
} from '../lib/liveInputMeter'
import {
  getAnalysisJobStatusLabel,
  getArrangementPartRoleLabel,
  getArrangementStyleLabel,
  getPartTypeLabel,
  getProjectVersionSourceLabel,
  getShareAccessScopeLabel,
  getTrackStatusLabel,
} from '../lib/localizedLabels'
import { renderOfflineMixdown, type RenderedMixdown } from '../lib/mixdownAudio'
import {
  buildUploadHeaders,
  pickSupportedRecordingMimeType,
  playCountInSequence,
  startMetronomeLoop,
  uploadBlobWithProgress,
  type MetronomeController,
} from '../lib/studioAudio'
import type { Project, ProjectChordTimelineItem } from '../types/project'

type StudioState =
  | { phase: 'loading' }
  | { phase: 'ready'; project: Project }
  | { phase: 'error'; message: string }

type ActionState =
  | { phase: 'idle' }
  | { phase: 'submitting'; message?: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

const studioWorkbenchLinks = [
  { id: 'harmony-authoring', label: '코드' },
  { id: 'audio-setup', label: '오디오 설정' },
  { id: 'recording', label: '녹음' },
  { id: 'analysis', label: '분석' },
  { id: 'melody', label: '멜로디' },
  { id: 'arrangement', label: '편곡' },
  { id: 'score-playback', label: '악보' },
  { id: 'mixdown', label: '믹스다운' },
  { id: 'sharing', label: '버전 / 공유' },
] as const

type StudioSectionId = (typeof studioWorkbenchLinks)[number]['id']

type StudioWorkspaceModeId = 'record' | 'review' | 'arrange'

const studioRailLabels: Record<StudioSectionId, string> = {
  'harmony-authoring': '화성 기준',
  'audio-setup': '장치 준비',
  recording: '녹음',
  analysis: '리뷰',
  melody: '멜로디',
  arrangement: '편곡',
  'score-playback': '악보',
  mixdown: '믹스다운',
  sharing: '버전·공유',
}

const studioSectionModeMap: Record<StudioSectionId, StudioWorkspaceModeId> = {
  'harmony-authoring': 'review',
  'audio-setup': 'record',
  recording: 'record',
  analysis: 'review',
  melody: 'arrange',
  arrangement: 'arrange',
  'score-playback': 'arrange',
  mixdown: 'arrange',
  sharing: 'arrange',
}

const studioWorkspaceModes: ReadonlyArray<{
  id: StudioWorkspaceModeId
  label: string
  eyebrow: string
  summary: string
  sectionIds: StudioSectionId[]
}> = [
  {
    id: 'record',
    label: '녹음',
    eyebrow: '시작하기',
    summary: '장치 확인, 가이드 맞추기, 새 테이크 녹음처럼 지금 바로 해야 할 준비만 앞으로 모읍니다.',
    sectionIds: ['audio-setup', 'recording'],
  },
  {
    id: 'review',
    label: '리뷰',
    eyebrow: '들어보고 판단하기',
    summary: '선택한 테이크의 점수와 보정 표시, 화성 기준을 같은 흐름에서 차례대로 살펴봅니다.',
    sectionIds: ['harmony-authoring', 'analysis'],
  },
  {
    id: 'arrange',
    label: '편곡',
    eyebrow: '마무리 작업',
    summary: '멜로디 초안, 편곡 비교, 악보와 미리듣기, 믹스다운과 공유까지 한 번에 이어갑니다.',
    sectionIds: ['melody', 'arrangement', 'score-playback', 'mixdown', 'sharing'],
  },
]

type DeviceProfile = {
  device_profile_id: string
  user_id: string
  browser: string
  os: string
  input_device_hash: string
  output_route: string
  browser_user_agent: string | null
  requested_constraints_json: Record<string, unknown> | null
  applied_settings_json: Record<string, unknown> | null
  capabilities_json: BrowserAudioCapabilitySnapshot | null
  diagnostic_flags_json: string[] | null
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
  upload_headers: Record<string, string>
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

type NoteFeedbackItem = {
  note_index: number
  start_ms: number
  end_ms: number
  target_midi: number
  target_frequency_hz: number
  attack_start_ms: number
  attack_end_ms: number
  settle_start_ms: number | null
  settle_end_ms: number | null
  sustain_start_ms: number | null
  sustain_end_ms: number | null
  release_start_ms: number | null
  release_end_ms: number | null
  timing_offset_ms: number | null
  attack_signed_cents: number | null
  sustain_median_cents: number | null
  sustain_mad_cents: number | null
  max_sharp_cents: number | null
  max_flat_cents: number | null
  in_tune_ratio: number | null
  confidence: number
  attack_score: number
  sustain_score: number
  stability_score: number
  timing_score: number
  note_score: number
  message: string
}

type TrackScoreSummary = {
  score_id: string
  project_id: string
  track_id: string
  pitch_score: number
  rhythm_score: number
  harmony_fit_score: number
  total_score: number
  pitch_quality_mode: string
  harmony_reference_mode: string
  feedback_json: AnalysisFeedbackItem[]
  note_feedback_json: NoteFeedbackItem[]
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
  upload_headers: Record<string, string>
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
  upload_headers: Record<string, string>
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

function summarizeRecorderSupport(snapshot: BrowserAudioCapabilitySnapshot | null): string {
  if (!snapshot) {
    return '미리보기 전용'
  }
  if (!snapshot.media_recorder.supported) {
    return '사용 불가'
  }
  return snapshot.media_recorder.selected_mime_type ? '지원 형식 있음' : '지원 형식 없음'
}

function summarizeWebAudioSupport(snapshot: BrowserAudioCapabilitySnapshot | null): string {
  if (!snapshot) {
    return '알 수 없음'
  }
  if (!snapshot.web_audio.audio_context) {
    return '사용 불가'
  }
  if (snapshot.web_audio.audio_context_mode === 'webkit') {
    return '호환 경로'
  }
  return '표준 경로'
}

function summarizeBrowserAudioStack(snapshot: BrowserAudioCapabilitySnapshot | null): string {
  if (!snapshot) {
    return '알 수 없음'
  }

  const readyCount = [
    snapshot.web_audio.audio_worklet ?? false,
    snapshot.execution?.web_worker ?? false,
    snapshot.execution?.web_assembly ?? false,
    snapshot.web_audio.offline_audio_context,
  ].filter(Boolean).length

  return `${readyCount}/4 준비`
}

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

type LiveInputMeterState =
  | { phase: 'idle'; peak: number; rms: number; message: string }
  | { phase: 'active'; peak: number; rms: number; message: string }
  | { phase: 'unsupported'; peak: number; rms: number; message: string }
  | { phase: 'error'; peak: number; rms: number; message: string }

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

type ChordTimelineDraftItem = {
  start_ms: string
  end_ms: string
  label: string
  root: string
  quality: string
  pitch_classes: string
}

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
  { value: 'headphones', label: '헤드폰 권장' },
  { value: 'speakers', label: '스피커 / 모니터' },
  { value: 'unknown', label: '알 수 없는 경로' },
] as const

const noteNamesSharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const arrangementDifficultyOptions = [
  {
    value: 'beginner',
    label: '입문',
    description: '첫 리허설에서 도약 폭을 줄이고 받침 움직임을 더 안전하게 잡습니다.',
  },
  {
    value: 'basic',
    label: '기본',
    description: '적당한 움직임을 허용하는 균형 잡힌 기본 프리셋입니다.',
  },
  {
    value: 'strict',
    label: '엄격',
    description: '도약 제약을 더 강하게 두고 병행 진행을 더 엄격하게 피합니다.',
  },
] as const
const voiceRangePresetOptions = [
  {
    value: 'soprano',
    label: 'S (Soprano)',
    description: '높은 리드 테이크에 맞춘 밝은 톱라인 프리셋입니다.',
  },
  {
    value: 'alto',
    label: 'A (Alto)',
    description: '현재 MVP 흐름과 가장 잘 맞는 균형형 기본 프리셋입니다.',
  },
  {
    value: 'tenor',
    label: 'T (Tenor)',
    description: '테너 중심 연습 테이크에 맞춘 낮은 리드 프리셋입니다.',
  },
  {
    value: 'bass',
    label: 'B (Bass)',
    description: '가장 낮은 리드 음역과 깊은 받침 간격을 쓰는 프리셋입니다.',
  },
  {
    value: 'baritone',
    label: '바리톤',
    description: '테너의 기민함과 베이스의 무게감 사이를 잇는 중저음 프리셋입니다.',
  },
] as const
const beatboxTemplateOptions = [
  {
    value: 'off',
    label: '사용 안 함',
    description: '후보 배치에 비트박스 레이어를 넣지 않습니다.',
  },
  {
    value: 'pulse',
    label: 'Pulse',
    description: '리허설 타이밍용 킥과 스네어 중심의 단순한 펄스입니다.',
  },
  {
    value: 'drive',
    label: 'Drive',
    description: '하이햇과 킥을 더한 밀도 있는 그루브입니다.',
  },
  {
    value: 'halftime',
    label: 'Half-Time',
    description: '프레이즈 사이 여백을 더 남기는 느린 백비트입니다.',
  },
  {
    value: 'syncopated',
    label: 'Syncopated',
    description: '엇박 강조로 비교용 후보를 더 생기 있게 만듭니다.',
  },
] as const

function createChordTimelineDraftItem(
  item?: ProjectChordTimelineItem,
  fallbackRoot = 'C',
): ChordTimelineDraftItem {
  return {
    start_ms: item ? String(item.start_ms) : '0',
    end_ms: item ? String(item.end_ms) : '2000',
    label: item?.label ?? (item?.root ? `${item.root}${item.quality ? ` ${item.quality}` : ''}` : fallbackRoot),
    root: item?.root ?? fallbackRoot,
    quality: item?.quality ?? 'major',
    pitch_classes: item?.pitch_classes?.join(', ') ?? '',
  }
}

function serializeChordTimelineItems(items: ProjectChordTimelineItem[] | null | undefined): string {
  return JSON.stringify(items ?? [], null, 2)
}

function parsePitchClassesDraft(value: string): number[] | null {
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (normalized.length === 0) {
    return null
  }

  const pitchClasses = normalized.map((item) => {
    const parsed = Number(item)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 11) {
      throw new Error('피치 클래스는 0부터 11 사이의 정수만 사용할 수 있습니다.')
    }
    return parsed
  })

  return pitchClasses
}

function buildChordTimelinePayload(draft: ChordTimelineDraftItem[]): ProjectChordTimelineItem[] {
  const items: ProjectChordTimelineItem[] = []

  for (const [index, item] of draft.entries()) {
    const startText = item.start_ms.trim()
    const endText = item.end_ms.trim()
    const label = item.label.trim()
    const root = item.root.trim()
    const quality = item.quality.trim()
    const pitchClassesText = item.pitch_classes.trim()

    const isEmpty =
      startText === '' &&
      endText === '' &&
      label === '' &&
      root === '' &&
      quality === '' &&
      pitchClassesText === ''

    if (isEmpty) {
      continue
    }

    const startMs = Number(startText)
    const endMs = Number(endText)

    if (!Number.isInteger(startMs) || startMs < 0) {
      throw new Error(`코드 ${index + 1}: 시작 ms는 0 이상의 정수여야 합니다.`)
    }
    if (!Number.isInteger(endMs) || endMs <= startMs) {
      throw new Error(`코드 ${index + 1}: 종료 ms는 시작 ms보다 커야 합니다.`)
    }

    items.push({
      start_ms: startMs,
      end_ms: endMs,
      label: label || null,
      root: root || null,
      quality: quality || null,
      pitch_classes: parsePitchClassesDraft(pitchClassesText),
    })
  }

  return items
}

function chordTimelineImportItemToDraft(
  item: unknown,
  index: number,
  fallbackRoot = 'C',
): ChordTimelineDraftItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`Chord ${index + 1}: each imported item must be an object.`)
  }

  const record = item as Record<string, unknown>
  const startMs = Number(record.start_ms)
  const endMs = Number(record.end_ms)
  if (!Number.isInteger(startMs) || startMs < 0) {
    throw new Error(`Chord ${index + 1}: start_ms must be an integer >= 0.`)
  }
  if (!Number.isInteger(endMs) || endMs <= startMs) {
    throw new Error(`Chord ${index + 1}: end_ms must be greater than start_ms.`)
  }

  const pitchClasses = Array.isArray(record.pitch_classes)
    ? record.pitch_classes
        .map((value) => (typeof value === 'number' ? value : Number.NaN))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 11)
    : null

  return {
    start_ms: String(startMs),
    end_ms: String(endMs),
    label: typeof record.label === 'string' ? record.label : '',
    root: typeof record.root === 'string' ? record.root : fallbackRoot,
    quality: typeof record.quality === 'string' ? record.quality : 'major',
    pitch_classes: pitchClasses && pitchClasses.length > 0 ? pitchClasses.join(', ') : '',
  }
}

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
  return '알 수 없는 브라우저'
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
  return '알 수 없는 OS'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) {
    return '아직 기록되지 않음'
  }

  return `${(durationMs / 1000).toFixed(2)}초`
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '아직 채점되지 않음'
  }

  return `${value.toFixed(1)} / 100`
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '없음'
  }

  return `${Math.round(value)}%`
}

function formatConfidence(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '대기 중'
  }

  return `${Math.round(value * 100)}%`
}

function formatOffsetMs(value: number | null): string {
  if (value === null) {
    return '대기 중'
  }

  if (value === 0) {
    return '정렬됨'
  }

  return `${value > 0 ? '+' : ''}${value} ms`
}

function formatTimeSpan(startMs: number, endMs: number): string {
  return `${(startMs / 1000).toFixed(2)}s - ${(endMs / 1000).toFixed(2)}s`
}

function formatSignedCents(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '없음'
  }

  if (Math.abs(value) < 1) {
    return '중심'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}c`
}

function formatSignedMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '없음'
  }

  if (value === 0) {
    return '정시'
  }

  return `${value > 0 ? '+' : ''}${Math.round(value)} ms`
}

function formatRatio(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '없음'
  }

  return `${Math.round(value * 100)}%`
}

function getPitchDirectionLabel(value: number | null): string {
  if (value === null || Number.isNaN(value) || Math.abs(value) < 1) {
    return '중심'
  }

  return value > 0 ? '높음' : '낮음'
}

function getPitchDirectionTone(value: number | null): 'good' | 'warn' | 'alert' | 'neutral' {
  if (value === null || Number.isNaN(value)) {
    return 'neutral'
  }

  const cents = Math.abs(value)
  if (cents <= 8) {
    return 'good'
  }
  if (cents <= 22) {
    return 'warn'
  }
  return 'alert'
}

function getScoreTone(value: number | null): 'good' | 'warn' | 'alert' | 'neutral' {
  if (value === null || Number.isNaN(value)) {
    return 'neutral'
  }

  if (value >= 88) {
    return 'good'
  }
  if (value >= 70) {
    return 'warn'
  }
  return 'alert'
}

function getConfidenceTone(value: number | null): 'good' | 'warn' | 'alert' | 'neutral' {
  if (value === null || Number.isNaN(value)) {
    return 'neutral'
  }

  if (value >= 0.8) {
    return 'good'
  }
  if (value >= 0.55) {
    return 'warn'
  }
  return 'alert'
}

function getPitchQualityModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'NOTE_EVENT_V1':
      return '노트별 확인'
    case 'FRAME_PITCH_V1':
      return '기본 음 높이 확인'
    case 'COARSE_CONTOUR_V1':
      return '간단 확인'
    default:
      return '확인 방식 정보 없음'
  }
}

function getPitchQualityModeHint(mode: string | null | undefined): string {
  switch (mode) {
    case 'NOTE_EVENT_V1':
      return '방향 음정 오차, 시작음/유지음 구간, 타이밍이 모두 노트 이벤트 기준으로 계산됩니다.'
    case 'FRAME_PITCH_V1':
      return '기본 음 높이 흐름을 먼저 확인한 결과입니다.'
    case 'COARSE_CONTOUR_V1':
      return '간단 안내용 결과입니다. 세밀한 교정보다는 큰 흐름을 보는 데에 적합합니다.'
    default:
      return '확인 방식 설명을 아직 준비하지 못했습니다.'
  }
}

function getHarmonyReferenceLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'CHORD_AWARE':
      return '저장한 코드 기준'
    case 'KEY_ONLY':
      return '기준 키 중심'
    default:
      return '화음 기준 정보 없음'
  }
}

function getHarmonyReferenceHint(
  mode: string | null | undefined,
  chordMarkerCount: number,
): string {
  if (mode === 'CHORD_AWARE') {
    return `이 프로젝트에 저장된 코드 마커 ${chordMarkerCount}개를 기준으로 화성 적합도를 계산합니다.`
  }

  if (mode === 'KEY_ONLY') {
    return chordMarkerCount > 0
      ? '프로젝트에 코드 마커가 있지만 이번 점수는 아직 키 기준 경로로 대체되었습니다.'
      : '코드 타임라인이 없어 화성 적합도를 코드 대신 프로젝트 키 기준으로 계산합니다.'
  }

  return '화음 기준 설명을 아직 준비하지 못했습니다.'
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

function getConsoleMicLabel(permissionPhase: string, hasProfile: boolean): string {
  if (permissionPhase === 'granted') {
    return '마이크 준비됨'
  }
  if (permissionPhase === 'error') {
    return '마이크 차단됨'
  }
  if (hasProfile) {
    return '프로필 저장됨'
  }
  return '마이크 대기'
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
  const AudioContextCtor =
    typeof window === 'undefined' ? undefined : getAudioContextConstructor(window)
  if (typeof window === 'undefined' || typeof AudioContextCtor === 'undefined') {
    return { actualSampleRate: null, durationMs: null }
  }

  const audioContext = new AudioContextCtor()

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
    message: '다음 테이크를 녹음할 준비가 되었습니다.',
  })
  const [liveInputMeterState, setLiveInputMeterState] = useState<LiveInputMeterState>({
    phase: 'idle',
    peak: 0,
    rms: 0,
    message: '다음 테이크가 시작되면 입력 표시가 자동으로 켜집니다.',
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
  const [capabilityPreview, setCapabilityPreview] =
    useState<BrowserAudioCapabilitySnapshot | null>(null)
  const [capabilityWarningFlags, setCapabilityWarningFlags] = useState<string[]>([])
  const [countInBeats, setCountInBeats] = useState(4)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<StudioWorkspaceModeId>('record')
  const [takeUploadProgress, setTakeUploadProgress] = useState<Record<string, number>>({})
  const [failedTakeUploads, setFailedTakeUploads] = useState<
    Record<string, FailedTakeUpload>
  >({})
  const [takePreviewUrls, setTakePreviewUrls] = useState<Record<string, string>>({})
  const [audioPreviews, setAudioPreviews] = useState<Record<string, AudioPreviewData>>({})
  const [waveformState, setWaveformState] = useState<ActionState>({ phase: 'idle' })
  const [analysisState, setAnalysisState] = useState<ActionState>({ phase: 'idle' })
  const [projectHarmonyState, setProjectHarmonyState] = useState<ActionState>({ phase: 'idle' })
  const [selectedNoteFeedbackIndex, setSelectedNoteFeedbackIndex] = useState(0)
  const [chordTimelineDraft, setChordTimelineDraft] = useState<ChordTimelineDraftItem[]>([])
  const [chordTimelineJsonDraft, setChordTimelineJsonDraft] = useState('[]')
  const [melodyState, setMelodyState] = useState<ActionState>({ phase: 'idle' })
  const [melodySaveState, setMelodySaveState] = useState<ActionState>({ phase: 'idle' })
  const [melodyNotesDraft, setMelodyNotesDraft] = useState<MelodyNote[]>([])
  const [arrangementState, setArrangementState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementSaveState, setArrangementSaveState] = useState<ActionState>({ phase: 'idle' })
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
      message: '후보를 선택하면 악보를 그리고 화성 스택을 미리들을 수 있습니다.',
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
  const liveInputMeterRef = useRef<LiveInputMeterController | null>(null)
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

  function hydrateChordTimelineDraft(project: Project): void {
    const nextDraft = (project.chord_timeline_json ?? []).map((item) =>
      createChordTimelineDraftItem(item, project.base_key ?? 'C'),
    )

    setChordTimelineDraft(nextDraft)
    setChordTimelineJsonDraft(serializeChordTimelineItems(project.chord_timeline_json))
    setProjectHarmonyState({ phase: 'idle' })
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

  async function stopActiveLiveInputMeter(resetMessage = true): Promise<void> {
    const activeMeter = liveInputMeterRef.current
    liveInputMeterRef.current = null
    if (activeMeter) {
      await activeMeter.stop()
    }

    setLiveInputMeterState((current) => ({
      phase: current.phase === 'unsupported' ? current.phase : 'idle',
      peak: 0,
      rms: 0,
      message:
        current.phase === 'unsupported'
          ? current.message
          : resetMessage
            ? '다음 테이크가 시작되면 입력 표시가 자동으로 켜집니다.'
            : current.message,
    }))
  }

  async function startLiveInputMeter(stream: MediaStream): Promise<void> {
    await stopActiveLiveInputMeter(false)

    const controller = await createLiveInputMeter(stream, (reading) => {
      setLiveInputMeterState({
        phase: 'active',
        peak: reading.peak,
        rms: reading.rms,
        message: '입력 표시가 켜졌습니다.',
      })
    })

    liveInputMeterRef.current = controller
    if (controller.mode === 'unsupported') {
      setLiveInputMeterState({
        phase: 'unsupported',
        peak: 0,
        rms: 0,
        message: '이 브라우저에서는 실시간 입력 표시를 사용할 수 없습니다.',
      })
      return
    }

    setLiveInputMeterState({
      phase: 'active',
      peak: 0,
      rms: 0,
      message: '입력 표시가 켜졌습니다.',
    })
  }

  async function refreshCapabilityPreview(options?: {
    audioContext?: AudioContext | null
    microphonePermissionState?: 'granted' | 'prompt' | 'denied' | 'unknown' | null
  }): Promise<BrowserAudioCapabilitySnapshot> {
    const snapshot = await collectBrowserAudioCapabilities(options)
    setCapabilityPreview(snapshot)
    setCapabilityWarningFlags(deriveBrowserAudioWarningFlags(snapshot))
    return snapshot
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
      message: '편곡 미리듣기를 시작할 수 있습니다.',
    })
  }

  async function cleanupRecordingResources(): Promise<void> {
    await stopActiveMetronome()
    await stopActiveLiveInputMeter()

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
    hydrateChordTimelineDraft(snapshot.project)
    setGuideState({ phase: 'ready', guide: snapshot.guide })
    setTakesState({ phase: 'ready', items: snapshot.takes })
    setMixdownSummary(snapshot.mixdown)
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
      setCapabilityPreview(snapshot.latest_device_profile.capabilities_json)
      setCapabilityWarningFlags(snapshot.latest_device_profile.diagnostic_flags_json ?? [])
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
      throw new Error(await readErrorMessage(response, '스튜디오 스냅샷을 새로고침하지 못했습니다.'))
    }

    const snapshot = (await response.json()) as StudioSnapshotResponse
    applyStudioSnapshotRef.current(snapshot)
    return snapshot
  }

  useEffect(() => {
    void refreshCapabilityPreview().catch(() => undefined)
  }, [])

  async function refreshProjectVersions(): Promise<ProjectVersionRecord[]> {
    if (!projectId) {
      return []
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/versions`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, '프로젝트 버전을 불러오지 못했습니다.'))
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
      throw new Error(await readErrorMessage(response, '공유 링크를 불러오지 못했습니다.'))
    }

    const payload = (await response.json()) as { items: ShareLinkRecord[] }
    setShareLinksState({ phase: 'ready', items: payload.items })
    return payload.items
  }

  useEffect(() => {
    if (!projectId) {
      setStudioState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
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
            response.status === 404
              ? '프로젝트를 찾지 못했습니다.'
              : `요청이 실패했습니다. (HTTP ${response.status})`,
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
          message: error instanceof Error ? error.message : '스튜디오를 불러오지 못했습니다.',
        })
      }
    }

    void loadStudio()

    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setVersionsState({ phase: 'error', items: [], message: '프로젝트 ID가 없습니다.' })
      return
    }

    let isActive = true
    setVersionsState({ phase: 'loading', items: [] })

    async function loadVersions(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/versions`))
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '프로젝트 버전을 불러오지 못했습니다.'))
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
          message: error instanceof Error ? error.message : '프로젝트 버전을 불러오지 못했습니다.',
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
      setShareLinksState({ phase: 'error', items: [], message: '프로젝트 ID가 없습니다.' })
      return
    }

    let isActive = true
    setShareLinksState({ phase: 'loading', items: [] })

    async function loadShareLinks(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/share-links`))
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '공유 링크를 불러오지 못했습니다.'))
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
          message: error instanceof Error ? error.message : '공유 링크를 불러오지 못했습니다.',
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
      const activeMeter = liveInputMeterRef.current
      if (activeMeter) {
        void activeMeter.stop()
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
        message: '파형과 컨투어 미리보기가 준비되었습니다.',
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
              ? '가장 최근 로컬 테이크에서 파형 미리보기를 만들었습니다.'
              : '저장된 소스 오디오에서 파형 미리보기를 다시 불러왔습니다.',
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setWaveformState({
          phase: 'error',
          message: error instanceof Error ? error.message : '파형 미리보기를 만들지 못했습니다.',
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
    const selectedTrack =
      takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
    const noteFeedback = selectedTrack?.latest_score?.note_feedback_json ?? []

    if (noteFeedback.length === 0) {
      setSelectedNoteFeedbackIndex(0)
      return
    }

    const lowestScoreIndex = noteFeedback.reduce((bestIndex, item, index, items) => {
      return item.note_score < items[bestIndex]!.note_score ? index : bestIndex
    }, 0)

    setSelectedNoteFeedbackIndex(lowestScoreIndex)
  }, [selectedTakeId, takesState.items])

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
        message: '후보를 선택하면 악보를 그리고 화성 스택을 미리들을 수 있습니다.',
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
      message: '편곡 미리듣기를 시작할 수 있습니다.',
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
      setVersionCreateState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    setVersionCreateState({
      phase: 'submitting',
      message: '현재 스튜디오 스냅샷을 프로젝트 히스토리에 저장하는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '프로젝트 버전을 저장하지 못했습니다.'))
      }

      const version = (await response.json()) as ProjectVersionRecord
      await refreshProjectVersions().catch(() => undefined)
      setVersionCreateState({
        phase: 'success',
        message: `"${version.label}" 버전을 저장했고 테이크 스냅샷 ${version.snapshot_summary.take_count}개를 포함했습니다.`,
      })
      if (!versionLabelDraft) {
        setVersionLabelDraft(version.label)
      }
    } catch (error) {
      setVersionCreateState({
        phase: 'error',
        message: error instanceof Error ? error.message : '프로젝트 버전을 저장하지 못했습니다.',
      })
    }
  }

  async function handleCreateShareLink(): Promise<void> {
    if (!projectId) {
      setShareCreateState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    setShareCreateState({
      phase: 'submitting',
      message: '현재 스튜디오 스냅샷에서 읽기 전용 공유 링크를 만드는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '공유 링크를 만들지 못했습니다.'))
      }

      const shareLink = (await response.json()) as ShareLinkRecord
      await Promise.all([
        refreshShareLinks().catch(() => undefined),
        refreshProjectVersions().catch(() => undefined),
      ])
      setShareCreateState({
        phase: 'success',
        message: `"${shareLink.label}" 읽기 전용 공유 링크를 만들었고 ${formatDate(shareLink.expires_at ?? shareLink.created_at)}까지 사용할 수 있습니다.`,
      })
      if (!shareLabelDraft) {
        setShareLabelDraft(shareLink.label)
      }
    } catch (error) {
      setShareCreateState({
        phase: 'error',
        message: error instanceof Error ? error.message : '공유 링크를 만들지 못했습니다.',
      })
    }
  }

  async function handleDeactivateShareLink(shareLinkId: string): Promise<void> {
    setShareDeactivateState({
      phase: 'submitting',
      message: '선택한 공유 링크를 비활성화하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/share-links/${shareLinkId}/deactivate`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '공유 링크를 비활성화하지 못했습니다.'))
      }

      const shareLink = (await response.json()) as ShareLinkRecord
      await refreshShareLinks().catch(() => undefined)
      setShareDeactivateState({
        phase: 'success',
        message: `"${shareLink.label}" 링크를 비활성화했습니다. 기존 수신자도 즉시 접근할 수 없습니다.`,
      })
    } catch (error) {
      setShareDeactivateState({
        phase: 'error',
        message: error instanceof Error ? error.message : '공유 링크를 비활성화하지 못했습니다.',
      })
    }
  }

  async function handleCopyShareLink(shareUrl: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      setShareCopyState({
        phase: 'error',
        message: '이 브라우저에서는 클립보드 접근을 사용할 수 없습니다.',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopyState({
        phase: 'success',
        message: '공유 URL을 클립보드에 복사했습니다.',
      })
    } catch (error) {
      setShareCopyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '공유 URL을 복사하지 못했습니다.',
      })
    }
  }

  async function handleRunAnalysis(): Promise<void> {
    if (!projectId) {
      setAnalysisState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    if (!selectedTake) {
      setAnalysisState({
        phase: 'error',
        message: '녹음 후 분석을 실행하기 전에 먼저 테이크를 선택해 주세요.',
      })
      return
    }

    setAnalysisState({
      phase: 'submitting',
      message: '서버에서 음정과 타이밍을 다시 확인하는 중입니다...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/analysis`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '트랙 분석을 실행하지 못했습니다.'))
      }

      const analysis = (await response.json()) as TrackAnalysisResponse
      await refreshStudioSnapshot().catch(() => null)
      setAnalysisState({
        phase: 'success',
        message: `분석을 저장했습니다. 총점 ${analysis.latest_score.total_score.toFixed(1)}점과 최신 피드백을 확인해 보세요.`,
      })
    } catch (error) {
      setAnalysisState({
        phase: 'error',
        message: error instanceof Error ? error.message : '트랙 분석을 실행하지 못했습니다.',
      })
    }
  }

  async function handleExtractMelody(): Promise<void> {
    if (!projectId) {
      setMelodyState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    if (!selectedTake) {
      setMelodyState({
        phase: 'error',
        message: '멜로디 초안을 추출하기 전에 먼저 테이크를 선택해 주세요.',
      })
      return
    }

    setMelodyState({
      phase: 'submitting',
      message: '선택한 테이크에서 양자화된 멜로디 초안을 추출하는 중입니다...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/melody`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '멜로디 초안을 추출하지 못했습니다.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraft
      setMelodyNotesDraft(melodyDraft.notes_json)
      await refreshStudioSnapshot().catch(() => null)
      setMelodyState({
        phase: 'success',
        message: `멜로디 초안을 저장했습니다. 노트 ${melodyDraft.note_count}개, 키 ${melodyDraft.key_estimate ?? '추정 대기'}입니다.`,
      })
    } catch (error) {
      setMelodyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '멜로디 초안을 추출하지 못했습니다.',
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
        message: '노트 편집을 저장하기 전에 먼저 멜로디 초안을 추출해 주세요.',
      })
      return
    }

    setMelodySaveState({
      phase: 'submitting',
      message: '노트 편집을 저장하고 MIDI 초안을 다시 만드는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '멜로디 초안을 저장하지 못했습니다.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraft
      setMelodyNotesDraft(melodyDraft.notes_json)
      await refreshStudioSnapshot().catch(() => null)
      setMelodySaveState({
        phase: 'success',
        message: `멜로디 노트 ${melodyDraft.note_count}개를 저장하고 MIDI 초안을 다시 만들었습니다.`,
      })
    } catch (error) {
      setMelodySaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : '멜로디 초안을 저장하지 못했습니다.',
      })
    }
  }

  async function handleGenerateArrangements(): Promise<void> {
    if (!projectId) {
      setArrangementState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    if (!selectedTakeMelody) {
      setArrangementState({
        phase: 'error',
        message: '편곡 후보를 만들기 전에 먼저 멜로디 초안을 추출해 주세요.',
      })
      return
    }

    setArrangementState({
      phase: 'submitting',
      message: '최신 멜로디 초안에서 편곡 후보를 생성하는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '편곡 후보를 생성하지 못했습니다.'))
      }

      const payload = (await response.json()) as {
        generation_id: string
        items: ArrangementCandidate[]
      }
      setArrangements(payload.items)
      setSelectedArrangementId(payload.items[0]?.arrangement_id ?? null)
      await refreshStudioSnapshot().catch(() => null)
      setArrangementState({
        phase: 'success',
        message: `비교할 편곡 후보 ${payload.items.length}개를 준비했습니다.`,
      })
    } catch (error) {
      setArrangementState({
        phase: 'error',
        message: error instanceof Error ? error.message : '편곡 후보를 생성하지 못했습니다.',
      })
    }
  }

  async function handleSaveArrangement(): Promise<void> {
    if (!selectedArrangement) {
      setArrangementSaveState({
        phase: 'error',
        message: '편집을 저장하기 전에 먼저 편곡 후보를 선택해 주세요.',
      })
      return
    }

    let parsedParts: ArrangementPart[]
    try {
      parsedParts = JSON.parse(arrangementJsonDraft) as ArrangementPart[]
      if (!Array.isArray(parsedParts) || parsedParts.length === 0) {
        throw new Error('붙여넣은 편곡 데이터에는 최소 한 파트가 있어야 합니다.')
      }
    } catch (error) {
      setArrangementSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : '고급 편집 내용을 읽지 못했습니다.',
      })
      return
    }

    setArrangementSaveState({
      phase: 'submitting',
      message: '편곡 편집을 저장하고 MIDI 산출물을 다시 만드는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '편곡 편집을 저장하지 못했습니다.'))
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
        message: `${updatedArrangement.candidate_code} 편곡을 저장하고 MIDI 파일을 다시 만들었습니다.`,
      })
    } catch (error) {
      setArrangementSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : '편곡 편집을 저장하지 못했습니다.',
      })
    }
  }

  async function handleRetryAnalysisJob(): Promise<void> {
    if (!selectedTakeAnalysisJob || selectedTakeAnalysisJob.status !== 'FAILED') {
      setAnalysisState({
        phase: 'error',
        message: '재실행하려면 실패 상태의 분석 작업이 있는 테이크를 선택해 주세요.',
      })
      return
    }

    setAnalysisState({
      phase: 'submitting',
      message: '같은 트랙과 가이드 기준으로 실패한 분석 작업을 다시 실행하는 중입니다...',
    })

    try {
      const response = await fetch(
        buildApiUrl(`/api/analysis-jobs/${selectedTakeAnalysisJob.job_id}/retry`),
        {
          method: 'POST',
        },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '분석 작업을 재실행하지 못했습니다.'))
      }

      await response.json()
      await refreshStudioSnapshot().catch(() => null)
      setAnalysisState({
        phase: 'success',
        message: '분석을 다시 실행해 최신 결과를 저장했습니다.',
      })
    } catch (error) {
      setAnalysisState({
        phase: 'error',
        message: error instanceof Error ? error.message : '분석 작업을 재실행하지 못했습니다.',
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
        message: '재생을 시작하기 전에 먼저 편곡 후보를 선택해 주세요.',
      })
      return
    }

    const playableParts = selectedArrangement.parts_json.filter((part) => part.notes.length > 0)
    if (playableParts.length === 0) {
      setArrangementTransportState({
        phase: 'error',
        message: '이 편곡에는 아직 재생할 수 있는 노트가 없습니다.',
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
            message: '편곡 미리듣기가 끝났습니다. 여기서 파트를 다듬거나 내보낼 수 있습니다.',
          })
        },
      })

      arrangementPlaybackRef.current = controller
      setArrangementTransportState({
        phase: 'playing',
        message: '편곡 미리듣기를 재생 중입니다.',
      })
    } catch (error) {
      setArrangementTransportState({
        phase: 'error',
        message: error instanceof Error ? error.message : '편곡 미리듣기에 실패했습니다.',
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

    return takePreviewUrls[track.track_id] ?? normalizeAssetUrl(track.source_artifact_url) ?? null
  }

  async function handleRenderMixdown(): Promise<void> {
    const selectedTakeTrack =
      takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
    const selectedTakeUrl = getSelectedTakePlaybackUrl(selectedTakeTrack)
    const mixdownSources = [
      ...(guideSourceUrl && guide && !isTrackMutedByMixer(guide.track_id)
        ? [
            {
              gain: guideMixer?.volume ?? 0.85,
              label: 'Guide',
              url: guideSourceUrl,
            },
          ]
        : []),
      ...(selectedTakeTrack && selectedTakeUrl && !isTrackMutedByMixer(selectedTakeTrack.track_id)
        ? [
            {
              gain: mixerState[selectedTakeTrack.track_id]?.volume ?? 1,
          label: `${selectedTakeTrack.take_no ?? '?'}번 테이크`,
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
        message: `${renderedPreview.labels.join(' + ')} 소스로 로컬 오프라인 믹스다운을 만들었습니다.`,
      })
    } catch (error) {
      replaceMixdownPreview(null)
      setMixdownPreviewState({
        phase: 'error',
        message: error instanceof Error ? error.message : '로컬 오프라인 믹스다운을 만들지 못했습니다.',
      })
    }
  }

  async function handleSaveMixdown(): Promise<void> {
    if (!projectId || !mixdownPreview) {
      setMixdownSaveState({
        phase: 'error',
        message: '프로젝트에 저장하기 전에 먼저 로컬 믹스다운 미리보기를 렌더링해 주세요.',
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
        throw new Error(await readErrorMessage(initResponse, '믹스다운 업로드를 시작하지 못했습니다.'))
      }

      const uploadSession = (await initResponse.json()) as MixdownUploadInitResponse

      await uploadBlobWithProgress({
        url: uploadSession.upload_url,
        method: uploadSession.method,
        blob: mixdownPreview.blob,
        headers: uploadSession.upload_headers,
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
          await readErrorMessage(completeResponse, '믹스다운 업로드를 마무리하지 못했습니다.'),
        )
      }

      const savedMixdown = (await completeResponse.json()) as MixdownTrack
      setMixdownSummary(savedMixdown)
      await refreshStudioSnapshot().catch(() => null)
      setMixdownSaveState({
        phase: 'success',
        message: '믹스다운을 프로젝트 산출물에 저장했고 스튜디오 스냅샷에도 반영했습니다.',
      })
    } catch (error) {
      setMixdownSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : '믹스다운을 저장하지 못했습니다.',
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
        throw new Error(await readErrorMessage(initResponse, '테이크 업로드를 시작하지 못했습니다.'))
      }

      const uploadSession = (await initResponse.json()) as TakeUploadInitResponse

      await uploadBlobWithProgress({
        url: uploadSession.upload_url,
        method: uploadSession.method,
        blob: upload.blob,
        headers: uploadSession.upload_headers,
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
          await readErrorMessage(completeResponse, '테이크 업로드를 완료하지 못했습니다.'),
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
        message: '프로젝트 ID가 없어 테이크를 저장할 수 없습니다.',
      })
      return
    }

    setRecordingState({
      phase: 'uploading',
      message: '테이크를 만들고 오디오를 업로드하는 중입니다...',
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
        throw new Error(await readErrorMessage(createResponse, '테이크를 만들지 못했습니다.'))
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
        message: `${completedTake.take_no ?? '?'}번 테이크 업로드가 완료되었습니다.`,
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
          message: `${failedTake.take_no ?? '?'}번 테이크 업로드에 실패했습니다. 다시 올리거나 새로 녹음해 주세요.`,
        })
        return
      }

      setRecordingState({
        phase: 'error',
        message: error instanceof Error ? error.message : '녹음 업로드에 실패했습니다.',
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
        message: '메트로놈 미리듣기가 끝났습니다.',
      })
    } catch (error) {
      setMetronomePreviewState({
        phase: 'error',
        message: error instanceof Error ? error.message : '메트로놈 미리듣기에 실패했습니다.',
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
        message: '이 브라우저에서는 getUserMedia를 사용할 수 없습니다.',
      })
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      setRecordingState({
        phase: 'error',
        message: '이 브라우저에서는 MediaRecorder를 사용할 수 없습니다.',
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
      await startLiveInputMeter(stream)

      if (countInBeats > 0) {
        setRecordingState({
          phase: 'counting-in',
        message: `${countInBeats}박 카운트인을 재생하는 중입니다...`,
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
          message: '브라우저 레코더에서 오류가 발생했습니다.',
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
        message: '녹음 중입니다. 테이크가 끝나면 중지해 주세요.',
      })
    } catch (error) {
      await cleanupRecordingResources()
      setRecordingState({
        phase: 'error',
        message: error instanceof Error ? error.message : '녹음을 시작하지 못했습니다.',
      })
    }
  }

  async function handleStopRecording(): Promise<void> {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return
    }

    await stopActiveMetronome()
    await stopActiveLiveInputMeter()
    setRecordingState({
      phase: 'uploading',
      message: '테이크를 멈추고 업로드를 준비하는 중입니다...',
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
        message: `${track.take_no ?? '?'}번 테이크 업로드를 다시 시도하는 중입니다...`,
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
        message: `${completedTake.take_no ?? '?'}번 테이크 업로드가 완료되었습니다.`,
      })
    } catch (error) {
      setRecordingState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : '업로드 재시도에 실패했습니다. 새로 녹음해 주세요.',
      })
    }
  }

  async function handleRequestMicrophoneAccess(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState({
        phase: 'error',
        message: '이 브라우저에서는 getUserMedia를 사용할 수 없습니다.',
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
      await refreshCapabilityPreview({ microphonePermissionState: 'granted' })

      permissionStream.getTracks().forEach((streamTrack) => streamTrack.stop())

      setPermissionState({
        phase: 'granted',
        message: '마이크 권한을 허용했습니다. 이제 장치 이름을 볼 수 있습니다.',
      })
    } catch (error) {
      await refreshCapabilityPreview().catch(() => undefined)
      setPermissionState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : '마이크 권한 요청에 실패했습니다.',
      })
    }
  }

  async function handleSaveDeviceProfile(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSaveDeviceState({
        phase: 'error',
        message: '이 브라우저에서는 getUserMedia를 사용할 수 없습니다.',
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

      const AudioContextCtor = getAudioContextConstructor()
      audioContext = AudioContextCtor ? new AudioContextCtor() : null
      const deviceHash = await hashValue(
        typeof settings.deviceId === 'string'
          ? settings.deviceId
          : selectedInputId || 'default-input',
      )
      const capabilitySnapshot = await refreshCapabilityPreview({
        audioContext,
        microphonePermissionState: 'granted',
      })
      const diagnosticFlags = deriveBrowserAudioWarningFlags(capabilitySnapshot)

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
          browser_user_agent: navigator.userAgent,
          requested_constraints: requestedConstraints,
          applied_settings: serializedSettings,
          capabilities: capabilitySnapshot,
          diagnostic_flags: diagnosticFlags,
          actual_sample_rate:
            pickNumber(settings.sampleRate) ?? pickNumber(audioContext?.sampleRate),
          channel_count: pickNumber(settings.channelCount),
          input_latency_est: getTrackLatency(settings),
          base_latency: pickNumber(audioContext?.baseLatency),
          output_latency: audioContext ? getAudioContextOutputLatency(audioContext) : null,
          calibration_method: 'studio-device-panel',
          calibration_confidence: 0.25,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '장치 기록 저장에 실패했습니다.'))
      }

      const savedProfile = (await response.json()) as DeviceProfile
      hydrateDeviceDraft(savedProfile)
      setDeviceProfileState({ phase: 'ready', profile: savedProfile })
      await refreshStudioSnapshot().catch(() => null)
      setPermissionState({
        phase: 'granted',
        message: '마이크 설정을 읽어 저장했습니다.',
      })
      setSaveDeviceState({
        phase: 'success',
        message: '장치 기록을 저장했고, 요청한 입력 설정과 실제 적용 결과도 함께 남겼습니다.',
      })
    } catch (error) {
      await refreshCapabilityPreview().catch(() => undefined)
      setSaveDeviceState({
        phase: 'error',
        message: error instanceof Error ? error.message : '장치 기록 저장에 실패했습니다.',
      })
    } finally {
      captureStream?.getTracks().forEach((streamTrack) => streamTrack.stop())
      await audioContext?.close().catch(() => undefined)
      await refreshAudioInputs(selectedInputId || undefined).catch(() => undefined)
    }
  }

  async function handleGuideUpload(): Promise<void> {
    if (!projectId) {
      setGuideUploadState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    if (!guideFile) {
      setGuideUploadState({ phase: 'error', message: '먼저 가이드 오디오 파일을 선택해 주세요.' })
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
        throw new Error(await readErrorMessage(initResponse, '가이드 업로드를 시작하지 못했습니다.'))
      }

      const uploadSession = (await initResponse.json()) as GuideUploadInitResponse
      const uploadHeaders = buildUploadHeaders(uploadSession.upload_headers, guideFile.type || undefined)
      const uploadResponse = await fetch(uploadSession.upload_url, {
        method: uploadSession.method,
        headers: uploadHeaders,
        body: guideFile,
      })

      if (!uploadResponse.ok) {
        throw new Error(await readErrorMessage(uploadResponse, '가이드 파일 업로드에 실패했습니다.'))
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
          await readErrorMessage(completeResponse, '가이드 트랙을 완료하지 못했습니다.'),
        )
      }

      const guide = (await completeResponse.json()) as GuideTrack
      setGuideState({ phase: 'ready', guide })
      await refreshStudioSnapshot().catch(() => null)
      setGuideUploadState({
        phase: 'success',
        message: '가이드를 업로드해 프로젝트에 연결했습니다.',
      })
      setGuideFile(null)
      if (guideFileInputRef.current) {
        guideFileInputRef.current.value = ''
      }
    } catch (error) {
      setGuideUploadState({
        phase: 'error',
        message: error instanceof Error ? error.message : '가이드 업로드에 실패했습니다.',
      })
    }
  }

  function updateChordTimelineDraftItem(
    index: number,
    field: keyof ChordTimelineDraftItem,
    value: string,
  ): void {
    setChordTimelineDraft((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    )
  }

  function handleAddChordMarker(): void {
    setChordTimelineDraft((current) => {
      const lastEndMs = current.length > 0 ? Number(current[current.length - 1]!.end_ms) || 0 : 0
      const fallbackRoot =
        studioState.phase === 'ready' ? studioState.project.base_key ?? 'C' : 'C'

      return [
        ...current,
        {
          ...createChordTimelineDraftItem(undefined, fallbackRoot),
          start_ms: String(lastEndMs),
          end_ms: String(lastEndMs + 2000),
        },
      ]
    })
  }

  function handleRemoveChordMarker(index: number): void {
    setChordTimelineDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function handleSeedChordTimelineFromProjectKey(): void {
    if (studioState.phase !== 'ready') {
      return
    }

    const keyRoot = studioState.project.base_key?.trim() || 'C'
    const spanMs = Math.max(
      1000,
      Math.round(
        (60000 / (studioState.project.bpm ?? 90)) *
          getAccentEvery(studioState.project.time_signature),
      ),
    )

    setChordTimelineDraft([
      {
        start_ms: '0',
        end_ms: String(spanMs),
        label: `${keyRoot} major`,
        root: keyRoot,
        quality: 'major',
        pitch_classes: '',
      },
    ])
    setProjectHarmonyState({
      phase: 'success',
      message: '현재 프로젝트 키를 기준으로 코드 마커 1개를 만들었습니다. 저장 전에 늘리거나 바꿔 주세요.',
    })
  }

  function handleLoadChordRowsIntoJson(): void {
    try {
      const payload = buildChordTimelinePayload(chordTimelineDraft)
      setChordTimelineJsonDraft(serializeChordTimelineItems(payload))
      setProjectHarmonyState({
        phase: 'success',
        message: '현재 코드 행을 붙여넣기 칸으로 옮겼습니다.',
      })
    } catch (error) {
      setProjectHarmonyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '코드 행을 붙여넣기 형식으로 정리하지 못했습니다.',
      })
    }
  }

  function handleApplyChordImport(): void {
    try {
      const parsed = JSON.parse(chordTimelineJsonDraft) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error('붙여넣기 내용은 목록 형식이어야 합니다.')
      }

      const fallbackRoot =
        studioState.phase === 'ready' ? studioState.project.base_key ?? 'C' : 'C'
      const nextDraft = parsed.map((item, index) =>
        chordTimelineImportItemToDraft(item, index, fallbackRoot),
      )
      setChordTimelineDraft(nextDraft)
      setChordTimelineJsonDraft(serializeChordTimelineItems(buildChordTimelinePayload(nextDraft)))
      setProjectHarmonyState({
        phase: 'success',
        message: `코드 마커 ${nextDraft.length}개를 편집기에 불러왔습니다.`,
      })
    } catch (error) {
      setProjectHarmonyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '붙여넣기 내용을 불러오지 못했습니다.',
      })
    }
  }

  async function handleSaveProjectHarmonyReference(): Promise<void> {
    if (!projectId || studioState.phase !== 'ready') {
      setProjectHarmonyState({
        phase: 'error',
        message: '프로젝트 메타데이터가 아직 준비되지 않았습니다.',
      })
      return
    }

    setProjectHarmonyState({
      phase: 'submitting',
      message: '코드 인식 화성이 사용할 수 있도록 코드 마커를 저장하는 중입니다.',
    })

    try {
      const chordTimelinePayload = buildChordTimelinePayload(chordTimelineDraft)
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chord_timeline_json: chordTimelinePayload,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '코드 타임라인을 저장하지 못했습니다.'))
      }

      const updatedProject = (await response.json()) as Project
      setStudioState({ phase: 'ready', project: updatedProject })
      hydrateChordTimelineDraft(updatedProject)
      setProjectHarmonyState({
        phase: 'success',
        message: `코드 마커 ${chordTimelinePayload.length}개를 저장했습니다. 다시 분석하면 화성 적합도가 코드 인식 경로를 사용합니다.`,
      })
    } catch (error) {
      setProjectHarmonyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '코드 타임라인을 저장하지 못했습니다.',
      })
    }
  }

  if (studioState.phase === 'loading') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">스튜디오</p>
          <h1>프로젝트를 불러오는 중입니다</h1>
          <p className="panel__summary">
            녹음 작업을 열기 전에 프로젝트 기준 상태를 불러오고 있습니다.
          </p>
        </section>
      </div>
    )
  }

  if (studioState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">스튜디오</p>
          <h1>스튜디오를 열 수 없습니다</h1>
          <p className="form-error">{studioState.message}</p>
          <Link className="back-link" to="/">
            프로젝트 목록으로 돌아가기
          </Link>
        </section>
      </div>
    )
  }

  const { project } = studioState
  const latestProfile = deviceProfileState.profile
  const currentCapabilitySnapshot = latestProfile?.capabilities_json ?? capabilityPreview
  const currentCapabilityWarnings =
    latestProfile?.diagnostic_flags_json ?? capabilityWarningFlags
  const guide = guideState.guide
  const inputSelectionDisabled =
    permissionState.phase === 'requesting' || saveDeviceState.phase === 'submitting'
  const transportBpm = project.bpm ?? 92
  const transportAccentEvery = getAccentEvery(project.time_signature)
  const selectedTake =
    takesState.items.find((take) => take.track_id === selectedTakeId) ?? takesState.items[0] ?? null
  const selectedTakePreview = selectedTake ? audioPreviews[selectedTake.track_id] ?? null : null
  const selectedTakePlaybackUrl = getSelectedTakePlaybackUrl(selectedTake)
  const hasReadyEvidenceBatch = takesState.items.some((take) => take.track_status === 'READY')
  const humanRatingPacketUrl =
    projectId && selectedTake
      ? buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/human-rating-packet`)
      : null
  const realEvidenceBatchUrl =
    projectId && selectedTake
      ? buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/real-evidence-batch`)
      : null
  const projectRealEvidenceBatchUrl =
    projectId && hasReadyEvidenceBatch ? buildApiUrl(`/api/projects/${projectId}/real-evidence-batch`) : null
  const selectedTakeScore = selectedTake?.latest_score ?? null
  const selectedTakeNoteFeedback = selectedTakeScore?.note_feedback_json ?? []
  const selectedTakeAnalysisJob = selectedTake?.latest_analysis_job ?? null
  const selectedTakeMelody = selectedTake?.latest_melody ?? null
  const selectedNoteFeedback =
    selectedTakeNoteFeedback[selectedNoteFeedbackIndex] ?? selectedTakeNoteFeedback[0] ?? null
  const chordMarkerCount = project.chord_timeline_json?.length ?? 0
  const chordDraftRowCount = chordTimelineDraft.length
  const noteFeedbackTimelineDurationMs =
    selectedTakeNoteFeedback.length > 0
      ? Math.max(
          selectedTake?.duration_ms ?? 0,
          ...selectedTakeNoteFeedback.map((item) => item.end_ms),
        )
      : Math.max(selectedTake?.duration_ms ?? 0, 1)
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
  const readyTakeCount = takesState.items.filter((take) => take.track_status === 'READY').length
  const totalTrackCount = takesState.items.length + (guide ? 1 : 0)
  const guideMixer = guide ? mixerState[guide.track_id] : null
  const guideSourceUrl = normalizeAssetUrl(guide?.source_artifact_url)
  const guideWavExportUrl = normalizeAssetUrl(guide?.guide_wav_artifact_url)
  const selectedArrangementMusicXmlUrl = normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url)
  const selectedArrangementMidiUrl = normalizeAssetUrl(selectedArrangement?.midi_artifact_url)
  const selectedTakeMelodyMidiUrl = normalizeAssetUrl(selectedTakeMelody?.midi_artifact_url)
  const mixdownPlaybackUrl = normalizeAssetUrl(
    mixdownPreview?.url ?? mixdownSummary?.source_artifact_url ?? null,
  )
  const mixdownSourceLabel = mixdownPreview
    ? '로컬 오프라인 렌더'
    : mixdownSummary
      ? '저장된 프로젝트 산출물'
      : '아직 생성되지 않음'
  const mixdownPreviewSource =
    mixdownPreview?.preview_data ?? mixdownSummary?.preview_data ?? null
  const isRecordingBusy =
    recordingState.phase === 'counting-in' ||
    recordingState.phase === 'recording' ||
    recordingState.phase === 'uploading'
  const liveInputMeterLevelPercent = Math.max(0, Math.min(100, liveInputMeterState.rms * 260))
  const liveInputMeterPeakPercent = Math.max(0, Math.min(100, liveInputMeterState.peak * 140))
  const liveInputMeterTone =
    liveInputMeterState.phase === 'error'
      ? 'error'
      : liveInputMeterState.phase === 'unsupported'
        ? 'loading'
        : liveInputMeterState.phase === 'active'
          ? 'ready'
          : 'loading'
  const consoleMicLabel =
    getConsoleMicLabel(permissionState.phase, Boolean(latestProfile))
  const consoleMicTone =
    permissionState.phase === 'granted'
      ? 'ready'
      : permissionState.phase === 'error'
        ? 'error'
        : 'loading'
  const consoleChordLabel = chordMarkerCount > 0 ? '화성 기준 있음' : '키 기준으로 비교'
  const consoleAlignmentLabel =
    selectedTake?.alignment_confidence === null || selectedTake?.alignment_confidence === undefined
      ? '없음'
      : formatConfidence(selectedTake.alignment_confidence)
  const inspectorDirectionValue =
    selectedNoteFeedback?.sustain_median_cents ?? selectedNoteFeedback?.attack_signed_cents ?? null
  const selectedTakeLabel = selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '선택 없음'
  const selectedTakeScoreLabel = selectedTakeScore
    ? formatPercent(selectedTakeScore.total_score)
    : selectedTake
      ? getTrackStatusLabel(selectedTake.track_status)
      : '대기 중'
  const melodySummaryLabel = selectedTakeMelody
    ? `${selectedTakeMelody.note_count}개 음표`
    : '초안 없음'
  const arrangementSummaryLabel = arrangements.length > 0 ? `${arrangements.length}개 후보` : '후보 없음'
  const arrangementRoute = projectId ? `/projects/${projectId}/arrangement` : null
  const activeWorkspaceMode =
    studioWorkspaceModes.find((mode) => mode.id === workspaceMode) ?? studioWorkspaceModes[0]
  const activeWorkbenchLinks = studioWorkbenchLinks
    .filter((link) => activeWorkspaceMode.sectionIds.includes(link.id))
    .map((link) => ({
      ...link,
      label: studioRailLabels[link.id],
    }))
  const getStudioSectionClassName = (sectionId: StudioSectionId) =>
    `section studio-section ${
      studioSectionModeMap[sectionId] === activeWorkspaceMode.id
        ? 'studio-section--active'
        : 'studio-section--muted'
    }`

  return (
    <div className="page-shell">
      <section className="studio-console-shell">
        <div className="studio-console-strip">
          <div className="studio-console-strip__title">
            <p className="eyebrow">GigaStudy 스튜디오</p>
            <h1>{project.title}</h1>
            <p className="panel__summary">
              가이드 기반 테이크, 노트 단위 피드백, 멜로디 초안 추출, 편곡 미리듣기와 내보내기를
              한 콘솔에서 이어서 진행합니다.
            </p>
          </div>

          <div className="studio-console-strip__meta">
            <span className="studio-utility-chip">
              <strong>{transportBpm} BPM</strong>
              <small>{project.time_signature ?? '4/4'}</small>
            </span>
            <span className="studio-utility-chip">
              <strong>{project.base_key ?? '키 미설정'}</strong>
              <small>{project.base_key ? '기준 키' : '먼저 정해 주세요'}</small>
            </span>
            <span className="studio-utility-chip">
              <strong>{consoleChordLabel}</strong>
              <small>{chordMarkerCount > 0 ? `${chordMarkerCount}개 마커` : '아직 마커 없음'}</small>
            </span>
            <span className={`studio-utility-chip studio-utility-chip--${consoleMicTone}`}>
              <strong>{consoleMicLabel}</strong>
              <small>
                {latestProfile ? `${latestProfile.output_route} · 장치 기록 있음` : '장치 기록 저장 전'}
              </small>
            </span>
            <span className="studio-utility-chip">
              <strong>카운트인 {countInBeats}</strong>
              <small>{metronomeEnabled ? '박자 소리 켜짐' : '박자 소리 꺼짐'}</small>
            </span>
            <span className="studio-utility-chip">
              <strong>정렬 {consoleAlignmentLabel}</strong>
              <small>{selectedTake ? `${selectedTake.take_no ?? '?'}번 중심` : '테이크를 고르면 표시'}</small>
            </span>
          </div>

          <Link className="back-link" to="/">
            홈으로
          </Link>
        </div>

        <div className="studio-console-grid">
          <aside className="panel studio-console-rack">
            <div className="panel-header">
              <div>
                <p className="eyebrow">준비물 랙</p>
                <h2>가이드와 테이크를 한쪽에서 고르고 바로 이어갑니다</h2>
              </div>
              <span className="status-pill status-pill--ready">{totalTrackCount}개 소스</span>
            </div>

            <div className="mini-grid studio-console-rack__summary">
              <div className="mini-card">
                <span>준비 완료</span>
                <strong>{readyTakeCount}개 테이크</strong>
              </div>
              <div className="mini-card">
                <span>선택한 테이크</span>
                <strong>{selectedTakeLabel}</strong>
              </div>
              <div className="mini-card">
                <span>멜로디</span>
                <strong>{melodySummaryLabel}</strong>
              </div>
              <div className="mini-card">
                <span>편곡</span>
                <strong>{arrangementSummaryLabel}</strong>
              </div>
            </div>

            <div className="studio-source-list">
              {guide ? (
                <div className="studio-source-card studio-source-card--guide">
                  <div className="studio-source-card__body">
                    <span className="studio-source-card__eyebrow">가이드</span>
                    <strong>기준으로 들을 곡</strong>
                    <small>
                      {getTrackStatusLabel(guide.track_status)} · {formatDuration(guide.duration_ms)}
                    </small>
                  </div>
                  <span className="candidate-chip candidate-chip--info">
                    {guideSourceUrl ? '듣기 준비됨' : '대기 중'}
                  </span>
                </div>
              ) : (
                <div className="empty-card">
                  <p>아직 가이드가 없습니다.</p>
                  <p>먼저 가이드를 올리면 녹음 기준과 비교 기준이 함께 열립니다.</p>
                </div>
              )}

              {takesState.items.length > 0 ? (
                takesState.items.map((take) => (
                  <button
                    className={`studio-source-card ${
                      selectedTake?.track_id === take.track_id ? 'studio-source-card--selected' : ''
                    }`}
                    key={`source-rack-${take.track_id}`}
                    type="button"
                    onClick={() => setSelectedTakeId(take.track_id)}
                  >
                    <div className="studio-source-card__body">
                      <span className="studio-source-card__eyebrow">{take.take_no ?? '?'}번 테이크</span>
                      <strong>{selectedTake?.track_id === take.track_id ? '지금 보고 있는 테이크' : '이 테이크로 보기'}</strong>
                      <small>
                        {getTrackStatusLabel(take.track_status)} ·{' '}
                        {take.latest_score ? formatPercent(take.latest_score.total_score) : '채점 전'}
                      </small>
                    </div>
                    <span
                      className={`candidate-chip ${
                        selectedTake?.track_id === take.track_id ? 'candidate-chip--selected' : ''
                      }`}
                    >
                      {selectedTake?.track_id === take.track_id ? '집중 중' : '바꾸기'}
                    </span>
                  </button>
                ))
              ) : null}
            </div>

            <div className="studio-console-rack__footer">
              <a className="button-secondary button-secondary--small" href="#recording">
                녹음 구역
              </a>
              <a className="button-secondary button-secondary--small" href="#analysis">
                피드백 보기
              </a>
              {arrangementRoute ? (
                <Link className="button-secondary button-secondary--small" to={arrangementRoute}>
                  편곡 화면
                </Link>
              ) : null}
            </div>
          </aside>

          <div className="studio-console-main">
            <article className="panel studio-console-canvas">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">듣고 보는 면</p>
                  <h2>선택한 테이크를 파형과 음정 흐름으로 확인합니다</h2>
                </div>
                <span
                  className={`status-pill ${
                    selectedTakePreview
                      ? 'status-pill--ready'
                      : waveformState.phase === 'error'
                        ? 'status-pill--error'
                        : 'status-pill--loading'
                  }`}
                >
                  {selectedTakePreview
                    ? '보기 준비됨'
                    : waveformState.phase === 'error'
                      ? '미리보기 오류'
                      : '테이크 대기 중'}
                </span>
              </div>

              {selectedTake ? (
                <div className="support-stack">
                  <div className="studio-console-canvas__meta">
                    <span>{selectedTakeLabel}</span>
                    <span>{getTrackStatusLabel(selectedTake.track_status)}</span>
                    <span>{formatDuration(selectedTake.duration_ms)}</span>
                    <span>
                      {selectedTakePreview
                        ? selectedTakePreview.source === 'local'
                          ? '방금 녹음한 파일'
                          : '저장된 파일'
                        : '미리보기 준비 전'}
                    </span>
                  </div>

                  {selectedTakePreview ? (
                    <WaveformPreview preview={selectedTakePreview} />
                  ) : (
                    <div className="empty-card">
                      <p>아직 파형 미리보기가 없습니다.</p>
                      <p>테이크를 녹음하거나 저장된 오디오가 있는 처리 완료 테이크를 선택해 주세요.</p>
                    </div>
                  )}

                  <div className="mini-card mini-card--stack">
                    <span>재생은 한 곳에서</span>
                    <strong>아래 시간선에서만 들어보면 됩니다</strong>
                    <small>
                      가이드와 선택한 테이크 듣기는 아래 시간선의 플레이어에만 모아 두었습니다.
                    </small>
                  </div>
                </div>
              ) : (
                <div className="empty-card">
                  <p>선택된 테이크가 없습니다.</p>
                  <p>첫 테이크를 녹음하거나 아래 트랜스포트 레일에서 선택해 주세요.</p>
                </div>
              )}
            </article>

            <article className="panel studio-console-transport">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">시간선</p>
                  <h2>녹음과 테이크 정리를 아래 레일에서 이어갑니다</h2>
                </div>
                <span className="status-pill status-pill--ready">{totalTrackCount}개 트랙</span>
              </div>

              <div className="studio-console-actions">
                <button
                  data-testid="quick-start-take-button"
                  className="button-primary"
                  type="button"
                  disabled={isRecordingBusy}
                  onClick={() => void handleStartRecording()}
                >
                  {recordingState.phase === 'counting-in'
                    ? '카운트인 중...'
                    : recordingState.phase === 'uploading'
                      ? '업로드 중...'
                      : '테이크 녹음'}
                </button>

                <button
                  data-testid="quick-stop-take-button"
                  className="button-secondary"
                  type="button"
                  disabled={recordingState.phase !== 'recording'}
                  onClick={() => void handleStopRecording()}
                >
                  테이크 중지
                </button>

                <button
                  className="button-secondary"
                  type="button"
                  disabled={metronomePreviewState.phase === 'submitting'}
                  onClick={() => void handlePreviewMetronome()}
                >
                  {metronomePreviewState.phase === 'submitting'
                    ? '미리듣기 재생 중...'
                    : '메트로놈 미리듣기'}
                </button>

                <button
                  data-testid="quick-analyze-take-button"
                  className="button-secondary"
                  type="button"
                  disabled={selectedTake === null || analysisState.phase === 'submitting'}
                  onClick={() => void handleRunAnalysis()}
                >
                  {analysisState.phase === 'submitting'
                    ? '분석 중...'
                    : '선택한 테이크 분석'}
                </button>
              </div>

              <p
                className={
                  recordingState.phase === 'error' || analysisState.phase === 'error'
                    ? 'form-error'
                    : 'status-card__hint'
                }
              >
                {recordingState.phase === 'error'
                  ? recordingState.message
                  : analysisState.phase === 'error'
                    ? analysisState.message
                    : metronomePreviewState.phase === 'success'
                      ? metronomePreviewState.message
                      : selectedTake
                        ? '이 하단 레일에서 콘솔을 벗어나지 않고 연습, 테이크 전환, 재채점을 이어갈 수 있습니다.'
                        : '가이드를 연결하고 마이크 권한을 받은 뒤 여기서 첫 테이크를 녹음해 주세요.'}
              </p>

              {(guideSourceUrl || selectedTakePlaybackUrl) ? (
                <div className="studio-console-players">
                  {guideSourceUrl ? (
                    <div className="studio-console-player">
                      <span>가이드 재생</span>
                      <ManagedAudioPlayer
                        muted={guide ? isTrackMutedByMixer(guide.track_id) : false}
                        src={guideSourceUrl}
                        volume={guideMixer?.volume ?? 0.85}
                      />
                    </div>
                  ) : null}

                  {selectedTakePlaybackUrl ? (
                    <div className="studio-console-player">
                      <span>선택한 테이크</span>
                      <ManagedAudioPlayer
                        muted={selectedTake ? isTrackMutedByMixer(selectedTake.track_id) : false}
                        src={selectedTakePlaybackUrl}
                        volume={selectedTake ? (mixerState[selectedTake.track_id]?.volume ?? 1) : 1}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="track-lane">
                {guide ? (
                  <div className="track-row">
                    <div className="track-row__meta">
                      <strong>가이드</strong>
                      <span>{getTrackStatusLabel(guide.track_status)}</span>
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
                        {(mixerState[guide.track_id]?.muted ?? false) ? '음소거 해제' : '음소거'}
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
                        {(mixerState[guide.track_id]?.solo ?? false) ? '솔로 해제' : '솔로'}
                      </button>

                      <label className="track-row__slider">
                        <span>볼륨</span>
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

                {takesState.items.map((take) => {
                  const progress = takeUploadProgress[take.track_id]

                  return (
                    <div
                      className={`track-row ${
                        selectedTake?.track_id === take.track_id ? 'track-row--selected' : ''
                      }`}
                      key={`console-track-${take.track_id}`}
                    >
                      <div className="track-row__meta">
                        <strong>{take.take_no ?? '?'}번 테이크</strong>
                        <span>
                          {getTrackStatusLabel(take.track_status)}
                          {take.latest_score ? ` · ${formatPercent(take.latest_score.total_score)}` : ''}
                        </span>
                      </div>

                      <div className="track-row__controls">
                        {typeof progress === 'number' && progress < 100 ? (
                          <span className="studio-inline-status">업로드 {progress}%</span>
                        ) : null}

                        <button
                          className="button-secondary button-secondary--small"
                          type="button"
                          onClick={() => setSelectedTakeId(take.track_id)}
                        >
                          {selectedTake?.track_id === take.track_id ? '선택됨' : '선택'}
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
                          {(mixerState[take.track_id]?.muted ?? false) ? '음소거 해제' : '음소거'}
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
                          {(mixerState[take.track_id]?.solo ?? false) ? '솔로 해제' : '솔로'}
                        </button>

                        <label className="track-row__slider">
                          <span>볼륨</span>
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
                  )
                })}

                {takesState.items.length === 0 ? (
                  <div className="empty-card">
                    <p>아직 테이크가 없습니다.</p>
                    <p>첫 테이크를 녹음하면 레인과 파형 검토 흐름이 함께 열립니다.</p>
                  </div>
                ) : null}
              </div>
            </article>
          </div>

          <aside className="panel studio-console-inspector">
            <div className="panel-header">
              <div>
                <p className="eyebrow">바로 확인할 내용</p>
                <h2>점수와 보정 포인트를 오른쪽에 모아 둡니다</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeScore
                    ? 'status-pill--ready'
                    : selectedTakeAnalysisJob?.status === 'FAILED'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {selectedTakeScore
                  ? '채점 완료'
                  : getAnalysisJobStatusLabel(selectedTakeAnalysisJob?.status)}
              </span>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>선택한 테이크</span>
                <strong>{selectedTakeLabel}</strong>
              </div>
              <div className="mini-card">
                <span>현재 상태</span>
                <strong>{selectedTakeScoreLabel}</strong>
              </div>
              <div className="mini-card">
                <span>음정 기준</span>
                <strong>{getPitchQualityModeLabel(selectedTakeScore?.pitch_quality_mode)}</strong>
              </div>
              <div className="mini-card">
                <span>화음 기준</span>
                <strong>{getHarmonyReferenceLabel(selectedTakeScore?.harmony_reference_mode)}</strong>
              </div>
            </div>

            <div className="score-grid">
              <div className="score-card">
                <span>음정</span>
                <strong>{formatPercent(selectedTakeScore?.pitch_score ?? null)}</strong>
              </div>
              <div className="score-card">
                <span>리듬</span>
                <strong>{formatPercent(selectedTakeScore?.rhythm_score ?? null)}</strong>
              </div>
              <div className="score-card">
                <span>화성 적합도</span>
                <strong>{formatPercent(selectedTakeScore?.harmony_fit_score ?? null)}</strong>
              </div>
              <div className="score-card score-card--highlight">
                <span>총점</span>
                <strong>{formatPercent(selectedTakeScore?.total_score ?? null)}</strong>
              </div>
            </div>

            {selectedNoteFeedback ? (
              <article className="studio-inspector-note">
                <div className="studio-inspector-note__header">
                  <div>
                    <span>보정이 필요한 노트</span>
                    <strong>
                      {midiToPitchName(selectedNoteFeedback.target_midi)} · {selectedNoteFeedback.note_index + 1}번 노트
                    </strong>
                  </div>
                  <span
                    className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                      inspectorDirectionValue,
                    )}`}
                  >
                    {getPitchDirectionLabel(inspectorDirectionValue)}
                  </span>
                </div>

                <p>{selectedNoteFeedback.message}</p>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>시작음</span>
                    <strong>{formatSignedCents(selectedNoteFeedback.attack_signed_cents)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>유지음</span>
                    <strong>{formatSignedCents(selectedNoteFeedback.sustain_median_cents)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>타이밍</span>
                    <strong>{formatSignedMs(selectedNoteFeedback.timing_offset_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>신뢰도</span>
                    <strong>{formatConfidence(selectedNoteFeedback.confidence)}</strong>
                  </div>
                </div>
              </article>
            ) : (
              <div className="empty-card">
                <p>아직 선택된 노트 상세 정보가 없습니다.</p>
                <p>먼저 분석을 실행한 뒤 아래 노트 피드백 영역에서 노트별 보정을 확인해 주세요.</p>
              </div>
            )}

            <div className="support-stack">
              <div className="mini-card mini-card--stack">
                <span>사람 평가 자료</span>
                <strong>
                  {selectedTake
                    ? selectedTakeScore
                      ? '노트별 자료까지 함께 준비됩니다'
                      : '지금도 받을 수 있고, 분석 후엔 더 자세해집니다'
                    : '테이크를 먼저 고르면 준비됩니다'}
                </strong>
                <small>
                  {selectedTake
                    ? selectedTakeScore
                      ? '가이드, 테이크, 노트 클립, 평가 시트를 한 번에 내려받아 바로 사람 평가를 시작할 수 있습니다.'
                      : '가이드와 테이크는 바로 담아 드리고, 분석을 마치면 노트별 클립과 리뷰 화면도 함께 들어갑니다.'
                    : '사람 평가를 시작하려면 먼저 평가할 테이크를 선택해 주세요.'}
                </small>
                <div className="support-stack">
                  {humanRatingPacketUrl ? (
                  <a
                    data-testid="download-human-rating-packet-button"
                    className="button-secondary button-secondary--small"
                    href={humanRatingPacketUrl}
                  >
                    평가 자료 받기
                  </a>
                ) : (
                  <button className="button-secondary button-secondary--small" disabled type="button">
                    평가 자료 받기
                  </button>
                  )}
                  {realEvidenceBatchUrl ? (
                    <a
                      data-testid="download-real-evidence-batch-button"
                      className="button-secondary button-secondary--small"
                      href={realEvidenceBatchUrl}
                    >
                      {"\uC120\uD0DD \uD14C\uC774\uD06C \uBB36\uC74C"}
                    </a>
                  ) : (
                    <button className="button-secondary button-secondary--small" disabled type="button">
                      {"\uC120\uD0DD \uD14C\uC774\uD06C \uBB36\uC74C"}
                    </button>
                  )}
                  {projectRealEvidenceBatchUrl ? (
                    <a
                      data-testid="download-project-real-evidence-batch-button"
                      className="button-secondary button-secondary--small"
                      href={projectRealEvidenceBatchUrl}
                    >
                      {"\uC900\uBE44\uB41C \uD14C\uC774\uD06C \uBB36\uC74C"}
                    </a>
                  ) : (
                    <button className="button-secondary button-secondary--small" disabled type="button">
                      {"\uC900\uBE44\uB41C \uD14C\uC774\uD06C \uBB36\uC74C"}
                    </button>
                  )}
                </div>
              </div>

              <div className="mini-card mini-card--stack">
                <span>환경 경고</span>
                <strong>
                  {currentCapabilityWarnings.length > 0
                    ? `${currentCapabilityWarnings.length}개 활성`
                    : '활성 경고 없음'}
                </strong>
                <small>
                  {currentCapabilityWarnings.length > 0
                    ? currentCapabilityWarnings
                        .slice(0, 3)
                        .map((flag) => getBrowserAudioWarningLabel(flag))
                        .join(' · ')
                    : '이 경로에서는 녹음, 권한, 재생 흐름이 모두 사용 가능한 상태로 보입니다.'}
                </small>
              </div>

              <div className="mini-card mini-card--stack">
                <span>다음 작업</span>
                <strong>아래 구역에서 세부 조정과 저장을 이어갑니다</strong>
                <small>
                  장치 기록, 코드 마커, 멜로디, 편곡, 믹스다운, 공유를 아래 워크벤치에서 차례대로
                  이어갈 수 있습니다.
                </small>
              </div>
            </div>
          </aside>
        </div>

        <nav className="studio-workrail" aria-label="스튜디오 워크벤치">
          <span className="studio-workrail__label">지금 필요한 바로가기</span>
          {activeWorkbenchLinks.map((link) => (
            <a
              className="studio-workrail__link"
              data-testid={`studio-workrail-link-${link.id}`}
              href={`#${link.id}`}
              key={link.id}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="studio-workspace-switch" data-testid="studio-workspace-modes">
          <div className="studio-workspace-switch__copy">
            <p className="eyebrow">작업 모드</p>
            <h2>지금은 {activeWorkspaceMode.label}에 집중하면 됩니다</h2>
            <p className="panel__summary">{activeWorkspaceMode.summary}</p>
          </div>

          <div className="studio-workspace-switch__actions">
            {studioWorkspaceModes.map((mode) => (
              <button
                key={mode.id}
                className={`studio-workspace-switch__button ${
                  activeWorkspaceMode.id === mode.id ? 'studio-workspace-switch__button--active' : ''
                }`}
                data-testid={`studio-workspace-mode-${mode.id}`}
                type="button"
                aria-pressed={activeWorkspaceMode.id === mode.id}
                onClick={() => setWorkspaceMode(mode.id)}
              >
                <span>{mode.eyebrow}</span>
                <strong>{mode.label}</strong>
                <small>{mode.summary}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={getStudioSectionClassName('harmony-authoring')} id="harmony-authoring">
        <div className="section__header">
          <p className="eyebrow">화성 기준 연결</p>
          <h2>코드 타임라인을 연결해 화성 적합도를 키 기준 대체 경로에서 벗어나게 합니다</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">화성 기준 작성</p>
                <h2>스튜디오 안에서 코드 마커를 만듭니다</h2>
              </div>
              <span
                className={`status-pill ${
                  chordMarkerCount > 0 ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {chordMarkerCount > 0 ? `저장된 마커 ${chordMarkerCount}개` : '키 기준 대체 경로'}
              </span>
            </div>

            <p className="panel__summary">
              화성 기준을 직접 연결하면 키 중심의 대체 판정보다 더 구체적인 화성 적합도를 확인할 수
              있습니다. 여기서 코드 마커를 저장한 뒤 분석을 다시 실행해 보세요.
            </p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>저장된 마커</span>
                <strong>{chordMarkerCount}</strong>
                <small>
                  {chordMarkerCount > 0
                    ? '분석을 다시 실행하면 코드 인식 화성 경로를 사용할 수 있습니다.'
                    : '아직 코드 타임라인이 없어 화성 적합도는 키 기준 대체 경로를 사용합니다.'}
                </small>
              </div>
              <div className="mini-card">
                <span>초안 행</span>
                <strong>{chordDraftRowCount}</strong>
                <small>
                  악보 작성 도구처럼 무겁게 만들기보다, 화성 적합도를 정직하게 만들 만큼만 유지하세요.
                </small>
              </div>
              <div className="mini-card">
                <span>프로젝트 키</span>
                <strong>{project.base_key ?? '미설정'}</strong>
                <small>프로젝트 메타데이터에서 첫 마커를 만들 때 시드 기준으로 사용합니다.</small>
              </div>
              <div className="mini-card">
                <span>타임 그리드 힌트</span>
                <strong>{project.time_signature ?? '4/4'} · {transportBpm} BPM</strong>
                <small>준비된 타임라인을 가져오지 않을 때 마커 길이를 가늠하는 기준으로 사용하세요.</small>
              </div>
            </div>

            <div className="button-row">
              <button className="button-primary" type="button" onClick={handleAddChordMarker}>
                코드 마커 추가
              </button>
              <button
                data-testid="seed-chord-from-key-button"
                className="button-secondary"
                type="button"
                onClick={handleSeedChordTimelineFromProjectKey}
              >
                현재 키로 시작
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={handleLoadChordRowsIntoJson}
              >
                붙여넣기 칸 채우기
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={handleApplyChordImport}
              >
                붙여넣기 반영
              </button>
              <button
                data-testid="save-chord-timeline-button"
                className="button-secondary"
                type="button"
                disabled={projectHarmonyState.phase === 'submitting'}
                onClick={() => void handleSaveProjectHarmonyReference()}
              >
                {projectHarmonyState.phase === 'submitting'
                  ? '화성 기준 저장 중...'
                  : '코드 타임라인 저장'}
              </button>
            </div>

            {projectHarmonyState.phase === 'success' || projectHarmonyState.phase === 'error' ? (
              <p
                className={
                  projectHarmonyState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {projectHarmonyState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                시작 시간과 끝 시간은 밀리초 기준으로 적어 주세요. 대부분은 코드 이름만 있어도
                시작할 수 있고, 세부 음 정보는 필요할 때만 더하면 됩니다.
              </p>
            )}

            {chordTimelineDraft.length > 0 ? (
              <div className="chord-list">
                {chordTimelineDraft.map((item, index) => (
                  <article className="chord-row" key={`chord-marker-${index}`}>
                    <div className="field">
                      <span>시작 ms</span>
                      <input
                        className="text-input"
                        inputMode="numeric"
                        value={item.start_ms}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'start_ms', event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <span>끝 ms</span>
                      <input
                        className="text-input"
                        inputMode="numeric"
                        value={item.end_ms}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'end_ms', event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <span>라벨</span>
                      <input
                        className="text-input"
                        value={item.label}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'label', event.target.value)
                        }
                        placeholder="A 메이저"
                      />
                    </div>
                    <div className="field">
                      <span>루트</span>
                      <input
                        className="text-input"
                        value={item.root}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'root', event.target.value)
                        }
                        placeholder="A"
                      />
                    </div>
                    <div className="field">
                      <span>성격</span>
                      <input
                        className="text-input"
                        value={item.quality}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'quality', event.target.value)
                        }
                        placeholder="major, minor, dom7"
                      />
                    </div>
                    <div className="field">
                      <span>피치 클래스</span>
                      <input
                        className="text-input"
                        value={item.pitch_classes}
                        onChange={(event) =>
                          updateChordTimelineDraftItem(index, 'pitch_classes', event.target.value)
                        }
                        placeholder="0, 4, 7"
                      />
                    </div>
                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => handleRemoveChordMarker(index)}
                    >
                      삭제
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-card">
                <p>편집기에 아직 코드 마커가 없습니다.</p>
                <p>직접 추가하거나 프로젝트 키에서 시작한 뒤, 준비된 목록을 붙여 넣어 이어갈 수 있습니다.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">고급 붙여넣기</p>
                <h2>준비된 코드 목록을 붙여 넣어 편집기로 가져옵니다</h2>
              </div>
              <span
                className={`status-pill ${
                  chordMarkerCount > 0 ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {chordMarkerCount > 0 ? '코드 인식 경로 사용 가능' : '대체 경로만 사용'}
              </span>
            </div>

            <p className="panel__summary">
              다른 도구에서 이미 만든 코드 목록이 있다면 여기 붙여 넣어 편집기에 반영할 수 있습니다.
              평소에는 위쪽 행 편집기만으로도 충분합니다.
            </p>

            <details className="advanced-panel">
              <summary className="advanced-panel__summary">고급 붙여넣기 열기</summary>
              <div className="advanced-panel__body">
                <label className="field">
                  <span>코드 목록 붙여넣기</span>
                  <textarea
                    className="text-input json-card--editor"
                    value={chordTimelineJsonDraft}
                    onChange={(event) => setChordTimelineJsonDraft(event.target.value)}
                    spellCheck={false}
                  />
                </label>

                <div className="empty-card empty-card--warn">
                  <p>붙여 넣기 전에 확인하세요.</p>
                  <p>각 구간의 시작 시간, 끝 시간, 코드 이름이 순서대로 들어 있으면 대부분 바로 가져올 수 있습니다.</p>
                </div>
              </div>
            </details>
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('audio-setup')} id="audio-setup">
        <div className="section__header">
          <p className="eyebrow">입력 준비</p>
          <h2>오디오 설정과 가이드 연결</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">장치 패널</p>
                <h2>마이크 권한을 열고 장치 기록을 저장합니다</h2>
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
                  ? '마이크 준비됨'
                  : permissionState.phase === 'error'
                    ? '마이크 차단됨'
                    : permissionState.phase === 'requesting'
                      ? '요청 중'
                      : '마이크 권한 미요청'}
              </span>
            </div>

            <p className="panel__summary">
              요청한 입력 설정과 실제 적용 결과를 함께 저장해, 이후 피드백에서 장치 차이를 추정이
              아니라 기록으로 설명할 수 있게 합니다.
            </p>

            <div className="button-row">
              <button
                data-testid="request-microphone-button"
                className="button-primary"
                type="button"
                disabled={permissionState.phase === 'requesting'}
                onClick={() => void handleRequestMicrophoneAccess()}
              >
                {permissionState.phase === 'requesting'
                  ? '권한 요청 중...'
                  : '마이크 권한 요청'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshAudioInputs().catch(() => undefined)}
              >
                입력 장치 목록 새로고침
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
                브라우저 장치 이름과 실시간 설정을 보려면 먼저 한 번 권한을 허용해 주세요.
              </p>
            )}

            <div className="field-grid">
              <label className="field">
                <span>입력 장치</span>
                <select
                  className="text-input"
                  value={selectedInputId}
                  disabled={inputSelectionDisabled || audioInputs.length === 0}
                  onChange={(event) => setSelectedInputId(event.target.value)}
                >
                  {audioInputs.length === 0 ? (
                    <option value="">아직 감지된 마이크가 없습니다</option>
                  ) : null}
                  {audioInputs.map((device, index) => (
                    <option key={device.deviceId || `audio-input-${index}`} value={device.deviceId}>
                      {device.label || `마이크 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>출력 경로</span>
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
                  <strong>에코 줄이기</strong>
                  <span>울림과 되먹임을 줄이도록 브라우저에 요청하고 결과도 함께 남깁니다.</span>
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
                  <strong>자동 음량 보정</strong>
                  <span>브라우저가 입력 음량을 자동으로 손봤는지 함께 기록합니다.</span>
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
                  <strong>잡음 줄이기</strong>
                  <span>배경 잡음을 얼마나 줄였는지 확인할 수 있도록 기록합니다.</span>
                </div>
              </label>
            </div>

            <label className="field field--compact">
              <span>요청 채널 수</span>
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
                data-testid="save-device-profile-button"
                className="button-primary"
                type="button"
                disabled={saveDeviceState.phase === 'submitting'}
                onClick={() => void handleSaveDeviceProfile()}
              >
                {saveDeviceState.phase === 'submitting'
                  ? '장치 기록 저장 중...'
                  : '장치 기록 저장'}
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

            <div className="mini-grid">
              <div className="mini-card mini-card--stack">
                <span>요청한 입력 설정</span>
                <strong>
                  {[
                    constraintDraft.echoCancellation ? '에코 줄이기 켜짐' : '에코 줄이기 꺼짐',
                    constraintDraft.autoGainControl ? '자동 음량 보정 켜짐' : '자동 음량 보정 꺼짐',
                    constraintDraft.noiseSuppression ? '잡음 줄이기 켜짐' : '잡음 줄이기 꺼짐',
                  ].join(' · ')}
                </strong>
                <small>요청 채널 수 {constraintDraft.channelCount}채널</small>
              </div>

              <div className="mini-card mini-card--stack">
                <span>최근 적용 결과</span>
                <strong>
                  {appliedSettingsPreview
                    ? `${String((appliedSettingsPreview as Record<string, unknown>).sampleRate ?? '알 수 없음')} Hz / ${String((appliedSettingsPreview as Record<string, unknown>).channelCount ?? '알 수 없음')}채널`
                    : '권한 허용 후 채워집니다'}
                </strong>
                <small>브라우저가 실제로 적용한 입력 상태를 기준으로 저장합니다.</small>
              </div>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>최근 저장</span>
                <strong>
                  {deviceProfileState.phase === 'loading'
                    ? '불러오는 중...'
                    : latestProfile
                      ? formatDate(latestProfile.updated_at)
                      : '아직 저장된 프로필이 없습니다'}
                </strong>
              </div>
              <div className="mini-card">
                <span>실제 샘플레이트</span>
                <strong>{latestProfile?.actual_sample_rate ?? '알 수 없음'}</strong>
              </div>
              <div className="mini-card">
                <span>채널 수</span>
                <strong>{latestProfile?.channel_count ?? '알 수 없음'}</strong>
              </div>
              <div className="mini-card">
                <span>출력 경로</span>
                <strong>{latestProfile?.output_route ?? outputRoute}</strong>
              </div>
              <div className="mini-card">
                <span>브라우저</span>
                <strong>
                  {latestProfile
                    ? `${latestProfile.browser} / ${latestProfile.os}`
                    : '미리보기 전용'}
                </strong>
                <small>
                  {latestProfile?.browser_user_agent
                    ? latestProfile.browser_user_agent
                    : '저장 시 user agent를 함께 남겨 하드웨어별 이슈를 설명 가능하게 만듭니다.'}
                </small>
              </div>
              <div className="mini-card">
                <span>녹음 형식</span>
                <strong>{summarizeRecorderSupport(currentCapabilitySnapshot)}</strong>
              </div>
              <div className="mini-card">
                <span>브라우저 재생 경로</span>
                <strong>{summarizeWebAudioSupport(currentCapabilitySnapshot)}</strong>
              </div>
              <div className="mini-card">
                <span>브라우저 오디오 준비</span>
                <strong>{summarizeBrowserAudioStack(currentCapabilitySnapshot)}</strong>
                <small>입력 표시, 빠른 계산, 브라우저 안 미리듣기 준비 상태입니다.</small>
              </div>
              <div className="mini-card">
                <span>마이크 권한</span>
                <strong>{currentCapabilitySnapshot?.permissions.microphone ?? '알 수 없음'}</strong>
              </div>
              <div className="mini-card">
                <span>출력 지연 API</span>
                <strong>
                  {currentCapabilitySnapshot?.web_audio.output_latency_supported ? '사용 가능' : '사용 불가'}
                </strong>
              </div>
              <div className="mini-card">
                <span>오프라인 렌더</span>
                <strong>
                  {currentCapabilitySnapshot?.web_audio.offline_audio_context ? '사용 가능' : '사용 불가'}
                </strong>
              </div>
            </div>

            {deviceProfileState.phase === 'error' ? (
              <p className="form-error">{deviceProfileState.message}</p>
            ) : null}

            {latestProfile ? (
              <div className="support-stack">
                <div>
                  <p className="json-label">저장된 환경 경고</p>
                  {currentCapabilityWarnings.length > 0 ? (
                    <ul className="ticket-list">
                      {currentCapabilityWarnings.map((flag) => (
                        <li key={flag}>
                          <strong>{flag}</strong>
                          <span>{getBrowserAudioWarningLabel(flag)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-card">
                      <p>저장된 프로필에는 활성 경고가 없습니다.</p>
                      <p>이 경로에서는 녹음, 권한, 재생 흐름이 모두 사용 가능한 상태로 보입니다.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : currentCapabilitySnapshot ? (
              <div className="support-stack">
                <div>
                  <p className="json-label">현재 환경 경고</p>
                  {currentCapabilityWarnings.length > 0 ? (
                    <ul className="ticket-list">
                      {currentCapabilityWarnings.map((flag) => (
                        <li key={flag}>
                          <strong>{flag}</strong>
                          <span>{getBrowserAudioWarningLabel(flag)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-card">
                      <p>현재 브라우저 미리보기에는 활성 경고가 없습니다.</p>
                      <p>이 상태를 프로젝트 작업 흐름에 남기려면 장치 기록을 저장해 주세요.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">가이드 트랙</p>
                <h2>가이드 하나를 올리고 바로 재생할 수 있게 유지합니다</h2>
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
                  ? '가이드 연결됨'
                  : guideState.phase === 'error'
                    ? '가이드 오류'
                    : '가이드 대기 중'}
              </span>
            </div>

            <p className="panel__summary">
              가이드 업로드 준비, 파일 전송, 마무리 처리, 최신 가이드 재생까지 한 흐름으로
              이어집니다.
            </p>

            <label className="field">
              <span>가이드 오디오 파일</span>
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
                업로드 준비됨: {guideFile.name} ({Math.round(guideFile.size / 1024)} KB)
              </p>
            ) : (
              <p className="status-card__hint">
                이 프로젝트의 첫 소스 트랙이 될 가이드 파일을 선택해 주세요.
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
                  ? '가이드 업로드 중...'
                  : '가이드 업로드'}
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
                    <span>상태</span>
                    <strong>{getTrackStatusLabel(guide.track_status)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>형식</span>
                    <strong>{guide.source_format ?? '알 수 없음'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>길이</span>
                    <strong>{formatDuration(guide.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>샘플레이트</span>
                    <strong>{guide.actual_sample_rate ?? '알 수 없음'}</strong>
                  </div>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>스토리지 키</span>
                  <strong>{guide.storage_key ?? '없음'}</strong>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>체크섬</span>
                  <strong>{guide.checksum ?? '없음'}</strong>
                </div>

                {guide.failure_message ? (
                  <p className="form-error">{guide.failure_message}</p>
                ) : null}

                {guideSourceUrl ? (
                  <div className="audio-preview">
                    <p className="json-label">가이드 재생</p>
                    <ManagedAudioPlayer
                      muted={guide ? isTrackMutedByMixer(guide.track_id) : false}
                      src={guideSourceUrl}
                      volume={guideMixer?.volume ?? 0.85}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>이 프로젝트에는 아직 가이드가 없습니다.</p>
                <p>녹음, 비교, 믹스다운이 같은 기준 트랙을 쓰도록 먼저 가이드 하나를 올려 주세요.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('recording')} id="recording">
        <div className="section__header">
          <p className="eyebrow">녹음 흐름</p>
          <h2>트랜스포트 준비와 테이크 녹음</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">트랜스포트</p>
                <h2>녹음 전에 템포, 카운트인, 메트로놈을 맞춥니다</h2>
              </div>
              <span
                className={`status-pill ${
                  metronomeEnabled ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {metronomeEnabled ? '메트로놈 켜짐' : '메트로놈 꺼짐'}
              </span>
            </div>

            <p className="panel__summary">
              가이드 재생과 사전 준비 토글을 함께 두고, 템포, 키, 메트로놈, 카운트인을 이곳에서 바로
              확인합니다.
            </p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>템포</span>
                <strong>{transportBpm} BPM</strong>
              </div>
              <div className="mini-card">
                <span>키</span>
                <strong>{project.base_key ?? '미설정'}</strong>
              </div>
              <div className="mini-card">
                <span>박자</span>
                <strong>{project.time_signature ?? '4/4'}</strong>
              </div>
              <div className="mini-card">
                <span>강박 주기</span>
                <strong>{transportAccentEvery}박</strong>
              </div>
            </div>

            <div className="toggle-grid">
              <label className="toggle-card">
                <input
                  data-testid="metronome-recording-checkbox"
                  type="checkbox"
                  checked={metronomeEnabled}
                  onChange={(event) => setMetronomeEnabled(event.target.checked)}
                />
                <div>
                  <strong>녹음 중 메트로놈</strong>
                  <span>테이크를 녹음하는 동안 헤드폰에서 가이드 템포를 계속 들려줍니다.</span>
                </div>
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>카운트인 길이</span>
                <select
                  data-testid="count-in-select"
                  className="text-input"
                  value={countInBeats}
                  onChange={(event) => setCountInBeats(Number(event.target.value))}
                >
                  <option value={0}>사용 안 함</option>
                  <option value={2}>2박</option>
                  <option value={4}>4박</option>
                  <option value={8}>8박</option>
                </select>
              </label>

              <label className="field">
                <span>선택한 테이크</span>
                <input
                  className="text-input"
                  value={selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '아직 테이크 없음'}
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
                  ? '미리듣기 재생 중...'
                  : '메트로놈 미리듣기'}
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
                다음 테이크 전에 미리듣기로 박 감각을 한 번 점검해 보세요.
              </p>
            )}
          </article>

          <article className="panel studio-block" data-testid="recorder-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">레코더</p>
                <h2>반복 테이크를 녹음하고 상태와 함께 업로드합니다</h2>
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
              녹음을 시작하고, 멈추고, 테이크를 만들고, 오디오를 업로드하며, 진행 상태를 보존하고,
              실패한 업로드를 테이크 슬롯을 잃지 않고 다시 시도합니다.
            </p>

            <div className="button-row">
              <button
                data-testid="start-take-button"
                className="button-primary"
                type="button"
                disabled={isRecordingBusy}
                onClick={() => void handleStartRecording()}
              >
                {recordingState.phase === 'counting-in'
                  ? '카운트인 중...'
                  : recordingState.phase === 'uploading'
                    ? '업로드 중...'
                    : '테이크 녹음 시작'}
              </button>

              <button
                data-testid="stop-take-button"
                className="button-secondary"
                type="button"
                disabled={recordingState.phase !== 'recording'}
                onClick={() => void handleStopRecording()}
              >
                테이크 중지
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshTakes().catch(() => undefined)}
              >
                테이크 목록 새로고침
              </button>
            </div>

            <p
              className={
                recordingState.phase === 'error' ? 'form-error' : 'status-card__hint'
              }
            >
              {recordingState.message}
            </p>

            <div className="live-input-meter" aria-live="polite">
              <div className="live-input-meter__header">
                <div>
                  <span className="shared-review-label">실시간 입력</span>
                  <strong>{liveInputMeterState.message}</strong>
                </div>
                <span className={`status-pill status-pill--${liveInputMeterTone}`}>
                  {liveInputMeterState.phase}
                </span>
              </div>

              <div
                className="live-input-meter__bar"
                role="meter"
                aria-label="실시간 입력 미터"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(liveInputMeterLevelPercent)}
              >
                <div
                  className="live-input-meter__fill"
                  style={
                    {
                      '--meter-level': `${liveInputMeterLevelPercent}%`,
                      '--meter-peak': `${liveInputMeterPeakPercent}%`,
                    } as CSSProperties
                  }
                />
              </div>

              <div className="live-input-meter__meta">
                <span>RMS {Math.round(liveInputMeterLevelPercent)}%</span>
                <span>Peak {Math.round(liveInputMeterPeakPercent)}%</span>
                <span>
                  {liveInputMeterState.phase === 'active'
                    ? '입력 표시 켜짐'
                    : liveInputMeterState.phase === 'unsupported'
                      ? '입력 표시 제한됨'
                      : '녹음 시 자동 켜짐'}
                </span>
              </div>
            </div>

            <div className="take-summary-grid">
              <div className="mini-card">
                <span>테이크 수</span>
                <strong>{takesState.items.length}</strong>
              </div>
              <div className="mini-card">
                <span>가장 최근 준비 완료 테이크</span>
                <strong>
                  {takesState.items.find((take) => take.track_status === 'READY')?.take_no ??
                    '없음'}
                </strong>
              </div>
              <div className="mini-card">
                <span>재시도 대기</span>
                <strong>{Object.keys(failedTakeUploads).length}</strong>
              </div>
              <div className="mini-card">
                <span>업로드 진행 중</span>
                <strong>{activeUploadTrackId ? '예' : '아니오'}</strong>
              </div>
            </div>

            {takesState.phase === 'error' ? <p className="form-error">{takesState.message}</p> : null}

            <div className="take-list">
              {takesState.items.length === 0 ? (
                <div className="empty-card">
                  <p>아직 테이크가 없습니다.</p>
                  <p>테이크를 한 번 녹음하면 업로드와 재시도 흐름이 열립니다.</p>
                </div>
              ) : (
                takesState.items.map((take) => {
                  const failedUpload = failedTakeUploads[take.track_id]
                  const progress = takeUploadProgress[take.track_id]
                  const previewUrl =
                    takePreviewUrls[take.track_id] ?? normalizeAssetUrl(take.source_artifact_url) ?? null

                  return (
                    <article
                      className={`take-card ${
                        selectedTake?.track_id === take.track_id ? 'take-card--selected' : ''
                      }`}
                      key={take.track_id}
                    >
                      <div className="take-card__header">
                        <div>
                          <h3>{take.take_no ?? '?'}번 테이크</h3>
                          <p className="take-card__subhead">
                            {getPartTypeLabel(take.part_type ?? 'LEAD')} |{' '}
                            {getTrackStatusLabel(take.track_status)}
                          </p>
                        </div>

                        <button
                          className="button-secondary button-secondary--small"
                          type="button"
                          onClick={() => setSelectedTakeId(take.track_id)}
                        >
                          선택
                        </button>
                      </div>

                      <div className="mini-grid">
                        <div className="mini-card">
                          <span>녹음 완료 시각</span>
                          <strong>
                            {take.recording_finished_at
                              ? formatDate(take.recording_finished_at)
                              : '알 수 없음'}
                          </strong>
                        </div>
                        <div className="mini-card">
                          <span>길이</span>
                          <strong>{formatDuration(take.duration_ms)}</strong>
                        </div>
                      </div>

                      {typeof progress === 'number' && progress < 100 ? (
                        <div className="progress-stack">
                          <div className="progress-bar" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <p className="status-card__hint">업로드 진행률: {progress}%</p>
                        </div>
                      ) : null}

                      {previewUrl ? (
                        <div className="audio-preview">
                          <p className="json-label">테이크 미리듣기</p>
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
                            이 테이크 업로드가 끝나지 않았습니다. 같은 오디오로 다시 시도하거나
                            새로 녹음해 주세요.
                          </p>
                          <div className="button-row">
                            <button
                              className="button-primary"
                              type="button"
                              disabled={activeUploadTrackId === take.track_id}
                              onClick={() => void handleRetryTakeUpload(take)}
                            >
                              {activeUploadTrackId === take.track_id
                                ? '재시도 중...'
                                : '업로드 재시도'}
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

      <section className="section" id="track-lane">
        <div className="section__header">
          <p className="eyebrow">트랙/미리보기</p>
          <h2>트랙과 미리듣기</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">트랙 레인</p>
                <h2>가이드와 테이크를 하나의 믹서 뷰에서 관리합니다</h2>
              </div>
              <span className="status-pill status-pill--ready">
                {guide ? takesState.items.length + 1 : takesState.items.length}개 트랙
              </span>
            </div>

            <p className="panel__summary">
              가이드 상태, 테이크 상태, 최근 장치 기록, 믹스다운 여부를 한 번에 다시 불러옵니다.
            </p>

            <div className="track-lane">
              {guide ? (
                <div className="track-row">
                  <div className="track-row__meta">
                    <strong>가이드</strong>
                    <span>{getTrackStatusLabel(guide.track_status)}</span>
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
                      {(mixerState[guide.track_id]?.muted ?? false) ? '음소거 해제' : '음소거'}
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
                      {(mixerState[guide.track_id]?.solo ?? false) ? '솔로 해제' : '솔로'}
                    </button>

                    <label className="track-row__slider">
                      <span>볼륨</span>
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
                    <strong>{take.take_no ?? '?'}번 테이크</strong>
                    <span>{getTrackStatusLabel(take.track_status)}</span>
                  </div>

                  <div className="track-row__controls">
                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => setSelectedTakeId(take.track_id)}
                    >
                      {selectedTake?.track_id === take.track_id ? '선택됨' : '선택'}
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
                      {(mixerState[take.track_id]?.muted ?? false) ? '음소거 해제' : '음소거'}
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
                      {(mixerState[take.track_id]?.solo ?? false) ? '솔로 해제' : '솔로'}
                    </button>

                    <label className="track-row__slider">
                      <span>볼륨</span>
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
                <span>스냅샷 가이드</span>
                <strong>{guide ? getTrackStatusLabel(guide.track_status) : '없음'}</strong>
              </div>
              <div className="mini-card">
                <span>스냅샷 테이크</span>
                <strong>{takesState.items.length}</strong>
              </div>
              <div className="mini-card">
                <span>최근 장치 기록</span>
                <strong>{latestProfile ? formatDate(latestProfile.updated_at) : '없음'}</strong>
              </div>
              <div className="mini-card">
                <span>믹스다운</span>
                <strong>
                  {mixdownSummary
                    ? getTrackStatusLabel(mixdownSummary.track_status)
                    : '아직 생성되지 않음'}
                </strong>
              </div>
            </div>
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">파형</p>
                <h2>선택한 테이크를 즉시 확인하고 새로고침 뒤에도 이어서 봅니다</h2>
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
                  ? '미리보기 준비됨'
                  : waveformState.phase === 'error'
                    ? '미리보기 오류'
                    : waveformState.phase === 'submitting'
                      ? '미리보기 불러오는 중'
                      : '미리보기 대기'}
              </span>
            </div>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>선택한 테이크</span>
                    <strong>{selectedTake.take_no ?? '?'}번 테이크</strong>
                  </div>
                  <div className="mini-card">
                    <span>상태</span>
                    <strong>{getTrackStatusLabel(selectedTake.track_status)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>길이</span>
                    <strong>{formatDuration(selectedTake.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>출처</span>
                    <strong>
                      {selectedTakePreview
                        ? selectedTakePreview.source === 'local'
                          ? '최신 로컬 blob'
                          : '저장된 서버 오디오'
                        : '미리보기 대기 중'}
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
                      : '미리보기는 녹음 직후에는 로컬 blob에서 만들고, 새로고침 뒤에는 저장된 오디오로 이어집니다.'}
                  </p>
                )}

                {selectedTakePreview ? (
                  <WaveformPreview preview={selectedTakePreview} />
                ) : (
                  <div className="empty-card">
                    <p>아직 파형 미리보기가 없습니다.</p>
                    <p>테이크를 녹음하거나 저장된 오디오가 있는 테이크를 선택해 주세요.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-card">
                <p>선택된 테이크가 없습니다.</p>
                <p>레인에서 테이크를 선택하면 파형과 컨투어를 확인할 수 있습니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('analysis')} id="analysis">
        <div className="section__header">
          <p className="eyebrow">사후 분석</p>
          <h2>녹음 후 정렬과 채점</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block" data-testid="analysis-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">다시 확인</p>
                <h2>선택한 테이크의 음정과 타이밍을 다시 확인합니다</h2>
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
                  ? '분석 중'
                  : getAnalysisJobStatusLabel(selectedTakeAnalysisJob?.status)}
              </span>
            </div>

            <p className="panel__summary">
              실시간 확정보다 녹음 후 정렬과 해석 가능한 피드백을 우선합니다. 이 단계에서는 정렬
              신뢰도, 3축 점수, 채점 모드, 구간 및 노트 피드백을 모두 스튜디오 스냅샷에 저장합니다.
            </p>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>선택한 테이크</span>
                    <strong>{selectedTake.take_no ?? '?'}번 테이크</strong>
                  </div>
                  <div className="mini-card">
                    <span>정렬 신뢰도</span>
                    <strong>{formatConfidence(selectedTake.alignment_confidence)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>오프셋 추정</span>
                    <strong>{formatOffsetMs(selectedTake.alignment_offset_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>최신 작업</span>
                    <strong>{getAnalysisJobStatusLabel(selectedTakeAnalysisJob?.status)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>음정 소스</span>
                    <strong>{getPitchQualityModeLabel(selectedTakeScore?.pitch_quality_mode)}</strong>
                    <small>{getPitchQualityModeHint(selectedTakeScore?.pitch_quality_mode)}</small>
                  </div>
                  <div className="mini-card">
                    <span>화성 기준</span>
                    <strong>{getHarmonyReferenceLabel(selectedTakeScore?.harmony_reference_mode)}</strong>
                    <small>
                      {getHarmonyReferenceHint(
                        selectedTakeScore?.harmony_reference_mode,
                        chordMarkerCount,
                      )}
                    </small>
                  </div>
                </div>

                <div className="score-grid">
                  <div className="score-card">
                    <span>음정</span>
                    <strong>{formatPercent(selectedTakeScore?.pitch_score ?? null)}</strong>
                  </div>
                  <div className="score-card">
                    <span>리듬</span>
                    <strong>{formatPercent(selectedTakeScore?.rhythm_score ?? null)}</strong>
                  </div>
                  <div className="score-card">
                    <span>화성 적합도</span>
                    <strong>{formatPercent(selectedTakeScore?.harmony_fit_score ?? null)}</strong>
                  </div>
                  <div className="score-card score-card--highlight">
                    <span>총점</span>
                    <strong>{formatPercent(selectedTakeScore?.total_score ?? null)}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    data-testid="run-post-analysis-button"
                    className="button-primary"
                    type="button"
                    disabled={analysisState.phase === 'submitting'}
                    onClick={() => void handleRunAnalysis()}
                  >
                    {analysisState.phase === 'submitting'
                      ? '분석 실행 중...'
                      : '녹음 후 분석 실행'}
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
                    실패한 작업 다시 실행
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
                  >
                    스냅샷 새로고침
                  </button>
                </div>

                {selectedTakeScore ? (
                  <div className="candidate-chip-row">
                    <span
                      className={`candidate-chip candidate-chip--${getScoreTone(
                        selectedTakeScore.total_score,
                      )}`}
                    >
                      {getPitchQualityModeLabel(selectedTakeScore.pitch_quality_mode)}
                    </span>
                    <span
                      className={`candidate-chip candidate-chip--${getConfidenceTone(
                        selectedTake.alignment_confidence,
                      )}`}
                    >
                      정렬 {formatConfidence(selectedTake.alignment_confidence)}
                    </span>
                    <span
                      className={`candidate-chip candidate-chip--${
                        selectedTakeScore.harmony_reference_mode === 'CHORD_AWARE' ? 'good' : 'warn'
                      }`}
                    >
                      {getHarmonyReferenceLabel(selectedTakeScore.harmony_reference_mode)}
                    </span>
                  </div>
                ) : null}

                {selectedTakeScore?.harmony_reference_mode === 'KEY_ONLY' ? (
                  <div className="empty-card empty-card--warn">
                    <p>화성 적합도는 아직 키 기준 대체 경로로 계산되고 있습니다.</p>
                    <p>
                      프로젝트에 코드 타임라인이 연결되기 전에는 이 점수를 코드 인식 음정 판정처럼
                      읽지 말아 주세요.
                    </p>
                  </div>
                ) : null}

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
                      최근 분석은 {formatDate(selectedTakeAnalysisJob.requested_at)}에 시작되었습니다.
                    </p>
                    {selectedTakeAnalysisJob.error_message ? (
                      <p className="form-error">{selectedTakeAnalysisJob.error_message}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="status-card__hint">
                    녹음 후 분석을 실행하면 스튜디오에 정렬 신뢰도, 음정, 리듬, 화성 적합도,
                    세그먼트 피드백이 저장됩니다.
                  </p>
                )}
              </div>
            ) : (
              <div className="empty-card">
                <p>선택된 테이크가 없습니다.</p>
                <p>녹음 후 분석을 실행하기 전에 테이크를 먼저 선택해 주세요.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block" data-testid="note-feedback-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">노트 피드백</p>
                <h2>어느 음이 높았는지, 낮았는지, 늦었는지, 불안했는지 확인합니다</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeNoteFeedback.length > 0
                    ? 'status-pill--ready'
                    : selectedTakeScore
                      ? 'status-pill--loading'
                      : 'status-pill--loading'
                }`}
              >
                {selectedTakeScore
                  ? selectedTakeNoteFeedback.length > 0
                    ? `노트 ${selectedTakeNoteFeedback.length}개`
                    : '구간 요약만 있음'
                  : '점수 대기 중'}
              </span>
            </div>

            {selectedTakeScore ? (
              <div className="support-stack">
                <p className="panel__summary">
                  이 패널은 구간 요약을 넘어서 노트 단위 교정 포인트까지 보여줍니다. 노트 목록에서
                  문제가 시작음, 유지음, 타이밍, 신뢰도 중 어디에 있는지 확인해 보세요.
                </p>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>음정 기준</span>
                    <strong>{getPitchQualityModeLabel(selectedTakeScore.pitch_quality_mode)}</strong>
                    <small>{getPitchQualityModeHint(selectedTakeScore.pitch_quality_mode)}</small>
                  </div>
                  <div className="mini-card">
                    <span>화음 기준</span>
                    <strong>{getHarmonyReferenceLabel(selectedTakeScore.harmony_reference_mode)}</strong>
                    <small>
                      {getHarmonyReferenceHint(
                        selectedTakeScore.harmony_reference_mode,
                        chordMarkerCount,
                      )}
                    </small>
                  </div>
                  <div className="mini-card">
                    <span>노트 피드백</span>
                    <strong>
                      {selectedTakeNoteFeedback.length > 0 ? '준비됨' : '연결 안 됨'}
                    </strong>
                    <small>
                      {selectedTakeNoteFeedback.length > 0
                        ? '방향성 cents 오차와 신뢰도를 교정 작업에 바로 사용할 수 있습니다.'
                        : '이 점수에는 구간 피드백만 있으니 거친 가이드로만 봐 주세요.'}
                    </small>
                  </div>
                  <div className="mini-card">
                    <span>코드 마커</span>
                    <strong>
                      {chordMarkerCount > 0 ? `${chordMarkerCount}개 마커` : '연결 안 됨'}
                    </strong>
                    <small>
                      {chordMarkerCount > 0
                        ? '무엇을 기준으로 채점하는지 코드 인식 화성 기준을 투명하게 보여줄 수 있습니다.'
                        : '코드 타임라인을 연결하면 화성 적합도를 키 기준 대체 경로에서 벗어나게 할 수 있습니다.'}
                    </small>
                  </div>
                </div>

                {selectedTakeNoteFeedback.length > 0 ? (
                  <>
                    <div className="note-timeline-card">
                      <div className="note-timeline-card__header">
                        <div>
                          <strong>교정 타임라인</strong>
                          <p>
                            노트를 눌러 방향성, 타이밍, 유지음 안정도, 신뢰도를 확인해 보세요.
                          </p>
                        </div>
                        <div className="candidate-chip-row">
                          <span className="candidate-chip candidate-chip--good">안정</span>
                          <span className="candidate-chip candidate-chip--warn">검토</span>
                          <span className="candidate-chip candidate-chip--alert">우선 수정</span>
                        </div>
                      </div>

                      <div className="note-timeline">
                        {selectedTakeNoteFeedback.map((item, index) => {
                          const leftPercent =
                            noteFeedbackTimelineDurationMs > 0
                              ? (item.start_ms / noteFeedbackTimelineDurationMs) * 100
                              : 0
                          const widthPercent =
                            noteFeedbackTimelineDurationMs > 0
                              ? Math.max(
                                  4,
                                  ((item.end_ms - item.start_ms) / noteFeedbackTimelineDurationMs) * 100,
                                )
                              : 8
                          const noteTone = getScoreTone(item.note_score)
                          const style = {
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          } satisfies CSSProperties

                          return (
                            <button
                              key={`${selectedTakeScore.score_id}-${item.note_index}`}
                              className={`note-timeline__note note-timeline__note--${noteTone} ${
                                selectedNoteFeedback?.note_index === item.note_index
                                  ? 'note-timeline__note--selected'
                                  : ''
                              }`}
                              style={style}
                              type="button"
                              onClick={() => setSelectedNoteFeedbackIndex(index)}
                            >
                              N{item.note_index + 1}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {selectedNoteFeedback ? (
                      <article className="note-detail-card">
                        <div className="note-detail-card__header">
                          <div>
                            <p className="eyebrow">선택한 노트</p>
                            <h3>
                              {selectedNoteFeedback.note_index + 1}번 노트 ·{' '}
                              {midiToPitchName(selectedNoteFeedback.target_midi)}
                            </h3>
                            <p className="status-card__hint">
                              {formatTimeSpan(
                                selectedNoteFeedback.start_ms,
                                selectedNoteFeedback.end_ms,
                              )}
                            </p>
                          </div>
                          <div className="candidate-chip-row">
                            <span
                              className={`candidate-chip candidate-chip--${getScoreTone(
                                selectedNoteFeedback.note_score,
                              )}`}
                            >
                              노트 점수 {selectedNoteFeedback.note_score.toFixed(1)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                selectedNoteFeedback.sustain_median_cents ??
                                  selectedNoteFeedback.attack_signed_cents,
                              )}`}
                            >
                              {getPitchDirectionLabel(
                                selectedNoteFeedback.sustain_median_cents ??
                                  selectedNoteFeedback.attack_signed_cents,
                              )}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getConfidenceTone(
                                selectedNoteFeedback.confidence,
                              )}`}
                            >
                              신뢰도 {formatConfidence(selectedNoteFeedback.confidence)}
                            </span>
                          </div>
                        </div>

                        <p>{selectedNoteFeedback.message}</p>

                        <div className="score-grid">
                          <div className="score-card">
                            <span>시작음</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.attack_signed_cents)}</strong>
                          </div>
                          <div className="score-card">
                            <span>유지음</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.sustain_median_cents)}</strong>
                          </div>
                          <div className="score-card">
                            <span>타이밍</span>
                            <strong>{formatSignedMs(selectedNoteFeedback.timing_offset_ms)}</strong>
                          </div>
                          <div className="score-card score-card--highlight">
                            <span>정확 비율</span>
                            <strong>{formatRatio(selectedNoteFeedback.in_tune_ratio)}</strong>
                          </div>
                        </div>

                        <div className="mini-grid">
                          <div className="mini-card">
                            <span>시작음 구간</span>
                            <strong>
                              {formatTimeSpan(
                                selectedNoteFeedback.attack_start_ms,
                                selectedNoteFeedback.attack_end_ms,
                              )}
                            </strong>
                          </div>
                          <div className="mini-card">
                            <span>유지음 편차</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.sustain_mad_cents)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>최대 샤프</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.max_sharp_cents)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>최대 플랫</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.max_flat_cents)}</strong>
                          </div>
                        </div>

                        <div className="note-subscore-grid">
                          <div className="mini-card">
                            <span>시작음 점수</span>
                            <strong>{selectedNoteFeedback.attack_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>유지음 점수</span>
                            <strong>{selectedNoteFeedback.sustain_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>안정도</span>
                            <strong>{selectedNoteFeedback.stability_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>타이밍 점수</span>
                            <strong>{selectedNoteFeedback.timing_score.toFixed(1)}</strong>
                          </div>
                        </div>
                      </article>
                    ) : null}

                    <div className="note-feedback-list">
                      {selectedTakeNoteFeedback.map((item, index) => (
                        <button
                          key={`${selectedTakeScore.score_id}-row-${item.note_index}`}
                          className={`note-feedback-row note-feedback-row--${getScoreTone(item.note_score)} ${
                            selectedNoteFeedback?.note_index === item.note_index
                              ? 'note-feedback-row--selected'
                              : ''
                          }`}
                          type="button"
                          onClick={() => setSelectedNoteFeedbackIndex(index)}
                        >
                          <div className="note-feedback-row__identity">
                            <strong>
                              {item.note_index + 1}번 노트 · {midiToPitchName(item.target_midi)}
                            </strong>
                            <span>{formatTimeSpan(item.start_ms, item.end_ms)}</span>
                          </div>

                          <div className="note-feedback-row__chips">
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                item.attack_signed_cents,
                              )}`}
                            >
                              시작음 {formatSignedCents(item.attack_signed_cents)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                item.sustain_median_cents,
                              )}`}
                            >
                              유지음 {formatSignedCents(item.sustain_median_cents)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getConfidenceTone(
                                item.confidence,
                              )}`}
                            >
                              신뢰도 {formatConfidence(item.confidence)}
                            </span>
                          </div>

                          <div className="note-feedback-row__summary">
                            <span>타이밍 {formatSignedMs(item.timing_offset_ms)}</span>
                            <span>정확도 {formatRatio(item.in_tune_ratio)}</span>
                            <span>점수 {item.note_score.toFixed(1)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-card empty-card--warn">
                    <p>이 점수에는 아직 노트 단위 교정 데이터가 연결되지 않았습니다.</p>
                    <p>
                      처리 완료된 테이크에서 분석을 다시 실행하면 방향성 cents 오차 기반 노트
                      피드백을 받을 수 있습니다. 그전까지는 아래 구간 요약을 거친 가이드로만
                      활용해 주세요.
                    </p>
                  </div>
                )}

                {selectedTakeScore.feedback_json.length > 0 ? (
                  <div className="support-stack">
                    <p className="json-label">구간 맥락</p>
                    <div className="feedback-list">
                      {selectedTakeScore.feedback_json.map((item) => (
                        <article
                          className="feedback-card"
                          key={`${selectedTakeScore.score_id}-${item.segment_index}`}
                        >
                          <div className="feedback-card__header">
                            <strong>
                              구간 {item.segment_index + 1} · {formatTimeSpan(item.start_ms, item.end_ms)}
                            </strong>
                            <span>{item.end_ms - item.start_ms} ms</span>
                          </div>

                          <div className="feedback-card__scores">
                            <span>음정 {item.pitch_score.toFixed(1)}</span>
                            <span>리듬 {item.rhythm_score.toFixed(1)}</span>
                            <span>화성 {item.harmony_fit_score.toFixed(1)}</span>
                          </div>

                          <p>{item.message}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>아직 점수 피드백이 없습니다.</p>
                <p>녹음 후 분석을 실행하면 노트 단위와 구간 요약 피드백이 프로젝트에 저장됩니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('melody')} id="melody">
        <div className="section__header">
          <p className="eyebrow">멜로디 초안</p>
          <h2>오디오→MIDI 멜로디 초안</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block" data-testid="melody-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">멜로디 추출</p>
                <h2>선택한 테이크를 양자화된 멜로디 초안으로 바꿉니다</h2>
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
                  ? '추출 중'
                  : selectedTakeMelody
                    ? '초안 준비됨'
                    : '초안 없음'}
              </span>
            </div>

            <p className="panel__summary">
              채점이 끝난 뒤 편곡 전에 사용할 수 있는 MIDI 초안을 만들고, 프로젝트 그리드에 맞춰
              양자화하고, 키를 추정하며, 노트 목록을 수정 가능하게 유지합니다.
            </p>

            {selectedTake ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>선택한 테이크</span>
                    <strong>{selectedTake.take_no ?? '?'}번 테이크</strong>
                  </div>
                  <div className="mini-card">
                    <span>키 추정</span>
                    <strong>{selectedTakeMelody?.key_estimate ?? '대기 중'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>그리드</span>
                    <strong>{selectedTakeMelody?.grid_division ?? '1/16 초안'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>노트 수</span>
                    <strong>{selectedTakeMelody?.note_count ?? 0}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    data-testid="extract-melody-button"
                    className="button-primary"
                    type="button"
                    disabled={melodyState.phase === 'submitting'}
                    onClick={() => void handleExtractMelody()}
                  >
                    {melodyState.phase === 'submitting'
                      ? '멜로디 추출 중...'
                      : '멜로디 초안 추출'}
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    disabled={selectedTakeMelody === null || melodySaveState.phase === 'submitting'}
                    onClick={() => void handleSaveMelodyDraft()}
                  >
                    {melodySaveState.phase === 'submitting' ? '초안 저장 중...' : '노트 수정 저장'}
                  </button>

                  <button
                    className="button-secondary"
                    type="button"
                    onClick={handleAddMelodyNote}
                  >
                    노트 추가
                  </button>

                  {selectedTakeMelodyMidiUrl ? (
                    <a
                      className="button-secondary"
                      href={selectedTakeMelodyMidiUrl}
                    >
                      MIDI 내려받기
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
                    한 번 추출하면 이 테이크의 양자화된 노트 초안과 MIDI 파일을 함께 만들 수 있습니다.
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
                <p>선택된 테이크가 없습니다.</p>
                <p>멜로디 초안을 추출하기 전에 테이크를 먼저 선택해 주세요.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">멜로디 편집기</p>
                <h2>편곡 전에 양자화된 노트를 검토하고 수정합니다</h2>
              </div>
              <span
                className={`status-pill ${
                  melodyNotesDraft.length > 0 ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                노트 {melodyNotesDraft.length}개
              </span>
            </div>

            {melodyNotesDraft.length > 0 ? (
              <div className="melody-note-list">
                {melodyNotesDraft.map((note, index) => (
                  <div className="melody-note-row" key={`melody-note-${index}`}>
                    <label>
                      <span>음높이</span>
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
                      <span>시작</span>
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
                      <span>끝</span>
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
                      <span>구간</span>
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
                      <span>{note.duration_ms}ms</span>
                    </div>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => handleRemoveMelodyNote(index)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-card">
                <p>아직 불러온 멜로디 노트가 없습니다.</p>
                <p>멜로디 초안을 추출하면 여기서 양자화된 노트 목록을 검토할 수 있습니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('arrangement')} id="arrangement">
        <div className="section__header">
          <p className="eyebrow">편곡 후보</p>
          <h2>룰 기반 편곡 후보</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block" data-testid="arrangement-engine-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">편곡 생성</p>
                <h2>최신 멜로디 초안에서 A/B/C 후보를 생성합니다</h2>
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
                  ? '생성 중'
                  : arrangements.length > 0
                    ? `후보 ${arrangements.length}개`
                    : '후보 없음'}
              </span>
            </div>

            <p className="panel__summary">
              음역, 도약, 병행 진행 제약을 가진 편곡 후보 2~3개를 만드는 구간입니다. 난이도
              프리셋, 음역 프리셋, 비트박스 템플릿을 함께 써서 비교 흐름을 더 또렷하게 다듬습니다.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>스타일</span>
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
                  <option value="contemporary">컨템퍼러리</option>
                  <option value="ballad">발라드</option>
                  <option value="anthem">앤섬</option>
                </select>
              </label>

              <label className="field">
                <span>난이도</span>
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
                  <option value="beginner">입문</option>
                  <option value="basic">기본</option>
                  <option value="strict">엄격</option>
                </select>
              </label>

              <label className="field">
                <span>리드 음역 프리셋</span>
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
                <span>비트박스 템플릿</span>
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
                <span>난이도 프리셋</span>
                <strong>{selectedDifficultyMeta.label}</strong>
                <small>{selectedDifficultyMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>리드 음역</span>
                <strong>{selectedVoiceRangeMeta.label}</strong>
                <small>{selectedVoiceRangeMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>비트박스</span>
                <strong>{selectedBeatboxMeta.label}</strong>
                <small>{selectedBeatboxMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>후보 배치</span>
                <strong>A / B / C 비교</strong>
                <small>같은 멜로디 초안에서 룰 기반 변형 3개를 만듭니다.</small>
              </div>
            </div>

            <div className="button-row">
              <button
                data-testid="generate-arrangements-button"
                className="button-primary"
                type="button"
                disabled={arrangementState.phase === 'submitting'}
                onClick={() => void handleGenerateArrangements()}
              >
                {arrangementState.phase === 'submitting'
                  ? '편곡 생성 중...'
                  : '편곡 후보 생성'}
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={selectedArrangement === null || arrangementSaveState.phase === 'submitting'}
                onClick={() => void handleSaveArrangement()}
              >
                {arrangementSaveState.phase === 'submitting'
                  ? '편곡 저장 중...'
                  : '편곡 수정 저장'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
              >
                스냅샷 새로고침
              </button>

              <Link
                className="button-secondary"
                to={`/projects/${projectId}/arrangement`}
              >
                편곡 작업 화면 열기
              </Link>
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
                멜로디를 정리한 뒤 후보를 생성하면 편곡 생성기가 다듬어진 초안 주변으로 화성 성부를
                더 안정적으로 쌓을 수 있습니다.
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
                  <p>아직 편곡 후보가 없습니다.</p>
                  <p>멜로디 초안을 추출한 뒤 A/B/C 후보를 생성해 주세요.</p>
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
                          {arrangement.part_count}성부 | {getOptionMeta(arrangementDifficultyOptions, arrangement.difficulty).label}
                        </span>
                      </div>

                      <button
                        className="button-secondary button-secondary--small"
                        type="button"
                        onClick={() => setSelectedArrangementId(arrangement.arrangement_id)}
                      >
                        {selectedArrangement?.arrangement_id === arrangement.arrangement_id
                          ? '선택됨'
                          : '선택'}
                      </button>
                    </div>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>리드 적합도</span>
                        <strong>{formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>최대 도약</span>
                        <strong>{arrangement.comparison_summary?.support_max_leap ?? '없음'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>병행 경고</span>
                        <strong>{arrangement.comparison_summary?.parallel_motion_alerts ?? 0}</strong>
                      </div>
                      <div className="mini-card">
                        <span>비트박스 히트</span>
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
                      <span className="candidate-chip">
                        {getArrangementStyleLabel(arrangement.style)}
                      </span>
                    </div>

                    <div className="mini-card mini-card--stack">
                      <span>비교 요약</span>
                      <strong>
                        {arrangement.parts_json
                          .map((part) => `${part.part_name} (${part.notes.length})`)
                          .join(' / ')}
                      </strong>
                      <small>
                        {getOptionMeta(voiceRangePresetOptions, arrangement.voice_range_preset).description}
                      </small>
                    </div>

                    {normalizeAssetUrl(arrangement.midi_artifact_url) ? (
                      <a
                        className="button-secondary"
                        href={normalizeAssetUrl(arrangement.midi_artifact_url) ?? undefined}
                      >
                        편곡 MIDI 내보내기
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
                <p className="eyebrow">후보 다듬기</p>
                <h2>선택한 후보를 세부 조정합니다</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedArrangement ? 'status-pill--ready' : 'status-pill--loading'
                }`}
              >
                {selectedArrangement ? selectedArrangement.candidate_code : '대기 중'}
              </span>
            </div>

            {selectedArrangement ? (
              <div className="support-stack">
                <div className="field-grid">
                  <label className="field">
                    <span>후보 제목</span>
                    <input
                      className="text-input"
                      value={arrangementTitleDraft}
                      onChange={(event) => setArrangementTitleDraft(event.target.value)}
                    />
                  </label>

                  <div className="mini-card">
                    <span>원본 멜로디</span>
                    <strong>{selectedArrangement.parts_json[0]?.notes.length ?? 0}개 음표 기준</strong>
                  </div>
                </div>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>최대 도약 제한</span>
                    <strong>
                      {typeof selectedArrangement.constraint_json?.max_leap === 'number'
                        ? selectedArrangement.constraint_json.max_leap
                        : '없음'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>병행 진행 회피</span>
                    <strong>
                      {selectedArrangement.constraint_json?.parallel_avoidance ? '사용' : '사용 안 함'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>리드 음역 프리셋</span>
                    <strong>
                      {getOptionMeta(voiceRangePresetOptions, selectedArrangement.voice_range_preset).label}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>비트박스 템플릿</span>
                    <strong>
                      {getOptionMeta(beatboxTemplateOptions, selectedArrangement.beatbox_template).label}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>리드 적합도</span>
                    <strong>{formatCompactPercent(selectedArrangement.comparison_summary?.lead_range_fit_percent)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>후보 파트 수</span>
                    <strong>{selectedArrangement.part_count}</strong>
                  </div>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>비교 요약</span>
                  <strong>
                    병행 경고 {selectedArrangement.comparison_summary?.parallel_motion_alerts ?? 0}개, 최대 도약{' '}
                    {selectedArrangement.comparison_summary?.support_max_leap ?? 0}세미톤, 비트박스 히트{' '}
                    {selectedArrangement.comparison_summary?.beatbox_note_count ?? 0}개
                  </strong>
                  <small>
                    {getOptionMeta(voiceRangePresetOptions, selectedArrangement.voice_range_preset).description}
                  </small>
                </div>

                <details className="advanced-panel">
                  <summary className="advanced-panel__summary">고급 편집 열기</summary>
                  <div className="advanced-panel__body">
                    <p className="status-card__hint">
                      파트 구성을 직접 다뤄야 할 때만 여세요. 기본 작업은 위 비교 카드와 악보 화면만으로도 충분합니다.
                    </p>
                    <textarea
                      className="json-card json-card--editor"
                      value={arrangementJsonDraft}
                      onChange={(event) => setArrangementJsonDraft(event.target.value)}
                    />
                  </div>
                </details>
              </div>
            ) : (
              <div className="empty-card">
                <p>선택된 편곡 후보가 없습니다.</p>
                <p>후보를 만든 뒤 하나를 선택하면 세부 조정과 내보내기를 이어갈 수 있습니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('score-playback')} id="score-playback">
        <div className="section__header">
          <p className="eyebrow">악보/재생</p>
          <h2>악보 렌더링, 가이드 재생, 내보내기</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block" data-testid="score-view-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">악보 보기</p>
                <h2>선택한 후보를 MusicXML 악보로 렌더링합니다</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedArrangementMusicXmlUrl
                    ? 'status-pill--ready'
                    : 'status-pill--loading'
                }`}
              >
                {selectedArrangementMusicXmlUrl ? 'MusicXML 준비됨' : 'MusicXML 대기 중'}
              </span>
            </div>

            <p className="panel__summary">
              악보 보기와 미리듣기는 따로 움직이고, 이 패널은 악보 파일 확인과 내보내기에만
              집중합니다.
            </p>

            <div className="button-row">
              {selectedArrangementMusicXmlUrl ? (
                <a className="button-primary" href={selectedArrangementMusicXmlUrl}>
                  MusicXML 내보내기
                </a>
              ) : null}

              {selectedArrangementMidiUrl ? (
                <a className="button-secondary" href={selectedArrangementMidiUrl}>
                  편곡 MIDI 내보내기
                </a>
              ) : null}

              {guideWavExportUrl ? (
                <a className="button-secondary" href={guideWavExportUrl}>
                  가이드 WAV 내보내기
                </a>
              ) : null}
            </div>

            {selectedArrangement ? (
              <ArrangementScore
                musicXmlUrl={selectedArrangementMusicXmlUrl}
                playheadRatio={arrangementPlaybackRatio}
                renderKey={`${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`}
              />
            ) : (
              <div className="empty-card">
                <p>선택된 편곡 후보가 없습니다.</p>
                <p>악보와 내보내기 도구를 열기 전에 후보를 생성하거나 선택해 주세요.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block" data-testid="playback-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">미리듣기</p>
                <h2>가이드 겹치기와 함께 파트를 미리듣습니다</h2>
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
                  ? '재생 중'
                  : arrangementTransportState.phase === 'error'
                    ? '재생 오류'
                    : '재생 준비됨'}
              </span>
            </div>

            <p className="panel__summary">
              재생은 악보 화면과 분리해 안정적으로 처리합니다. 솔로, 가이드 겹치기, 파트 밸런스는
              이곳에서 바로 미리듣습니다.
            </p>

            <div className="transport-card">
              <div className="transport-card__row">
                <strong>
                  {formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}
                </strong>
                <span>
                  {selectedArrangement
                    ? `${selectedArrangement.part_count}개 파트`
                    : '선택된 편곡 없음'}
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
                편곡 미리듣기 재생
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
                onClick={() => void stopArrangementPlayback()}
              >
                재생 중지
              </button>
            </div>

            <label className="toggle-card">
              <input
                type="checkbox"
                checked={guideModeEnabled}
                onChange={(event) => setGuideModeEnabled(event.target.checked)}
              />
              <div>
                <strong>가이드 겹치기</strong>
                <span>가이드 기준 파트를 더 또렷하게 두고 나머지 스택은 뒤로 물립니다.</span>
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
                            {getArrangementPartRoleLabel(part.role)} | 노트 {part.notes.length}개
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
                        <span>사용</span>
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
                        {partMixer.solo ? '솔로 켜짐' : '솔로'}
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
                        {isGuideFocus ? '가이드 기준' : '기준'}
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
                <p>재생할 후보가 선택되지 않았습니다.</p>
                <p>파트 솔로, 가이드 기준, 트랜스포트 동기화를 쓰려면 후보를 먼저 선택해 주세요.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('mixdown')} id="mixdown">
        <div className="section__header">
          <p className="eyebrow">믹스다운</p>
          <h2>오프라인 믹스다운 미리듣기와 저장</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">믹스다운 렌더</p>
                <h2>현재 가이드와 선택한 테이크를 오프라인으로 렌더링합니다</h2>
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
                  ? '미리보기 준비됨'
                  : mixdownPreviewState.phase === 'error'
                    ? '미리보기 오류'
                    : mixdownPreviewState.phase === 'submitting'
                      ? '렌더링 중'
                      : '미리보기 대기'}
              </span>
            </div>

            <p className="panel__summary">
              흐름은 단순하게 유지합니다. 현재 믹서 값으로 가이드와 선택한 테이크를 렌더링하고,
              로컬에서 확인한 뒤 괜찮으면 프로젝트 산출물로 저장합니다.
            </p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>가이드 소스</span>
                <strong>
                  {guideSourceUrl && guide
                    ? isTrackMutedByMixer(guide.track_id)
                      ? '믹서에서 음소거됨'
                      : '포함됨'
                    : '없음'}
                </strong>
              </div>
              <div className="mini-card">
                <span>선택한 테이크</span>
                <strong>
                  {selectedTake
                    ? selectedTakePlaybackUrl
                      ? isTrackMutedByMixer(selectedTake.track_id)
                        ? '믹서에서 음소거됨'
                        : `${selectedTake.take_no ?? '?'}번 테이크`
                      : '재생 가능한 오디오 없음'
                    : '없음'}
                </strong>
              </div>
              <div className="mini-card">
                <span>가이드 음량</span>
                <strong>{guide ? (guideMixer?.volume ?? 0.85).toFixed(2) : '없음'}</strong>
              </div>
              <div className="mini-card">
                <span>테이크 음량</span>
                <strong>
                  {selectedTake ? (mixerState[selectedTake.track_id]?.volume ?? 1).toFixed(2) : '없음'}
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
                  ? '믹스다운 렌더링 중...'
                  : '믹스다운 미리보기 렌더링'}
              </button>

              <button
                className="button-secondary"
                type="button"
                disabled={mixdownPreview === null || mixdownSaveState.phase === 'submitting'}
                onClick={() => void handleSaveMixdown()}
              >
                {mixdownSaveState.phase === 'submitting'
                  ? '믹스다운 저장 중...'
                  : '믹스다운 저장'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshStudioSnapshot().catch(() => undefined)}
              >
                스튜디오 스냅샷 새로고침
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
                선택 테이크, 음소거, 솔로, 볼륨을 바꾼 뒤에는 다시 렌더링해 주세요.
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
                <p className="eyebrow">믹스다운 플레이어</p>
                <h2>먼저 로컬에서 듣고, 괜찮으면 저장된 산출물로 남깁니다</h2>
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
                {mixdownSummary
                  ? getTrackStatusLabel(mixdownSummary.track_status)
                  : '아직 저장 전'}
              </span>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>재생 출처</span>
                <strong>{mixdownSourceLabel}</strong>
              </div>
              <div className="mini-card">
                <span>길이</span>
                <strong>
                  {mixdownPreview
                    ? formatDuration(mixdownPreview.durationMs)
                    : formatDuration(mixdownSummary?.duration_ms ?? null)}
                </strong>
              </div>
              <div className="mini-card">
                <span>샘플레이트</span>
                <strong>
                  {mixdownPreview?.actualSampleRate ?? mixdownSummary?.actual_sample_rate ?? '알 수 없음'}
                </strong>
              </div>
              <div className="mini-card">
                <span>업데이트</span>
                <strong>{mixdownSummary ? formatDate(mixdownSummary.updated_at) : '아직 저장되지 않음'}</strong>
              </div>
            </div>

            {mixdownPlaybackUrl ? (
              <div className="support-stack">
                <div className="mini-card mini-card--stack">
                  <span>포함된 트랙</span>
                  <strong>
                    {mixdownPreview
                      ? mixdownPreview.labels.join(' + ')
                      : mixdownSummary
                        ? `가장 최근 저장된 믹스다운 (${getTrackStatusLabel(mixdownSummary.track_status)})`
                        : '미리보기를 렌더링하면 현재 소스 구성을 확인할 수 있습니다.'}
                  </strong>
                </div>

                <div className="audio-preview">
                  <p className="json-label">믹스다운 재생</p>
                  <ManagedAudioPlayer muted={false} src={mixdownPlaybackUrl} volume={1} />
                </div>

                {mixdownPreviewSource ? <WaveformPreview preview={mixdownPreviewSource} /> : null}

                {mixdownSummary ? (
                  <div className="mini-card mini-card--stack">
                    <span>스토리지 키</span>
                    <strong>{mixdownSummary.storage_key ?? '없음'}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>아직 믹스다운 미리보기가 준비되지 않았습니다.</p>
                <p>현재 가이드와 선택한 테이크를 렌더링하면 미리보기와 저장 흐름이 열립니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={getStudioSectionClassName('sharing')} id="sharing">
        <div className="section__header">
          <p className="eyebrow">버전/공유</p>
          <h2>프로젝트 히스토리와 읽기 전용 공유</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">버전 히스토리</p>
                <h2>큰 수정이나 리뷰 전에 프로젝트 스냅샷을 남깁니다</h2>
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
                  ? `${versionsState.items.length}개 버전`
                  : versionsState.phase === 'error'
                    ? '버전 오류'
                    : '버전 불러오는 중'}
              </span>
            </div>

            <p className="panel__summary">
              가벼운 프로젝트 버전 히스토리를 유지합니다. 현재 스튜디오 상태를 스냅샷으로 남겨 공유
              전이나 큰 편곡 수정 전에 흐름을 추적할 수 있게 합니다.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>스냅샷 이름</span>
                <input
                  className="text-input"
                  value={versionLabelDraft}
                  onChange={(event) => setVersionLabelDraft(event.target.value)}
                  placeholder="리뷰 전 체크포인트"
                />
              </label>

              <label className="field">
                <span>스냅샷 메모</span>
                <input
                  className="text-input"
                  value={versionNoteDraft}
                  onChange={(event) => setVersionNoteDraft(event.target.value)}
                  placeholder="무엇이 바뀌었는지, 왜 남기는지"
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
                  ? '스냅샷 저장 중...'
                  : '프로젝트 스냅샷 저장'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshProjectVersions().catch(() => undefined)}
              >
                버전 새로고침
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
                  <p>아직 프로젝트 버전이 없습니다.</p>
                  <p>공유하기 전이나 큰 편곡 수정을 하기 전에 스냅샷을 남겨 주세요.</p>
                </div>
              ) : (
                versionsState.items.map((version) => (
                  <article className="history-card" key={version.version_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>{version.label}</strong>
                        <span>
                          {getProjectVersionSourceLabel(version.source_type)} |{' '}
                          {formatDate(version.created_at)}
                        </span>
                      </div>
                      <span className="candidate-chip">{version.snapshot_summary.take_count}개 테이크</span>
                    </div>

                    {version.note ? <p className="status-card__hint">{version.note}</p> : null}

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>가이드</span>
                        <strong>{version.snapshot_summary.has_guide ? '있음' : '없음'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>테이크</span>
                        <strong>{version.snapshot_summary.take_count}</strong>
                      </div>
                      <div className="mini-card">
                        <span>준비 완료 테이크</span>
                        <strong>{version.snapshot_summary.ready_take_count}</strong>
                      </div>
                      <div className="mini-card">
                        <span>편곡 후보</span>
                        <strong>{version.snapshot_summary.arrangement_count}</strong>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel studio-block" data-testid="share-links-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">공유 링크</p>
                <h2>고정된 스냅샷에 연결된 읽기 전용 공유 URL을 만듭니다</h2>
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
                  ? `${shareLinksState.items.length}개 링크`
                  : shareLinksState.phase === 'error'
                    ? '공유 오류'
                    : '공유 불러오는 중'}
              </span>
            </div>

            <p className="panel__summary">
              master plan에서는 공유 범위를 열어두고 있지만, 현재 slice는 읽기 전용 링크를
              기준으로 구현합니다. 각 링크는 먼저 버전을 고정한 뒤 수정 기능 없는 공개 뷰어
              경로를 엽니다.
            </p>

            <div className="field-grid">
              <label className="field">
                <span>공유 이름</span>
                <input
                  data-testid="share-label-input"
                  className="text-input"
                  value={shareLabelDraft}
                  onChange={(event) => setShareLabelDraft(event.target.value)}
                  placeholder="코치 리뷰"
                />
              </label>

              <label className="field field--compact">
                <span>만료 일수</span>
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
                data-testid="create-share-link-button"
                className="button-primary"
                type="button"
                disabled={shareCreateState.phase === 'submitting'}
                onClick={() => void handleCreateShareLink()}
              >
                {shareCreateState.phase === 'submitting'
                  ? '공유 링크 만드는 중...'
                  : '읽기 전용 공유 링크 만들기'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshShareLinks().catch(() => undefined)}
              >
                공유 링크 새로고침
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
                  <p>아직 공유 링크가 없습니다.</p>
                  <p>현재 스튜디오 스냅샷을 리뷰어에게 보내려면 읽기 전용 공유 URL을 만들어 주세요.</p>
                </div>
              ) : (
                shareLinksState.items.map((shareLink) => (
                  <article className="history-card" key={shareLink.share_link_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>{shareLink.label}</strong>
                        <span>
                          {shareLink.is_active ? '활성' : '비활성'} | 만료{' '}
                          {shareLink.expires_at ? formatDate(shareLink.expires_at) : '없음'}
                        </span>
                      </div>
                      <span className="candidate-chip">
                        {getShareAccessScopeLabel(shareLink.access_scope)}
                      </span>
                    </div>

                    <div className="mini-card mini-card--stack">
                      <span>공유 URL</span>
                      <strong>{shareLink.share_url}</strong>
                    </div>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>사용 기한</span>
                        <strong>{shareLink.expires_at ? formatDate(shareLink.expires_at) : '없음'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>마지막 열람</span>
                        <strong>{shareLink.last_accessed_at ? formatDate(shareLink.last_accessed_at) : '아직 없음'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>생성 시각</span>
                        <strong>{formatDate(shareLink.created_at)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>상태</span>
                        <strong>{shareLink.is_active ? '공개 중' : '종료됨'}</strong>
                      </div>
                    </div>

                    <div className="button-row">
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={() => void handleCopyShareLink(shareLink.share_url)}
                      >
                        URL 복사
                      </button>
                      <a className="button-secondary" href={shareLink.share_url} target="_blank" rel="noreferrer">
                        공유 화면 열기
                      </a>
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={!shareLink.is_active || shareDeactivateState.phase === 'submitting'}
                        onClick={() => void handleDeactivateShareLink(shareLink.share_link_id)}
                      >
                        {shareLink.is_active ? '비활성화' : '이미 비활성화됨'}
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

