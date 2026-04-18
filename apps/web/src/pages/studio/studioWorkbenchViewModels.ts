import type { BrowserAudioCapabilitySnapshot } from '../../lib/browserAudioDiagnostics'

type AudioProfileLike = {
  actual_sample_rate: number | null
  browser: string
  browser_user_agent: string | null
  channel_count: number | null
  os: string
  output_route: string
  updated_at: string
}

type ConstraintDraftLike = {
  autoGainControl: boolean
  echoCancellation: boolean
  noiseSuppression: boolean
}

type GuideTrackLike = {
  actual_sample_rate: number | null
  duration_ms: number | null
  source_format: string | null
  track_status: string
}

type ProjectVersionRecordLike = {
  created_at: string
  label: string
  note: string | null
  snapshot_summary: {
    arrangement_count: number
    has_guide: boolean
    ready_take_count: number
    take_count: number
  }
  source_type: string
  version_id: string
}

type ShareLinkRecordLike = {
  access_scope: string
  created_at: string
  expires_at: string | null
  is_active: boolean
  label: string
  last_accessed_at: string | null
  share_link_id: string
  share_url: string
}

type ArrangementCandidateLike = {
  arrangement_id: string
  beatbox_template: string | null
  candidate_code: string
  comparison_summary: {
    beatbox_note_count: number
    lead_range_fit_percent: number
    parallel_motion_alerts: number
    support_max_leap: number
  } | null
  constraint_json: Record<string, unknown> | null
  difficulty: string
  midi_artifact_url: string | null
  part_count: number
  parts_json: Array<{ notes: unknown[]; part_name?: string }>
  style?: string | null
  title?: string | null
  voice_range_preset: string | null
}

type MixdownPreviewLike = {
  actualSampleRate: number
  durationMs: number
  labels: string[]
}

type MixdownSummaryLike = {
  actual_sample_rate: number | null
  duration_ms: number | null
  source_artifact_url: string | null
  track_status: string
  updated_at: string
}

type PlaybackTransportStateLike = {
  message: string
  phase: string
}

type SnapshotSummaryLike = {
  arrangement_count: number
  has_guide: boolean
  take_count: number
}

type TakeSummaryLike = {
  take_no: number | null
  track_status: string
}

type MelodyDraftLike = {
  grid_division: string
  key_estimate: string | null
  note_count: number
}

type AnalysisJobLike = {
  error_message: string | null
  requested_at: string
  status: string | null | undefined
}

type OptionMetaLike = {
  description: string
  label: string
}

type SelectedTakeLike = {
  alignment_confidence: number | null
  alignment_offset_ms?: number | null
  take_no: number | null
}

type SelectedTakeScoreLike = {
  harmony_fit_score: number | null
  harmony_reference_mode: string | null | undefined
  pitch_quality_mode: string | null | undefined
  pitch_score: number | null
  rhythm_score: number | null
  total_score: number | null
}

export type StudioInfoCard = {
  description?: string
  label: string
  value: string
}

export type StudioSummaryCard = {
  description: string
  label: string
  value: string
}

export type StudioAnalysisScoreCard = {
  highlight?: boolean
  label: string
  value: string
}

export type StudioAnalysisMiniCard = {
  detail?: string
  label: string
  value: string
}

export type StudioAnalysisChip = {
  label: string
  tone: 'alert' | 'good' | 'neutral' | 'warn'
}

export type StudioPresetSummaryCard = {
  description: string
  label: string
  title: string
}

export type StudioArrangementCandidateCard = {
  beatboxCountLabel: string
  chipLabels: string[]
  id: string
  leadFitLabel: string
  maxLeapLabel: string
  midiUrl: string | null
  parallelAlertsLabel: string
  selectLabel: string
  selected: boolean
  subtitle: string
  summaryDescription: string
  summaryTitle: string
  title: string
}

export type StudioHistoryCard = {
  arrangementCountLabel: string
  createdAtLabel: string
  hasGuideLabel: string
  id: string
  label: string
  note: string | null
  readyTakeCountLabel: string
  sourceLabel: string
  takeCountLabel: string
  takeSummaryLabel: string
}

export type StudioShareLinkHistoryCard = {
  accessScopeLabel: string
  createdAtLabel: string
  expiresAtLabel: string
  id: string
  isActive: boolean
  label: string
  lastAccessedLabel: string
  stateLabel: string
  summaryLabel: string
  url: string
}

export type StudioWarningEmptyMessage = {
  hint: string
  title: string
}

export type StudioToneMessage = {
  text: string
  tone: 'error' | 'hint'
}

export type StudioStatusTone = 'error' | 'loading' | 'ready'
export type StudioTimelineMessage = {
  text: string
  tone: 'error' | 'info'
}

export function buildStudioSelectionViewModel({
  getTrackStatusLabel,
  hasMelodyDraft,
  noteFeedbackCount,
  selectedTakeExists,
  selectedTakeNo,
  selectedTakeStatus,
  selectedTakeTotalScoreLabel,
}: {
  getTrackStatusLabel: (status: string) => string
  hasMelodyDraft: boolean
  noteFeedbackCount: number
  selectedTakeExists: boolean
  selectedTakeNo: number | null | undefined
  selectedTakeStatus: string | null | undefined
  selectedTakeTotalScoreLabel: string | null
}): {
  canFocusInspectorNotes: boolean
  canOpenArrangementWorkbench: boolean
  canOpenMelodyWorkbench: boolean
  selectedTakeLabel: string
  selectedTakeScoreLabel: string
} {
  const selectedTakeLabel = selectedTakeExists ? `${selectedTakeNo ?? '?'}번 테이크` : '선택 없음'

  return {
    canFocusInspectorNotes: noteFeedbackCount > 0,
    canOpenArrangementWorkbench: hasMelodyDraft,
    canOpenMelodyWorkbench: selectedTakeExists,
    selectedTakeLabel,
    selectedTakeScoreLabel: selectedTakeTotalScoreLabel ?? (selectedTakeStatus ? getTrackStatusLabel(selectedTakeStatus) : '대기 중'),
  }
}

export function buildStudioConsoleViewModel({
  chordMarkerCount,
  formatConfidence,
  getConsoleMicLabel,
  hasProfile,
  permissionPhase,
  selectedTakeAlignmentConfidence,
}: {
  chordMarkerCount: number
  formatConfidence: (value: number | null) => string
  getConsoleMicLabel: (permissionPhase: string, hasProfile: boolean) => string
  hasProfile: boolean
  permissionPhase: string
  selectedTakeAlignmentConfidence: number | null | undefined
}): {
  consoleAlignmentLabel: string
  consoleChordLabel: string
  consoleMicLabel: string
  consoleMicTone: StudioStatusTone
} {
  return {
    consoleAlignmentLabel:
      selectedTakeAlignmentConfidence === null || selectedTakeAlignmentConfidence === undefined
        ? '없음'
        : formatConfidence(selectedTakeAlignmentConfidence),
    consoleChordLabel: chordMarkerCount > 0 ? '화성 기준' : '키 기준',
    consoleMicLabel: getConsoleMicLabel(permissionPhase, hasProfile),
    consoleMicTone:
      permissionPhase === 'granted'
        ? 'ready'
        : permissionPhase === 'error'
          ? 'error'
          : 'loading',
  }
}

function buildOptionalActionFeedbackMessage({
  message,
  phase,
}: {
  message: string
  phase: string
}): StudioToneMessage | null {
  if (phase === 'success' || phase === 'error') {
    return {
      text: message,
      tone: phase === 'error' ? 'error' : 'hint',
    }
  }

  return null
}

