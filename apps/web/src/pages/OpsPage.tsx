import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { buildApiUrl } from '../lib/api'
import { getBrowserAudioWarningLabel } from '../lib/browserAudioDiagnostics'

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
    return 'Not finished'
  }

  return new Date(value).toLocaleString()
}

function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'Unavailable'
  }

  return `${Math.round(value * 1000)} ms`
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
  const [validationFormState, setValidationFormState] = useState<ValidationFormState>(
    initialValidationFormState,
  )

  async function loadOverview(signal?: AbortSignal): Promise<void> {
    try {
      const response = await fetch(buildApiUrl('/api/admin/ops'), { signal })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to load ops overview.'))
      }

      const payload = (await response.json()) as OpsOverview
      setPageState({ phase: 'ready', payload })
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      setPageState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to load ops overview.',
      })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadOverview(controller.signal)
    return () => controller.abort()
  }, [])

  async function handleRetryProcessing(trackId: string): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: 'Retrying track processing and refreshing the overview...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/tracks/${trackId}/retry-processing`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Track processing retry failed.'))
      }

      await loadOverview()
      setActionState({
        phase: 'success',
        message: 'Track processing retry finished. The overview has been refreshed.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Track processing retry failed.',
      })
    }
  }

  async function handleRetryAnalysis(jobId: string): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: 'Retrying the failed analysis job...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/analysis-jobs/${jobId}/retry`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Analysis job retry failed.'))
      }

      await loadOverview()
      setActionState({
        phase: 'success',
        message: 'Analysis job retried successfully and the overview was refreshed.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Analysis job retry failed.',
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
      message:
        'Environment diagnostics report downloaded. Use it as the baseline for native hardware validation.',
    })
  }

  async function handleDownloadValidationPacket(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: 'Building the environment validation packet from saved diagnostics and manual runs...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validation-packet'))
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to build the environment validation packet.'))
      }

      const payload = (await response.json()) as EnvironmentValidationPacket
      const dateToken = new Date().toISOString().slice(0, 10)
      downloadJsonReport(`gigastudy-environment-validation-packet-${dateToken}.json`, payload)
      setActionState({
        phase: 'success',
        message:
          'Environment validation packet downloaded. Use it for release notes, compatibility notes, and native-browser evidence review.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to build the environment validation packet.',
      })
    }
  }

  async function handleDownloadValidationReleaseNotes(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: 'Building the browser compatibility release-note draft from saved validation evidence...',
    })

    try {
      const response = await fetch(buildApiUrl('/api/admin/environment-validation-release-notes'))
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Unable to build the environment validation release notes.'),
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
        message:
          'Browser compatibility release-note draft downloaded. Review unsupported paths before publishing support claims.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to build the environment validation release notes.',
      })
    }
  }

  async function handleDownloadValidationClaimGate(): Promise<void> {
    setActionState({
      phase: 'submitting',
      message: 'Evaluating whether browser and hardware evidence is strong enough for a release-claim review...',
    })

    try {
      const markdownResponse = await fetch(buildApiUrl('/api/admin/environment-validation-claim-gate.md'))
      if (!markdownResponse.ok) {
        throw new Error(
          await readErrorMessage(markdownResponse, 'Unable to build the browser environment claim gate.'),
        )
      }

      const jsonResponse = await fetch(buildApiUrl('/api/admin/environment-validation-claim-gate'))
      if (!jsonResponse.ok) {
        throw new Error(
          await readErrorMessage(jsonResponse, 'Unable to load the browser environment claim gate summary.'),
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
          ? 'Browser environment claim gate downloaded. Evidence is strong enough to begin a release-claim review.'
          : 'Browser environment claim gate downloaded. The checklist should stay open until the missing evidence is collected.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to build the browser environment claim gate.',
      })
    }
  }

  async function handleCreateValidationRun(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setActionState({
      phase: 'submitting',
      message: 'Saving the environment validation run and refreshing the overview...',
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
        throw new Error(await readErrorMessage(response, 'Unable to save the validation run.'))
      }

      await loadOverview()
      setValidationFormState(initialValidationFormState())
      setActionState({
        phase: 'success',
        message:
          'Environment validation run saved. The ops overview now includes the latest manual browser check.',
      })
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unable to save the validation run.',
      })
    }
  }

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell ops-page">
        <section className="panel studio-panel">
          <p className="eyebrow">Phase 7</p>
          <h1>Loading operations overview</h1>
          <p className="panel__summary">
            Pulling the failure, retry, policy, and model-version state from the API.
          </p>
        </section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell ops-page">
        <section className="panel studio-panel">
          <p className="eyebrow">Phase 7</p>
          <h1>Operations overview unavailable</h1>
          <p className="form-error">{pageState.message}</p>
          <Link className="back-link" to="/">
            Back to home
          </Link>
        </section>
      </div>
    )
  }

  const { payload } = pageState
  const environmentDiagnostics = payload.environment_diagnostics
  const validationRuns = payload.recent_environment_validation_runs

  return (
    <div className="page-shell ops-page">
      <section className="panel studio-panel ops-shell">
        <div className="studio-header ops-shell__header">
          <div className="ops-shell__copy">
            <p className="eyebrow">Phase 7</p>
            <h1>Operations overview and release gate</h1>
            <p className="panel__summary">
              PROJECT_FOUNDATION closes with failure visibility, retry paths, model-version
              traceability, and a basic admin monitoring view. This page keeps those checks in one place.
            </p>
          </div>

          <div className="button-row ops-shell__actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => void loadOverview()}
            >
              Refresh overview
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => handleDownloadEnvironmentReport(environmentDiagnostics)}
            >
              Download environment report
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationPacket()}
            >
              Download validation packet
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationReleaseNotes()}
            >
              Download compatibility notes
            </button>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void handleDownloadValidationClaimGate()}
            >
              Download claim gate
            </button>

            <Link className="back-link" to="/">
              Back to home
            </Link>
          </div>
        </div>

        {actionState.phase !== 'idle' ? (
          <p className={actionState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
            {actionState.message}
          </p>
        ) : null}

        <div className="card-grid ops-kpi-strip">
          <article className="info-card ops-kpi-card">
            <h3>Release summary</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>Projects</span>
                <strong>{payload.summary.project_count}</strong>
              </div>
              <div className="mini-card">
                <span>Ready takes</span>
                <strong>{payload.summary.ready_take_count}</strong>
              </div>
              <div className="mini-card">
                <span>Failed tracks</span>
                <strong>{payload.summary.failed_track_count}</strong>
              </div>
              <div className="mini-card">
                <span>Failed analysis jobs</span>
                <strong>{payload.summary.failed_analysis_job_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-kpi-card">
            <h3>Policies</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>Analysis timeout</span>
                <strong>{payload.policies.analysis_timeout_seconds} sec</strong>
              </div>
              <div className="mini-card">
                <span>Upload expiry</span>
                <strong>{payload.policies.upload_session_expiry_minutes} min</strong>
              </div>
              <div className="mini-card">
                <span>Recent window</span>
                <strong>{payload.policies.recent_limit} items</strong>
              </div>
              <div className="mini-card">
                <span>Analysis jobs</span>
                <strong>{payload.summary.analysis_job_count}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="section ops-section ops-section--versions">
        <div className="section__header ops-section__header">
          <p className="eyebrow">Model Trace</p>
          <h2>Track which engine versions are active</h2>
        </div>

        <div className="card-grid">
          <article className="info-card ops-info-card">
            <h3>Analysis versions</h3>
            <ul>
              {payload.model_versions.analysis.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card ops-info-card">
            <h3>Melody versions</h3>
            <ul>
              {payload.model_versions.melody.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card ops-info-card">
            <h3>Arrangement engine</h3>
            <ul>
              {payload.model_versions.arrangement_engine.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="section ops-section ops-section--diagnostics">
        <div className="section__header ops-section__header">
          <p className="eyebrow">Environment Diagnostics</p>
          <h2>Track browser audio variability before it becomes a support mystery</h2>
        </div>

        <div className="card-grid">
          <article className="info-card ops-info-card">
            <h3>DeviceProfile coverage</h3>
            <div className="mini-grid">
              <div className="mini-card">
                <span>Profiles captured</span>
                <strong>{environmentDiagnostics.summary.total_device_profiles}</strong>
              </div>
              <div className="mini-card">
                <span>Profiles with warnings</span>
                <strong>{environmentDiagnostics.summary.profiles_with_warnings}</strong>
              </div>
              <div className="mini-card">
                <span>Browser families</span>
                <strong>{environmentDiagnostics.summary.browser_family_count}</strong>
              </div>
              <div className="mini-card">
                <span>Warning types</span>
                <strong>{environmentDiagnostics.summary.warning_flag_count}</strong>
              </div>
            </div>
          </article>

          <article className="info-card ops-info-card">
            <h3>Warning distribution</h3>
            {environmentDiagnostics.warning_flags.length === 0 ? (
              <div className="empty-card">
                <p>No warning flags have been captured yet.</p>
                <p>Save DeviceProfiles from different browsers to build this baseline.</p>
              </div>
            ) : (
              <ul className="ticket-list">
                {environmentDiagnostics.warning_flags.map((warning) => (
                  <li key={warning.flag}>
                    <strong>{getBrowserAudioWarningLabel(warning.flag)}</strong>
                    <span>{warning.profile_count} profiles</span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="info-card ops-info-card">
            <h3>Browser matrix</h3>
            {environmentDiagnostics.browser_matrix.length === 0 ? (
              <div className="empty-card">
                <p>No browser environments have been captured yet.</p>
                <p>The matrix fills in as soon as DeviceProfiles are saved from the studio.</p>
              </div>
            ) : (
              <ul className="ticket-list">
                {environmentDiagnostics.browser_matrix.map((browserEntry) => (
                  <li key={`${browserEntry.browser}-${browserEntry.os}`}>
                    <strong>
                      {browserEntry.browser} / {browserEntry.os}
                    </strong>
                    <span>
                      {browserEntry.profile_count} profiles, {browserEntry.warning_profile_count}{' '}
                      with warnings
                      <br />
                      Last seen {formatDate(browserEntry.latest_seen_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section className="section section--split ops-section ops-section--validation">
        <article className="panel studio-block ops-panel">
          <p className="eyebrow">Validation Log</p>
          <h2>Record a native browser or real-hardware validation run</h2>
          <p className="panel__summary">
            Use the PROJECT_FOUNDATION environment protocol, then leave the result here so ops,
            release notes, and browser support claims all point at the same evidence.
          </p>

          <form className="project-form" onSubmit={(event) => void handleCreateValidationRun(event)}>
            <div className="field-grid">
              <label className="field">
                <span>Run label</span>
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
                  placeholder="Native Safari built-in speaker run"
                  required
                />
              </label>

              <label className="field">
                <span>Tester</span>
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
                  placeholder="QA lead"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Device name</span>
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
                <span>Validated at</span>
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
                <span>OS</span>
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
                <span>Browser</span>
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
                <span>Input device</span>
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
                  placeholder="Built-in Microphone"
                />
              </label>

              <label className="field">
                <span>Output route</span>
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
                  placeholder="Built-in Speakers"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Outcome</span>
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
                  <option value="PASS">PASS</option>
                  <option value="WARN">WARN</option>
                  <option value="FAIL">FAIL</option>
                </select>
              </label>

              <label className="field">
                <span>Warning flags</span>
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
                <span>Mic permission before</span>
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
                <span>Mic permission after</span>
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
                <span>Recorder MIME</span>
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
                <span>Primary AudioContext mode</span>
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
                  placeholder="standard or webkit"
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Offline render mode</span>
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
                  placeholder="standard, webkit, unavailable"
                />
              </label>

              <label className="field">
                <span>Sample rate (Hz)</span>
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
                <span>Base latency (ms)</span>
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
                <span>Output latency (ms)</span>
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
                <span>Secure context</span>
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
                <span>Take recording succeeded</span>
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
                <span>Analysis succeeded</span>
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
                <span>Playback succeeded</span>
              </label>
            </div>

            <label className="field">
              <span>Audible issues</span>
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
                placeholder="Playback preview stayed disabled on this environment."
              />
            </label>

            <label className="field">
              <span>Permission issues</span>
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
                placeholder="The first prompt required a reload after denial recovery."
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>Unexpected warnings</span>
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
                <span>Follow-up</span>
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
              <span>Notes</span>
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
                placeholder="Recording worked, but playback stayed environment-limited."
              />
            </label>

            <button
              className="button-primary"
              type="submit"
              disabled={actionState.phase === 'submitting'}
            >
              {actionState.phase === 'submitting' ? 'Saving validation run...' : 'Save validation run'}
            </button>
          </form>
        </article>

        <article className="panel studio-block ops-panel">
          <p className="eyebrow">Recent Validation Runs</p>
          <h2>Keep native browser checks visible next to the diagnostics baseline</h2>

          <div className="ops-list">
            {validationRuns.length === 0 ? (
              <div className="empty-card empty-card--warn">
                <p>No manual validation runs have been logged yet.</p>
                <p>Use the form to capture a native Safari or real-hardware run after testing.</p>
              </div>
            ) : (
              validationRuns.map((run) => (
                <article className="ops-card" key={run.validation_run_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{run.label}</strong>
                      <span>
                        {run.browser} / {run.os} | {run.device_name} | validated{' '}
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
                      {run.outcome}
                    </div>
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>Tester</span>
                      <strong>{run.tester ?? 'Unspecified'}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Input / output</span>
                      <strong>
                        {run.input_device ?? 'Unknown'} / {run.output_route ?? 'Unknown'}
                      </strong>
                    </div>
                    <div className="mini-card">
                      <span>Recorder / audio</span>
                      <strong>
                        {run.recording_mime_type ?? 'Unavailable'} / {run.audio_context_mode ?? 'Unavailable'}
                      </strong>
                    </div>
                    <div className="mini-card">
                      <span>Flow checks</span>
                      <strong>
                        Rec {run.take_recording_succeeded ? 'yes' : 'no'} / Ana{' '}
                        {run.analysis_succeeded ? 'yes' : 'no'} / Play{' '}
                        {run.playback_succeeded ? 'yes' : 'no'}
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

                  {run.follow_up ? <p className="status-card__hint">Follow-up: {run.follow_up}</p> : null}
                  {run.notes ? <p className="status-card__hint">{run.notes}</p> : null}
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="section section--split ops-section ops-section--recovery">
        <article className="panel studio-block ops-panel">
          <p className="eyebrow">Failed Tracks</p>
          <h2>Inspect failed uploads and processing state</h2>

          <div className="ops-list">
            {payload.failed_tracks.length === 0 ? (
              <div className="empty-card">
                <p>No failed tracks are waiting right now.</p>
                <p>When uploads or processing fail, they will land here with a retry path.</p>
              </div>
            ) : (
              payload.failed_tracks.map((track) => (
                <article className="ops-card" key={track.track_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{track.project_title}</strong>
                      <span>
                        {track.track_role}
                        {track.take_no ? ` | Take ${track.take_no}` : ''}
                      </span>
                    </div>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={() => void handleRetryProcessing(track.track_id)}
                    >
                      Retry processing
                    </button>
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>Status</span>
                      <strong>{track.track_status}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Format</span>
                      <strong>{track.source_format ?? 'Unknown'}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Updated</span>
                      <strong>{formatDate(track.updated_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Track id</span>
                      <strong>{track.track_id.slice(0, 8)}</strong>
                    </div>
                  </div>

                  <p className="form-error">
                    {track.failure_message ?? 'This track failed without a stored message.'}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="panel studio-block ops-panel">
          <p className="eyebrow">Analysis Jobs</p>
          <h2>Retry failed jobs and inspect model usage</h2>

          <div className="ops-list">
            {payload.recent_analysis_jobs.length === 0 ? (
              <div className="empty-card">
                <p>No analysis jobs have run yet.</p>
                <p>Run post-recording analysis from the studio to populate this feed.</p>
              </div>
            ) : (
              payload.recent_analysis_jobs.map((job) => (
                <article className="ops-card" key={job.job_id}>
                  <div className="ops-card__header">
                    <div>
                      <strong>{job.project_title}</strong>
                      <span>
                        {job.track_role}
                        {job.take_no ? ` | Take ${job.take_no}` : ''} | {job.model_version}
                      </span>
                    </div>

                    {job.status === 'FAILED' ? (
                      <button
                        className="button-secondary button-secondary--small"
                        type="button"
                        onClick={() => void handleRetryAnalysis(job.job_id)}
                      >
                        Retry job
                      </button>
                    ) : (
                      <span className="status-card__hint">{job.status}</span>
                    )}
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>Requested</span>
                      <strong>{formatDate(job.requested_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Finished</span>
                      <strong>{formatDate(job.finished_at)}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Status</span>
                      <strong>{job.status}</strong>
                    </div>
                    <div className="mini-card">
                      <span>Job id</span>
                      <strong>{job.job_id.slice(0, 8)}</strong>
                    </div>
                  </div>

                  {job.error_message ? (
                    <p className="form-error">{job.error_message}</p>
                  ) : (
                    <p className="status-card__hint">
                      This job completed without a stored error message.
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
          <p className="eyebrow">Recent Profiles</p>
          <h2>Inspect the latest captured audio environments</h2>
        </div>

        <div className="ops-list">
          {environmentDiagnostics.recent_profiles.length === 0 ? (
            <div className="empty-card empty-card--warn">
              <p>No recent DeviceProfiles are available yet.</p>
              <p>Open the studio, save a DeviceProfile, and come back here to compare environments.</p>
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
                      {profile.output_route} | saved {formatDate(profile.updated_at)}
                    </span>
                  </div>

                  <div
                    className={`status-pill ${
                      profile.warning_flags.length > 0 ? 'status-pill--loading' : 'status-pill--ready'
                    }`}
                  >
                    {profile.warning_flags.length > 0
                      ? `${profile.warning_flags.length} warnings`
                      : 'No warnings'}
                  </div>
                </div>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Mic permission</span>
                    <strong>{profile.microphone_permission ?? 'Unknown'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Recorder MIME</span>
                    <strong>{profile.recording_mime_type ?? 'Unavailable'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>AudioContext</span>
                    <strong>{profile.audio_context_mode ?? 'Unavailable'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Offline render</span>
                    <strong>{profile.offline_audio_context_mode ?? 'Unavailable'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Sample rate</span>
                    <strong>
                      {profile.actual_sample_rate ? `${profile.actual_sample_rate} Hz` : 'Unavailable'}
                    </strong>
                  </div>
                  <div className="mini-card">
                    <span>Latency</span>
                    <strong>
                      Base {formatLatency(profile.base_latency)} / Out{' '}
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
                    This environment currently reports no stored browser-audio warnings.
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
