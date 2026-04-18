import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import './StudioPage.css'

import { StudioAnalysisSummaryPanel } from './studio/StudioAnalysisSummaryPanel'
import { StudioAudioSetupPanel } from './studio/StudioAudioSetupPanel'
import { StudioChordImportPanel } from './studio/StudioChordImportPanel'
import { StudioArrangementEnginePanel } from './studio/StudioArrangementEnginePanel'
import { StudioArrangementSummaryPanel } from './studio/StudioArrangementSummaryPanel'
import { StudioGuidePanel } from './studio/StudioGuidePanel'
import { StudioHarmonyTimelinePanel } from './studio/StudioHarmonyTimelinePanel'
import { StudioInspector } from './studio/StudioInspector'
import { StudioMelodyPanel } from './studio/StudioMelodyPanel'
import { StudioMelodyEditorPanel } from './studio/StudioMelodyEditorPanel'
import { StudioMixdownPlaybackPanel } from './studio/StudioMixdownPlaybackPanel'
import { StudioMixdownRenderPanel } from './studio/StudioMixdownRenderPanel'
import { StudioNoteFeedbackPanel } from './studio/StudioNoteFeedbackPanel'
import { StudioPlaybackPanel } from './studio/StudioPlaybackPanel'
import { StudioProjectSettingsDrawer } from './studio/StudioProjectSettingsDrawer'
import { StudioRail } from './studio/StudioRail'
import { StudioRecordingSection } from './studio/StudioRecordingSection'
import { StudioRouteStatePanel } from './studio/StudioRouteStatePanel'
import { StudioScoreViewPanel } from './studio/StudioScoreViewPanel'
import { StudioShareModal } from './studio/StudioShareModal'
import { StudioShareLinksPanel } from './studio/StudioShareLinksPanel'
import { StudioStage } from './studio/StudioStage'
import { StudioTimeline } from './studio/StudioTimeline'
import { StudioTopbar } from './studio/StudioTopbar'
import { StudioVersionPanel } from './studio/StudioVersionPanel'
import {
  buildStudioModeButtons,
  buildWorkbenchTabItems,
} from './studio/studioWorkbenchNavigation'
import {
  buildAnalysisChips,
  buildAnalysisMiniCards,
  buildAnalysisPanelViewModel,
  buildAnalysisScoreCards,
  buildAppliedInputSettingsLabel,
  buildArrangementCandidateCards,
  buildArrangementEngineViewModel,
  buildArrangementPresetSummaryCards,
  buildArrangementSummaryViewModel,
  buildAudioInputOptions,
  buildAudioSetupDeviceCards,
  buildAudioSetupPanelViewModel,
  buildAudioSetupWarningEmptyMessage,
  buildAudioSetupWarningItems,
  buildGuidePanelViewModel,
  buildGuideStatusCards,
  buildHarmonyPanelViewModel,
  buildHarmonySummaryCards,
  buildInspectorSummaryViewModel,
  buildMelodyPanelViewModel,
  buildMelodyMiniItems,
  buildMixdownPlaybackViewModel,
  buildMixdownRenderViewModel,
  buildPlaybackPanelViewModel,
  buildProjectSettingsSummaryCards,
  buildProjectSettingsViewModel,
  buildRecordingFlowViewModel,
  buildRecordingSectionViewModel,
  buildRecordingTakeSummaryItems,
  buildScorePlaybackSummaryViewModel,
  buildShareLinksPanelViewModel,
  buildRequestedInputSettingsLabel,
  buildShareLinkHistoryCards,
  buildShareModalArtifactItems,
  buildShareModalSummaryCards,
  buildShareModalViewModel,
  buildStageViewModel,
  buildStudioShellViewModel,
  buildStudioSelectionViewModel,
  buildTimelineMessage,
  buildStudioConsoleViewModel,
  buildShareVersionOptions,
  buildVersionHistoryCards,
  buildVersionPanelViewModel,
  getAudioSetupWarningSectionTitle,
  getLatestShareVersionLabel,
  getShareTargetLabel,
} from './studio/studioWorkbenchViewModels'
import {
  buildMelodyEditorRows,
  buildPlaybackPartRows,
  buildRailTakeItems,
  buildRecordingTakeItems,
  buildTimelineGuideRow,
  buildTimelinePlayers,
  buildTimelineRows,
} from './studio/studioWorkbenchRows'
import {
  getStudioWorkspaceMode,
  studioDefaultSectionByMode,
  studioRailLabels,
  studioSectionModeMap,
  studioWorkbenchLinks,
  studioWorkspaceModes,
  type StudioSectionId,
  type StudioWorkspaceModeId,
} from './studio/studioWorkbenchConfig'
import { StudioWorkbenchSection } from './studio/StudioWorkbenchSection'
import { StudioWorkbenchTabs } from './studio/StudioWorkbenchTabs'
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

function getActionStateMessage(state: ActionState): string {
  return 'message' in state && typeof state.message === 'string' ? state.message : ''
}

const arrangementStyleSelectOptions = [
  { value: 'contemporary', label: '컨템포러리' },
  { value: 'ballad', label: '발라드' },
  { value: 'anthem', label: '앤섬' },
] as const

const arrangementDifficultySelectOptions = [
  { value: 'beginner', label: '입문' },
  { value: 'basic', label: '기본' },
  { value: 'strict', label: '엄격' },
] as const

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

type ShareArtifactKey = 'guide' | 'takes' | 'mixdown' | 'arrangements'

type ProjectSettingsDraft = {
  title: string
  bpm: string
  baseKey: string
  timeSignature: string
}

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

const defaultShareIncludedArtifacts: ShareArtifactKey[] = [
  'guide',
  'takes',
  'mixdown',
  'arrangements',
]

const studioShareArtifactOptions: ReadonlyArray<{
  key: ShareArtifactKey
  label: string
  description: string
}> = [
  {
    key: 'guide',
    label: '가이드',
    description: '기준 청취용 가이드 오디오와 메타데이터를 포함합니다.',
  },
  {
    key: 'takes',
    label: '테이크',
    description: '선택된 버전에 들어 있는 take 목록과 피드백 데이터를 포함합니다.',
  },
  {
    key: 'mixdown',
    label: '믹스다운',
    description: '저장된 mixdown 결과가 있을 때만 함께 전달합니다.',
  },
  {
    key: 'arrangements',
    label: '편곡 후보',
    description: 'musicxml/midi로 이어지는 편곡 후보 목록을 포함합니다.',
  },
] as const

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
    description: '가장 무난하게 시작하기 좋은 균형형 기본 프리셋입니다.',
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