export function buildHarmonySummaryCards({
  baseKey,
  chordDraftRowCount,
  chordMarkerCount,
  timeSignature,
  transportBpm,
}: {
  baseKey: string | null
  chordDraftRowCount: number
  chordMarkerCount: number
  timeSignature: string | null
  transportBpm: number
}): StudioSummaryCard[] {
  return [
    {
      description:
        chordMarkerCount > 0
          ? '분석을 다시 실행하면 코드 인식 화성 경로를 사용할 수 있습니다.'
          : '아직 코드 타임라인이 없어 화성 적합도는 키 기준 대체 경로를 사용합니다.',
      label: '저장된 마커',
      value: String(chordMarkerCount),
    },
    {
      description:
        '악보 작성 도구처럼 무겁게 만들기보다, 화성 적합도를 정직하게 만들 만큼만 유지하세요.',
      label: '초안 행',
      value: String(chordDraftRowCount),
    },
    {
      description: '프로젝트 메타데이터에서 첫 마커를 만들 때 시드 기준으로 사용합니다.',
      label: '프로젝트 키',
      value: baseKey ?? '미설정',
    },
    {
      description: '준비된 타임라인을 가져오지 않을 때 마커 길이를 가늠하는 기준으로 사용하세요.',
      label: '타임 그리드 힌트',
      value: `${timeSignature ?? '4/4'} · ${transportBpm} BPM`,
    },
  ]
}

export function buildHarmonyPanelViewModel({
  chordMarkerCount,
  projectHarmonyMessage,
  projectHarmonyPhase,
}: {
  chordMarkerCount: number
  projectHarmonyMessage: string
  projectHarmonyPhase: string
}): {
  chordImportStatusLabel: string
  chordImportStatusTone: StudioStatusTone
  feedbackMessage: StudioToneMessage
  saveButtonLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
} {
  const hasChordMarkers = chordMarkerCount > 0

  return {
    chordImportStatusLabel: hasChordMarkers ? '코드 인식 경로 사용 가능' : '대체 경로만 사용',
    chordImportStatusTone: hasChordMarkers ? 'ready' : 'loading',
    feedbackMessage:
      buildOptionalActionFeedbackMessage({
        message: projectHarmonyMessage,
        phase: projectHarmonyPhase,
      }) ?? {
        text: '시작 시간과 끝 시간은 밀리초 기준으로 적어 주세요. 대부분은 코드 이름만 있어도 시작할 수 있고, 세부 음 정보는 필요할 때만 더하면 됩니다.',
        tone: 'hint',
      },
    saveButtonLabel: projectHarmonyPhase === 'submitting' ? '화성 기준 저장 중...' : '코드 타임라인 저장',
    statusLabel: hasChordMarkers ? `저장된 마커 ${chordMarkerCount}개` : '키 기준 대체 경로',
    statusTone: hasChordMarkers ? 'ready' : 'loading',
  }
}

export function buildAudioInputOptions(audioInputs: MediaDeviceInfo[]) {
  return audioInputs.map((device, index) => ({
    label: device.label || `마이크 ${index + 1}`,
    value: device.deviceId || `audio-input-${index}`,
  }))
}

export function buildRequestedInputSettingsLabel(constraintDraft: ConstraintDraftLike): string {
  return [
    constraintDraft.echoCancellation ? '에코 줄이기 켜짐' : '에코 줄이기 꺼짐',
    constraintDraft.autoGainControl ? '자동 음량 보정 켜짐' : '자동 음량 보정 꺼짐',
    constraintDraft.noiseSuppression ? '잡음 줄이기 켜짐' : '잡음 줄이기 꺼짐',
  ].join(' · ')
}

export function buildAppliedInputSettingsLabel(appliedSettingsPreview: Record<string, unknown> | null): string {
  if (!appliedSettingsPreview) {
    return '권한 허용 후 채워집니다'
  }

  return `${String(appliedSettingsPreview.sampleRate ?? '알 수 없음')} Hz / ${String(
    appliedSettingsPreview.channelCount ?? '알 수 없음',
  )}채널`
}

export function buildAudioSetupDeviceCards({
  currentCapabilitySnapshot,
  deviceProfilePhase,
  formatDate,
  latestProfile,
  outputRoute,
  summarizeBrowserAudioStack,
  summarizeRecorderSupport,
  summarizeWebAudioSupport,
}: {
  currentCapabilitySnapshot: BrowserAudioCapabilitySnapshot | null
  deviceProfilePhase: string
  formatDate: (value: string) => string
  latestProfile: AudioProfileLike | null
  outputRoute: string
  summarizeBrowserAudioStack: (snapshot: BrowserAudioCapabilitySnapshot | null) => string
  summarizeRecorderSupport: (snapshot: BrowserAudioCapabilitySnapshot | null) => string
  summarizeWebAudioSupport: (snapshot: BrowserAudioCapabilitySnapshot | null) => string
}): StudioInfoCard[] {
  return [
    {
      label: '최근 저장',
      value:
        deviceProfilePhase === 'loading'
          ? '불러오는 중...'
          : latestProfile
            ? formatDate(latestProfile.updated_at)
            : '아직 저장된 프로필이 없습니다',
    },
    {
      label: '실제 샘플레이트',
      value: String(latestProfile?.actual_sample_rate ?? '알 수 없음'),
    },
    {
      label: '채널 수',
      value: String(latestProfile?.channel_count ?? '알 수 없음'),
    },
    {
      label: '출력 경로',
      value: latestProfile?.output_route ?? outputRoute,
    },
    {
      description: latestProfile?.browser_user_agent
        ? latestProfile.browser_user_agent
        : '저장 시 user agent를 함께 남겨 하드웨어별 이슈를 설명 가능하게 만듭니다.',
      label: '브라우저',
      value: latestProfile ? `${latestProfile.browser} / ${latestProfile.os}` : '미리보기 전용',
    },
    {
      label: '녹음 형식',
      value: summarizeRecorderSupport(currentCapabilitySnapshot),
    },
    {
      label: '브라우저 재생 경로',
      value: summarizeWebAudioSupport(currentCapabilitySnapshot),
    },
    {
      description: '입력 표시, 빠른 계산, 브라우저 안 미리듣기 준비 상태입니다.',
      label: '브라우저 오디오 준비',
      value: summarizeBrowserAudioStack(currentCapabilitySnapshot),
    },
    {
      label: '마이크 권한',
      value: currentCapabilitySnapshot?.permissions.microphone ?? '알 수 없음',
    },
    {
      label: '출력 지연 API',
      value: currentCapabilitySnapshot?.web_audio.output_latency_supported ? '사용 가능' : '사용 불가',
    },
    {
      label: '오프라인 렌더',
      value: currentCapabilitySnapshot?.web_audio.offline_audio_context ? '사용 가능' : '사용 불가',
    },
  ]
}

export function buildAudioSetupWarningItems(
  currentCapabilityWarnings: string[],
  getBrowserAudioWarningLabel: (flag: string) => string,
) {
  return currentCapabilityWarnings.map((flag) => ({
    description: getBrowserAudioWarningLabel(flag),
    title: flag,
  }))
}

export function getAudioSetupWarningSectionTitle({
  hasCapabilitySnapshot,
  hasLatestProfile,
}: {
  hasCapabilitySnapshot: boolean
  hasLatestProfile: boolean
}): string | null {
  if (hasLatestProfile) {
    return '저장된 환경 경고'
  }

  if (hasCapabilitySnapshot) {
    return '현재 환경 경고'
  }

  return null
}

