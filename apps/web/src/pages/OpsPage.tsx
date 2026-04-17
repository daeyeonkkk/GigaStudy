import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'

import './OpsPage.css'

import { buildApiUrl, normalizeRequestError, readApiErrorMessage } from '../lib/api'
import { getBrowserAudioWarningLabel } from '../lib/browserAudioDiagnostics'
import {
  getAnalysisJobStatusLabel,
  getTrackRoleLabel,
  getTrackStatusLabel,
  getValidationOutcomeLabel,
} from '../lib/localizedLabels'

type RuntimeEvent = {
  runtime_event_id: string
  severity: string
  event_type: string
  message: string
  project_id: string | null
  track_id: string | null
  route_path: string | null
  surface: string | null
  request_id: string | null
  request_method: string | null
  request_path: string | null
  status_code: number | null
  details: Record<string, unknown> | unknown[] | null
  created_at: string
}

type ClaimGate = {
  release_claim_ready: boolean
  summary_message: string
  checks: Array<{
    key: string
    passed: boolean
    actual: string
    expected: string
    message: string
  }>
  next_actions: string[]
}

type ValidationRun = {
  validation_run_id: string
  label: string
  tester: string | null
  device_name: string
  os: string
  browser: string
  outcome: 'PASS' | 'WARN' | 'FAIL'
  input_device: string | null
  output_route: string | null
  warning_flags: string[]
  take_recording_succeeded: boolean | null
  analysis_succeeded: boolean | null
  playback_succeeded: boolean | null
  audible_issues: string | null
  permission_issues: string | null
  unexpected_warnings: string | null
  follow_up: string | null
  notes: string | null
  actual_sample_rate: number | null
  base_latency: number | null
  output_latency: number | null
  recording_mime_type: string | null
  audio_context_mode: string | null
  offline_audio_context_mode: string | null
  validated_at: string
}

type ImportPreviewItem = {
  label: string
  device_name: string
  os: string
  browser: string
  outcome: 'PASS' | 'WARN' | 'FAIL'
  take_recording_succeeded: boolean | null
  analysis_succeeded: boolean | null
  playback_succeeded: boolean | null
  validated_at: string
}

type ImportPreview = {
  item_count: number
  items: ImportPreviewItem[]
}

