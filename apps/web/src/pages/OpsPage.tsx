import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { buildApiUrl } from '../lib/api'
import { getBrowserAudioWarningLabel } from '../lib/browserAudioDiagnostics'
import {
  getAnalysisJobStatusLabel,
  getTrackRoleLabel,
  getTrackStatusLabel,
  getValidationOutcomeLabel,
} from '../lib/localizedLabels'

type OpsSummary = {
  project_count: number
  ready_take_count: number
  failed_track_count: number
  analysis_job_count: number
  failed_analysis_job_count: number
}

type OpsPolicies = {
  analysis_timeout_seconds: number
  upload_session_expiry_minutes: number
  recent_limit: number
}

type OpsModelVersions = {
  analysis: string[]
  melody: string[]
  arrangement_engine: string[]
}

type OpsEnvironmentSummary = {
  total_device_profiles: number
  profiles_with_warnings: number
  browser_family_count: number
  warning_flag_count: number
}

type OpsEnvironmentBrowser = {
  browser: string
  os: string
  profile_count: number
  warning_profile_count: number
  latest_seen_at: string
}

type OpsEnvironmentWarning = {
  flag: string
  profile_count: number
}

type OpsEnvironmentProfile = {
  device_profile_id: string
  browser: string
  os: string
  browser_user_agent: string | null
  output_route: string
  actual_sample_rate: number | null
  base_latency: number | null
  output_latency: number | null
  microphone_permission: string | null
  recording_mime_type: string | null
  audio_context_mode: string | null
  offline_audio_context_mode: string | null
  warning_flags: string[]
  updated_at: string
}

type OpsEnvironmentDiagnostics = {
  summary: OpsEnvironmentSummary
  browser_matrix: OpsEnvironmentBrowser[]
  warning_flags: OpsEnvironmentWarning[]
  recent_profiles: OpsEnvironmentProfile[]
}

type EnvironmentValidationRun = {
  validation_run_id: string
  label: string
  tester: string | null
  device_name: string
  os: string
  browser: string
  input_device: string | null
  output_route: string | null
  outcome: 'PASS' | 'WARN' | 'FAIL'
  secure_context: boolean | null
  microphone_permission_before: string | null
  microphone_permission_after: string | null
  recording_mime_type: string | null
  audio_context_mode: string | null
  offline_audio_context_mode: string | null
  actual_sample_rate: number | null
  base_latency: number | null
  output_latency: number | null
  warning_flags: string[]
  take_recording_succeeded: boolean | null
  analysis_succeeded: boolean | null
  playback_succeeded: boolean | null
  audible_issues: string | null
  permission_issues: string | null
  unexpected_warnings: string | null
  follow_up: string | null
  notes: string | null
  validated_at: string
  created_at: string
  updated_at: string
}

type EnvironmentValidationImportPreviewItem = {
  label: string
  tester: string | null
  device_name: string
  os: string
  browser: string
  input_device: string | null
  output_route: string | null
  outcome: 'PASS' | 'WARN' | 'FAIL'
  secure_context: boolean | null
  microphone_permission_before: string | null
  microphone_permission_after: string | null
  recording_mime_type: string | null
  audio_context_mode: string | null
  offline_audio_context_mode: string | null
  actual_sample_rate: number | null
  base_latency: number | null
  output_latency: number | null
  warning_flags: string[]
  take_recording_succeeded: boolean | null
  analysis_succeeded: boolean | null
  playback_succeeded: boolean | null
  audible_issues: string | null
  permission_issues: string | null
  unexpected_warnings: string | null
  follow_up: string | null
  notes: string | null
  validated_at: string
}

type EnvironmentValidationImportPreview = {
  item_count: number
  items: EnvironmentValidationImportPreviewItem[]
}

type EnvironmentValidationImportResult = {
  imported_count: number
  items: EnvironmentValidationRun[]
}

type FailedTrackSummary = {
  track_id: string
  project_id: string
  project_title: string
  track_role: string
  track_status: string
  take_no: number | null
  source_format: string | null
  failure_message: string | null
  updated_at: string
}

type AnalysisJobSummary = {
  job_id: string
  project_id: string
  project_title: string
  track_id: string
  track_role: string
  take_no: number | null
  status: string
  model_version: string
  requested_at: string
  finished_at: string | null
  error_message: string | null
}

type OpsOverview = {
  summary: OpsSummary
  policies: OpsPolicies
  model_versions: OpsModelVersions
  environment_diagnostics: OpsEnvironmentDiagnostics
  runtime_log_summary: {
    total_event_count: number
    error_event_count: number
    client_error_event_count: number
    server_error_event_count: number
  }
  recent_runtime_events: Array<{
    runtime_event_id: string
    source: string
    severity: string
    event_type: string
    message: string
    project_id: string | null
    track_id: string | null
    surface: string | null
    route_path: string | null
    request_id: string | null
    request_method: string | null
    request_path: string | null
    status_code: number | null
    user_agent: string | null
    details: Record<string, unknown> | unknown[] | null
    created_at: string
    updated_at: string
  }>
  environment_claim_gate: EnvironmentValidationClaimGate
  recent_environment_validation_runs: EnvironmentValidationRun[]
  failed_tracks: FailedTrackSummary[]
  recent_analysis_jobs: AnalysisJobSummary[]
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'ready'; payload: OpsOverview }
  | { phase: 'error'; message: string }