export function buildAudioSetupWarningEmptyMessage(hasLatestProfile: boolean): StudioWarningEmptyMessage {
  return hasLatestProfile
    ? {
        hint: '이 경로에서는 녹음, 권한, 재생 흐름이 모두 사용 가능한 상태로 보입니다.',
        title: '저장된 프로필에는 활성 경고가 없습니다.',
      }
    : {
        hint: '이 상태를 프로젝트 작업 흐름에 남기려면 장치 기록을 저장해 주세요.',
        title: '현재 브라우저 미리보기에는 활성 경고가 없습니다.',
      }
}

export function buildAudioSetupPanelViewModel({
  permissionMessage,
  permissionPhase,
  saveMessage,
  savePhase,
}: {
  permissionMessage: string
  permissionPhase: string
  saveMessage: string
  savePhase: string
}): {
  permissionMessage: StudioToneMessage
  saveButtonLabel: string
  saveMessage: StudioToneMessage | null
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    permissionMessage:
      (permissionPhase === 'granted' || permissionPhase === 'error') && permissionMessage
        ? {
            text: permissionMessage,
            tone: permissionPhase === 'error' ? 'error' : 'hint',
          }
        : {
            text: '브라우저 장치 이름과 실시간 설정을 보려면 먼저 한 번 권한을 허용해 주세요.',
            tone: 'hint',
          },
    saveButtonLabel: savePhase === 'submitting' ? '장치 기록 저장 중...' : '장치 기록 저장',
    saveMessage: buildOptionalActionFeedbackMessage({
      message: saveMessage,
      phase: savePhase,
    }),
    statusLabel:
      permissionPhase === 'granted'
        ? '마이크 준비됨'
        : permissionPhase === 'error'
          ? '마이크 차단됨'
          : permissionPhase === 'requesting'
            ? '요청 중'
            : '마이크 권한 미요청',
    statusTone:
      permissionPhase === 'granted'
        ? 'ready'
        : permissionPhase === 'error'
          ? 'error'
          : 'loading',
  }
}

export function buildGuideStatusCards({
  formatDuration,
  getTrackStatusLabel,
  guide,
}: {
  formatDuration: (value: number | null | undefined) => string
  getTrackStatusLabel: (status: string) => string
  guide: GuideTrackLike | null
}): StudioInfoCard[] {
  if (!guide) {
    return []
  }

  return [
    { label: '상태', value: getTrackStatusLabel(guide.track_status) },
    { label: '형식', value: guide.source_format ?? '알 수 없음' },
    { label: '길이', value: formatDuration(guide.duration_ms) },
    { label: '샘플레이트', value: String(guide.actual_sample_rate ?? '알 수 없음') },
  ]
}

export function buildGuidePanelViewModel({
  guideExists,
  guideFile,
  guideStatePhase,
  guideUploadMessage,
  guideUploadPhase,
}: {
  guideExists: boolean
  guideFile: File | null
  guideStatePhase: string
  guideUploadMessage: string
  guideUploadPhase: string
}): {
  fileSelectionMessage: string
  statusLabel: string
  statusTone: StudioStatusTone
  uploadButtonLabel: string
  uploadMessage: StudioToneMessage | null
} {
  return {
    fileSelectionMessage: guideFile
      ? `업로드 준비됨: ${guideFile.name} (${Math.round(guideFile.size / 1024)} KB)`
      : '이 프로젝트의 첫 소스 트랙이 될 가이드 파일을 선택해 주세요.',
    statusLabel:
      guideExists ? '가이드 연결됨' : guideStatePhase === 'error' ? '가이드 오류' : '가이드 대기 중',
    statusTone:
      guideExists ? 'ready' : guideStatePhase === 'error' ? 'error' : 'loading',
    uploadButtonLabel: guideUploadPhase === 'submitting' ? '가이드 업로드 중...' : '가이드 업로드',
    uploadMessage: buildOptionalActionFeedbackMessage({
      message: guideUploadMessage,
      phase: guideUploadPhase,
    }),
  }
}

export function buildMelodyMiniItems({
  selectedTake,
  selectedTakeMelody,
}: {
  selectedTake: SelectedTakeLike | null
  selectedTakeMelody: MelodyDraftLike | null
}) {
  return [
    { label: '선택된 테이크', value: selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '선택 없음' },
    { label: '키 추정', value: selectedTakeMelody?.key_estimate ?? '대기 중' },
    { label: '그리드', value: selectedTakeMelody?.grid_division ?? '1/16 초안' },
    { label: '노트 수', value: String(selectedTakeMelody?.note_count ?? 0) },
  ]
}

export function buildMelodyPanelViewModel({
  hasMelodyDraft,
  melodyMessage,
  melodyNoteCount,
  melodyPhase,
  melodySaveMessage,
  melodySavePhase,
}: {
  hasMelodyDraft: boolean
  melodyMessage: string
  melodyNoteCount: number
  melodyPhase: string
  melodySaveMessage: string
  melodySavePhase: string
}): {
  editorStatusLabel: string
  editorStatusTone: StudioStatusTone
  editorSummaryLabel: string
  extractButtonLabel: string
  melodyMessage: StudioToneMessage
  saveButtonLabel: string
  saveMessage: StudioToneMessage | null
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    editorStatusLabel: `노트 ${melodyNoteCount}개`,
    editorStatusTone: melodyNoteCount > 0 ? 'ready' : 'loading',
    editorSummaryLabel: melodyNoteCount > 0 ? `${melodyNoteCount}개 노트` : '비어 있음',
    extractButtonLabel: melodyPhase === 'submitting' ? '멜로디 추출 중..' : '멜로디 초안 추출',
    melodyMessage:
      buildOptionalActionFeedbackMessage({
        message: melodyMessage,
        phase: melodyPhase,
      }) ?? {
        text: '한 번 추출하면 이 테이크의 박자화된 노트 초안과 MIDI 파일을 함께 만들 수 있습니다.',
        tone: 'hint',
      },
    saveButtonLabel: melodySavePhase === 'submitting' ? '초안 저장 중..' : '노트 수정 저장',
    saveMessage: buildOptionalActionFeedbackMessage({
      message: melodySaveMessage,
      phase: melodySavePhase,
    }),
    statusLabel: melodyPhase === 'submitting' ? '추출 중' : hasMelodyDraft ? '초안 준비됨' : '초안 없음',
    statusTone: hasMelodyDraft ? 'ready' : melodyPhase === 'error' ? 'error' : 'loading',
  }
}

export function buildArrangementPresetSummaryCards({
  selectedBeatboxMeta,
  selectedDifficultyMeta,
  selectedVoiceRangeMeta,
}: {
  selectedBeatboxMeta: OptionMetaLike
  selectedDifficultyMeta: OptionMetaLike
  selectedVoiceRangeMeta: OptionMetaLike
}): StudioPresetSummaryCard[] {
  return [
    {
      label: '스타일 프리셋',
      title: selectedDifficultyMeta.label,
      description: selectedDifficultyMeta.description,
    },
    {
      label: '리드 편역',
      title: selectedVoiceRangeMeta.label,
      description: selectedVoiceRangeMeta.description,
    },
    {
      label: '비트박스',
      title: selectedBeatboxMeta.label,
      description: selectedBeatboxMeta.description,
    },
    {
      label: '후보 배치',
      title: 'A / B / C 비교',
      description: '같은 멜로디 초안에서 룰 기반 변형 3개를 만듭니다.',
    },
  ]
}

