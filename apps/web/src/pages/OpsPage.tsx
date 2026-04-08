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

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell">
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
      <div className="page-shell">
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

  return (
    <div className="page-shell">
      <section className="panel studio-panel">
        <div className="studio-header">
          <div>
            <p className="eyebrow">Phase 7</p>
            <h1>Operations overview and release gate</h1>
            <p className="panel__summary">
              PROJECT_FOUNDATION closes with failure visibility, retry paths, model-version
              traceability, and a basic admin monitoring view. This page keeps those checks in one place.
            </p>
          </div>

          <div className="button-row">
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

        <div className="card-grid">
          <article className="info-card">
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

          <article className="info-card">
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

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Model Trace</p>
          <h2>Track which engine versions are active</h2>
        </div>

        <div className="card-grid">
          <article className="info-card">
            <h3>Analysis versions</h3>
            <ul>
              {payload.model_versions.analysis.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card">
            <h3>Melody versions</h3>
            <ul>
              {payload.model_versions.melody.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>

          <article className="info-card">
            <h3>Arrangement engine</h3>
            <ul>
              {payload.model_versions.arrangement_engine.map((version) => (
                <li key={version}>{version}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Environment Diagnostics</p>
          <h2>Track browser audio variability before it becomes a support mystery</h2>
        </div>

        <div className="card-grid">
          <article className="info-card">
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

          <article className="info-card">
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

          <article className="info-card">
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

      <section className="section section--split">
        <article className="panel studio-block">
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

        <article className="panel studio-block">
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

      <section className="section">
        <div className="section__header">
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