type ActionState =
  | { phase: 'idle' }
  | { phase: 'submitting'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type EnvironmentDiagnosticsExport = {
  exported_at: string
  generated_from: 'ops_overview'
  environment_diagnostics: OpsEnvironmentDiagnostics
}

type EnvironmentValidationPacket = {
  generated_at: string
  generated_from: 'ops_environment_validation_packet'
  summary: {
    total_validation_runs: number
    pass_run_count: number
    warn_run_count: number
    fail_run_count: number
    native_safari_run_count: number
    real_hardware_recording_success_count: number
    environments_with_warning_flags: number
  }
  required_matrix: Array<{
    label: string
    covered: boolean
    run_count: number
  }>
  environment_diagnostics: OpsEnvironmentDiagnostics
  recent_validation_runs: EnvironmentValidationRun[]
  claim_guardrails: string[]
  compatibility_notes: string[]
}

type EnvironmentValidationClaimGate = {
  evaluated_at: string
  generated_from: 'ops_environment_validation_claim_gate'
  release_claim_ready: boolean
  summary_message: string
  policy: {
    minimum_total_validation_runs: number
    minimum_native_safari_run_count: number
    minimum_real_hardware_recording_success_count: number
    minimum_covered_matrix_cells: number
    maximum_fail_run_count: number
    required_matrix_labels: string[]
  }
  packet_summary: {
    total_validation_runs: number
    pass_run_count: number
    warn_run_count: number
    fail_run_count: number
    native_safari_run_count: number
    real_hardware_recording_success_count: number
    environments_with_warning_flags: number
  }
  covered_matrix_count: number
  total_required_matrix_cells: number
  checks: Array<{
    key: string
    passed: boolean
    actual: string
    expected: string
    message: string
  }>
  next_actions: string[]
}

type ValidationFormState = {
  label: string
  tester: string
  deviceName: string
  os: string
  browser: string
  inputDevice: string
  outputRoute: string
  outcome: 'PASS' | 'WARN' | 'FAIL'
  secureContext: boolean
  microphonePermissionBefore: string
  microphonePermissionAfter: string
  recordingMimeType: string
  audioContextMode: string
  offlineAudioContextMode: string
  actualSampleRate: string
  baseLatencyMs: string
  outputLatencyMs: string
  warningFlagsText: string
  takeRecordingSucceeded: boolean
  analysisSucceeded: boolean
  playbackSucceeded: boolean
  audibleIssues: string
  permissionIssues: string
  unexpectedWarnings: string
  followUp: string
  notes: string
  validatedAt: string
}

function getCurrentDateTimeLocal(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const localDate = new Date(now.getTime() - offsetMinutes * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const initialValidationFormState = (): ValidationFormState => ({
  label: '',
  tester: '',
  deviceName: '',
  os: '',
  browser: '',
  inputDevice: '',
  outputRoute: '',
  outcome: 'WARN',
  secureContext: true,
  microphonePermissionBefore: 'prompt',
  microphonePermissionAfter: 'granted',
  recordingMimeType: '',
  audioContextMode: '',
  offlineAudioContextMode: '',
  actualSampleRate: '',
  baseLatencyMs: '',
  outputLatencyMs: '',
  warningFlagsText: '',
  takeRecordingSucceeded: true,
  analysisSucceeded: true,
  playbackSucceeded: true,
  audibleIssues: '',
  permissionIssues: '',
  unexpectedWarnings: '',
  followUp: '',
  notes: '',
  validatedAt: getCurrentDateTimeLocal(),
})

function formatDate(value: string | null): string {
  if (!value) {
    return '아직 완료되지 않음'
  }

  return new Date(value).toLocaleString()
}

function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '사용 불가'
  }

  return `${Math.round(value * 1000)} ms`
}

function formatAudioRouteLabel(value: string | null): string {
  switch (value) {
    case 'standard':
      return '표준 경로'
    case 'webkit':
      return '호환 경로'
    case 'unavailable':
    case null:
      return '사용 불가'
    default:
      return value
  }
}

function downloadJsonReport(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadTextReport(filename: string, payload: string, contentType = 'text/plain'): void {
  const blob = new Blob([payload], {
    type: `${contentType};charset=utf-8`,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function parseWarningFlags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getRuntimeSeverityLabel(severity: string): string {
  switch (severity) {
    case 'error':
      return '오류'
    case 'warn':
      return '주의'
    default:
      return '참고'
  }
}

function getRuntimeSourceLabel(source: string): string {
  return source === 'client' ? '화면' : '서버'
}

function getRuntimeFollowUpMessage(item: OpsOverview['recent_runtime_events'][number]): string {
  if (item.source === 'client') {
    return '같은 화면 흐름을 다시 열어 보고, 버튼이나 입력 순서가 겹치지 않는지 먼저 확인해 주세요.'
  }

  if (item.status_code && item.status_code >= 500) {
    return '서버 500 계열이므로 요청 경로와 추적 번호를 기준으로 백엔드 로그를 먼저 대조해 주세요.'
  }

  return '같은 시간대의 요청과 최근 작업 기록을 함께 보고, 다시 실행이 필요한지 확인해 주세요.'
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

export function OpsPage() {
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' })
  const [actionState, setActionState] = useState<ActionState>({ phase: 'idle' })
  const [workspaceMode, setWorkspaceMode] = useState<'triage' | 'validation' | 'recovery'>(
    'triage',
  )
  const [selectedRuntimeEventId, setSelectedRuntimeEventId] = useState<string | null>(null)
  const [validationImportText, setValidationImportText] = useState('')
  const [validationImportPreview, setValidationImportPreview] =
    useState<EnvironmentValidationImportPreview | null>(null)
  const [validationFormState, setValidationFormState] = useState<ValidationFormState>(
    initialValidationFormState,
  )

  async function loadOverview(signal?: AbortSignal): Promise<void> {
    try {
      const response = await fetch(buildApiUrl('/api/admin/ops'), { signal })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '운영 개요를 불러오지 못했습니다.'))
      }

      const payload = (await response.json()) as OpsOverview
      setPageState({ phase: 'ready', payload })
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      setPageState({
        phase: 'error',
        message: error instanceof Error ? error.message : '운영 개요를 불러오지 못했습니다.',
      })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadOverview(controller.signal)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (pageState.phase !== 'ready') {
      return
    }

    const firstRuntimeEvent = pageState.payload.recent_runtime_events[0]
    if (!firstRuntimeEvent) {
      if (selectedRuntimeEventId !== null) {
        setSelectedRuntimeEventId(null)
      }
      return
    }

    const selectedStillExists = pageState.payload.recent_runtime_events.some(
      (item) => item.runtime_event_id === selectedRuntimeEventId,
    )
    if (!selectedStillExists) {
      setSelectedRuntimeEventId(firstRuntimeEvent.runtime_event_id)
    }
  }, [pageState, selectedRuntimeEventId])

  async function handleRetryProcessing(trackId: string): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: '트랙 처리를 다시 실행하고 운영 개요를 새로고침하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/tracks/${trackId}/retry-processing`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '트랙 처리를 다시 실행하지 못했습니다.'))
      }

      await loadOverview()
      setActionState({
        phase: 'success',
        message: '트랙 재처리를 마쳤고 운영 개요를 새로고침했습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '트랙 처리를 다시 실행하지 못했습니다.',
      })
    }
  }

  async function handleRetryAnalysis(jobId: string): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: '실패한 분석 작업을 다시 실행하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/analysis-jobs/${jobId}/retry`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '분석 작업 재실행에 실패했습니다.'))
      }

      await loadOverview()
      setActionState({
        phase: 'success',
        message: '분석 작업을 다시 실행했고 운영 개요를 새로고침했습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '분석 작업 재실행에 실패했습니다.',
      })
    }
  }

  function handleDownloadEnvironmentReport(payload: OpsEnvironmentDiagnostics): void {
    const report: EnvironmentDiagnosticsExport = {
      exported_at: new Date().toISOString(),
      generated_from: 'ops_overview',
      environment_diagnostics: payload,
    }

    const dateToken = new Date().toISOString().slice(0, 10)
    downloadJsonReport(`gigastudy-environment-diagnostics-${dateToken}.json`, report)
    setActionState({
      phase: 'success',
      message: '환경 진단 리포트를 내려받았습니다. 실기기 하드웨어 검증의 기준선으로 사용하세요.',
    })
  }

  async function handleDownloadValidationPacket(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: '저장된 진단 정보와 수동 검증 실행 기록으로 환경 검증 패킷을 만드는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validation-packet'))
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '환경 검증 패킷을 만들지 못했습니다.'))
      }

      const payload = (await response.json()) as EnvironmentValidationPacket
      const dateToken = new Date().toISOString().slice(0, 10)
      downloadJsonReport(`gigastudy-environment-validation-packet-${dateToken}.json`, payload)
      setActionState({
        phase: 'success',
        message: '환경 검증 패킷을 내려받았습니다. 릴리즈 노트, 호환성 메모, 실기기 브라우저 증거 검토에 사용하세요.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '환경 검증 패킷을 만들지 못했습니다.',
      })
    }
  }

  async function handleDownloadValidationReleaseNotes(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: '저장된 검증 증거로 브라우저 호환성 릴리즈 노트 초안을 만드는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validation-release-notes'))
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, '환경 검증 릴리즈 노트를 만들지 못했습니다.'),
        )
      }

      const payload = await response.text()
      const dateToken = new Date().toISOString().slice(0, 10)
      downloadTextReport(
        `gigastudy-browser-compatibility-notes-${dateToken}.md`,
        payload,
        'text/markdown',
      )
      setActionState({
        phase: 'success',
        message: '브라우저 호환성 릴리즈 노트 초안을 내려받았습니다. 지원 문구를 공개하기 전에 미검증 경로를 먼저 확인하세요.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '환경 검증 릴리즈 노트를 만들지 못했습니다.',
      })
    }
  }

  async function handleDownloadValidationClaimGate(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: '브라우저와 하드웨어 증거가 릴리즈 클레임 검토를 시작할 만큼 충분한지 평가하는 중입니다...',
    })

    try {
      const markdownResponse = await fetch(buildApiUrl('/api/admin/environment-validation-claim-gate.md'))
      if (!markdownResponse.ok) {
        throw new Error(
          await readErrorMessage(markdownResponse, '브라우저 환경 클레임 게이트를 만들지 못했습니다.'),
        )
      }

      const jsonResponse = await fetch(buildApiUrl('/api/admin/environment-validation-claim-gate'))
      if (!jsonResponse.ok) {
        throw new Error(
          await readErrorMessage(jsonResponse, '브라우저 환경 클레임 게이트 요약을 불러오지 못했습니다.'),
        )
      }

      const markdown = await markdownResponse.text()
      const summary = (await jsonResponse.json()) as EnvironmentValidationClaimGate
      const dateToken = new Date().toISOString().slice(0, 10)
      downloadTextReport(
        `gigastudy-browser-environment-claim-gate-${dateToken}.md`,
        markdown,
        'text/markdown',
      )
      setActionState({
        phase: 'success',
        message: summary.release_claim_ready
          ? '브라우저 환경 클레임 게이트를 내려받았습니다. 릴리즈 클레임 검토를 시작할 만큼 증거가 충분합니다.'
          : '브라우저 환경 클레임 게이트를 내려받았습니다. 부족한 증거가 채워질 때까지 체크리스트를 열어 두세요.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '브라우저 환경 클레임 게이트를 만들지 못했습니다.',
      })
    }
  }

  async function handleCreateValidationRun(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setActionState({
      phase: 'submitting',
      message: '환경 검증 실행 기록을 저장하고 운영 개요를 새로고침하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: validationFormState.label,
          tester: validationFormState.tester || null,
          device_name: validationFormState.deviceName,
          os: validationFormState.os,
          browser: validationFormState.browser,
          input_device: validationFormState.inputDevice || null,
          output_route: validationFormState.outputRoute || null,
          outcome: validationFormState.outcome,
          secure_context: validationFormState.secureContext,
          microphone_permission_before: validationFormState.microphonePermissionBefore || null,
          microphone_permission_after: validationFormState.microphonePermissionAfter || null,
          recording_mime_type: validationFormState.recordingMimeType || null,
          audio_context_mode: validationFormState.audioContextMode || null,
          offline_audio_context_mode: validationFormState.offlineAudioContextMode || null,
          actual_sample_rate: validationFormState.actualSampleRate
            ? Number(validationFormState.actualSampleRate)
            : null,
          base_latency: validationFormState.baseLatencyMs
            ? Number(validationFormState.baseLatencyMs) / 1000
            : null,
          output_latency: validationFormState.outputLatencyMs
            ? Number(validationFormState.outputLatencyMs) / 1000
            : null,
          warning_flags: parseWarningFlags(validationFormState.warningFlagsText),
          take_recording_succeeded: validationFormState.takeRecordingSucceeded,
          analysis_succeeded: validationFormState.analysisSucceeded,
          playback_succeeded: validationFormState.playbackSucceeded,
          audible_issues: validationFormState.audibleIssues || null,
          permission_issues: validationFormState.permissionIssues || null,
          unexpected_warnings: validationFormState.unexpectedWarnings || null,
          follow_up: validationFormState.followUp || null,
          notes: validationFormState.notes || null,
          validated_at: new Date(validationFormState.validatedAt).toISOString(),
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '검증 실행 기록을 저장하지 못했습니다.'))
      }

      await loadOverview()
      setValidationFormState(initialValidationFormState())
      setActionState({
        phase: 'success',
        message: '환경 검증 실행 기록을 저장했습니다. 운영 개요에 최신 수동 브라우저 점검이 반영되었습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '검증 실행 기록을 저장하지 못했습니다.',
      })
    }
  }

  async function handleValidationImportFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const text = await file.text()
    setValidationImportText(text)
    setValidationImportPreview(null)
    setActionState({
      phase: 'success',
      message: `${file.name} 파일을 불러왔습니다. ops에 가져오기 전에 CSV를 먼저 미리 확인하세요.`,
    })
    event.target.value = ''
  }

  async function handlePreviewValidationImport(): Promise<void> {
    if (!validationImportText.trim()) {
      setActionState({
        phase: 'error',
        message: '가져오기 미리보기를 실행하기 전에 CSV 내용을 붙여넣거나 파일을 불러와 주세요.',
      })
      return
    }

    setActionState({
      phase: 'submitting',
      message: '운영 로그에 반영하기 전에 외부 검증 행을 미리 확인하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validations/import-preview'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csv_text: validationImportText }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '검증 CSV 가져오기 미리보기에 실패했습니다.'))
      }

      const payload = (await response.json()) as EnvironmentValidationImportPreview
      setValidationImportPreview(payload)
      setActionState({
        phase: 'success',
        message:
          payload.item_count > 0
            ? `검증 실행 ${payload.item_count}건의 미리보기를 준비했습니다. 가져오기 전에 행을 확인해 주세요.`
            : 'CSV는 정상적으로 읽었지만 비어 있지 않은 검증 행이 없었습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '검증 CSV 가져오기 미리보기에 실패했습니다.',
      })
    }
  }

  async function handleSubmitValidationImport(): Promise<void> {
    if (!validationImportText.trim()) {
      setActionState({
        phase: 'error',
        message: '운영 로그로 가져오기 전에 CSV 내용을 붙여넣거나 파일을 불러와 주세요.',
      })
      return
    }

    setActionState({
      phase: 'submitting',
      message: '외부 검증 행을 운영 로그로 가져오고 운영 개요를 새로고침하는 중입니다...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validations/import'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csv_text: validationImportText }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '검증 CSV 행을 가져오지 못했습니다.'))
      }

      const payload = (await response.json()) as EnvironmentValidationImportResult
      await loadOverview()
      setValidationImportPreview(null)
      setValidationImportText('')
      setActionState({
        phase: 'success',
        message:
          payload.imported_count > 0
            ? `외부 CSV에서 검증 실행 ${payload.imported_count}건을 ops로 가져왔습니다.`
            : 'CSV 가져오기를 마쳤지만 생성된 검증 행은 없었습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '검증 CSV 행을 가져오지 못했습니다.',
      })
    }
  }

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell ops-page">
        <section className="panel studio-panel">
          <p className="eyebrow">운영</p>
          <h1>운영 개요를 불러오는 중입니다</h1>
          <p className="panel__summary">
            API에서 실패 상태, 재시도 경로, 운영 정책, 모델 버전 정보를 불러오고 있습니다.
          </p>
        </section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell ops-page">
        <section className="panel studio-panel">
          <p className="eyebrow">운영</p>
          <h1>운영 개요를 열 수 없습니다</h1>
          <p className="form-error">{pageState.message}</p>
          <Link className="back-link" to="/">
            홈으로 돌아가기
          </Link>
        </section>
      </div>
    )
  }

  const { payload } = pageState
  const environmentDiagnostics = payload.environment_diagnostics
  const runtimeLogSummary = payload.runtime_log_summary
  const recentRuntimeEvents = payload.recent_runtime_events
  const environmentClaimGate = payload.environment_claim_gate
  const failedClaimChecks = environmentClaimGate.checks.filter((check) => !check.passed)
  const validationRuns = payload.recent_environment_validation_runs
  const selectedRuntimeEvent =
    recentRuntimeEvents.find((item) => item.runtime_event_id === selectedRuntimeEventId) ??
    recentRuntimeEvents[0] ??
    null

  return (
    <div className="page-shell ops-page">
      <section className="panel studio-panel ops-shell">
        <div className="studio-header ops-shell__header">
          <div className="ops-shell__copy">
            <p className="eyebrow">운영</p>
            <h1>운영 개요와 릴리즈 게이트</h1>
            <p className="panel__summary">
              실패 가시성, 재시도 경로, 모델 버전 추적, 운영 모니터링을 이 화면에서 한 번에
              점검합니다.
            </p>
          </div>

          <div className="button-row ops-shell__actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => void loadOverview()}
            >
              개요 새로고침
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => handleDownloadEnvironmentReport(environmentDiagnostics)}
            >
              환경 리포트 내려받기
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationPacket()}
            >
              검증 패킷 내려받기
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationReleaseNotes()}
            >
              호환성 노트 내려받기
            </button>

            <button
              data-testid="download-claim-gate-button"
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationClaimGate()}
            >
              클레임 게이트 내려받기
            </button>

            <Link className="back-link" to="/">
              홈으로 돌아가기
            </Link>
          </div>
        </div>

        {actionState.phase !== 'idle' ? (
          <p className={actionState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
            {actionState.message}
          </p>
        ) : null}

        <div className="ops-workspace-switch" role="tablist" aria-label="운영 작업 모드">
          <button
            className={`ops-workspace-button ${
              workspaceMode === 'triage' ? 'ops-workspace-button--active' : ''
            }`}
            type="button"
            data-testid="ops-workspace-mode-triage"
            aria-selected={workspaceMode === 'triage'}
            onClick={() => setWorkspaceMode('triage')}
          >
            <span>1단계</span>
            <strong>문제 확인</strong>
            <small>화면 오류와 서버 오류를 먼저 읽습니다.</small>
          </button>
          <button
            className={`ops-workspace-button ${
              workspaceMode === 'validation' ? 'ops-workspace-button--active' : ''
            }`}
            type="button"
            data-testid="ops-workspace-mode-validation"
            aria-selected={workspaceMode === 'validation'}
            onClick={() => setWorkspaceMode('validation')}
          >
            <span>2단계</span>
            <strong>환경 검증</strong>
            <small>브라우저와 장치 편차를 모아 봅니다.</small>
          </button>
          <button
            className={`ops-workspace-button ${
              workspaceMode === 'recovery' ? 'ops-workspace-button--active' : ''
            }`}
            type="button"
            data-testid="ops-workspace-mode-recovery"
            aria-selected={workspaceMode === 'recovery'}
            onClick={() => setWorkspaceMode('recovery')}
          >
            <span>3단계</span>
            <strong>복구 처리</strong>
            <small>실패한 업로드와 분석 작업을 다시 돌립니다.</small>
          </button>
        </div>

        <div className="card-grid ops-kpi-strip">
          <article className="info-card ops-kpi-card">
            <h3>릴리즈 요약</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>프로젝트</span>
                <strong>{payload.summary.project_count}</strong>
              </div>
              <div className="mini-card">
                <span>준비 완료 테이크</span>
                <strong>{payload.summary.ready_take_count}</strong>
              </div>
              <div className="mini-card">
                <span>실패한 트랙</span>
                <strong>{payload.summary.failed_track_count}</strong>
              </div>
              <div className="mini-card">
                <span>실패한 분석 작업</span>
                <strong>{payload.summary.failed_analysis_job_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-kpi-card">
            <h3>운영 정책</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>분석 타임아웃</span>
                <strong>{payload.policies.analysis_timeout_seconds}초</strong>
              </div>
              <div className="mini-card">
                <span>업로드 만료</span>
                <strong>{payload.policies.upload_session_expiry_minutes}분</strong>
              </div>
              <div className="mini-card">
                <span>최근 조회 범위</span>
                <strong>{payload.policies.recent_limit}개</strong>
              </div>
              <div className="mini-card">
                <span>분석 작업</span>
                <strong>{payload.summary.analysis_job_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-kpi-card">
            <h3>런타임 로그</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>전체 사건</span>
                <strong>{runtimeLogSummary.total_event_count}</strong>
              </div>
              <div className="mini-card">
                <span>오류 합계</span>
                <strong>{runtimeLogSummary.error_event_count}</strong>
              </div>
              <div className="mini-card">
                <span>화면 오류</span>
                <strong>{runtimeLogSummary.client_error_event_count}</strong>
              </div>
              <div className="mini-card">
                <span>서버 오류</span>
                <strong>{runtimeLogSummary.server_error_event_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-kpi-card ops-claim-gate-card">
            <div className="ops-claim-gate-card__header">
              <div>
                <h3>클레임 게이트</h3>
                <p className="panel__summary">
                  실기기 브라우저와 하드웨어 증거가 체크리스트 종료 검토를 시작할 만큼 충분한지
                  확인합니다.
                </p>
              </div>
              <span
                className={`status-pill ${
                  environmentClaimGate.release_claim_ready ? 'status-pill--success' : 'status-pill--warning'
                }`}
              >
                {environmentClaimGate.release_claim_ready ? '검토 시작 가능' : '체크리스트 유지'}
              </span>
            </div>

            <p className="ops-claim-gate-card__summary">{environmentClaimGate.summary_message}</p>

            <div className="mini-grid">
              <div className="mini-card">
                <span>검증 실행 수</span>
                <strong>
                  {environmentClaimGate.packet_summary.total_validation_runs}/
                  {environmentClaimGate.policy.minimum_total_validation_runs}
                </strong>
              </div>
              <div className="mini-card">
                <span>실기기 Safari</span>
                <strong>
                  {environmentClaimGate.packet_summary.native_safari_run_count}/
                  {environmentClaimGate.policy.minimum_native_safari_run_count}
                </strong>
              </div>
              <div className="mini-card">
                <span>실기기 녹음</span>
                <strong>
                  {environmentClaimGate.packet_summary.real_hardware_recording_success_count}/
                  {environmentClaimGate.policy.minimum_real_hardware_recording_success_count}
                </strong>
              </div>
              <div className="mini-card">
                <span>매트릭스 커버리지</span>
                <strong>
                  {environmentClaimGate.covered_matrix_count}/
                  {environmentClaimGate.policy.minimum_covered_matrix_cells}
                </strong>
              </div>
            </div>

            <div className="ops-claim-gate-card__detail">
              <div>
                <h4>막는 항목</h4>
                {failedClaimChecks.length === 0 ? (
                  <p>현재 정책 검사를 모두 통과했습니다. 지원 범위를 넓히기 전에 검토 메모와 호환성 문구를 다시 확인해 주세요.</p>
                ) : (
                  <ul className="ticket-list ops-claim-gate-list">
                    {failedClaimChecks.map((check) => (
                      <li key={check.key}>
                        <strong>{check.key}</strong>
                        <span>
                          {check.actual} vs {check.expected}
                        </span>
                        <span>{check.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4>다음 작업</h4>
                <ul className="ticket-list ops-claim-gate-list">
                  {environmentClaimGate.next_actions.map((action) => (
                    <li key={action}>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </div>
        <article
          className={`panel studio-block ops-panel ops-workspace-panel ${
            workspaceMode === 'triage' ? 'ops-workspace-panel--active' : ''
          }`}
        >
          <p className="eyebrow">런타임 로그</p>
          <h2>최근에 실제 사용 중 잡힌 오류를 바로 확인합니다</h2>

          <div className="ops-runtime-workspace">
            {recentRuntimeEvents.length === 0 ? (
              <div className="empty-card">
                <p>아직 런타임 로그가 없습니다.</p>
                <p>화면 오류나 서버 500 응답이 생기면 이곳에 최근 순서대로 쌓입니다.</p>
              </div>
            ) : (
              <>
                {selectedRuntimeEvent ? (
                  <article className="ops-card ops-runtime-focus">
                    <div className="ops-card__header">
                      <div>
                        <strong>{selectedRuntimeEvent.message}</strong>
                        <span>
                          {getRuntimeSourceLabel(selectedRuntimeEvent.source)}
                          {selectedRuntimeEvent.surface ? ` / ${selectedRuntimeEvent.surface}` : ''}
                          {' / '}
                          {formatDate(selectedRuntimeEvent.created_at)}
                        </span>
                      </div>

                      <div
                        className={`status-pill ${
                          selectedRuntimeEvent.severity === 'error'
                            ? 'status-pill--error'
                            : selectedRuntimeEvent.severity === 'warn'
                              ? 'status-pill--loading'
                              : 'status-pill--ready'
                        }`}
                      >
                        {getRuntimeSeverityLabel(selectedRuntimeEvent.severity)}
                      </div>
                    </div>

                    <p className="panel__summary">
                      {getRuntimeFollowUpMessage(selectedRuntimeEvent)}
                    </p>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>구분</span>
                        <strong>{selectedRuntimeEvent.event_type}</strong>
                      </div>
                      <div className="mini-card">
                        <span>요청</span>
                        <strong>
                          {selectedRuntimeEvent.request_method ?? '-'}{' '}
                          {selectedRuntimeEvent.request_path ?? selectedRuntimeEvent.route_path ?? '-'}
                        </strong>
                      </div>
                      <div className="mini-card">
                        <span>응답</span>
                        <strong>{selectedRuntimeEvent.status_code ?? '-'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>추적 번호</span>
                        <strong>{selectedRuntimeEvent.request_id ?? '-'}</strong>
                      </div>
                      <div className="mini-card">
                        <span>프로젝트</span>
                        <strong>
                          {selectedRuntimeEvent.project_id
                            ? selectedRuntimeEvent.project_id.slice(0, 8)
                            : '없음'}
                        </strong>
                      </div>
                      <div className="mini-card">
                        <span>테이크</span>
                        <strong>
                          {selectedRuntimeEvent.track_id
                            ? selectedRuntimeEvent.track_id.slice(0, 8)
                            : '없음'}
                        </strong>
                      </div>
                    </div>
                  </article>
                ) : null}

                <div className="ops-runtime-queue" role="list" aria-label="최근 런타임 로그 대기열">
                  {recentRuntimeEvents.map((item) => (
                    <button
                      key={item.runtime_event_id}
                      className={`ops-runtime-row ${
                        selectedRuntimeEvent?.runtime_event_id === item.runtime_event_id
                          ? 'ops-runtime-row--active'
                          : ''
                      }`}
                      type="button"
                      onClick={() => setSelectedRuntimeEventId(item.runtime_event_id)}
                    >
                      <div className="ops-runtime-row__main">
                        <strong>{item.message}</strong>
                        <span>
                          {getRuntimeSourceLabel(item.source)}
                          {item.surface ? ` / ${item.surface}` : ''}
                        </span>
                      </div>
                      <div className="ops-runtime-row__meta">
                        <small>{formatDate(item.created_at)}</small>
                        <small>
                          {item.request_method ?? '-'} {item.request_path ?? item.route_path ?? '-'}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </article>
      </section>

      <section className="section ops-section ops-section--versions">
        <div className="section__header ops-section__header">
          <p className="eyebrow">모델 추적</p>
          <h2>현재 어떤 분석 버전이 동작 중인지 확인합니다</h2>
        </div>

        <div className="card-grid">
          <article className="info-card ops-info-card">
            <h3>분석 버전</h3>
            <ul>
              {payload.model_versions.analysis.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card ops-info-card">
            <h3>멜로디 버전</h3>
            <ul>
              {payload.model_versions.melody.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card ops-info-card">
            <h3>편곡 버전</h3>
            <ul>
              {payload.model_versions.arrangement_engine.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section
        className={`section ops-section ops-section--diagnostics ${
          workspaceMode === 'validation' ? 'ops-workspace-panel ops-workspace-panel--active' : ''
        }`}
      >
        <div className="section__header ops-section__header">
          <p className="eyebrow">환경 진단</p>
          <h2>브라우저 오디오 편차를 지원 이슈가 되기 전에 추적합니다</h2>
        </div>

        <div className="card-grid">
          <article className="info-card ops-info-card">
            <h3>장치 기록 커버리지</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>수집된 프로필</span>
                <strong>{environmentDiagnostics.summary.total_device_profiles}</strong>
              </div>
              <div className="mini-card">
                <span>경고가 있는 프로필</span>
                <strong>{environmentDiagnostics.summary.profiles_with_warnings}</strong>
              </div>
              <div className="mini-card">
                <span>브라우저 계열</span>
                <strong>{environmentDiagnostics.summary.browser_family_count}</strong>
              </div>
              <div className="mini-card">
                <span>경고 종류</span>
                <strong>{environmentDiagnostics.summary.warning_flag_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-info-card">
            <h3>경고 분포</h3>
            {environmentDiagnostics.warning_flags.length === 0 ? (
              <div className="empty-card">
                <p>아직 수집된 경고 플래그가 없습니다.</p>
                <p>여러 브라우저에서 장치 기록을 저장해 이 기준선을 쌓아 주세요.</p>
              </div>
            ) : (
              <ul className="ticket-list">
                {environmentDiagnostics.warning_flags.map((warning) => (
                  <li key={warning.flag}>
                    <strong>{getBrowserAudioWarningLabel(warning.flag)}</strong>
                    <span>{warning.profile_count}개 프로필</span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="info-card ops-info-card">
            <h3>브라우저 매트릭스</h3>
            {environmentDiagnostics.browser_matrix.length === 0 ? (
              <div className="empty-card">
                <p>아직 수집된 브라우저 환경이 없습니다.</p>
                <p>스튜디오에서 장치 기록을 저장하면 매트릭스가 채워집니다.</p>
              </div>
            ) : (
              <ul className="ticket-list">
                {environmentDiagnostics.browser_matrix.map((browserEntry) => (
                  <li key={`${browserEntry.browser}-${browserEntry.os}`}>
                    <strong>
                      {browserEntry.browser} / {browserEntry.os}
                    </strong>
                    <span>
                      프로필 {browserEntry.profile_count}개, 경고 포함 {browserEntry.warning_profile_count}개
                      <br />
                      최근 확인 {formatDate(browserEntry.latest_seen_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section
        className={`section section--split ops-section ops-section--validation ${
          workspaceMode === 'validation' ? 'ops-workspace-panel ops-workspace-panel--active' : ''
        }`}
      >
        <article className="panel studio-block ops-panel" data-testid="validation-import-panel">
          <p className="eyebrow">가져오기 입력</p>
          <h2>외부 검증 시트를 미리 보고 가져옵니다</h2>
          <p className="panel__summary">
            QA나 실기기 검증 라운드를 ops 밖에서 기록했다면, 여기서 CSV를 붙여 넣거나 파일로 불러온 뒤
            파싱 결과를 확인하고 릴리즈 로그로 가져오세요.
          </p>

          <div className="project-form ops-import-form">
            <div className="button-row">
              <a
                className="button-secondary button-secondary--small"
                data-testid="download-validation-template-button"
                download="gigastudy-environment-validation-starter-pack.zip"
                href={buildApiUrl('/api/admin/environment-validations/template')}
              >
                검증 시트 받기
              </a>
            </div>

            <label className="field">
              <span>환경 검증 CSV</span>
              <textarea
                className="text-input text-area"
                name="validationImportText"
                value={validationImportText}
                onChange={(event) => {
                  setValidationImportText(event.target.value)
                  setValidationImportPreview(null)
                }}
                placeholder="환경 검증 CSV 내용을 여기에 붙여 넣으세요."
                rows={10}
              />
            </label>

            <div className="button-row">
              <label className="button-secondary button-secondary--small ops-file-button">
                CSV 파일 불러오기
                <input
                  className="ops-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="환경 검증 CSV 파일"
                  onChange={(event) => void handleValidationImportFile(event)}
                />
              </label>

              <button
                className="button-secondary button-secondary--small"
                type="button"
                onClick={() => void handlePreviewValidationImport()}
              >
                가져오기 미리보기
              </button>

              <button
                className="button-primary button-secondary--small"
                type="button"
                onClick={() => void handleSubmitValidationImport()}
                disabled={!validationImportPreview || validationImportPreview.item_count === 0}
              >
                미리 본 실행 가져오기
              </button>
            </div>

            {validationImportPreview ? (
              <div className="ops-import-preview">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>미리보기 행 수</span>
                    <strong>{validationImportPreview.item_count}</strong>
                  </div>
                  <div className="mini-card">
                    <span>통과 / 주의 / 실패</span>
                    <strong>
                      {
                        validationImportPreview.items.filter((item) => item.outcome === 'PASS').length
                      }{' '}
                      /{' '}
                      {
                        validationImportPreview.items.filter((item) => item.outcome === 'WARN').length
                      }{' '}
                      /{' '}
                      {
                        validationImportPreview.items.filter((item) => item.outcome === 'FAIL').length
                      }
                    </strong>
                  </div>
                </div>

                {validationImportPreview.item_count === 0 ? (
                  <div className="empty-card">
                    <p>CSV 입력에서 가져올 수 있는 행을 찾지 못했습니다.</p>
                    <p>시트에 헤더와 비어 있지 않은 행이 남아 있는지 확인해 주세요.</p>
                  </div>
                ) : (
                  <div className="ops-list">
                    {validationImportPreview.items.map((item, index) => (
                      <article className="ops-card" key={`${item.label}-${item.validated_at}-${index}`}>
                        <div className="ops-card__header">
                          <div>
                            <strong>{item.label}</strong>
                            <span>
                              {item.browser} / {item.os} / {item.device_name}
                            </span>
                          </div>

                          <span
                            className={`status-pill ${
                              item.outcome === 'PASS'
                                ? 'status-pill--success'
                                : item.outcome === 'FAIL'
                                  ? 'status-pill--danger'
                                  : 'status-pill--warning'
                            }`}
                          >
                            {getValidationOutcomeLabel(item.outcome)}
                          </span>
                        </div>

                        <div className="mini-grid">
                          <div className="mini-card">
                            <span>출력 경로</span>
                            <strong>{item.output_route ?? '기록되지 않음'}</strong>
                          </div>
                          <div className="mini-card">
                            <span>레코더 MIME</span>
                            <strong>{item.recording_mime_type ?? '사용 불가'}</strong>
                          </div>
                          <div className="mini-card">
                            <span>검증 시각</span>
                            <strong>{formatDate(item.validated_at)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>경고 수</span>
                            <strong>{item.warning_flags.length}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel studio-block ops-panel" data-testid="validation-log-panel">
          <p className="eyebrow">검증 로그</p>
          <h2>실기기 브라우저 또는 하드웨어 검증 실행을 기록합니다</h2>
          <p className="panel__summary">
            환경 검증 프로토콜을 따라 점검한 뒤, 결과를 여기에 남겨 운영 화면, 릴리즈 노트, 브라우저
            지원 문구가 같은 증거를 보도록 만듭니다.
          </p>

          <form className="project-form" onSubmit={(event) => void handleCreateValidationRun(event)}>
            <div className="field-grid">
              <label className="field">
                <span>실행 이름</span>
                <input
                  className="text-input"
                  name="validationLabel"
                  value={validationFormState.label}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  placeholder="실기기 Safari 내장 스피커 점검"
                  required
                />
              </label>

              <label className="field">
                <span>테스터</span>
                <input
                  className="text-input"
                  name="tester"
                  value={validationFormState.tester}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      tester: event.target.value,
                    }))
                  }
                  placeholder="QA 담당"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>기기 이름</span>
                <input
                  className="text-input"
                  name="deviceName"
                  value={validationFormState.deviceName}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      deviceName: event.target.value,
                    }))
                  }
                  placeholder="MacBook Air 15"
                  required
                />
              </label>

              <label className="field">
                <span>검증 시각</span>
                <input
                  className="text-input"
                  type="datetime-local"
                  name="validatedAt"
                  value={validationFormState.validatedAt}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      validatedAt: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>운영체제</span>
                <input
                  className="text-input"
                  name="validationOs"
                  value={validationFormState.os}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      os: event.target.value,
                    }))
                  }
                  placeholder="macOS 15.4"
                  required
                />
              </label>

              <label className="field">
                <span>브라우저</span>
                <input
                  className="text-input"
                  name="validationBrowser"
                  value={validationFormState.browser}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      browser: event.target.value,
                    }))
                  }
                  placeholder="Safari 18"
                  required
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>입력 장치</span>
                <input
                  className="text-input"
                  name="inputDevice"
                  value={validationFormState.inputDevice}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      inputDevice: event.target.value,
                    }))
                  }
                  placeholder="내장 마이크"
                />
              </label>

              <label className="field">
                <span>출력 경로</span>
                <input
                  className="text-input"
                  name="outputRoute"
                  value={validationFormState.outputRoute}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      outputRoute: event.target.value,
                    }))
                  }
                  placeholder="내장 스피커"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>결과</span>
                <select
                  className="text-input"
                  name="outcome"
                  value={validationFormState.outcome}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      outcome: event.target.value as ValidationFormState['outcome'],
                    }))
                  }
                >
                  <option value="PASS">통과</option>
                  <option value="WARN">주의</option>
                  <option value="FAIL">실패</option>
                </select>
              </label>

              <label className="field">
                <span>경고 플래그</span>
                <input
                  className="text-input"
                  name="warningFlags"
                  value={validationFormState.warningFlagsText}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      warningFlagsText: event.target.value,
                    }))
                  }
                  placeholder="legacy_webkit_audio_context_only, missing_offline_audio_context"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>권한 요청 전 마이크 상태</span>
                <input
                  className="text-input"
                  name="permissionBefore"
                  value={validationFormState.microphonePermissionBefore}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      microphonePermissionBefore: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>권한 요청 후 마이크 상태</span>
                <input
                  className="text-input"
                  name="permissionAfter"
                  value={validationFormState.microphonePermissionAfter}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      microphonePermissionAfter: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>레코더 MIME</span>
                <input
                  className="text-input"
                  name="recordingMimeType"
                  value={validationFormState.recordingMimeType}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      recordingMimeType: event.target.value,
                    }))
                  }
                  placeholder="audio/webm"
                />
              </label>

              <label className="field">
                <span>기본 재생 경로</span>
                <input
                  className="text-input"
                  name="audioContextMode"
                  value={validationFormState.audioContextMode}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      audioContextMode: event.target.value,
                    }))
                  }
                  placeholder="표준 또는 호환"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>합치기 미리듣기 경로</span>
                <input
                  className="text-input"
                  name="offlineAudioContextMode"
                  value={validationFormState.offlineAudioContextMode}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      offlineAudioContextMode: event.target.value,
                    }))
                  }
                  placeholder="표준, 호환, 사용 불가"
                />
              </label>

              <label className="field">
                <span>샘플레이트 (Hz)</span>
                <input
                  className="text-input"
                  name="actualSampleRate"
                  inputMode="numeric"
                  value={validationFormState.actualSampleRate}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      actualSampleRate: event.target.value,
                    }))
                  }
                  placeholder="48000"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>기본 지연 (ms)</span>
                <input
                  className="text-input"
                  name="baseLatency"
                  inputMode="decimal"
                  value={validationFormState.baseLatencyMs}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      baseLatencyMs: event.target.value,
                    }))
                  }
                  placeholder="17"
                />
              </label>

              <label className="field">
                <span>출력 지연 (ms)</span>
                <input
                  className="text-input"
                  name="outputLatency"
                  inputMode="decimal"
                  value={validationFormState.outputLatencyMs}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      outputLatencyMs: event.target.value,
                    }))
                  }
                  placeholder="39"
                />
              </label>
            </div>

            <div className="ops-toggle-grid">
              <label className="ops-toggle">
                <input
                  type="checkbox"
                  checked={validationFormState.secureContext}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      secureContext: event.target.checked,
                    }))
                  }
                />
                <span>보안 컨텍스트</span>
              </label>
              <label className="ops-toggle">
                <input
                  type="checkbox"
                  checked={validationFormState.takeRecordingSucceeded}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      takeRecordingSucceeded: event.target.checked,
                    }))
                  }
                />
                <span>테이크 녹음 성공</span>
              </label>
              <label className="ops-toggle">
                <input
                  type="checkbox"
                  checked={validationFormState.analysisSucceeded}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      analysisSucceeded: event.target.checked,
                    }))
                  }
                />
                <span>분석 성공</span>
              </label>
              <label className="ops-toggle">
                <input
                  type="checkbox"
                  checked={validationFormState.playbackSucceeded}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      playbackSucceeded: event.target.checked,
                    }))
                  }
                />
                <span>재생 성공</span>
              </label>
            </div>

            <label className="field">
              <span>청감상 이슈</span>
              <textarea
                className="text-input text-input--textarea"
                name="audibleIssues"
                value={validationFormState.audibleIssues}
                onChange={(event) =>
                  setValidationFormState((current) => ({
                    ...current,
                    audibleIssues: event.target.value,
                  }))
                }
                placeholder="이 환경에서는 재생 미리듣기가 비활성 상태로 남았습니다."
              />
            </label>

            <label className="field">
              <span>권한 이슈</span>
              <textarea
                className="text-input text-input--textarea"
                name="permissionIssues"
                value={validationFormState.permissionIssues}
                onChange={(event) =>
                  setValidationFormState((current) => ({
                    ...current,
                    permissionIssues: event.target.value,
                  }))
                }
                placeholder="첫 권한 프롬프트 거절 후 새로고침이 필요했습니다."
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>예상 밖 경고</span>
                <textarea
                  className="text-input text-input--textarea"
                  name="unexpectedWarnings"
                  value={validationFormState.unexpectedWarnings}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      unexpectedWarnings: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>후속 작업</span>
                <textarea
                  className="text-input text-input--textarea"
                  name="followUp"
                  value={validationFormState.followUp}
                  onChange={(event) =>
                    setValidationFormState((current) => ({
                      ...current,
                      followUp: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label className="field">
              <span>메모</span>
              <textarea
                className="text-input text-input--textarea"
                name="validationNotes"
                value={validationFormState.notes}
                onChange={(event) =>
                  setValidationFormState((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="녹음은 가능했지만 재생은 환경 제약을 받았습니다."
              />
            </label>

            <button
              className="button-primary"
              type="submit"
              disabled={actionState.phase === 'submitting'}
            >
              {actionState.phase === 'submitting' ? '검증 실행 저장 중...' : '검증 실행 저장'}
            </button>
          </form>
        </article>

        <article className="panel studio-block ops-panel">
          <p className="eyebrow">최근 검증 실행</p>
          <h2>실기기 브라우저 점검을 진단 기준선 옆에서 바로 확인합니다</h2>

          <div className="ops-list">
            {validationRuns.length === 0 ? (
              <div className="empty-card empty-card--warn">
                <p>아직 수동 검증 실행 기록이 없습니다.</p>
                <p>테스트 후 이 폼으로 실기기 Safari 또는 하드웨어 실행 결과를 남겨 주세요.</p>
              </div>
            ) : (
              validationRuns.map((run) => (
                <article className="ops-card" key={run.validation_run_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{run.label}</strong>
                      <span>
                        {run.browser} / {run.os} | {run.device_name} | 검증{' '}
                        {formatDate(run.validated_at)}
                      </span>
                    </div>

                    <div
                      className={`status-pill ${
                        run.outcome === 'FAIL'
                          ? 'status-pill--error'
                          : run.outcome === 'WARN'
                            ? 'status-pill--loading'
                            : 'status-pill--ready'
                      }`}
                    >
                      {getValidationOutcomeLabel(run.outcome)}
                    </div>
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>테스터</span>
                      <strong>{run.tester ?? '미지정'}</strong>
                    </div>
                    <div className="mini-card">
                      <span>입력 / 출력</span>
                      <strong>
                        {run.input_device ?? '알 수 없음'} / {run.output_route ?? '알 수 없음'}
                      </strong>
                    </div>
                    <div className="mini-card">
                      <span>레코더 / 오디오</span>
                      <strong>
                        {run.recording_mime_type ?? '사용 불가'} / {run.audio_context_mode ?? '사용 불가'}
                      </strong>
                    </div>
                    <div className="mini-card">
                      <span>흐름 점검</span>
                      <strong>
                        녹음 {run.take_recording_succeeded ? '성공' : '실패'} / 분석{' '}
                        {run.analysis_succeeded ? '성공' : '실패'} / 재생{' '}
                        {run.playback_succeeded ? '성공' : '실패'}
                      </strong>
                    </div>
                  </div>

                  {run.warning_flags.length > 0 ? (
                    <div className="ops-chip-list">
                      {run.warning_flags.map((flag) => (
                        <span className="status-pill status-pill--loading" key={flag}>
                          {getBrowserAudioWarningLabel(flag)}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {run.follow_up ? <p className="status-card__hint">후속 작업: {run.follow_up}</p> : null}
                  {run.notes ? <p className="status-card__hint">{run.notes}</p> : null}
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section
        className={`section section--split ops-section ops-section--recovery ${
          workspaceMode === 'recovery' ? 'ops-workspace-panel ops-workspace-panel--active' : ''
        }`}
      >
        <article className="panel studio-block ops-panel">
          <p className="eyebrow">실패한 트랙</p>
          <h2>실패한 업로드와 처리 상태를 점검합니다</h2>

          <div className="ops-list">
            {payload.failed_tracks.length === 0 ? (
              <div className="empty-card">
                <p>현재 대기 중인 실패 트랙이 없습니다.</p>
                <p>업로드나 처리가 실패하면 이곳에 재시도 경로와 함께 표시됩니다.</p>
              </div>
            ) : (
              payload.failed_tracks.map((track) => (
                <article className="ops-card" key={track.track_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{track.project_title}</strong>
                      <span>
                        {getTrackRoleLabel(track.track_role)}
                        {track.take_no ? ` | ${track.take_no}번 테이크` : ''}
                      </span>
                    </div>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => void handleRetryProcessing(track.track_id)}
                    >
                      처리 재실행
                    </button>
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>상태</span>
                      <strong>{getTrackStatusLabel(track.track_status)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>형식</span>
                      <strong>{track.source_format ?? '알 수 없음'}</strong>
                    </div>
                    <div className="mini-card">
                      <span>업데이트</span>
                      <strong>{formatDate(track.updated_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>트랙 ID</span>
                      <strong>{track.track_id.slice(0, 8)}</strong>
                    </div>
                  </div>

                  <p className="form-error">
                    {track.failure_message ?? '저장된 오류 메시지 없이 실패한 트랙입니다.'}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="panel studio-block ops-panel">
          <p className="eyebrow">분석 작업</p>
          <h2>실패한 작업을 다시 실행하고 모델 사용 이력을 확인합니다</h2>

          <div className="ops-list">
            {payload.recent_analysis_jobs.length === 0 ? (
              <div className="empty-card">
                <p>아직 실행된 분석 작업이 없습니다.</p>
                <p>스튜디오에서 녹음 후 분석을 실행하면 이 목록이 채워집니다.</p>
              </div>
            ) : (
              payload.recent_analysis_jobs.map((job) => (
                <article className="ops-card" key={job.job_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{job.project_title}</strong>
                      <span>
                        {getTrackRoleLabel(job.track_role)}
                        {job.take_no ? ` | ${job.take_no}번 테이크` : ''} | {job.model_version}
                      </span>
                    </div>

                    {job.status === 'FAILED' ? (
                      <button
                        className="button-secondary button-secondary--small"
                        type="button"
                        onClick={() => void handleRetryAnalysis(job.job_id)}
                      >
                        작업 재실행
                      </button>
                    ) : (
                      <span className="status-card__hint">
                        {getAnalysisJobStatusLabel(job.status)}
                      </span>
                    )}
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>요청 시각</span>
                      <strong>{formatDate(job.requested_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>완료 시각</span>
                      <strong>{formatDate(job.finished_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>상태</span>
                      <strong>{getAnalysisJobStatusLabel(job.status)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>작업 ID</span>
                      <strong>{job.job_id.slice(0, 8)}</strong>
                    </div>
                  </div>

                  {job.error_message ? (
                    <p className="form-error">{job.error_message}</p>
                  ) : (
                    <p className="status-card__hint">
                      이 작업은 저장된 오류 메시지 없이 완료되었습니다.
                    </p>
                  )}
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="section ops-section ops-section--profiles">
        <div className="section__header ops-section__header">
          <p className="eyebrow">최근 프로필</p>
          <h2>가장 최근에 기록된 오디오 환경을 점검합니다</h2>
        </div>

        <div className="ops-list">
          {environmentDiagnostics.recent_profiles.length === 0 ? (
            <div className="empty-card empty-card--warn">
              <p>아직 최근 장치 기록이 없습니다.</p>
              <p>스튜디오에서 장치 기록을 저장한 뒤 여기로 돌아와 환경을 비교해 주세요.</p>
            </div>
          ) : (
            environmentDiagnostics.recent_profiles.map((profile) => (
              <article className="ops-card" key={profile.device_profile_id}>
                <div className="ops-card__header">
                  <div>
                    <strong>
                      {profile.browser} / {profile.os}
                    </strong>
                    <span>
                      {profile.output_route} | 저장 {formatDate(profile.updated_at)}
                    </span>
                  </div>

                  <div
                    className={`status-pill ${
                      profile.warning_flags.length > 0 ? 'status-pill--loading' : 'status-pill--ready'
                    }`}
                  >
                    {profile.warning_flags.length > 0
                      ? `경고 ${profile.warning_flags.length}개`
                      : '경고 없음'}
                  </div>
                </div>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>마이크 권한</span>
                    <strong>{profile.microphone_permission ?? '알 수 없음'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>녹음 형식</span>
                    <strong>{profile.recording_mime_type ?? '사용 불가'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>브라우저 재생 경로</span>
                    <strong>{formatAudioRouteLabel(profile.audio_context_mode)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>브라우저 안 합치기</span>
                    <strong>{formatAudioRouteLabel(profile.offline_audio_context_mode)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>샘플레이트</span>
                    <strong>
                      {profile.actual_sample_rate ? `${profile.actual_sample_rate} Hz` : '사용 불가'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>지연</span>
                    <strong>
                      입력 {formatLatency(profile.base_latency)} / 출력{' '}
                      {formatLatency(profile.output_latency)}
                    </strong>
                  </div>
                </div>

                {profile.browser_user_agent ? (
                  <p className="status-card__hint">{profile.browser_user_agent}</p>
                ) : null}

                {profile.warning_flags.length > 0 ? (
                  <div className="ops-chip-list">
                    {profile.warning_flags.map((flag) => (
                      <span className="status-pill status-pill--loading" key={flag}>
                        {getBrowserAudioWarningLabel(flag)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="status-card__hint">
                    이 환경에는 현재 저장된 브라우저 오디오 경고가 없습니다.
                  </p>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