export function buildArrangementEngineViewModel({
  arrangementCount,
  arrangementMessage,
  arrangementPhase,
  arrangementSaveMessage,
  arrangementSavePhase,
  selectedDifficultyLabel,
  selectedVoiceRangeLabel,
}: {
  arrangementCount: number
  arrangementMessage: string
  arrangementPhase: string
  arrangementSaveMessage: string
  arrangementSavePhase: string
  selectedDifficultyLabel: string
  selectedVoiceRangeLabel: string
}): {
  generateButtonLabel: string
  presetSummaryLabel: string
  primaryMessage: StudioToneMessage
  saveButtonLabel: string
  saveMessage: StudioToneMessage | null
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    generateButtonLabel: arrangementPhase === 'submitting' ? '편곡 생성 중..' : '편곡 후보 생성',
    presetSummaryLabel: `${selectedDifficultyLabel} / ${selectedVoiceRangeLabel}`,
    primaryMessage:
      buildOptionalActionFeedbackMessage({
        message: arrangementMessage,
        phase: arrangementPhase,
      }) ?? {
        text: '멜로디를 정리한 뒤 후보를 생성하면 편곡 생성기가 더 안정적인 초안 조합을 만들 수 있습니다.',
        tone: 'hint',
      },
    saveButtonLabel: arrangementSavePhase === 'submitting' ? '편곡 저장 중..' : '편곡 수정 저장',
    saveMessage: buildOptionalActionFeedbackMessage({
      message: arrangementSaveMessage,
      phase: arrangementSavePhase,
    }),
    statusLabel:
      arrangementPhase === 'submitting'
        ? '생성 중'
        : arrangementCount > 0
          ? `후보 ${arrangementCount}개`
          : '후보 없음',
    statusTone:
      arrangementCount > 0 ? 'ready' : arrangementPhase === 'error' ? 'error' : 'loading',
  }
}

export function buildArrangementCandidateCards({
  arrangements,
  formatCompactPercent,
  getArrangementDifficultyLabel,
  getArrangementStyleLabel,
  getBeatboxLabel,
  getVoiceRangeDescription,
  getVoiceRangeLabel,
  normalizeAssetUrl,
  selectedArrangementId,
}: {
  arrangements: ArrangementCandidateLike[]
  formatCompactPercent: (value: number | null | undefined) => string
  getArrangementDifficultyLabel: (value: string) => string
  getArrangementStyleLabel: (value: string | null | undefined) => string
  getBeatboxLabel: (value: string | null) => string
  getVoiceRangeDescription: (value: string | null) => string
  getVoiceRangeLabel: (value: string | null) => string
  normalizeAssetUrl: (value: string | null | undefined) => string | null
  selectedArrangementId: string | null
}): StudioArrangementCandidateCard[] {
  return arrangements.map((arrangement) => ({
    beatboxCountLabel: String(arrangement.comparison_summary?.beatbox_note_count ?? 0),
    chipLabels: [
      getVoiceRangeLabel(arrangement.voice_range_preset),
      getBeatboxLabel(arrangement.beatbox_template),
      getArrangementStyleLabel(arrangement.style),
    ],
    id: arrangement.arrangement_id,
    leadFitLabel: formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent),
    maxLeapLabel: String(arrangement.comparison_summary?.support_max_leap ?? '없음'),
    midiUrl: normalizeAssetUrl(arrangement.midi_artifact_url) ?? null,
    parallelAlertsLabel: String(arrangement.comparison_summary?.parallel_motion_alerts ?? 0),
    selectLabel: selectedArrangementId === arrangement.arrangement_id ? '선택됨' : '선택',
    selected: selectedArrangementId === arrangement.arrangement_id,
    subtitle: `${arrangement.part_count}성부 | ${getArrangementDifficultyLabel(arrangement.difficulty)}`,
    summaryDescription: getVoiceRangeDescription(arrangement.voice_range_preset),
    summaryTitle: arrangement.parts_json
      .map((part) => `${part.part_name ?? '파트'} (${part.notes.length})`)
      .join(' / '),
    title: `${arrangement.candidate_code} - ${arrangement.title ?? 'Untitled'}`,
  }))
}

export function buildAnalysisScoreCards({
  formatPercent,
  selectedTakeScore,
}: {
  formatPercent: (value: number | null) => string
  selectedTakeScore: SelectedTakeScoreLike | null
}): StudioAnalysisScoreCard[] {
  return [
    { label: '피치', value: formatPercent(selectedTakeScore?.pitch_score ?? null) },
    { label: '리듬', value: formatPercent(selectedTakeScore?.rhythm_score ?? null) },
    { label: '화성 적합도', value: formatPercent(selectedTakeScore?.harmony_fit_score ?? null) },
    {
      highlight: true,
      label: '총점',
      value: formatPercent(selectedTakeScore?.total_score ?? null),
    },
  ]
}

export function buildAnalysisMiniCards({
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
}: {
  chordMarkerCount: number
  formatConfidence: (value: number | null) => string
  formatOffsetMs: (value: number | null) => string
  getAnalysisJobStatusLabel: (status: string | null | undefined) => string
  getHarmonyReferenceHint: (mode: string | null | undefined, chordMarkerCount: number) => string
  getHarmonyReferenceLabel: (mode: string | null | undefined) => string
  getPitchQualityModeHint: (mode: string | null | undefined) => string
  getPitchQualityModeLabel: (mode: string | null | undefined) => string
  selectedTake: SelectedTakeLike | null
  selectedTakeAnalysisJob: AnalysisJobLike | null
  selectedTakeScore: SelectedTakeScoreLike | null
}): StudioAnalysisMiniCard[] {
  if (!selectedTake) {
    return []
  }

  return [
    { label: '선택된 테이크', value: `${selectedTake.take_no ?? '?'}번 테이크` },
    { label: '정렬 신뢰도', value: formatConfidence(selectedTake.alignment_confidence) },
    { label: '오프셋 추정', value: formatOffsetMs(selectedTake.alignment_offset_ms ?? null) },
    { label: '최신 작업', value: getAnalysisJobStatusLabel(selectedTakeAnalysisJob?.status) },
    {
      label: '채점 모드',
      value: getPitchQualityModeLabel(selectedTakeScore?.pitch_quality_mode),
      detail: getPitchQualityModeHint(selectedTakeScore?.pitch_quality_mode),
    },
    {
      label: '화성 기준',
      value: getHarmonyReferenceLabel(selectedTakeScore?.harmony_reference_mode),
      detail: getHarmonyReferenceHint(selectedTakeScore?.harmony_reference_mode, chordMarkerCount),
    },
  ]
}

export function buildAnalysisChips({
  chordMarkerCount,
  formatConfidence,
  getConfidenceTone,
  getHarmonyReferenceLabel,
  getPitchQualityModeLabel,
  getScoreTone,
  selectedTake,
  selectedTakeScore,
}: {
  chordMarkerCount: number
  formatConfidence: (value: number | null) => string
  getConfidenceTone: (value: number | null) => 'alert' | 'good' | 'neutral' | 'warn'
  getHarmonyReferenceLabel: (mode: string | null | undefined) => string
  getPitchQualityModeLabel: (mode: string | null | undefined) => string
  getScoreTone: (value: number | null) => 'alert' | 'good' | 'neutral' | 'warn'
  selectedTake: SelectedTakeLike | null
  selectedTakeScore: SelectedTakeScoreLike | null
}): StudioAnalysisChip[] {
  if (!selectedTakeScore) {
    return []
  }

  return [
    {
      label: getPitchQualityModeLabel(selectedTakeScore.pitch_quality_mode),
      tone: getScoreTone(selectedTakeScore.total_score),
    },
    {
      label: `정렬 ${formatConfidence(selectedTake?.alignment_confidence ?? null)}`,
      tone: getConfidenceTone(selectedTake?.alignment_confidence ?? null),
    },
    {
      label: getHarmonyReferenceLabel(selectedTakeScore.harmony_reference_mode),
      tone: selectedTakeScore.harmony_reference_mode === 'CHORD_AWARE' && chordMarkerCount > 0 ? 'good' : 'warn',
    },
  ]
}