type FailedTrack = {
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

type AnalysisJob = {
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

type AudioProfile = {
  device_profile_id: string
  browser: string
  os: string
  browser_user_agent: string | null
  output_route: string
  actual_sample_rate: number | null
  base_latency: number | null
  output_latency: number | null
  recording_mime_type: string | null
  audio_context_mode: string | null
  offline_audio_context_mode: string | null
  warning_flags: string[]
  updated_at: string
}

type OpsOverview = {
  summary: {
    failed_track_count: number
    failed_analysis_job_count: number
  }
  recent_runtime_events: RuntimeEvent[]
  environment_claim_gate: ClaimGate
  recent_environment_validation_runs: ValidationRun[]
  failed_tracks: FailedTrack[]
  recent_analysis_jobs: AnalysisJob[]
  environment_diagnostics: {
    recent_profiles: AudioProfile[]
  }
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

type RuntimeRange = '24h' | '3d' | '7d' | '30d'
type RuntimeSeverity = 'all' | 'error' | 'warn'
type DrawerState =
  | null
  | { kind: 'release' }
  | { kind: 'runtime'; id: string }
  | { kind: 'validation'; id: string }
  | { kind: 'job'; id: string }
  | { kind: 'profile'; id: string }

const runtimeRanges: Array<{ value: RuntimeRange; label: string }> = [
  { value: '24h', label: '24시간' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
]

const runtimeSeverities: Array<{ value: RuntimeSeverity; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'error', label: 'error' },
  { value: 'warn', label: 'warn' },
]

function formatDateTime(value: string | null, fallback = '-'): string {
  return value ? new Date(value).toLocaleString('ko-KR') : fallback
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '-'
  }

  return `${Math.round(value * 1000)} ms`
}

function formatAudioMode(value: string | null): string {
  if (!value || value === 'unavailable') {
    return '-'
  }
  if (value === 'standard') {
    return '표준'
  }
  if (value === 'webkit') {
    return 'WebKit'
  }
  return value
}

function getHours(range: RuntimeRange): number {
  return range === '24h' ? 24 : range === '3d' ? 72 : range === '7d' ? 168 : 720
}

function inRange(value: string, range: RuntimeRange): boolean {
  const timestamp = new Date(value).getTime()
  return !Number.isNaN(timestamp) && Date.now() - timestamp <= getHours(range) * 60 * 60 * 1000
}

function runtimeEventLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim()
}

function runtimePageLabel(item: RuntimeEvent): string {
  return item.route_path ?? item.surface ?? item.request_path ?? '-'
}

function badgeClass(kind: 'default' | 'success' | 'warning' | 'error'): string {
  return `ops-v2-badge${kind === 'default' ? '' : ` ops-v2-badge--${kind}`}`
}

function buildLabel(): string {
  if (typeof window !== 'undefined' && window.location.hostname.includes('pages.dev')) {
    return 'main / alpha'
  }

  return import.meta.env.DEV ? 'local / development' : 'main / production'
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadText(filename: string, payload: string, type = 'text/plain'): void {
  const blob = new Blob([payload], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function previewCount(preview: ImportPreview | null, outcome: ImportPreviewItem['outcome']): number {
  return preview ? preview.items.filter((item) => item.outcome === outcome).length : 0
}

function validationSummary(item: {
  take_recording_succeeded: boolean | null
  analysis_succeeded: boolean | null
  playback_succeeded: boolean | null
}): string {
  return [
    item.take_recording_succeeded ? '녹음 통과' : '녹음 점검',
    item.analysis_succeeded ? '분석 통과' : '분석 점검',
    item.playback_succeeded ? '재생 통과' : '재생 점검',
  ].join(' / ')
}

export function OpsPage() {
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' })
  const [actionState, setActionState] = useState<ActionState>({ phase: 'idle' })
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [runtimeRange, setRuntimeRange] = useState<RuntimeRange>('24h')
  const [runtimeSeverity, setRuntimeSeverity] = useState<RuntimeSeverity>('all')
  const [drawerState, setDrawerState] = useState<DrawerState>(null)
  const [isImportModalOpen, setImportModalOpen] = useState(false)
  const [validationImportText, setValidationImportText] = useState('')
  const [validationImportPreview, setValidationImportPreview] = useState<ImportPreview | null>(null)
  const [selectedImportFileName, setSelectedImportFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function loadOverview(signal?: AbortSignal): Promise<void> {
    try {
      const response = await fetch(buildApiUrl('/api/admin/ops'), { signal })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '운영 개요를 불러올 수 없습니다.'))
      }

      const payload = (await response.json()) as OpsOverview
      setPageState({ phase: 'ready', payload })
      setLastRefreshedAt(new Date().toISOString())
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      setPageState({
        phase: 'error',
        message: normalizeRequestError(
          error,
          '운영 개요를 불러올 수 없습니다.',
          '지금은 운영 서비스에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
        ),
      })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadOverview(controller.signal)
    return () => controller.abort()
  }, [])

  async function handleRetryProcessing(trackId: string): Promise<void> {
    setActionState({ phase: 'submitting', message: '실패 업로드를 다시 처리하는 중입니다...' })

    try {
      const response = await fetch(buildApiUrl(`/api/tracks/${trackId}/retry-processing`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '업로드 재처리를 시작하지 못했습니다.'))
      }
      await loadOverview()
      setActionState({ phase: 'success', message: '실패 업로드를 다시 큐에 올렸습니다.' })
      setDrawerState(null)
    } catch (error) {
      setActionState({
        phase: 'error',
        message: normalizeRequestError(error, '업로드 재처리를 시작하지 못했습니다.'),
      })
    }
  }

  async function handleRetryAnalysis(jobId: string): Promise<void> {
    setActionState({ phase: 'submitting', message: '분석 작업을 다시 실행하는 중입니다...' })

    try {
      const response = await fetch(buildApiUrl(`/api/analysis-jobs/${jobId}/retry`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '분석 재실행을 시작하지 못했습니다.'))
      }
      await loadOverview()
      setActionState({ phase: 'success', message: '분석 작업을 다시 큐에 올렸습니다.' })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: normalizeRequestError(error, '분석 재실행을 시작하지 못했습니다.'),
      })
    }
  }

  async function handleDownloadReleaseGate(): Promise<void> {
    setActionState({ phase: 'submitting', message: '릴리즈 게이트 문서를 준비하는 중입니다...' })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validation-claim-gate.md'))
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '릴리즈 게이트 문서를 내려받지 못했습니다.'))
      }

      const payload = await response.text()
      downloadText(`gigastudy-release-gate-${new Date().toISOString().slice(0, 10)}.md`, payload, 'text/markdown')
      setActionState({ phase: 'success', message: '릴리즈 게이트 문서를 내려받았습니다.' })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: normalizeRequestError(error, '릴리즈 게이트 문서를 내려받지 못했습니다.'),
      })
    }
  }

  async function handleValidationFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setSelectedImportFileName(file.name)
    setValidationImportPreview(null)
    setValidationImportText(await file.text())
    setActionState({ phase: 'success', message: `${file.name} 파일을 불러왔습니다. 미리 보기로 확인해 주세요.` })
    event.target.value = ''
  }

  async function handlePreviewValidationImport(): Promise<void> {
    if (!validationImportText.trim()) {
      setActionState({ phase: 'error', message: '가져올 CSV 파일을 먼저 선택해 주세요.' })
      return
    }

    setActionState({ phase: 'submitting', message: '검증 CSV를 미리 분석하는 중입니다...' })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validations/import-preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv_text: validationImportText }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '검증 CSV 미리 보기를 불러오지 못했습니다.'))
      }

      const payload = (await response.json()) as ImportPreview
      setValidationImportPreview(payload)
      setActionState({
        phase: 'success',
        message: payload.item_count > 0 ? `검증 ${payload.item_count}건을 확인했습니다.` : '가져올 검증 행이 없습니다.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: normalizeRequestError(error, '검증 CSV 미리 보기를 불러오지 못했습니다.'),
      })
    }
  }

  async function handleSubmitValidationImport(): Promise<void> {
    if (!validationImportText.trim()) {
      setActionState({ phase: 'error', message: '가져올 CSV 파일을 먼저 선택해 주세요.' })
      return
    }

    if (!validationImportPreview || validationImportPreview.item_count === 0) {
      setActionState({ phase: 'error', message: '가져오기 전에 미리 보기로 검증 행을 확인해 주세요.' })
      return
    }

    setActionState({ phase: 'submitting', message: '검증 로그를 가져오는 중입니다...' })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validations/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv_text: validationImportText }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '검증 CSV를 가져오지 못했습니다.'))
      }

      await response.json()
      await loadOverview()
      setImportModalOpen(false)
      setSelectedImportFileName(null)
      setValidationImportText('')
      setValidationImportPreview(null)
      setActionState({ phase: 'success', message: '검증 로그를 가져왔습니다.' })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: normalizeRequestError(error, '검증 CSV를 가져오지 못했습니다.'),
      })
    }
  }

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell ops-v2-route">
        <section className="ops-v2-state">
          <p className="ops-v2-state__eyebrow">OPERATIONS</p>
          <h1>운영 개요를 불러오는 중입니다.</h1>
          <p>런타임 로그, 검증 로그, 실패 작업 상태를 한 화면에 모으고 있습니다.</p>
        </section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell ops-v2-route">
        <section className="ops-v2-state ops-v2-state--error">
          <p className="ops-v2-state__eyebrow">OPERATIONS</p>
          <h1>운영 개요를 불러올 수 없습니다.</h1>
          <p className="ops-v2-message ops-v2-message--error">{pageState.message}</p>
          <div className="ops-v2-inline-actions">
            <button className="ops-v2-button" type="button" onClick={() => void loadOverview()}>
              다시 불러오기
            </button>
            <Link className="ops-v2-button ops-v2-button--ghost" to="/">
              런치로 돌아가기
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const payload = pageState.payload
  const gate = payload.environment_claim_gate
  const runtimeRows = payload.recent_runtime_events.filter((item) => {
    if (!inRange(item.created_at, runtimeRange)) {
      return false
    }

    if (runtimeSeverity === 'all') {
      return true
    }

    return item.severity === runtimeSeverity
  })
  const runtimeErrorsToday = payload.recent_runtime_events.filter(
    (item) => item.severity === 'error' && inRange(item.created_at, '24h'),
  ).length
  const validationRunsThisWeek = payload.recent_environment_validation_runs.filter((item) =>
    inRange(item.validated_at, '7d'),
  ).length
  const runtimeDetail =
    drawerState?.kind === 'runtime'
      ? payload.recent_runtime_events.find((item) => item.runtime_event_id === drawerState.id) ?? null
      : null
  const validationDetail =
    drawerState?.kind === 'validation'
      ? payload.recent_environment_validation_runs.find((item) => item.validation_run_id === drawerState.id) ?? null
      : null
  const jobDetail =
    drawerState?.kind === 'job'
      ? payload.recent_analysis_jobs.find((item) => item.job_id === drawerState.id) ?? null
      : null
  const profileDetail =
    drawerState?.kind === 'profile'
      ? payload.environment_diagnostics.recent_profiles.find(
          (item) => item.device_profile_id === drawerState.id,
        ) ?? null
      : null

  return (
    <div className="page-shell ops-v2-route">
      <input
        ref={fileInputRef}
        className="ops-v2-hidden-file"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => void handleValidationFileChange(event)}
      />

      <section className="ops-v2-shell">
        <header className="ops-v2-header">
          <div>
            <h1>운영 개요와 릴리즈 게이트</h1>
            <p>last refresh {formatDateTime(lastRefreshedAt, '방금 연결')}</p>
          </div>
          <div className="ops-v2-header__actions">
            <button className="ops-v2-button" type="button" onClick={() => void loadOverview()}>
              새로고침
            </button>
            <button className="ops-v2-button" type="button" onClick={() => void handleDownloadReleaseGate()}>
              릴리즈 게이트 내려받기
            </button>
            <button className="ops-v2-button ops-v2-button--primary" type="button" onClick={() => setImportModalOpen(true)}>
              검증 가져오기
            </button>
          </div>
        </header>

        {actionState.phase !== 'idle' ? (
          <p className={`ops-v2-message ${actionState.phase === 'error' ? 'ops-v2-message--error' : 'ops-v2-message--status'}`}>
            {actionState.message}
          </p>
        ) : null}

        <section className="ops-v2-kpis">
          <article className="ops-v2-kpi">
            <span>release claim readiness</span>
            <strong>{gate.release_claim_ready ? '통과' : '주의'}</strong>
            <em className={badgeClass(gate.release_claim_ready ? 'success' : 'warning')}>
              {gate.release_claim_ready ? 'pass' : 'warning'}
            </em>
          </article>
          <article className="ops-v2-kpi">
            <span>runtime errors today</span>
            <strong>{runtimeErrorsToday}</strong>
          </article>
          <article className="ops-v2-kpi">
            <span>validation runs this week</span>
            <strong>{validationRunsThisWeek}</strong>
          </article>
          <article className="ops-v2-kpi">
            <span>failed uploads</span>
            <strong>{payload.summary.failed_track_count}</strong>
          </article>
          <article className="ops-v2-kpi">
            <span>failed analysis jobs</span>
            <strong>{payload.summary.failed_analysis_job_count}</strong>
          </article>
        </section>

        <div className="ops-v2-main-grid">
          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Runtime logs</h2>
              <div className="ops-v2-panel__controls">
                <select value={runtimeRange} onChange={(event) => setRuntimeRange(event.target.value as RuntimeRange)}>
                  {runtimeRanges.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <div className="ops-v2-tabs" role="tablist" aria-label="로그 심각도">
                  {runtimeSeverities.map((item) => (
                    <button
                      key={item.value}
                      className={`ops-v2-tab ${runtimeSeverity === item.value ? 'ops-v2-tab--active' : ''}`}
                      type="button"
                      onClick={() => setRuntimeSeverity(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <table className="ops-v2-table">
              <thead>
                <tr>
                  <th>timestamp</th>
                  <th>page</th>
                  <th>event</th>
                  <th>severity</th>
                  <th>detail</th>
                </tr>
              </thead>
              <tbody>
                {runtimeRows.length > 0 ? (
                  runtimeRows.slice(0, 8).map((item) => (
                    <tr key={item.runtime_event_id}>
                      <td>{formatClock(item.created_at)}</td>
                      <td>{runtimePageLabel(item)}</td>
                      <td>{runtimeEventLabel(item.event_type)}</td>
                      <td>
                        <span className={badgeClass(item.severity === 'error' ? 'error' : item.severity === 'warn' ? 'warning' : 'default')}>
                          {item.severity}
                        </span>
                      </td>
                      <td>
                        <button className="ops-v2-text-button" type="button" onClick={() => setDrawerState({ kind: 'runtime', id: item.runtime_event_id })}>
                          상세 보기
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="ops-v2-empty">선택한 범위에서 확인할 로그가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </article>

          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Release gate</h2>
            </div>
            <div className="ops-v2-release">
              <p>{gate.summary_message}</p>
              <div className="ops-v2-release__build">
                <span>latest build</span>
                <strong>{buildLabel()}</strong>
              </div>
            </div>
            <ul className="ops-v2-list">
              {gate.checks.map((check) => (
                <li key={check.key}>
                  <span>{runtimeEventLabel(check.key)}</span>
                  <strong className={check.passed ? 'ops-v2-pass' : 'ops-v2-open'}>
                    {check.passed ? 'pass' : 'open'}
                  </strong>
                </li>
              ))}
            </ul>
            <div className="ops-v2-inline-actions">
              <button className="ops-v2-button" type="button" onClick={() => downloadJson(`gigastudy-release-gate-${new Date().toISOString().slice(0, 10)}.json`, gate)}>
                게이트 JSON 받기
              </button>
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => setDrawerState({ kind: 'release' })}>
                상세 조건 보기
              </button>
            </div>
          </article>

          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Validation import</h2>
            </div>
            <div className="ops-v2-inline-actions">
              <a className="ops-v2-button ops-v2-button--ghost" download="gigastudy-environment-validation-starter-pack.zip" href={buildApiUrl('/api/admin/environment-validations/template')}>
                템플릿 받기
              </a>
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
                파일 선택
              </button>
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => void handlePreviewValidationImport()} disabled={!validationImportText.trim()}>
                미리 보기
              </button>
              <button className="ops-v2-button ops-v2-button--primary" type="button" onClick={() => setImportModalOpen(true)} disabled={!validationImportText.trim()}>
                가져오기
              </button>
            </div>
            <p className="ops-v2-hint">
              {selectedImportFileName ? `selected file ${selectedImportFileName}` : 'selected file 없음'}
            </p>
            {validationImportPreview ? (
              <>
                <div className="ops-v2-preview">
                  <span>rows {validationImportPreview.item_count}</span>
                  <span>pass {previewCount(validationImportPreview, 'PASS')}</span>
                  <span>warn {previewCount(validationImportPreview, 'WARN')}</span>
                  <span>fail {previewCount(validationImportPreview, 'FAIL')}</span>
                </div>
                <ul className="ops-v2-list ops-v2-list--stack">
                  {validationImportPreview.items.slice(0, 3).map((item, index) => (
                    <li key={`${item.label}-${item.validated_at}-${index}`}>
                      <span>{item.browser} / {item.os}</span>
                      <strong>{item.label}</strong>
                      <em>{getValidationOutcomeLabel(item.outcome)}</em>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="ops-v2-hint">CSV를 선택한 뒤 미리 보기로 파싱 결과를 먼저 확인합니다.</p>
            )}
          </article>

          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Validation log</h2>
            </div>
            <table className="ops-v2-table">
              <thead>
                <tr>
                  <th>environment</th>
                  <th>result</th>
                  <th>validated at</th>
                  <th>detail</th>
                </tr>
              </thead>
              <tbody>
                {payload.recent_environment_validation_runs.length > 0 ? (
                  payload.recent_environment_validation_runs.slice(0, 6).map((item) => (
                    <tr key={item.validation_run_id}>
                      <td>{item.browser} / {item.os} / {item.device_name}</td>
                      <td>
                        <span className={badgeClass(item.outcome === 'PASS' ? 'success' : item.outcome === 'FAIL' ? 'error' : 'warning')}>
                          {getValidationOutcomeLabel(item.outcome)}
                        </span>
                      </td>
                      <td>{formatDateTime(item.validated_at)}</td>
                      <td>
                        <button className="ops-v2-text-button" type="button" onClick={() => setDrawerState({ kind: 'validation', id: item.validation_run_id })}>
                          실행 상세
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="ops-v2-empty">검증 로그가 아직 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </article>
        </div>

        <div className="ops-v2-footer-grid">
          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Failed tracks</h2>
            </div>
            <ul className="ops-v2-rows">
              {payload.failed_tracks.length > 0 ? (
                payload.failed_tracks.slice(0, 6).map((item) => (
                  <li key={item.track_id}>
                    <div>
                      <strong>
                        {item.project_title} / {getTrackRoleLabel(item.track_role)}
                        {item.take_no ? ` ${item.take_no}번` : ''}
                      </strong>
                      <span>
                        {getTrackStatusLabel(item.track_status)} / {item.source_format ?? '형식 없음'} / {formatClock(item.updated_at)}
                      </span>
                    </div>
                    <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => void handleRetryProcessing(item.track_id)}>
                      다시 시도
                    </button>
                  </li>
                ))
              ) : (
                <li className="ops-v2-empty-row">실패 업로드가 없습니다.</li>
              )}
            </ul>
          </article>

          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Analysis jobs</h2>
            </div>
            <ul className="ops-v2-rows">
              {payload.recent_analysis_jobs.length > 0 ? (
                payload.recent_analysis_jobs.slice(0, 6).map((item) => (
                  <li key={item.job_id}>
                    <div>
                      <strong>{item.job_id}</strong>
                      <span>
                        {item.model_version} / {getAnalysisJobStatusLabel(item.status)} / {formatDateTime(item.requested_at)}
                      </span>
                    </div>
                    <div className="ops-v2-inline-actions">
                      <button className="ops-v2-text-button" type="button" onClick={() => setDrawerState({ kind: 'job', id: item.job_id })}>
                        기록 보기
                      </button>
                      {item.status === 'FAILED' ? (
                        <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => void handleRetryAnalysis(item.job_id)}>
                          재실행
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))
              ) : (
                <li className="ops-v2-empty-row">최근 분석 작업이 없습니다.</li>
              )}
            </ul>
          </article>

          <article className="ops-v2-panel">
            <div className="ops-v2-panel__header">
              <h2>Latest audio profiles</h2>
            </div>
            <ul className="ops-v2-rows">
              {payload.environment_diagnostics.recent_profiles.length > 0 ? (
                payload.environment_diagnostics.recent_profiles.slice(0, 6).map((item) => (
                  <li key={item.device_profile_id}>
                    <div>
                      <strong>{item.browser} / {item.os}</strong>
                      <span>
                        {item.actual_sample_rate ? `${item.actual_sample_rate} Hz` : 'sample rate 없음'} /{' '}
                        {item.warning_flags.length > 0 ? `${item.warning_flags.length}개 warning` : 'warning 없음'}
                      </span>
                    </div>
                    <button className="ops-v2-text-button" type="button" onClick={() => setDrawerState({ kind: 'profile', id: item.device_profile_id })}>
                      프로필 상세
                    </button>
                  </li>
                ))
              ) : (
                <li className="ops-v2-empty-row">최근 장치 프로필이 없습니다.</li>
              )}
            </ul>
          </article>
        </div>
      </section>

      {isImportModalOpen ? (
        <div className="ops-v2-overlay" role="presentation" onClick={() => setImportModalOpen(false)}>
          <section className="ops-v2-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="ops-v2-surface-header">
              <div>
                <p>검증 가져오기</p>
                <h2>Validation import</h2>
              </div>
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => setImportModalOpen(false)}>
                닫기
              </button>
            </header>
            <div className="ops-v2-surface-body">
              <div className="ops-v2-detail-grid">
                <div>
                  <span>file</span>
                  <strong>{selectedImportFileName ?? '선택되지 않음'}</strong>
                </div>
                <div>
                  <span>preview</span>
                  <strong>{validationImportPreview ? `${validationImportPreview.item_count} rows` : '아직 없음'}</strong>
                </div>
              </div>
              <div className="ops-v2-inline-actions ops-v2-inline-actions--spaced">
                <a className="ops-v2-button ops-v2-button--ghost" download="gigastudy-environment-validation-starter-pack.zip" href={buildApiUrl('/api/admin/environment-validations/template')}>
                  템플릿 받기
                </a>
                <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
                  파일 선택
                </button>
                <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => void handlePreviewValidationImport()} disabled={!validationImportText.trim()}>
                  미리 보기
                </button>
              </div>
              {validationImportPreview ? (
                <>
                  <div className="ops-v2-preview">
                    <span>rows {validationImportPreview.item_count}</span>
                    <span>pass {previewCount(validationImportPreview, 'PASS')}</span>
                    <span>warn {previewCount(validationImportPreview, 'WARN')}</span>
                    <span>fail {previewCount(validationImportPreview, 'FAIL')}</span>
                  </div>
                  <ul className="ops-v2-rows ops-v2-rows--tight">
                    {validationImportPreview.items.slice(0, 5).map((item, index) => (
                      <li key={`${item.label}-${item.validated_at}-${index}`}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>
                            {item.browser} / {item.os} / {item.device_name}
                          </span>
                        </div>
                        <div>
                          <strong>{getValidationOutcomeLabel(item.outcome)}</strong>
                          <span>{validationSummary(item)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="ops-v2-hint">미리 보기를 실행하면 가져올 검증 행이 여기에 나타납니다.</p>
              )}
              <div className="ops-v2-warning">
                <strong>overwrite warning</strong>
                <p>같은 실행 이름과 시각을 가진 항목이 있으면 최신 가져오기 값으로 다시 정리됩니다.</p>
              </div>
            </div>
            <footer className="ops-v2-surface-footer">
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => setImportModalOpen(false)}>
                취소
              </button>
              <button className="ops-v2-button ops-v2-button--primary" type="button" onClick={() => void handleSubmitValidationImport()} disabled={!validationImportPreview || validationImportPreview.item_count === 0}>
                가져오기
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {drawerState ? (
        <div className="ops-v2-overlay" role="presentation" onClick={() => setDrawerState(null)}>
          <aside className="ops-v2-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="ops-v2-surface-header">
              <div>
                <p>
                  {drawerState.kind === 'release'
                    ? '릴리즈 게이트'
                    : drawerState.kind === 'runtime'
                      ? '로그 상세'
                      : drawerState.kind === 'validation'
                        ? '검증 상세'
                        : drawerState.kind === 'job'
                          ? '작업 상세'
                          : '프로필 상세'}
                </p>
                <h2>
                  {drawerState.kind === 'release'
                    ? '게이트 상세 조건'
                    : drawerState.kind === 'runtime'
                      ? runtimeDetail?.message ?? '로그 상세'
                      : drawerState.kind === 'validation'
                        ? validationDetail?.label ?? '검증 상세'
                        : drawerState.kind === 'job'
                          ? jobDetail?.job_id ?? '작업 상세'
                          : profileDetail?.browser ?? '프로필 상세'}
                </h2>
              </div>
              <button className="ops-v2-button ops-v2-button--ghost" type="button" onClick={() => setDrawerState(null)}>
                닫기
              </button>
            </header>
            <div className="ops-v2-surface-body">
              {drawerState.kind === 'release' ? (
                <>
                  <ul className="ops-v2-rows ops-v2-rows--tight">
                    {gate.checks.map((item) => (
                      <li key={item.key}>
                        <div>
                          <strong>{runtimeEventLabel(item.key)}</strong>
                          <span>{item.actual} vs {item.expected}</span>
                        </div>
                        <div>
                          <strong>{item.passed ? 'pass' : 'open'}</strong>
                          <span>{item.message}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <ul className="ops-v2-bullets">
                    {gate.next_actions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {runtimeDetail ? (
                <>
                  <div className="ops-v2-detail-grid">
                    <div><span>route</span><strong>{runtimePageLabel(runtimeDetail)}</strong></div>
                    <div><span>severity</span><strong>{runtimeDetail.severity}</strong></div>
                    <div><span>request</span><strong>{runtimeDetail.request_method && runtimeDetail.request_path ? `${runtimeDetail.request_method} ${runtimeDetail.request_path}` : '-'}</strong></div>
                    <div><span>status</span><strong>{runtimeDetail.status_code ?? '-'}</strong></div>
                    <div><span>project id</span><strong>{runtimeDetail.project_id ?? '-'}</strong></div>
                    <div><span>track id</span><strong>{runtimeDetail.track_id ?? '-'}</strong></div>
                  </div>
                  <pre className="ops-v2-code">{runtimeDetail.details ? JSON.stringify(runtimeDetail.details, null, 2) : '세부 payload가 없습니다.'}</pre>
                </>
              ) : null}

              {validationDetail ? (
                <>
                  <div className="ops-v2-detail-grid">
                    <div><span>browser</span><strong>{validationDetail.browser}</strong></div>
                    <div><span>hardware</span><strong>{validationDetail.device_name}</strong></div>
                    <div><span>result</span><strong>{getValidationOutcomeLabel(validationDetail.outcome)}</strong></div>
                    <div><span>validated at</span><strong>{formatDateTime(validationDetail.validated_at)}</strong></div>
                    <div><span>latency</span><strong>in {formatLatency(validationDetail.base_latency)} / out {formatLatency(validationDetail.output_latency)}</strong></div>
                    <div><span>mime / audio</span><strong>{validationDetail.recording_mime_type ?? '-'} / {formatAudioMode(validationDetail.audio_context_mode)}</strong></div>
                  </div>
                  {validationDetail.warning_flags.length > 0 ? (
                    <div className="ops-v2-chips">
                      {validationDetail.warning_flags.map((item) => (
                        <span className={badgeClass('warning')} key={item}>{getBrowserAudioWarningLabel(item)}</span>
                      ))}
                    </div>
                  ) : null}
                  <ul className="ops-v2-bullets">
                    {[validationDetail.follow_up, validationDetail.audible_issues, validationDetail.permission_issues, validationDetail.unexpected_warnings, validationDetail.notes]
                      .filter(Boolean)
                      .map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                  </ul>
                </>
              ) : null}

              {jobDetail ? (
                <>
                  <div className="ops-v2-detail-grid">
                    <div><span>job id</span><strong>{jobDetail.job_id}</strong></div>
                    <div><span>model version</span><strong>{jobDetail.model_version}</strong></div>
                    <div><span>status</span><strong>{getAnalysisJobStatusLabel(jobDetail.status)}</strong></div>
                    <div><span>requested</span><strong>{formatDateTime(jobDetail.requested_at)}</strong></div>
                    <div><span>project id</span><strong>{jobDetail.project_id}</strong></div>
                    <div><span>track id</span><strong>{jobDetail.track_id}</strong></div>
                  </div>
                  <pre className="ops-v2-code">{jobDetail.error_message ?? 'stderr 정보가 없습니다.'}</pre>
                </>
              ) : null}

              {profileDetail ? (
                <>
                  <div className="ops-v2-detail-grid">
                    <div><span>device name</span><strong>{profileDetail.browser} / {profileDetail.os}</strong></div>
                    <div><span>sample rate</span><strong>{profileDetail.actual_sample_rate ? `${profileDetail.actual_sample_rate} Hz` : '-'}</strong></div>
                    <div><span>channel count</span><strong>데이터 없음</strong></div>
                    <div><span>latency</span><strong>in {formatLatency(profileDetail.base_latency)} / out {formatLatency(profileDetail.output_latency)}</strong></div>
                    <div><span>route</span><strong>{formatAudioMode(profileDetail.output_route)}</strong></div>
                    <div><span>audio mode</span><strong>{formatAudioMode(profileDetail.audio_context_mode)} / {formatAudioMode(profileDetail.offline_audio_context_mode)}</strong></div>
                  </div>
                  {profileDetail.warning_flags.length > 0 ? (
                    <div className="ops-v2-chips">
                      {profileDetail.warning_flags.map((item) => (
                        <span className={badgeClass('warning')} key={item}>{getBrowserAudioWarningLabel(item)}</span>
                      ))}
                    </div>
                  ) : null}
                  {profileDetail.browser_user_agent ? <pre className="ops-v2-code">{profileDetail.browser_user_agent}</pre> : null}
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