function formatEditorClock(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '알 수 없음'
  }

  const totalTenths = Math.max(0, Math.round(value / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  const tenths = totalTenths % 10

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
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
  const [activeWorkbenchSectionId, setActiveWorkbenchSectionId] =
    useState<StudioSectionId>(studioDefaultSectionByMode.record)
  const [editorRangeMode, setEditorRangeMode] = useState<'take' | 'note'>('take')
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
  const [projectSettingsSaveState, setProjectSettingsSaveState] = useState<ActionState>({
    phase: 'idle',
  })
  const [versionLabelDraft, setVersionLabelDraft] = useState('')
  const [versionNoteDraft, setVersionNoteDraft] = useState('')
  const [shareLabelDraft, setShareLabelDraft] = useState('')
  const [shareExpiryDays, setShareExpiryDays] = useState(7)
  const [projectSettingsDraft, setProjectSettingsDraft] = useState<ProjectSettingsDraft>({
    title: '',
    bpm: '',
    baseKey: 'C',
    timeSignature: '4/4',
  })
  const [isProjectSettingsDrawerOpen, setIsProjectSettingsDrawerOpen] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [shareVersionIdDraft, setShareVersionIdDraft] = useState('')
  const [shareIncludedArtifacts, setShareIncludedArtifacts] = useState<ShareArtifactKey[]>(
    defaultShareIncludedArtifacts,
  )
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
  const workbenchRef = useRef<HTMLElement | null>(null)
  const inspectorNoteListRef = useRef<HTMLDivElement | null>(null)
  const inspectorPanelRef = useRef<HTMLDetailsElement | null>(null)
  const readyProjectForDraftSync = studioState.phase === 'ready' ? studioState.project : null

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
    const visibleSections = getStudioWorkspaceMode(workspaceMode).sectionIds
    if (visibleSections.length === 0) {
      return
    }

    if (!visibleSections.includes(activeWorkbenchSectionId)) {
      setActiveWorkbenchSectionId(studioDefaultSectionByMode[workspaceMode] ?? visibleSections[0])
    }
  }, [activeWorkbenchSectionId, workspaceMode])

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

  useEffect(() => {
    if (!readyProjectForDraftSync) {
      return
    }

    setProjectSettingsDraft({
      title: readyProjectForDraftSync.title,
      bpm: readyProjectForDraftSync.bpm ? String(readyProjectForDraftSync.bpm) : '',
      baseKey: readyProjectForDraftSync.base_key ?? 'C',
      timeSignature: readyProjectForDraftSync.time_signature ?? '4/4',
    })
    setProjectSettingsSaveState({ phase: 'idle' })
  }, [readyProjectForDraftSync])

  useEffect(() => {
    const selectedVersion =
      shareVersionIdDraft && versionsState.phase === 'ready'
        ? versionsState.items.find((item) => item.version_id === shareVersionIdDraft) ?? null
        : null
    const availability = {
      guide: selectedVersion ? selectedVersion.snapshot_summary.has_guide : guideState.guide !== null,
      takes: selectedVersion
        ? selectedVersion.snapshot_summary.take_count > 0
        : takesState.items.length > 0,
      mixdown: selectedVersion
        ? selectedVersion.snapshot_summary.has_mixdown
        : mixdownSummary !== null || mixdownPreview !== null,
      arrangements: selectedVersion
        ? selectedVersion.snapshot_summary.arrangement_count > 0
        : arrangements.length > 0,
    } satisfies Record<ShareArtifactKey, boolean>

    const availableArtifacts = defaultShareIncludedArtifacts.filter((item) => availability[item])
    setShareIncludedArtifacts((current) => {
      const next = current.filter((item) => availability[item])
      if (next.length > 0) {
        return next
      }
      return availableArtifacts
    })
  }, [
    arrangements.length,
    guideState.guide,
    mixdownPreview,
    mixdownSummary,
    shareVersionIdDraft,
    takesState.items.length,
    versionsState,
  ])

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

    if (shareIncludedArtifacts.length === 0) {
      setShareCreateState({
        phase: 'error',
        message: '공유에 포함할 항목을 하나 이상 선택해 주세요.',
      })
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
          version_id: shareVersionIdDraft || undefined,
          included_artifacts: shareIncludedArtifacts,
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
      setIsShareModalOpen(false)
      openWorkbenchSection('sharing')
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

  function handleToggleShareArtifact(key: ShareArtifactKey): void {
    setShareIncludedArtifacts((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key)
      }

      return defaultShareIncludedArtifacts.filter((item) =>
        item === key || current.includes(item),
      )
    })
  }

  function handleOpenProjectSettingsDrawer(): void {
    if (studioState.phase !== 'ready') {
      return
    }

    setProjectSettingsDraft({
      title: studioState.project.title,
      bpm: studioState.project.bpm ? String(studioState.project.bpm) : '',
      baseKey: studioState.project.base_key ?? 'C',
      timeSignature: studioState.project.time_signature ?? '4/4',
    })
    setProjectSettingsSaveState({ phase: 'idle' })
    setIsProjectSettingsDrawerOpen(true)
  }

  function handleOpenShareModal(): void {
    setShareCreateState({ phase: 'idle' })
    setShareVersionIdDraft('')
    setShareIncludedArtifacts(defaultShareIncludedArtifacts)
    setIsShareModalOpen(true)
  }

  async function handleSaveProjectSettings(): Promise<void> {
    if (!projectId || studioState.phase !== 'ready') {
      setProjectSettingsSaveState({
        phase: 'error',
        message: '프로젝트 메타데이터가 아직 준비되지 않았습니다.',
      })
      return
    }

    const normalizedTitle = projectSettingsDraft.title.trim()
    if (!normalizedTitle) {
      setProjectSettingsSaveState({
        phase: 'error',
        message: '프로젝트 이름을 비워 둘 수 없습니다.',
      })
      return
    }

    const normalizedBpm = projectSettingsDraft.bpm.trim()
    let bpmValue: number | null = null
    if (normalizedBpm) {
      const parsedBpm = Number(normalizedBpm)
      if (
        !Number.isFinite(parsedBpm) ||
        Number.isNaN(parsedBpm) ||
        parsedBpm < 1 ||
        parsedBpm > 400
      ) {
        setProjectSettingsSaveState({
          phase: 'error',
          message: '템포는 1에서 400 사이 숫자로 입력해 주세요.',
        })
        return
      }
      bpmValue = parsedBpm
    }

    setProjectSettingsSaveState({
      phase: 'submitting',
      message: '프로젝트 설정을 저장하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: normalizedTitle,
          bpm: bpmValue ?? null,
          base_key: projectSettingsDraft.baseKey.trim() || null,
          time_signature: projectSettingsDraft.timeSignature.trim() || null,
        }),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '프로젝트 설정을 저장하지 못했습니다.'))
      }

      const updatedProject = (await response.json()) as Project
      setStudioState({ phase: 'ready', project: updatedProject })
      setProjectSettingsSaveState({
        phase: 'success',
        message: '프로젝트 설정을 저장했습니다.',
      })
      setIsProjectSettingsDrawerOpen(false)
    } catch (error) {
      setProjectSettingsSaveState({
        phase: 'error',
        message: error instanceof Error ? error.message : '프로젝트 설정을 저장하지 못했습니다.',
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
      <StudioRouteStatePanel
        eyebrow="스튜디오"
        summary="녹음 작업을 열기 전에 프로젝트 기준 상태를 불러오고 있습니다."
        title="프로젝트를 불러오는 중입니다"
      />
    )
  }

  if (studioState.phase === 'error') {
    return (
      <StudioRouteStatePanel
        backLinkLabel="프로젝트 목록으로 돌아가기"
        backLinkTo="/"
        eyebrow="스튜디오"
        errorMessage={studioState.message}
        title="스튜디오를 열 수 없습니다"
      />
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
  const selectedTakeDurationMs = selectedTakePreview?.durationMs ?? selectedTake?.duration_ms ?? null
  const editorRangeStartMs =
    editorRangeMode === 'note' && selectedNoteFeedback ? selectedNoteFeedback.start_ms : 0
  const editorRangeEndMs =
    editorRangeMode === 'note' && selectedNoteFeedback
      ? selectedNoteFeedback.end_ms
      : selectedTakeDurationMs
  const editorRangeTitle =
    editorRangeMode === 'note' && selectedNoteFeedback
      ? `${selectedNoteFeedback.note_index + 1}번째 노트`
      : '테이크 전체'
  const editorPrimaryAction =
    workspaceMode === 'arrange'
      ? 'arrangement'
      : workspaceMode === 'review'
        ? 'analysis'
        : 'recording'
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
  const harmonySummaryCards = buildHarmonySummaryCards({
    baseKey: project.base_key ?? null,
    chordDraftRowCount,
    chordMarkerCount,
    timeSignature: project.time_signature ?? null,
    transportBpm,
  })
  const harmonyPanelViewModel = buildHarmonyPanelViewModel({
    chordMarkerCount,
    projectHarmonyMessage: getActionStateMessage(projectHarmonyState),
    projectHarmonyPhase: projectHarmonyState.phase,
  })
  const harmonyMarkerRows = chordTimelineDraft.map((item, index) => ({
    endMs: item.end_ms,
    id: `chord-marker-${index}`,
    label: item.label,
    onEndMsChange: (value: string) => updateChordTimelineDraftItem(index, 'end_ms', value),
    onLabelChange: (value: string) => updateChordTimelineDraftItem(index, 'label', value),
    onPitchClassesChange: (value: string) => updateChordTimelineDraftItem(index, 'pitch_classes', value),
    onQualityChange: (value: string) => updateChordTimelineDraftItem(index, 'quality', value),
    onRemove: () => handleRemoveChordMarker(index),
    onRootChange: (value: string) => updateChordTimelineDraftItem(index, 'root', value),
    onStartMsChange: (value: string) => updateChordTimelineDraftItem(index, 'start_ms', value),
    pitchClasses: item.pitch_classes,
    quality: item.quality,
    root: item.root,
    startMs: item.start_ms,
  }))
  const audioSetupPanelViewModel = buildAudioSetupPanelViewModel({
    permissionMessage:
      permissionState.phase === 'granted' || permissionState.phase === 'error'
        ? permissionState.message
        : '',
    permissionPhase: permissionState.phase,
    saveMessage: getActionStateMessage(saveDeviceState),
    savePhase: saveDeviceState.phase,
  })
  const audioInputOptions = buildAudioInputOptions(audioInputs)
  const requestedInputSettingsLabel = buildRequestedInputSettingsLabel(constraintDraft)
  const appliedInputSettingsLabel = buildAppliedInputSettingsLabel(appliedSettingsPreview)
  const audioSetupDeviceCards = buildAudioSetupDeviceCards({
    currentCapabilitySnapshot,
    deviceProfilePhase: deviceProfileState.phase,
    formatDate,
    latestProfile,
    outputRoute,
    summarizeBrowserAudioStack,
    summarizeRecorderSupport,
    summarizeWebAudioSupport,
  })
  const audioSetupWarningItems = buildAudioSetupWarningItems(
    currentCapabilityWarnings,
    getBrowserAudioWarningLabel,
  )
  const audioSetupWarningSectionTitle = getAudioSetupWarningSectionTitle({
    hasCapabilitySnapshot: currentCapabilitySnapshot !== null,
    hasLatestProfile: latestProfile !== null,
  })
  const audioSetupWarningEmptyMessage = buildAudioSetupWarningEmptyMessage(latestProfile !== null)
  const guidePanelViewModel = buildGuidePanelViewModel({
    guideExists: guide !== null,
    guideFile,
    guideStatePhase: guideState.phase,
    guideUploadMessage: getActionStateMessage(guideUploadState),
    guideUploadPhase: guideUploadState.phase,
  })
  const guideStatusCards = buildGuideStatusCards({
    formatDuration,
    getTrackStatusLabel,
    guide,
  })
  const mixdownPlaybackUrl = normalizeAssetUrl(
    mixdownPreview?.url ?? mixdownSummary?.source_artifact_url ?? null,
  )
  const mixdownPreviewSource =
    mixdownPreview?.preview_data ?? mixdownSummary?.preview_data ?? null
  const recordingFlowViewModel = buildRecordingFlowViewModel({
    liveInputMeterPhase: liveInputMeterState.phase,
    recordingPhase: recordingState.phase,
  })
  const liveInputMeterLevelPercent = Math.max(0, Math.min(100, liveInputMeterState.rms * 260))
  const liveInputMeterPeakPercent = Math.max(0, Math.min(100, liveInputMeterState.peak * 140))
  const studioConsoleViewModel = buildStudioConsoleViewModel({
    chordMarkerCount,
    formatConfidence,
    getConsoleMicLabel,
    hasProfile: Boolean(latestProfile),
    permissionPhase: permissionState.phase,
    selectedTakeAlignmentConfidence: selectedTake?.alignment_confidence,
  })
  const inspectorDirectionValue =
    selectedNoteFeedback?.sustain_median_cents ?? selectedNoteFeedback?.attack_signed_cents ?? null
  const studioSelectionViewModel = buildStudioSelectionViewModel({
    getTrackStatusLabel,
    hasMelodyDraft: selectedTakeMelody !== null,
    noteFeedbackCount: selectedTakeNoteFeedback.length,
    selectedTakeExists: selectedTake !== null,
    selectedTakeNo: selectedTake?.take_no,
    selectedTakeStatus: selectedTake?.track_status,
    selectedTakeTotalScoreLabel: selectedTakeScore ? formatPercent(selectedTakeScore.total_score) : null,
  })
  const activeWorkspaceMode = getStudioWorkspaceMode(workspaceMode)
  const studioShellViewModel = buildStudioShellViewModel({
    activeWorkspaceModeLabel: activeWorkspaceMode.label,
    arrangementCount: arrangements.length,
    formatDate,
    formatDuration,
    guideActualSampleRate: guide?.actual_sample_rate,
    guideDurationMs: guide?.duration_ms,
    hasGuide: guide !== null,
    noteFeedbackCount: selectedTakeNoteFeedback.length,
    projectCreatedAt: project.created_at,
    readyTakeCount,
    selectedTakeExists: selectedTake !== null,
    selectedTakeLabel: studioSelectionViewModel.selectedTakeLabel,
    selectedTakeMelodyNoteCount: selectedTakeMelody?.note_count,
    selectedTakeScoreLabel: studioSelectionViewModel.selectedTakeScoreLabel,
    takeCount: takesState.items.length,
    takeNo: selectedTake?.take_no,
    totalTrackCount,
  })
  const inspectorSummaryViewModel = buildInspectorSummaryViewModel({
    feedbackSegmentCount: selectedTakeScore?.feedback_json.length ?? 0,
    midiToPitchName,
    noteFeedbackSummaryLabel: studioShellViewModel.noteFeedbackSummaryLabel,
    selectedNoteIndex: selectedNoteFeedback?.note_index,
    selectedNoteTargetMidi: selectedNoteFeedback?.target_midi,
  })
  const melodyMiniItems = buildMelodyMiniItems({
    selectedTake,
    selectedTakeMelody,
  })
  const melodyPanelViewModel = buildMelodyPanelViewModel({
    hasMelodyDraft: selectedTakeMelody !== null,
    melodyMessage: getActionStateMessage(melodyState),
    melodyNoteCount: melodyNotesDraft.length,
    melodyPhase: melodyState.phase,
    melodySaveMessage: getActionStateMessage(melodySaveState),
    melodySavePhase: melodySaveState.phase,
  })
  const arrangementEngineViewModel = buildArrangementEngineViewModel({
    arrangementCount: arrangements.length,
    arrangementMessage: getActionStateMessage(arrangementState),
    arrangementPhase: arrangementState.phase,
    arrangementSaveMessage: getActionStateMessage(arrangementSaveState),
    arrangementSavePhase: arrangementSaveState.phase,
    selectedDifficultyLabel: selectedDifficultyMeta.label,
    selectedVoiceRangeLabel: selectedVoiceRangeMeta.label,
  })
  const arrangementPresetSummaryCards = buildArrangementPresetSummaryCards({
    selectedBeatboxMeta,
    selectedDifficultyMeta,
    selectedVoiceRangeMeta,
  })
  const arrangementCandidateCards = buildArrangementCandidateCards({
    arrangements,
    formatCompactPercent,
    getArrangementDifficultyLabel: (value) => getOptionMeta(arrangementDifficultyOptions, value).label,
    getArrangementStyleLabel,
    getBeatboxLabel: (value) => getOptionMeta(beatboxTemplateOptions, value).label,
    getVoiceRangeDescription: (value) => getOptionMeta(voiceRangePresetOptions, value).description,
    getVoiceRangeLabel: (value) => getOptionMeta(voiceRangePresetOptions, value).label,
    normalizeAssetUrl,
    selectedArrangementId: selectedArrangement?.arrangement_id ?? null,
  })
  const scorePlaybackSummaryViewModel = buildScorePlaybackSummaryViewModel({
    hasMusicXml: selectedArrangementMusicXmlUrl !== null,
    selectedArrangementPartCount: selectedArrangement?.parts_json.length ?? null,
  })
  const scoreViewRenderKey = selectedArrangement
    ? `${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`
    : null
  const mixdownRenderViewModel = buildMixdownRenderViewModel({
    getTrackStatusLabel,
    guideConnected: guide !== null,
    guideMuted: guide ? isTrackMutedByMixer(guide.track_id) : false,
    guideSourceUrl,
    guideVolume: guideMixer?.volume ?? 0.85,
    hasSelectedTake: selectedTake !== null,
    mixdownPreview,
    mixdownPreviewPhase: mixdownPreviewState.phase,
    mixdownPreviewStateMessage: getActionStateMessage(mixdownPreviewState),
    mixdownSavePhase: mixdownSaveState.phase,
    mixdownSaveStateMessage: getActionStateMessage(mixdownSaveState),
    mixdownSummary,
    selectedTakeLabel: selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '없음',
    selectedTakeMuted: selectedTake ? isTrackMutedByMixer(selectedTake.track_id) : false,
    selectedTakePlaybackUrl,
    selectedTakeVolume: selectedTake ? mixerState[selectedTake.track_id]?.volume ?? 1 : 1,
  })
  const mixdownPlaybackViewModel = buildMixdownPlaybackViewModel({
    formatDate,
    formatDuration,
    getTrackStatusLabel,
    mixdownPreview,
    mixdownSavePhase: mixdownSaveState.phase,
    mixdownSummary,
  })
  const stageViewModel = buildStageViewModel({
    analysisPhase: analysisState.phase,
    formatDuration,
    noteFeedbackCount: selectedTakeNoteFeedback.length,
    selectedTakeDurationMs: selectedTake?.duration_ms,
    selectedTakeExists: selectedTake !== null,
    selectedTakeLabel: studioSelectionViewModel.selectedTakeLabel,
    selectedTakeNo: selectedTake?.take_no,
    selectedTakeScoreLabel: selectedTakeScore ? `총점 ${formatPercent(selectedTakeScore.total_score)}` : '--',
    selectedTakeStatusLabel: selectedTake ? getTrackStatusLabel(selectedTake.track_status) : '대기',
    waveformPhase: waveformState.phase,
    waveformReady: selectedTakePreview !== null,
  })
  const analysisPanelViewModel = buildAnalysisPanelViewModel({
    analysisJob: selectedTakeAnalysisJob,
    analysisMessage: getActionStateMessage(analysisState),
    analysisPhase: analysisState.phase,
    formatDate,
    getAnalysisJobStatusLabel,
  })
  const analysisMiniCards = buildAnalysisMiniCards({
    chordMarkerCount,
    formatConfidence,
    formatOffsetMs,
    getAnalysisJobStatusLabel,
    getHarmonyReferenceHint,
    getHarmonyReferenceLabel,
    getPitchQualityModeHint,
    getPitchQualityModeLabel,
    selectedTake,
    selectedTakeAnalysisJob,
    selectedTakeScore,
  })
  const analysisScoreCards = buildAnalysisScoreCards({
    formatPercent,
    selectedTakeScore,
  })
  const analysisChips = buildAnalysisChips({
    chordMarkerCount,
    formatConfidence,
    getConfidenceTone,
    getHarmonyReferenceLabel,
    getPitchQualityModeLabel,
    getScoreTone,
    selectedTake,
    selectedTakeScore,
  })
  const recordingSectionViewModel = buildRecordingSectionViewModel({
    liveInputMeterPhase: liveInputMeterState.phase,
    metronomePreviewMessage: getActionStateMessage(metronomePreviewState),
    metronomePreviewPhase: metronomePreviewState.phase,
    recordingPhase: recordingState.phase,
    selectedTakeNo: selectedTake?.take_no,
  })
  const recordingTakeSummaryItems = buildRecordingTakeSummaryItems({
    activeUploadTrackId,
    failedTakeUploadCount: Object.keys(failedTakeUploads).length,
    takes: takesState.items,
  })
  const recordingTakeItems = buildRecordingTakeItems({
    activeUploadTrackId,
    failedTakeUploads,
    formatDate,
    formatDuration,
    getPartTypeLabel,
    getTrackStatusLabel,
    isTrackMutedByMixer,
    mixerState,
    normalizeAssetUrl,
    onRetryUpload: (take) => {
      void handleRetryTakeUpload(take)
    },
    onSelectTake: setSelectedTakeId,
    selectedTakeId: selectedTake?.track_id ?? null,
    takePreviewUrls,
    takeUploadProgress,
    takes: takesState.items,
  })
  const timelineMessage = buildTimelineMessage({
    analysisMessage: getActionStateMessage(analysisState),
    analysisPhase: analysisState.phase,
    metronomePreviewMessage: getActionStateMessage(metronomePreviewState),
    metronomePreviewPhase: metronomePreviewState.phase,
    recordingMessage: recordingState.message,
    recordingPhase: recordingState.phase,
  })
  const timelinePlayers = buildTimelinePlayers({
    guide,
    guideSourceUrl,
    guideVolume: guideMixer?.volume ?? 0.85,
    isGuideMuted: guide ? isTrackMutedByMixer(guide.track_id) : false,
    isSelectedTakeMuted: selectedTake ? isTrackMutedByMixer(selectedTake.track_id) : false,
    selectedTake,
    selectedTakePlaybackUrl,
    selectedTakeVolume: selectedTake ? mixerState[selectedTake.track_id]?.volume ?? 1 : 1,
  })
  const timelineGuideRow = buildTimelineGuideRow({
    getTrackStatusLabel,
    guide,
    guideMuted: guide ? mixerState[guide.track_id]?.muted ?? false : false,
    guideSolo: guide ? mixerState[guide.track_id]?.solo ?? false : false,
    guideVolume: guide ? mixerState[guide.track_id]?.volume ?? 0.85 : 0.85,
    onToggleMute: () => {
      if (!guide) {
        return
      }
      updateMixerTrack(guide.track_id, {
        muted: !(mixerState[guide.track_id]?.muted ?? false),
      })
    },
    onToggleSolo: () => {
      if (!guide) {
        return
      }
      updateMixerTrack(guide.track_id, {
        solo: !(mixerState[guide.track_id]?.solo ?? false),
      })
    },
    onVolumeChange: (value) => {
      if (!guide) {
        return
      }
      updateMixerTrack(guide.track_id, {
        volume: value,
      })
    },
  })
  const timelineRows = buildTimelineRows({
    formatPercent,
    getTrackStatusLabel,
    mixerState,
    onSelectTake: setSelectedTakeId,
    onToggleMute: (trackId) =>
      updateMixerTrack(trackId, {
        muted: !(mixerState[trackId]?.muted ?? false),
      }),
    onToggleSolo: (trackId) =>
      updateMixerTrack(trackId, {
        solo: !(mixerState[trackId]?.solo ?? false),
      }),
    onVolumeChange: (trackId, value) =>
      updateMixerTrack(trackId, {
        volume: value,
      }),
    selectedTakeId: selectedTake?.track_id ?? null,
    takeUploadProgress,
    takes: takesState.items,
  })
  const formatScoreCell = (value: number | null | undefined) =>
    value === null || value === undefined || Number.isNaN(value) ? '--' : formatPercent(value)
  const arrangementRoute = projectId ? `/projects/${projectId}/arrangement` : null
  const liveShareSnapshotSummary: SnapshotSummary = {
    has_guide: guide !== null,
    take_count: takesState.items.length,
    ready_take_count: readyTakeCount,
    arrangement_count: arrangements.length,
    has_mixdown: mixdownSummary !== null || mixdownPreview !== null,
  }
  const selectedShareVersion =
    shareVersionIdDraft && versionsState.phase === 'ready'
      ? versionsState.items.find((item) => item.version_id === shareVersionIdDraft) ?? null
      : null
  const activeShareSnapshotSummary = selectedShareVersion?.snapshot_summary ?? liveShareSnapshotSummary
  const shareArtifactAvailability: Record<ShareArtifactKey, boolean> = {
    guide: activeShareSnapshotSummary.has_guide,
    takes: activeShareSnapshotSummary.take_count > 0,
    mixdown: activeShareSnapshotSummary.has_mixdown,
    arrangements: activeShareSnapshotSummary.arrangement_count > 0,
  }
  const availableShareArtifacts = defaultShareIncludedArtifacts.filter(
    (item) => shareArtifactAvailability[item],
  )
  const canLaunchShareFlow = availableShareArtifacts.length > 0
  const selectedShareArtifactCount = shareIncludedArtifacts.filter(
    (item) => shareArtifactAvailability[item],
  ).length
  const shareTargetLabel = getShareTargetLabel(selectedShareVersion?.label ?? null)
  const versionPanelViewModel = buildVersionPanelViewModel({
    versionCount: versionsState.items.length,
    versionCreateMessage: getActionStateMessage(versionCreateState),
    versionCreatePhase: versionCreateState.phase,
    versionsErrorMessage: versionsState.phase === 'error' ? versionsState.message : '',
    versionsPhase: versionsState.phase,
  })
  const versionHistoryCards = buildVersionHistoryCards({
    formatDate,
    getProjectVersionSourceLabel,
    versions: versionsState.items,
  })
  const shareLinksPanelViewModel = buildShareLinksPanelViewModel({
    linkCount: shareLinksState.items.length,
    shareCopyMessage: getActionStateMessage(shareCopyState),
    shareCopyPhase: shareCopyState.phase,
    shareCreateMessage: getActionStateMessage(shareCreateState),
    shareCreatePhase: shareCreateState.phase,
    shareDeactivateMessage: getActionStateMessage(shareDeactivateState),
    shareDeactivatePhase: shareDeactivateState.phase,
    shareLinksErrorMessage: shareLinksState.phase === 'error' ? shareLinksState.message : '',
    shareLinksPhase: shareLinksState.phase,
  })
  const latestShareVersionLabel = getLatestShareVersionLabel(versionsState.items)
  const shareLinkHistoryCards = buildShareLinkHistoryCards({
    formatDate,
    getShareAccessScopeLabel,
    shareLinks: shareLinksState.items,
  })
  const playbackPanelViewModel = buildPlaybackPanelViewModel({
    arrangementTransportState,
    formatPlaybackClock,
    playbackDurationMs: arrangementDurationMs,
    playbackPositionMs: arrangementPlaybackPositionMs,
    selectedArrangementPartCount: selectedArrangement?.part_count ?? null,
  })
  const playbackPartRows = selectedArrangement
    ? buildPlaybackPartRows({
        arrangementPartMixerState,
        getArrangementPartColor,
        getDefaultArrangementPartVolume,
        guideFocusPartName,
        onGuideFocusToggle: (partName) =>
          setGuideFocusPartName((current) => (current === partName ? null : partName)),
        onToggleEnabled: (partName, enabled) =>
          updateArrangementPartMixer(partName, {
            enabled,
          }),
        onToggleSolo: (partName, nextSolo) =>
          updateArrangementPartMixer(partName, {
            solo: nextSolo,
          }),
        onVolumeChange: (partName, value) =>
          updateArrangementPartMixer(partName, {
            volume: value,
          }),
        parts: selectedArrangement.parts_json,
      })
    : []
  const melodyEditorRows = buildMelodyEditorRows({
    notes: melodyNotesDraft,
    onRemoveNote: handleRemoveMelodyNote,
    onUpdateNote: updateMelodyNote,
  })
  const arrangementSummaryViewModel = buildArrangementSummaryViewModel({
    formatCompactPercent,
    getBeatboxLabel: (value) => getOptionMeta(beatboxTemplateOptions, value).label,
    getVoiceRangeDescription: (value) => getOptionMeta(voiceRangePresetOptions, value).description,
    getVoiceRangeLabel: (value) => getOptionMeta(voiceRangePresetOptions, value).label,
    selectedArrangement,
  })
  const projectSettingsViewModel = buildProjectSettingsViewModel({
    saveMessage: getActionStateMessage(projectSettingsSaveState),
    savePhase: projectSettingsSaveState.phase,
  })
  const projectSettingsSummaryCards = buildProjectSettingsSummaryCards({
    baseKey: project.base_key ?? null,
    formatDate,
    updatedAt: project.updated_at,
  })
  const shareModalSummaryCards = buildShareModalSummaryCards({
    shareTargetLabel,
    snapshotSummary: activeShareSnapshotSummary,
  })
  const shareVersionOptions = buildShareVersionOptions(
    versionsState.phase === 'ready' ? versionsState.items : [],
  )
  const shareModalArtifactItems = buildShareModalArtifactItems({
    availability: shareArtifactAvailability,
    options: studioShareArtifactOptions,
    selectedArtifacts: shareIncludedArtifacts,
  })
  const shareModalViewModel = buildShareModalViewModel({
    createMessage: getActionStateMessage(shareCreateState),
    createPhase: shareCreateState.phase,
  })
  const workbenchTabItems = buildWorkbenchTabItems({
    activeMode: activeWorkspaceMode,
    activeSectionId: activeWorkbenchSectionId,
    links: studioWorkbenchLinks,
    onSelectSection: setActiveWorkbenchSectionId,
    railLabels: studioRailLabels,
  })
  const openWorkbenchSection = (sectionId: StudioSectionId): void => {
    setWorkspaceMode(studioSectionModeMap[sectionId])
    setActiveWorkbenchSectionId(sectionId)
    requestAnimationFrame(() => {
      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const updateConstraintDraftField = <Key extends keyof ConstraintDraft,>(
    key: Key,
    value: ConstraintDraft[Key],
  ): void => {
    setConstraintDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }
  const updateArrangementConfigField = <Key extends keyof ArrangementConfig,>(
    key: Key,
    value: ArrangementConfig[Key],
  ): void => {
    setArrangementConfig((current) => ({
      ...current,
      [key]: value,
    }))
  }
  const focusInspectorNotes = (): void => {
    if (inspectorPanelRef.current) {
      inspectorPanelRef.current.open = true
    }
    requestAnimationFrame(() => {
      inspectorNoteListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
  const getStudioSectionClassName = (sectionId: StudioSectionId) =>
    `section studio-section ${
      activeWorkbenchSectionId === sectionId
        ? 'studio-section--active'
        : 'studio-section--muted'
    }`

  return (
    <div className="page-shell page-shell--studio">
      <section className="studio-console-shell studio-console-shell--wave-editor">
        <StudioTopbar
          arrangementRoute={arrangementRoute}
          baseKey={project.base_key ?? null}
          canLaunchShareFlow={canLaunchShareFlow}
          chordMarkerCount={chordMarkerCount}
          consoleAlignmentLabel={studioConsoleViewModel.consoleAlignmentLabel}
          consoleChordLabel={studioConsoleViewModel.consoleChordLabel}
          consoleMicLabel={studioConsoleViewModel.consoleMicLabel}
          consoleMicTone={studioConsoleViewModel.consoleMicTone}
          countInBeats={countInBeats}
          onOpenArrangementWorkbench={() => openWorkbenchSection('arrangement')}
          onOpenProjectSettingsDrawer={handleOpenProjectSettingsDrawer}
          onOpenShareModal={handleOpenShareModal}
          projectIdentityLabel={studioShellViewModel.projectIdentityLabel}
          projectTitle={project.title}
          transportBpm={transportBpm}
        />

        <div className="studio-wave-editor__body">
          <StudioRail
            arrangementContextLabel={studioShellViewModel.arrangementContextLabel}
            arrangementSummaryLabel={studioShellViewModel.arrangementSummaryLabel}
            canFocusInspectorNotes={studioSelectionViewModel.canFocusInspectorNotes}
            canOpenArrangementWorkbench={studioSelectionViewModel.canOpenArrangementWorkbench}
            canOpenMelodyWorkbench={studioSelectionViewModel.canOpenMelodyWorkbench}
            consoleAlignmentLabel={studioConsoleViewModel.consoleAlignmentLabel}
            consoleMicLabel={studioConsoleViewModel.consoleMicLabel}
            guideConnected={guide !== null}
            guideSummaryLabel={studioShellViewModel.guideSummaryLabel}
            melodySummaryLabel={studioShellViewModel.melodySummaryLabel}
            mobileSummaryLabel={studioShellViewModel.mobileRailSummaryLabel}
            modeButtons={buildStudioModeButtons({
              activeModeId: activeWorkspaceMode.id,
              modes: studioWorkspaceModes,
              onSelectMode: (mode) => {
                setWorkspaceMode(mode.id)
                setActiveWorkbenchSectionId(studioDefaultSectionByMode[mode.id] ?? mode.sectionIds[0])
              },
            })}
            noteFeedbackContextLabel={studioShellViewModel.noteFeedbackContextLabel}
            noteFeedbackSummaryLabel={studioShellViewModel.noteFeedbackSummaryLabel}
            onFocusInspectorNotes={focusInspectorNotes}
            onOpenArrangementWorkbench={() => openWorkbenchSection('arrangement')}
            onOpenAudioSetup={() => openWorkbenchSection('audio-setup')}
            onOpenMelodyWorkbench={() => openWorkbenchSection('melody')}
            readyTakeCount={readyTakeCount}
            selectedTakeLabel={studioSelectionViewModel.selectedTakeLabel}
            selectedTakeScoreLabel={studioSelectionViewModel.selectedTakeScoreLabel}
            takeCount={takesState.items.length}
            takeItems={buildRailTakeItems({
              formatCompactPercent,
              getTrackStatusLabel,
              onSelectTake: (trackId) => {
                setSelectedTakeId(trackId)
                setWorkspaceMode('review')
              },
              selectedTakeId: selectedTake?.track_id ?? null,
              takes: takesState.items,
            })}
          />

          <div className="studio-wave-editor__main">
            <StudioStage
              analysisButtonDisabled={selectedTake === null || analysisState.phase === 'submitting'}
              analysisButtonLabel={stageViewModel.analysisButtonLabel}
              arrangementRoute={arrangementRoute}
              editorPrimaryAction={editorPrimaryAction}
              editorRangeEndLabel={formatEditorClock(editorRangeEndMs)}
              editorRangeMode={editorRangeMode}
              editorRangeStartLabel={formatEditorClock(editorRangeStartMs)}
              editorRangeTitle={editorRangeTitle}
              fileChipLabel={stageViewModel.fileChipLabel}
              fileChipMeta={stageViewModel.fileChipMeta}
              humanRatingPacketUrl={humanRatingPacketUrl}
              isRecordingActive={recordingFlowViewModel.isRecordingActive}
              isRecordingLocked={recordingFlowViewModel.isRecordingLocked}
              metronomeButtonDisabled={metronomePreviewState.phase === 'submitting'}
              metronomeButtonLabel={recordingSectionViewModel.metronomePreviewButtonLabel}
              noteViewDisabled={selectedNoteFeedback === null}
              onOpenAnalysisWorkbench={() => openWorkbenchSection('analysis')}
              onOpenArrangementWorkbench={() => openWorkbenchSection('arrangement')}
              onOpenRecordingWorkbench={() => openWorkbenchSection('recording')}
              onPreviewMetronome={() => void handlePreviewMetronome()}
              onRunAnalysis={() => void handleRunAnalysis()}
              onSetEditorRangeMode={setEditorRangeMode}
              onStopRecording={() => void handleStopRecording()}
              onToggleRecording={() =>
                void (recordingFlowViewModel.isRecordingActive ? handleStopRecording() : handleStartRecording())
              }
              projectRealEvidenceBatchUrl={projectRealEvidenceBatchUrl}
              quickStopDisabled={recordingState.phase !== 'recording'}
              realEvidenceBatchUrl={realEvidenceBatchUrl}
              recordingToggleLabel={recordingFlowViewModel.recordingToggleLabel}
              selectedTakeExists={selectedTake !== null}
              stageMetaItems={stageViewModel.stageMetaItems}
              waveformPreview={selectedTakePreview}
              waveformStatusLabel={stageViewModel.waveformStatusLabel}
              waveformStatusTone={stageViewModel.waveformStatusTone}
            />

            <StudioTimeline
              emptyDetail="첫 테이크를 녹음하면 여기서 바로 선택하고 다시 들어볼 수 있습니다."
              emptyTitle="아직 테이크가 없습니다."
              guideRow={timelineGuideRow}
              message={timelineMessage}
              mobileSummaryLabel={studioShellViewModel.mobileTrackLaneSummaryLabel}
              players={timelinePlayers}
              rows={timelineRows}
              totalTrackCount={totalTrackCount}
            />
          </div>

          <StudioInspector
            canOpenArrangementWorkbench={studioSelectionViewModel.canOpenArrangementWorkbench}
            canOpenMelodyWorkbench={studioSelectionViewModel.canOpenMelodyWorkbench}
            chordMarkerCount={chordMarkerCount}
            consoleChordLabel={studioConsoleViewModel.consoleChordLabel}
            editorRangeTitle={editorRangeTitle}
            formatConfidence={formatConfidence}
            formatScoreCell={formatScoreCell}
            formatSignedCents={formatSignedCents}
            formatSignedMs={formatSignedMs}
            getHarmonyReferenceLabel={getHarmonyReferenceLabel}
            getPitchDirectionLabel={getPitchDirectionLabel}
            getPitchDirectionTone={getPitchDirectionTone}
            getPitchQualityModeLabel={getPitchQualityModeLabel}
            getTrackStatusLabel={getTrackStatusLabel}
            humanRatingPacketUrl={humanRatingPacketUrl}
            inspectorDirectionValue={inspectorDirectionValue}
            inspectorNoteListRef={inspectorNoteListRef}
            inspectorPanelRef={inspectorPanelRef}
            midiToPitchName={midiToPitchName}
            mobileInspectorSummaryLabel={studioShellViewModel.mobileInspectorSummaryLabel}
            noteFeedbackSummaryLabel={studioShellViewModel.noteFeedbackSummaryLabel}
            onOpenArrangementWorkbench={() => openWorkbenchSection('arrangement')}
            onOpenHarmonyWorkbench={() => openWorkbenchSection('harmony-authoring')}
            onOpenMelodyWorkbench={() => openWorkbenchSection('melody')}
            onSelectNoteFeedback={setSelectedNoteFeedbackIndex}
            selectedNoteFeedback={selectedNoteFeedback}
            selectedTake={selectedTake}
            selectedTakeLabel={studioSelectionViewModel.selectedTakeLabel}
            selectedTakeNoteFeedback={selectedTakeNoteFeedback}
            selectedTakeScore={selectedTakeScore}
          />
        </div>
      </section>


      <section className="studio-workbench" ref={workbenchRef}>
        <StudioWorkbenchTabs items={workbenchTabItems} />

        <div className="studio-workbench__panel">
          <StudioWorkbenchSection
            className={getStudioSectionClassName('harmony-authoring')}
            eyebrow="화성 기준 연결"
            id="harmony-authoring"
            title="코드 타임라인"
            useGrid
          >
            <StudioHarmonyTimelinePanel
              addButtonLabel="코드 마커 추가"
              applyImportButtonLabel="붙여넣기 반영"
              feedbackMessage={harmonyPanelViewModel.feedbackMessage}
              importButtonLabel="붙여넣기 칸 채우기"
              markerRows={harmonyMarkerRows}
              onAddMarker={handleAddChordMarker}
              onApplyImport={handleApplyChordImport}
              onLoadImport={handleLoadChordRowsIntoJson}
              onSave={() => void handleSaveProjectHarmonyReference()}
              onSeedFromProjectKey={handleSeedChordTimelineFromProjectKey}
              saveButtonDisabled={projectHarmonyState.phase === 'submitting'}
              saveButtonLabel={harmonyPanelViewModel.saveButtonLabel}
              seedButtonLabel="현재 키로 시작"
              statusLabel={harmonyPanelViewModel.statusLabel}
              statusTone={harmonyPanelViewModel.statusTone}
              summaryCards={harmonySummaryCards}
            />

            <StudioChordImportPanel
              jsonDraft={chordTimelineJsonDraft}
              onJsonDraftChange={setChordTimelineJsonDraft}
              statusLabel={harmonyPanelViewModel.chordImportStatusLabel}
              statusTone={harmonyPanelViewModel.chordImportStatusTone}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('audio-setup')}
            eyebrow="입력 준비"
            id="audio-setup"
            title="장치 / 가이드"
            useGrid
          >
            <StudioAudioSetupPanel
              appliedSettingsLabel={appliedInputSettingsLabel}
              autoGainControl={constraintDraft.autoGainControl}
              channelCount={constraintDraft.channelCount}
              deviceCards={audioSetupDeviceCards}
              echoCancellation={constraintDraft.echoCancellation}
              inputOptions={audioInputOptions}
              inputSelectionDisabled={inputSelectionDisabled}
              noiseSuppression={constraintDraft.noiseSuppression}
              onAutoGainControlChange={(checked) => updateConstraintDraftField('autoGainControl', checked)}
              onChannelCountChange={(value) => updateConstraintDraftField('channelCount', value)}
              onEchoCancellationChange={(checked) => updateConstraintDraftField('echoCancellation', checked)}
              onNoiseSuppressionChange={(checked) => updateConstraintDraftField('noiseSuppression', checked)}
              onOutputRouteChange={setOutputRoute}
              onRefreshInputs={() => void refreshAudioInputs().catch(() => undefined)}
              onRequestMicrophoneAccess={() => void handleRequestMicrophoneAccess()}
              onSaveDeviceProfile={() => void handleSaveDeviceProfile()}
              onSelectedInputChange={setSelectedInputId}
              outputOptions={outputRouteOptions}
              outputRoute={outputRoute}
              permissionMessage={audioSetupPanelViewModel.permissionMessage}
              requestButtonDisabled={permissionState.phase === 'requesting'}
              requestButtonLabel={
                permissionState.phase === 'requesting' ? '권한 요청 중...' : '마이크 권한 요청'
              }
              requestedSettingsLabel={requestedInputSettingsLabel}
              saveButtonDisabled={saveDeviceState.phase === 'submitting'}
              saveButtonLabel={audioSetupPanelViewModel.saveButtonLabel}
              saveMessage={
                deviceProfileState.phase === 'error'
                  ? { text: deviceProfileState.message, tone: 'error' }
                  : audioSetupPanelViewModel.saveMessage
              }
              selectedInputId={selectedInputId}
              statusLabel={audioSetupPanelViewModel.statusLabel}
              statusTone={audioSetupPanelViewModel.statusTone}
              warningEmptyMessage={audioSetupWarningEmptyMessage}
              warningItems={audioSetupWarningItems}
              warningSectionTitle={audioSetupWarningSectionTitle}
            />

            <StudioGuidePanel
              fileInputRef={guideFileInputRef}
              fileSelectionMessage={guidePanelViewModel.fileSelectionMessage}
              fileSelectionTone="hint"
              guideErrorMessage={guideState.phase === 'error' ? guideState.message : null}
              guidePlayerMuted={guide ? isTrackMutedByMixer(guide.track_id) : false}
              guidePlayerVolume={guideMixer?.volume ?? 0.85}
              guideSourceUrl={guideSourceUrl}
              guideStatusLabel={guidePanelViewModel.statusLabel}
              guideStatusTone={guidePanelViewModel.statusTone}
              hasGuide={guide !== null}
              onFileChange={setGuideFile}
              onUpload={() => void handleGuideUpload()}
              statusCards={guideStatusCards}
              trackFailureMessage={guide?.failure_message ?? null}
              uploadButtonDisabled={guideUploadState.phase === 'submitting' || guideFile === null}
              uploadButtonLabel={guidePanelViewModel.uploadButtonLabel}
              uploadMessage={guidePanelViewModel.uploadMessage}
            />
          </StudioWorkbenchSection>

      <StudioRecordingSection
        className={getStudioSectionClassName('recording')}
        countInBeats={countInBeats}
        isRecordingActive={recordingFlowViewModel.isRecordingActive}
        isRecordingLocked={recordingFlowViewModel.isRecordingLocked}
        liveInputMeterLevelPercent={liveInputMeterLevelPercent}
        liveInputMeterMessage={liveInputMeterState.message}
        liveInputMeterPeakPercent={liveInputMeterPeakPercent}
        liveInputMeterPhase={liveInputMeterState.phase}
        liveInputMeterStatusLabel={recordingSectionViewModel.liveInputMeterStatusLabel}
        liveInputMeterTone={recordingFlowViewModel.liveInputMeterTone}
        metronomeEnabled={metronomeEnabled}
        metronomePreviewButtonDisabled={metronomePreviewState.phase === 'submitting'}
        metronomePreviewButtonLabel={recordingSectionViewModel.metronomePreviewButtonLabel}
        metronomePreviewMessage={recordingSectionViewModel.metronomePreviewMessage}
        metronomePreviewTone={recordingSectionViewModel.metronomePreviewTone}
        onCountInChange={setCountInBeats}
        onPreviewMetronome={() => void handlePreviewMetronome()}
        onRefreshTakes={() => void refreshTakes().catch(() => undefined)}
        onStopRecording={() => void handleStopRecording()}
        onToggleMetronome={setMetronomeEnabled}
        onToggleRecording={() =>
          void (recordingFlowViewModel.isRecordingActive ? handleStopRecording() : handleStartRecording())
        }
        recordingMessage={recordingState.message}
        recordingStatusLabel={recordingSectionViewModel.recordingStatusLabel}
        recordingStatusTone={recordingSectionViewModel.recordingStatusTone}
        recordingToggleLabel={recordingFlowViewModel.recordingToggleLabel}
        selectedTakeFieldLabel={recordingSectionViewModel.selectedTakeFieldLabel}
        stopRecordingDisabled={recordingState.phase !== 'recording'}
        takeItems={recordingTakeItems}
        takeSummaryItems={recordingTakeSummaryItems}
        takesErrorMessage={takesState.phase === 'error' ? takesState.message : null}
        timeSignatureLabel={project.time_signature ?? '4/4'}
        transportAccentEveryLabel={`${transportAccentEvery}박`}
        transportBpmLabel={`${transportBpm} BPM`}
        transportKeyLabel={project.base_key ?? '미설정'}
      />
          <StudioWorkbenchSection
            className={getStudioSectionClassName('analysis')}
            eyebrow="사후 분석"
            id="analysis"
            title="분석"
            useGrid
          >
            <StudioAnalysisSummaryPanel
              actionMessages={analysisPanelViewModel.actionMessages}
              chips={analysisChips}
              harmonyFallbackWarning={selectedTakeScore?.harmony_reference_mode === 'KEY_ONLY'}
              hasSelectedTake={selectedTake !== null}
              miniCards={analysisMiniCards}
              onRefreshSnapshot={() => void refreshStudioSnapshot().catch(() => undefined)}
              onRetryAnalysis={() => void handleRetryAnalysisJob()}
              onRunAnalysis={() => void handleRunAnalysis()}
              retryDisabled={
                selectedTakeAnalysisJob?.status !== 'FAILED' || analysisState.phase === 'submitting'
              }
              runButtonDisabled={analysisState.phase === 'submitting'}
              runButtonLabel={analysisPanelViewModel.runButtonLabel}
              scoreCards={analysisScoreCards}
              statusLabel={analysisPanelViewModel.statusLabel}
              statusTone={analysisPanelViewModel.statusTone}
            />
            <StudioNoteFeedbackPanel
              chordMarkerCount={chordMarkerCount}
              formatConfidence={formatConfidence}
              formatRatio={formatRatio}
              formatSignedCents={formatSignedCents}
              formatSignedMs={formatSignedMs}
              formatTimeSpan={formatTimeSpan}
              getConfidenceTone={getConfidenceTone}
              getHarmonyReferenceHint={getHarmonyReferenceHint}
              getHarmonyReferenceLabel={getHarmonyReferenceLabel}
              getPitchDirectionLabel={getPitchDirectionLabel}
              getPitchDirectionTone={getPitchDirectionTone}
              getPitchQualityModeHint={getPitchQualityModeHint}
              getPitchQualityModeLabel={getPitchQualityModeLabel}
              getScoreTone={getScoreTone}
              midiToPitchName={midiToPitchName}
              noteFeedbackDetailSummaryLabel={inspectorSummaryViewModel.noteFeedbackDetailSummaryLabel}
              noteFeedbackSegmentSummaryLabel={inspectorSummaryViewModel.noteFeedbackSegmentSummaryLabel}
              noteFeedbackSummaryLabel={studioShellViewModel.noteFeedbackSummaryLabel}
              noteFeedbackTimelineDurationMs={noteFeedbackTimelineDurationMs}
              onSelectNoteFeedback={setSelectedNoteFeedbackIndex}
              selectedNoteFeedback={selectedNoteFeedback}
              selectedTakeNoteFeedback={selectedTakeNoteFeedback}
              selectedTakeScore={selectedTakeScore}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('melody')}
            eyebrow="멜로디 초안"
            id="melody"
            title="멜로디"
            useGrid
          >
            <StudioMelodyPanel
              extractButtonDisabled={melodyState.phase === 'submitting'}
              extractButtonLabel={melodyPanelViewModel.extractButtonLabel}
              hasSelectedTake={selectedTake !== null}
              melodyMessage={melodyPanelViewModel.melodyMessage}
              midiDownloadUrl={selectedTakeMelodyMidiUrl}
              miniItems={melodyMiniItems}
              onAddNote={handleAddMelodyNote}
              onExtract={() => void handleExtractMelody()}
              onSave={() => void handleSaveMelodyDraft()}
              saveButtonDisabled={
                selectedTakeMelody === null || melodySaveState.phase === 'submitting'
              }
              saveButtonLabel={melodyPanelViewModel.saveButtonLabel}
              saveMessage={melodyPanelViewModel.saveMessage}
              statusLabel={melodyPanelViewModel.statusLabel}
              statusTone={melodyPanelViewModel.statusTone}
            />
            <StudioMelodyEditorPanel
              hasNotes={melodyNotesDraft.length > 0}
              noteRows={melodyEditorRows}
              statusLabel={melodyPanelViewModel.editorStatusLabel}
              statusTone={melodyPanelViewModel.editorStatusTone}
              summaryLabel={melodyPanelViewModel.editorSummaryLabel}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('arrangement')}
            eyebrow="편곡 후보"
            id="arrangement"
            title="편곡"
            useGrid
          >
            <StudioArrangementEnginePanel
              arrangementRoute={arrangementRoute ?? `/projects/${projectId}/arrangement`}
              beatboxTemplateOptions={beatboxTemplateOptions}
              candidateCards={arrangementCandidateCards}
              difficultyOptions={arrangementDifficultySelectOptions}
              generateButtonDisabled={arrangementState.phase === 'submitting'}
              generateButtonLabel={arrangementEngineViewModel.generateButtonLabel}
              onBeatboxTemplateChange={(value) => updateArrangementConfigField('beatboxTemplate', value)}
              onDifficultyChange={(value) => updateArrangementConfigField('difficulty', value)}
              onGenerate={() => void handleGenerateArrangements()}
              onRefresh={() => void refreshStudioSnapshot().catch(() => undefined)}
              onSave={() => void handleSaveArrangement()}
              onSelectArrangement={setSelectedArrangementId}
              onStyleChange={(value) => updateArrangementConfigField('style', value)}
              onVoiceRangePresetChange={(value) => updateArrangementConfigField('voiceRangePreset', value)}
              presetSummaryCards={arrangementPresetSummaryCards}
              presetSummaryLabel={arrangementEngineViewModel.presetSummaryLabel}
              primaryMessage={arrangementEngineViewModel.primaryMessage}
              saveButtonDisabled={
                selectedArrangement === null || arrangementSaveState.phase === 'submitting'
              }
              saveButtonLabel={arrangementEngineViewModel.saveButtonLabel}
              saveMessage={arrangementEngineViewModel.saveMessage}
              selectedBeatboxTemplate={arrangementConfig.beatboxTemplate}
              selectedDifficulty={arrangementConfig.difficulty}
              selectedStyle={arrangementConfig.style}
              selectedVoiceRangePreset={arrangementConfig.voiceRangePreset}
              statusLabel={arrangementEngineViewModel.statusLabel}
              statusTone={arrangementEngineViewModel.statusTone}
              styleOptions={arrangementStyleSelectOptions}
              voiceRangeOptions={voiceRangePresetOptions}
            />
            <StudioArrangementSummaryPanel
              arrangementJsonDraft={arrangementJsonDraft}
              comparisonHint={arrangementSummaryViewModel.comparisonHint}
              comparisonSummaryLabel={arrangementSummaryViewModel.comparisonSummaryLabel}
              detailCards={arrangementSummaryViewModel.detailCards}
              hasSelectedArrangement={selectedArrangement !== null}
              onArrangementJsonChange={setArrangementJsonDraft}
              onTitleChange={setArrangementTitleDraft}
              sourceMelodyLabel={arrangementSummaryViewModel.sourceMelodyLabel}
              statusLabel={arrangementSummaryViewModel.statusLabel}
              statusTone={arrangementSummaryViewModel.statusTone}
              titleDraft={arrangementTitleDraft}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('score-playback')}
            eyebrow="악보/재생"
            id="score-playback"
            title="악보 / 재생"
            useGrid
          >
            <StudioScoreViewPanel
              guideWavUrl={guideWavExportUrl}
              hasSelectedArrangement={selectedArrangement !== null}
              midiUrl={selectedArrangementMidiUrl}
              musicXmlUrl={selectedArrangementMusicXmlUrl}
              playheadRatio={arrangementPlaybackRatio}
              renderKey={scoreViewRenderKey}
              scoreStatusLabel={scorePlaybackSummaryViewModel.scoreStatusLabel}
              scoreStatusTone={scorePlaybackSummaryViewModel.scoreStatusTone}
            />
            <StudioPlaybackPanel
              guideModeEnabled={guideModeEnabled}
              hasSelectedArrangement={selectedArrangement !== null}
              mixSummaryLabel={scorePlaybackSummaryViewModel.arrangementMixSummaryLabel}
              onGuideModeChange={setGuideModeEnabled}
              onPlay={() => void handlePlayArrangement()}
              onStop={() => void stopArrangementPlayback()}
              partCountLabel={playbackPanelViewModel.partCountLabel}
              partRows={playbackPartRows}
              playButtonDisabled={selectedArrangement === null}
              playbackPositionLabel={playbackPanelViewModel.positionLabel}
              progressPercent={Math.min(100, arrangementPlaybackRatio * 100)}
              statusLabel={playbackPanelViewModel.statusLabel}
              statusTone={playbackPanelViewModel.statusTone}
              stopButtonDisabled={
                arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'
              }
              transportMessage={playbackPanelViewModel.transportMessage}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('mixdown')}
            eyebrow="믹스다운"
            id="mixdown"
            title="믹스다운"
            useGrid
          >
            <StudioMixdownRenderPanel
              guideSourceLabel={mixdownRenderViewModel.guideSourceLabel}
              guideVolumeLabel={mixdownRenderViewModel.guideVolumeLabel}
              onRefresh={() => void refreshStudioSnapshot().catch(() => undefined)}
              onRender={() => void handleRenderMixdown()}
              onSave={() => void handleSaveMixdown()}
              previewButtonDisabled={mixdownPreviewState.phase === 'submitting'}
              previewButtonLabel={mixdownRenderViewModel.previewButtonLabel}
              previewMessage={mixdownRenderViewModel.previewMessage}
              saveButtonDisabled={mixdownPreview === null || mixdownSaveState.phase === 'submitting'}
              saveButtonLabel={mixdownRenderViewModel.saveButtonLabel}
              saveMessage={mixdownRenderViewModel.saveMessage}
              selectedTakeLabel={mixdownRenderViewModel.selectedTakeLabel}
              statusLabel={mixdownRenderViewModel.statusLabel}
              statusTone={mixdownRenderViewModel.statusTone}
              takeVolumeLabel={mixdownRenderViewModel.takeVolumeLabel}
            />

            <StudioMixdownPlaybackPanel
              durationLabel={mixdownPlaybackViewModel.durationLabel}
              includedTracksLabel={mixdownRenderViewModel.playbackIncludedTracksLabel}
              playbackSummaryLabel={mixdownRenderViewModel.playbackSummaryLabel}
              playbackUrl={mixdownPlaybackUrl}
              previewSource={mixdownPreviewSource}
              sampleRateLabel={mixdownPlaybackViewModel.sampleRateLabel}
              sourceLabel={mixdownRenderViewModel.sourceLabel}
              statusLabel={mixdownPlaybackViewModel.statusLabel}
              statusTone={mixdownPlaybackViewModel.statusTone}
              updatedAtLabel={mixdownPlaybackViewModel.updatedAtLabel}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('version')}
            eyebrow="버전"
            id="version"
            title="버전"
          >
            <StudioVersionPanel
              cards={versionHistoryCards}
              feedbackMessage={versionPanelViewModel.feedbackMessage}
              onCapture={() => void handleCaptureVersion()}
              onRefresh={() => void refreshProjectVersions().catch(() => undefined)}
              onVersionLabelChange={setVersionLabelDraft}
              onVersionNoteChange={setVersionNoteDraft}
              saveButtonDisabled={versionCreateState.phase === 'submitting'}
              saveButtonLabel={versionPanelViewModel.saveButtonLabel}
              statusLabel={versionPanelViewModel.statusLabel}
              statusTone={versionPanelViewModel.statusTone}
              versionLabelDraft={versionLabelDraft}
              versionNoteDraft={versionNoteDraft}
            />
          </StudioWorkbenchSection>

          <StudioWorkbenchSection
            className={getStudioSectionClassName('sharing')}
            eyebrow="공유"
            id="sharing"
            title="공유"
          >
            <StudioShareLinksPanel
              canLaunchShareFlow={canLaunchShareFlow}
              copyMessage={shareLinksPanelViewModel.copyMessage}
              deactivateBusy={shareDeactivateState.phase === 'submitting'}
              deactivateMessage={shareLinksPanelViewModel.deactivateMessage}
              latestVersionLabel={latestShareVersionLabel}
              links={shareLinkHistoryCards}
              onCopy={(shareUrl) => void handleCopyShareLink(shareUrl)}
              onDeactivate={(shareLinkId) => void handleDeactivateShareLink(shareLinkId)}
              onOpenShareModal={handleOpenShareModal}
              onRefresh={() => void refreshShareLinks().catch(() => undefined)}
              primaryMessage={shareLinksPanelViewModel.primaryMessage}
              selectedShareArtifactCount={selectedShareArtifactCount}
              shareTargetLabel={shareTargetLabel}
              statusLabel={shareLinksPanelViewModel.statusLabel}
              statusTone={shareLinksPanelViewModel.statusTone}
            />
          </StudioWorkbenchSection>

      <StudioProjectSettingsDrawer
        draft={projectSettingsDraft}
        feedbackMessage={projectSettingsViewModel.feedbackMessage}
        isOpen={isProjectSettingsDrawerOpen}
        onClose={() => setIsProjectSettingsDrawerOpen(false)}
        onDraftChange={(field, value) =>
          setProjectSettingsDraft((current) => ({
            ...current,
            [field]: value,
          }))
        }
        onSave={() => void handleSaveProjectSettings()}
        saveButtonDisabled={projectSettingsSaveState.phase === 'submitting'}
        saveButtonLabel={projectSettingsViewModel.saveButtonLabel}
        summaryCards={projectSettingsSummaryCards}
      />

      <StudioShareModal
        artifactItems={shareModalArtifactItems}
        createButtonDisabled={shareCreateState.phase === 'submitting' || selectedShareArtifactCount === 0}
        createButtonLabel={shareModalViewModel.createButtonLabel}
        feedbackMessage={shareModalViewModel.feedbackMessage}
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        onCreate={() => void handleCreateShareLink()}
        onExpiryDaysChange={setShareExpiryDays}
        onLabelChange={setShareLabelDraft}
        onToggleArtifact={(key) => handleToggleShareArtifact(key as ShareArtifactKey)}
        onVersionChange={setShareVersionIdDraft}
        shareExpiryDays={shareExpiryDays}
        shareLabelDraft={shareLabelDraft}
        shareVersionIdDraft={shareVersionIdDraft}
        summaryCards={shareModalSummaryCards}
        versionOptions={shareVersionOptions}
      />
    </div>
  </section>
    </div>
  )
}