export function buildAnalysisPanelViewModel({
  analysisJob,
  analysisMessage,
  analysisPhase,
  formatDate,
  getAnalysisJobStatusLabel,
}: {
  analysisJob: AnalysisJobLike | null
  analysisMessage: string
  analysisPhase: string
  formatDate: (value: string) => string
  getAnalysisJobStatusLabel: (status: string | null | undefined) => string
}): {
  actionMessages: StudioToneMessage[]
  runButtonLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    actionMessages:
      buildOptionalActionFeedbackMessage({
        message: analysisMessage,
        phase: analysisPhase,
      }) !== null
        ? [
            buildOptionalActionFeedbackMessage({
              message: analysisMessage,
              phase: analysisPhase,
            }) as StudioToneMessage,
          ]
        : analysisJob
          ? [
              {
                text: `최근 분석은 ${formatDate(analysisJob.requested_at)}에 시작됐습니다.`,
                tone: analysisJob.status === 'FAILED' ? 'error' : 'hint',
              },
              ...(analysisJob.error_message
                ? [{ text: analysisJob.error_message, tone: 'error' as const }]
                : []),
            ]
          : [
              {
                text: '녹음 후 분석을 실행하면 스튜디오에서 정렬 신뢰도와 피치, 리듬, 화성 적합도 세부 피드백이 열립니다.',
                tone: 'hint',
              },
            ],
    runButtonLabel: analysisPhase === 'submitting' ? '분석 실행 중..' : '녹음 후 분석 실행',
    statusLabel: analysisPhase === 'submitting' ? '분석 중' : getAnalysisJobStatusLabel(analysisJob?.status),
    statusTone:
      analysisJob?.status === 'SUCCEEDED'
        ? 'ready'
        : analysisPhase === 'error' || analysisJob?.status === 'FAILED'
          ? 'error'
          : 'loading',
  }
}

export function buildStageViewModel({
  analysisPhase,
  formatDuration,
  noteFeedbackCount,
  selectedTakeDurationMs,
  selectedTakeExists,
  selectedTakeLabel,
  selectedTakeNo,
  selectedTakeScoreLabel,
  selectedTakeStatusLabel,
  waveformPhase,
  waveformReady,
}: {
  analysisPhase: string
  formatDuration: (value: number | null | undefined) => string
  noteFeedbackCount: number
  selectedTakeDurationMs: number | null | undefined
  selectedTakeExists: boolean
  selectedTakeLabel: string
  selectedTakeNo: number | null | undefined
  selectedTakeScoreLabel: string
  selectedTakeStatusLabel: string
  waveformPhase: string
  waveformReady: boolean
}): {
  analysisButtonLabel: string
  fileChipLabel: string
  fileChipMeta: string | null
  stageMetaItems: string[]
  waveformStatusLabel: string
  waveformStatusTone: StudioStatusTone
} {
  return {
    analysisButtonLabel: analysisPhase === 'submitting' ? '분석 중..' : '선택 테이크 분석',
    fileChipLabel: selectedTakeExists ? `${selectedTakeNo ?? '?'}번 테이크` : '테이크 없음',
    fileChipMeta: selectedTakeExists ? formatDuration(selectedTakeDurationMs) : null,
    stageMetaItems: [
      selectedTakeLabel,
      selectedTakeStatusLabel,
      selectedTakeScoreLabel,
      noteFeedbackCount > 0 ? `노트 ${noteFeedbackCount}` : '--',
    ],
    waveformStatusLabel: waveformReady ? '파형 준비됨' : waveformPhase === 'error' ? '파형 불러오기 실패' : '파형 준비 중',
    waveformStatusTone: waveformReady ? 'ready' : waveformPhase === 'error' ? 'error' : 'loading',
  }
}

export function buildRecordingFlowViewModel({
  liveInputMeterPhase,
  recordingPhase,
}: {
  liveInputMeterPhase: string
  recordingPhase: string
}): {
  isRecordingActive: boolean
  isRecordingLocked: boolean
  liveInputMeterTone: StudioStatusTone
  recordingToggleLabel: string
} {
  const isRecordingActive = recordingPhase === 'recording'

  return {
    isRecordingActive,
    isRecordingLocked: recordingPhase === 'counting-in' || recordingPhase === 'uploading',
    liveInputMeterTone:
      liveInputMeterPhase === 'error'
        ? 'error'
        : liveInputMeterPhase === 'unsupported'
          ? 'loading'
          : liveInputMeterPhase === 'active'
            ? 'ready'
            : 'loading',
    recordingToggleLabel:
      recordingPhase === 'counting-in'
        ? '카운트인 중...'
        : recordingPhase === 'uploading'
          ? '업로드 중...'
          : isRecordingActive
            ? '녹음 중지'
            : '테이크 녹음',
  }
}

export function buildRecordingSectionViewModel({
  liveInputMeterPhase,
  metronomePreviewMessage,
  metronomePreviewPhase,
  recordingPhase,
  selectedTakeNo,
}: {
  liveInputMeterPhase: string
  metronomePreviewMessage: string
  metronomePreviewPhase: string
  recordingPhase: string
  selectedTakeNo: number | null | undefined
}): {
  liveInputMeterStatusLabel: string
  metronomePreviewButtonLabel: string
  metronomePreviewMessage: string | null
  metronomePreviewTone: 'error' | 'hint'
  recordingStatusLabel: string
  recordingStatusTone: StudioStatusTone
  selectedTakeFieldLabel: string
} {
  return {
    liveInputMeterStatusLabel:
      liveInputMeterPhase === 'active'
        ? '입력 표시 켜짐'
        : liveInputMeterPhase === 'unsupported'
          ? '입력 표시 제한됨'
          : '녹음 때 자동으로 켜짐',
    metronomePreviewButtonLabel:
      metronomePreviewPhase === 'submitting' ? '박자 소리 준비 중..' : '박자 소리 들어보기',
    metronomePreviewMessage:
      metronomePreviewPhase === 'success' || metronomePreviewPhase === 'error'
        ? metronomePreviewMessage
        : null,
    metronomePreviewTone: metronomePreviewPhase === 'error' ? 'error' : 'hint',
    recordingStatusLabel: recordingPhase,
    recordingStatusTone:
      recordingPhase === 'recording' || recordingPhase === 'success'
        ? 'ready'
        : recordingPhase === 'error'
          ? 'error'
          : 'loading',
    selectedTakeFieldLabel: selectedTakeNo === null || selectedTakeNo === undefined ? '아직 테이크 없음' : `${selectedTakeNo}번 테이크`,
  }
}

export function buildTimelineMessage({
  analysisMessage,
  analysisPhase,
  metronomePreviewMessage,
  metronomePreviewPhase,
  recordingMessage,
  recordingPhase,
}: {
  analysisMessage: string
  analysisPhase: string
  metronomePreviewMessage: string
  metronomePreviewPhase: string
  recordingMessage: string
  recordingPhase: string
}): StudioTimelineMessage | null {
  if (recordingPhase === 'error') {
    return { text: recordingMessage, tone: 'error' }
  }

  if (analysisPhase === 'error') {
    return { text: analysisMessage, tone: 'error' }
  }

  if (metronomePreviewPhase === 'success') {
    return { text: metronomePreviewMessage, tone: 'info' }
  }

  return null
}

export function buildStudioShellViewModel({
  activeWorkspaceModeLabel,
  arrangementCount,
  formatDate,
  formatDuration,
  guideActualSampleRate,
  guideDurationMs,
  hasGuide,
  noteFeedbackCount,
  projectCreatedAt,
  readyTakeCount,
  selectedTakeExists,
  selectedTakeLabel,
  selectedTakeMelodyNoteCount,
  selectedTakeScoreLabel,
  takeCount,
  takeNo,
  totalTrackCount,
}: {
  activeWorkspaceModeLabel: string
  arrangementCount: number
  formatDate: (value: string) => string
  formatDuration: (value: number | null | undefined) => string
  guideActualSampleRate: number | null | undefined
  guideDurationMs: number | null | undefined
  hasGuide: boolean
  noteFeedbackCount: number
  projectCreatedAt: string
  readyTakeCount: number
  selectedTakeExists: boolean
  selectedTakeLabel: string
  selectedTakeMelodyNoteCount: number | null | undefined
  selectedTakeScoreLabel: string
  takeCount: number
  takeNo: number | null | undefined
  totalTrackCount: number
}): {
  arrangementContextLabel: string
  arrangementSummaryLabel: string
  guideSummaryLabel: string
  melodySummaryLabel: string
  mobileInspectorSummaryLabel: string
  mobileRailSummaryLabel: string
  mobileTrackLaneSummaryLabel: string
  noteFeedbackContextLabel: string
  noteFeedbackSummaryLabel: string
  projectIdentityLabel: string
} {
  return {
    arrangementContextLabel: selectedTakeMelodyNoteCount ? '초안 기준' : '초안 준비 필요',
    arrangementSummaryLabel: arrangementCount > 0 ? `${arrangementCount}개 후보` : '후보 없음',
    guideSummaryLabel: hasGuide
      ? `${formatDuration(guideDurationMs)} / ${
          guideActualSampleRate ? `${guideActualSampleRate} Hz` : '샘플레이트 미확인'
        }`
      : '가이드 없음',
    melodySummaryLabel: selectedTakeMelodyNoteCount ? `${selectedTakeMelodyNoteCount}개 음표` : '초안 없음',
    mobileInspectorSummaryLabel: selectedTakeExists ? `${selectedTakeLabel} · ${selectedTakeScoreLabel}` : '선택 없음',
    mobileRailSummaryLabel: hasGuide
      ? readyTakeCount > 0
        ? `가이드 연결 · 준비 ${readyTakeCount}개`
        : takeCount > 0
          ? `가이드 연결 · 테이크 ${takeCount}개`
          : '가이드 연결'
      : takeCount > 0
        ? `가이드 없음 · 테이크 ${takeCount}개`
        : '가이드 없음',
    mobileTrackLaneSummaryLabel: selectedTakeExists ? `${selectedTakeLabel} / ${totalTrackCount}개` : `${totalTrackCount}개 트랙`,
    noteFeedbackContextLabel: selectedTakeExists ? `${takeNo ?? '?'}번 테이크` : '테이크 선택 필요',
    noteFeedbackSummaryLabel: noteFeedbackCount > 0 ? `${noteFeedbackCount}개` : '없음',
    projectIdentityLabel: `${activeWorkspaceModeLabel} / ${formatDate(projectCreatedAt)}`,
  }
}

export function buildInspectorSummaryViewModel({
  feedbackSegmentCount,
  midiToPitchName,
  noteFeedbackSummaryLabel,
  selectedNoteIndex,
  selectedNoteTargetMidi,
}: {
  feedbackSegmentCount: number
  midiToPitchName: (pitchMidi: number) => string
  noteFeedbackSummaryLabel: string
  selectedNoteIndex: number | null | undefined
  selectedNoteTargetMidi: number | null | undefined
}): {
  noteFeedbackDetailSummaryLabel: string
  noteFeedbackSegmentSummaryLabel: string
} {
  return {
    noteFeedbackDetailSummaryLabel:
      selectedNoteIndex === null || selectedNoteIndex === undefined || selectedNoteTargetMidi === null || selectedNoteTargetMidi === undefined
        ? noteFeedbackSummaryLabel
        : `노트 ${selectedNoteIndex + 1} / ${midiToPitchName(selectedNoteTargetMidi)}`,
    noteFeedbackSegmentSummaryLabel: feedbackSegmentCount > 0 ? `${feedbackSegmentCount}개 구간` : '구간 없음',
  }
}

export function buildRecordingTakeSummaryItems({
  activeUploadTrackId,
  failedTakeUploadCount,
  takes,
}: {
  activeUploadTrackId: string | null
  failedTakeUploadCount: number
  takes: TakeSummaryLike[]
}) {
  return [
    { label: '테이크 수', value: String(takes.length) },
    {
      label: '가장 최근 준비 완료 테이크',
      value: String(takes.find((take) => take.track_status === 'READY')?.take_no ?? '없음'),
    },
    { label: '재시도 대기', value: String(failedTakeUploadCount) },
    { label: '업로드 진행 중', value: activeUploadTrackId ? '예' : '아니오' },
  ]
}

export function getShareTargetLabel(selectedShareVersionLabel: string | null): string {
  return selectedShareVersionLabel ?? '현재 작업면'
}

export function buildVersionHistoryCards({
  formatDate,
  getProjectVersionSourceLabel,
  versions,
}: {
  formatDate: (value: string) => string
  getProjectVersionSourceLabel: (sourceType: string) => string
  versions: ProjectVersionRecordLike[]
}): StudioHistoryCard[] {
  return versions.map((version) => ({
    arrangementCountLabel: String(version.snapshot_summary.arrangement_count),
    createdAtLabel: formatDate(version.created_at),
    hasGuideLabel: version.snapshot_summary.has_guide ? '있음' : '없음',
    id: version.version_id,
    label: version.label,
    note: version.note,
    readyTakeCountLabel: String(version.snapshot_summary.ready_take_count),
    sourceLabel: getProjectVersionSourceLabel(version.source_type),
    takeCountLabel: String(version.snapshot_summary.take_count),
    takeSummaryLabel: `${version.snapshot_summary.take_count}개 테이크`,
  }))
}

export function getLatestShareVersionLabel(versions: ProjectVersionRecordLike[]): string {
  return versions[0]?.label ?? '아직 없음'
}

export function buildShareLinkHistoryCards({
  formatDate,
  getShareAccessScopeLabel,
  shareLinks,
}: {
  formatDate: (value: string) => string
  getShareAccessScopeLabel: (accessScope: string) => string
  shareLinks: ShareLinkRecordLike[]
}): StudioShareLinkHistoryCard[] {
  return shareLinks.map((shareLink) => ({
    accessScopeLabel: getShareAccessScopeLabel(shareLink.access_scope),
    createdAtLabel: formatDate(shareLink.created_at),
    expiresAtLabel: shareLink.expires_at ? formatDate(shareLink.expires_at) : '없음',
    id: shareLink.share_link_id,
    isActive: shareLink.is_active,
    label: shareLink.label,
    lastAccessedLabel: shareLink.last_accessed_at ? formatDate(shareLink.last_accessed_at) : '아직 없음',
    stateLabel: shareLink.is_active ? '공개 중' : '종료됨',
    summaryLabel: `${shareLink.is_active ? '활성' : '비활성'} | 만료 ${
      shareLink.expires_at ? formatDate(shareLink.expires_at) : '없음'
    }`,
    url: shareLink.share_url,
  }))
}

export function buildProjectSettingsSummaryCards({
  baseKey,
  formatDate,
  updatedAt,
}: {
  baseKey: string | null
  formatDate: (value: string) => string
  updatedAt: string
}) {
  return [
    { label: '현재 키', value: baseKey ?? '미정' },
    { label: '최근 업데이트', value: formatDate(updatedAt) },
  ]
}

export function buildPlaybackPanelViewModel({
  arrangementTransportState,
  formatPlaybackClock,
  playbackDurationMs,
  playbackPositionMs,
  selectedArrangementPartCount,
}: {
  arrangementTransportState: PlaybackTransportStateLike
  formatPlaybackClock: (positionMs: number, durationMs: number) => string
  playbackDurationMs: number
  playbackPositionMs: number
  selectedArrangementPartCount: number | null
}): {
  partCountLabel: string
  positionLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
  transportMessage: StudioToneMessage
} {
  return {
    partCountLabel:
      selectedArrangementPartCount === null ? '선택된 편곡 없음' : `${selectedArrangementPartCount}개 파트`,
    positionLabel: formatPlaybackClock(playbackPositionMs, playbackDurationMs),
    statusLabel:
      arrangementTransportState.phase === 'playing'
        ? '재생 중'
        : arrangementTransportState.phase === 'error'
          ? '재생 오류'
          : '재생 준비됨',
    statusTone:
      arrangementTransportState.phase === 'playing'
        ? 'ready'
        : arrangementTransportState.phase === 'error'
          ? 'error'
          : 'loading',
    transportMessage: {
      text: arrangementTransportState.message,
      tone: arrangementTransportState.phase === 'error' ? 'error' : 'hint',
    },
  }
}

export function buildScorePlaybackSummaryViewModel({
  hasMusicXml,
  selectedArrangementPartCount,
}: {
  hasMusicXml: boolean
  selectedArrangementPartCount: number | null
}): {
  arrangementMixSummaryLabel: string
  scoreStatusLabel: string
  scoreStatusTone: StudioStatusTone
} {
  return {
    arrangementMixSummaryLabel:
      selectedArrangementPartCount === null ? '파트 없음' : `${selectedArrangementPartCount}개 파트`,
    scoreStatusLabel: hasMusicXml ? 'MusicXML 준비됨' : 'MusicXML 대기 중',
    scoreStatusTone: hasMusicXml ? 'ready' : 'loading',
  }
}

export function buildVersionPanelViewModel({
  versionCount,
  versionCreateMessage,
  versionCreatePhase,
  versionsErrorMessage,
  versionsPhase,
}: {
  versionCount: number
  versionCreateMessage: string
  versionCreatePhase: string
  versionsErrorMessage: string
  versionsPhase: string
}): {
  feedbackMessage: StudioToneMessage | null
  saveButtonLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    feedbackMessage:
      buildOptionalActionFeedbackMessage({
        message: versionCreateMessage,
        phase: versionCreatePhase,
      }) ??
      (versionsPhase === 'error'
        ? {
            text: versionsErrorMessage,
            tone: 'error',
          }
        : null),
    saveButtonLabel: versionCreatePhase === 'submitting' ? '스냅샷 저장 중...' : '프로젝트 스냅샷 저장',
    statusLabel:
      versionsPhase === 'ready'
        ? `${versionCount}개 버전`
        : versionsPhase === 'error'
          ? '버전 오류'
          : '버전 불러오는 중',
    statusTone:
      versionsPhase === 'ready' ? 'ready' : versionsPhase === 'error' ? 'error' : 'loading',
  }
}

export function buildShareModalSummaryCards({
  shareTargetLabel,
  snapshotSummary,
}: {
  shareTargetLabel: string
  snapshotSummary: SnapshotSummaryLike
}) {
  return [
    { label: '공유 기준', value: shareTargetLabel },
    { label: '가이드', value: snapshotSummary.has_guide ? '있음' : '없음' },
    { label: '테이크', value: String(snapshotSummary.take_count) },
    { label: '편곡 후보', value: String(snapshotSummary.arrangement_count) },
  ]
}

export function buildShareVersionOptions(versions: ProjectVersionRecordLike[]) {
  return versions.map((version) => ({
    label: version.label,
    value: version.version_id,
  }))
}

export function buildShareLinksPanelViewModel({
  linkCount,
  shareCopyMessage,
  shareCopyPhase,
  shareCreateMessage,
  shareCreatePhase,
  shareDeactivateMessage,
  shareDeactivatePhase,
  shareLinksErrorMessage,
  shareLinksPhase,
}: {
  linkCount: number
  shareCopyMessage: string
  shareCopyPhase: string
  shareCreateMessage: string
  shareCreatePhase: string
  shareDeactivateMessage: string
  shareDeactivatePhase: string
  shareLinksErrorMessage: string
  shareLinksPhase: string
}): {
  copyMessage: StudioToneMessage | null
  deactivateMessage: StudioToneMessage | null
  primaryMessage: StudioToneMessage | null
  statusLabel: string
  statusTone: StudioStatusTone
} {
  return {
    copyMessage: buildOptionalActionFeedbackMessage({
      message: shareCopyMessage,
      phase: shareCopyPhase,
    }),
    deactivateMessage: buildOptionalActionFeedbackMessage({
      message: shareDeactivateMessage,
      phase: shareDeactivatePhase,
    }),
    primaryMessage:
      buildOptionalActionFeedbackMessage({
        message: shareCreateMessage,
        phase: shareCreatePhase,
      }) ??
      (shareLinksPhase === 'error'
        ? {
            text: shareLinksErrorMessage,
            tone: 'error',
          }
        : null),
    statusLabel:
      shareLinksPhase === 'ready'
        ? `${linkCount}개 링크`
        : shareLinksPhase === 'error'
          ? '공유 오류'
          : '공유 불러오는 중',
    statusTone:
      shareLinksPhase === 'ready' ? 'ready' : shareLinksPhase === 'error' ? 'error' : 'loading',
  }
}

export function buildShareModalArtifactItems<Key extends string>({
  availability,
  options,
  selectedArtifacts,
}: {
  availability: Record<Key, boolean>
  options: ReadonlyArray<{ description: string; key: Key; label: string }>
  selectedArtifacts: Key[]
}) {
  return options.map((option) => {
    const enabled = availability[option.key]
    return {
      checked: enabled && selectedArtifacts.includes(option.key),
      description: option.description,
      disabled: !enabled,
      key: option.key,
      label: option.label,
    }
  })
}

export function buildProjectSettingsViewModel({
  saveMessage,
  savePhase,
}: {
  saveMessage: string
  savePhase: string
}): {
  feedbackMessage: StudioToneMessage | null
  saveButtonLabel: string
} {
  return {
    feedbackMessage: buildOptionalActionFeedbackMessage({
      message: saveMessage,
      phase: savePhase,
    }),
    saveButtonLabel: savePhase === 'submitting' ? '저장 중...' : '저장',
  }
}

export function buildShareModalViewModel({
  createMessage,
  createPhase,
}: {
  createMessage: string
  createPhase: string
}): {
  createButtonLabel: string
  feedbackMessage: StudioToneMessage | null
} {
  return {
    createButtonLabel: createPhase === 'submitting' ? '공유 링크 만드는 중...' : '공유 링크 만들기',
    feedbackMessage: buildOptionalActionFeedbackMessage({
      message: createMessage,
      phase: createPhase,
    }),
  }
}

export function buildArrangementSummaryViewModel({
  formatCompactPercent,
  getBeatboxLabel,
  getVoiceRangeDescription,
  getVoiceRangeLabel,
  selectedArrangement,
}: {
  formatCompactPercent: (value: number | null | undefined) => string
  getBeatboxLabel: (value: string | null) => string
  getVoiceRangeDescription: (value: string | null) => string
  getVoiceRangeLabel: (value: string | null) => string
  selectedArrangement: ArrangementCandidateLike | null
}): {
  comparisonHint: string
  comparisonSummaryLabel: string
  detailCards: StudioInfoCard[]
  sourceMelodyLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
} {
  if (!selectedArrangement) {
    return {
      comparisonHint: '',
      comparisonSummaryLabel: '',
      detailCards: [] as StudioInfoCard[],
      sourceMelodyLabel: '0개 음표 기준',
      statusLabel: '대기 중',
      statusTone: 'loading' as const,
    }
  }

  return {
    comparisonHint: getVoiceRangeDescription(selectedArrangement.voice_range_preset),
    comparisonSummaryLabel: `병행 경고 ${selectedArrangement.comparison_summary?.parallel_motion_alerts ?? 0}개, 최대 도약 ${
      selectedArrangement.comparison_summary?.support_max_leap ?? 0
    }세미톤, 비트박스 히트 ${selectedArrangement.comparison_summary?.beatbox_note_count ?? 0}개`,
    detailCards: [
      {
        label: '최대 도약 제한',
        value:
          typeof selectedArrangement.constraint_json?.max_leap === 'number'
            ? String(selectedArrangement.constraint_json.max_leap)
            : '없음',
      },
      {
        label: '병행 진행 회피',
        value: selectedArrangement.constraint_json?.parallel_avoidance ? '사용' : '사용 안 함',
      },
      {
        label: '리드 음역 프리셋',
        value: getVoiceRangeLabel(selectedArrangement.voice_range_preset),
      },
      {
        label: '비트박스 템플릿',
        value: getBeatboxLabel(selectedArrangement.beatbox_template),
      },
      {
        label: '리드 적합도',
        value: formatCompactPercent(selectedArrangement.comparison_summary?.lead_range_fit_percent),
      },
      {
        label: '후보 파트 수',
        value: String(selectedArrangement.part_count),
      },
    ],
    sourceMelodyLabel: `${selectedArrangement.parts_json[0]?.notes.length ?? 0}개 음표 기준`,
    statusLabel: selectedArrangement.candidate_code,
    statusTone: 'ready' as const,
  }
}

export function buildMixdownRenderViewModel({
  getTrackStatusLabel,
  guideConnected,
  guideMuted,
  guideSourceUrl,
  guideVolume,
  hasSelectedTake,
  mixdownPreview,
  mixdownPreviewPhase,
  mixdownPreviewStateMessage,
  mixdownSavePhase,
  mixdownSaveStateMessage,
  mixdownSummary,
  selectedTakeLabel,
  selectedTakeMuted,
  selectedTakePlaybackUrl,
  selectedTakeVolume,
}: {
  getTrackStatusLabel: (status: string) => string
  guideConnected: boolean
  guideMuted: boolean
  guideSourceUrl: string | null
  guideVolume: number
  hasSelectedTake: boolean
  mixdownPreview: MixdownPreviewLike | null
  mixdownPreviewPhase: string
  mixdownPreviewStateMessage: string
  mixdownSavePhase: string
  mixdownSaveStateMessage: string
  mixdownSummary: MixdownSummaryLike | null
  selectedTakeLabel: string
  selectedTakeMuted: boolean
  selectedTakePlaybackUrl: string | null
  selectedTakeVolume: number
}): {
  guideSourceLabel: string
  guideVolumeLabel: string
  playbackIncludedTracksLabel: string
  playbackSummaryLabel: string
  previewButtonLabel: string
  previewMessage: StudioToneMessage
  saveButtonLabel: string
  saveMessage: StudioToneMessage | null
  selectedTakeLabel: string
  sourceLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
  takeVolumeLabel: string
} {
  const sourceLabel = mixdownPreview
    ? '로컬 오프라인 렌더'
    : mixdownSummary
      ? '저장된 프로젝트 산출물'
      : '아직 생성되지 않음'

  return {
    guideSourceLabel:
      guideSourceUrl && guideConnected ? (guideMuted ? '믹서에서 음소거됨' : '포함됨') : '없음',
    guideVolumeLabel: guideConnected ? guideVolume.toFixed(2) : '없음',
    playbackSummaryLabel: mixdownPreview?.labels
      ? `${sourceLabel} / ${mixdownPreview ? '임시 미리듣기' : mixdownSummary ? '저장됨' : '준비됨'}`
      : mixdownSummary?.source_artifact_url
        ? `${sourceLabel} / 저장됨`
        : '미리보기 없음',
    previewButtonLabel:
      mixdownPreviewPhase === 'submitting' ? '믹스다운 렌더링 중...' : '믹스다운 미리보기 렌더링',
    previewMessage:
      mixdownPreviewPhase === 'success' || mixdownPreviewPhase === 'error'
        ? {
            text: mixdownPreviewStateMessage,
            tone: mixdownPreviewPhase === 'error' ? 'error' : 'hint',
          }
        : {
            text: '선택 테이크, 음소거, 솔로, 볼륨을 바꾼 뒤에는 다시 렌더링해 주세요.',
            tone: 'hint',
          },
    saveButtonLabel: mixdownSavePhase === 'submitting' ? '믹스다운 저장 중...' : '믹스다운 저장',
    saveMessage:
      mixdownSavePhase === 'success' || mixdownSavePhase === 'error'
        ? {
            text: mixdownSaveStateMessage,
            tone: mixdownSavePhase === 'error' ? 'error' : 'hint',
          }
        : null,
    selectedTakeLabel: hasSelectedTake
      ? selectedTakePlaybackUrl
        ? selectedTakeMuted
          ? '믹서에서 음소거됨'
          : selectedTakeLabel
        : '재생 가능한 오디오 없음'
      : '없음',
    sourceLabel,
    statusLabel:
      mixdownPreviewPhase === 'success'
        ? '미리보기 준비됨'
        : mixdownPreviewPhase === 'error'
          ? '미리보기 오류'
          : mixdownPreviewPhase === 'submitting'
            ? '렌더링 중'
            : '미리보기 대기',
    statusTone:
      mixdownPreviewPhase === 'success'
        ? 'ready'
        : mixdownPreviewPhase === 'error'
          ? 'error'
          : 'loading',
    takeVolumeLabel: hasSelectedTake ? selectedTakeVolume.toFixed(2) : '없음',
    playbackIncludedTracksLabel: mixdownPreview
      ? mixdownPreview.labels.join(' + ')
      : mixdownSummary
        ? `가장 최근 저장된 믹스다운 (${getTrackStatusLabel(mixdownSummary.track_status)})`
        : '미리보기를 렌더링하면 현재 소스 구성을 확인할 수 있습니다.',
  }
}

export function buildMixdownPlaybackViewModel({
  formatDate,
  formatDuration,
  getTrackStatusLabel,
  mixdownPreview,
  mixdownSavePhase,
  mixdownSummary,
}: {
  formatDate: (value: string) => string
  formatDuration: (value: number | null | undefined) => string
  getTrackStatusLabel: (status: string) => string
  mixdownPreview: MixdownPreviewLike | null
  mixdownSavePhase: string
  mixdownSummary: MixdownSummaryLike | null
}): {
  durationLabel: string
  sampleRateLabel: string
  statusLabel: string
  statusTone: StudioStatusTone
  updatedAtLabel: string
} {
  return {
    durationLabel: mixdownPreview
      ? formatDuration(mixdownPreview.durationMs)
      : formatDuration(mixdownSummary?.duration_ms ?? null),
    sampleRateLabel: String(mixdownPreview?.actualSampleRate ?? mixdownSummary?.actual_sample_rate ?? '알 수 없음'),
    statusLabel: mixdownSummary ? getTrackStatusLabel(mixdownSummary.track_status) : '아직 저장 전',
    statusTone:
      mixdownSummary?.track_status === 'READY'
        ? 'ready'
        : mixdownSavePhase === 'error'
          ? 'error'
          : 'loading',
    updatedAtLabel: mixdownSummary ? formatDate(mixdownSummary.updated_at) : '아직 저장되지 않음',
  }
}
