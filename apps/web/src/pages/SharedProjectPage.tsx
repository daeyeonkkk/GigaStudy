import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'

import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { buildApiUrl } from '../lib/api'
import type { AudioPreviewData } from '../lib/audioPreview'
import type { Project } from '../types/project'

type AnalysisFeedbackItem = {
  message: string
}

type TrackScoreSummary = {
  total_score: number
  feedback_json: AnalysisFeedbackItem[]
}

type MelodyNote = {
  pitch_midi: number
}

type MelodyDraft = {
  note_count: number
  key_estimate: string | null
  midi_artifact_url: string | null
  notes_json: MelodyNote[]
}

type GuideTrack = {
  track_id: string
  track_status: string
  source_format: string | null
  duration_ms: number | null
  actual_sample_rate: number | null
  source_artifact_url: string | null
  guide_wav_artifact_url: string | null
  preview_data: AudioPreviewData | null
}

type TakeTrack = {
  track_id: string
  take_no: number | null
  part_type: string | null
  track_status: string
  duration_ms: number | null
  source_artifact_url: string | null
  preview_data: AudioPreviewData | null
  latest_score: TrackScoreSummary | null
  latest_melody: MelodyDraft | null
}

type MixdownTrack = {
  track_id: string
  track_status: string
  duration_ms: number | null
  source_artifact_url: string | null
  preview_data: AudioPreviewData | null
}

type ArrangementCandidate = {
  arrangement_id: string
  candidate_code: string
  title: string
  style: string
  difficulty: string
  part_count: number
  musicxml_artifact_url: string | null
  midi_artifact_url: string | null
}

type SnapshotSummary = {
  has_guide: boolean
  take_count: number
  ready_take_count: number
  arrangement_count: number
  has_mixdown: boolean
}

type SharedProjectPayload = {
  share_link_id: string
  label: string
  access_scope: string
  expires_at: string | null
  version_id: string
  version_label: string
  version_source_type: string
  version_created_at: string
  snapshot_summary: SnapshotSummary
  project: Project
  guide: GuideTrack | null
  takes: TakeTrack[]
  mixdown: MixdownTrack | null
  arrangement_generation_id: string | null
  arrangements: ArrangementCandidate[]
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'ready'; payload: SharedProjectPayload }
  | { phase: 'error'; message: string }

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'Unknown'
  }

  return `${(durationMs / 1000).toFixed(2)} sec`
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

export function SharedProjectPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' })

  useEffect(() => {
    if (!shareToken) {
      setPageState({ phase: 'error', message: 'Share token is missing.' })
      return
    }

    const controller = new AbortController()

    async function loadSharedProject(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/shared/${shareToken}`), {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Unable to load shared project.'))
        }

        const payload = (await response.json()) as SharedProjectPayload
        setPageState({ phase: 'ready', payload })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setPageState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Unable to load shared project.',
        })
      }
    }

    void loadSharedProject()

    return () => controller.abort()
  }, [shareToken])

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell">
        <section className="panel">
          <p className="eyebrow">Read-Only Share</p>
          <h1>Loading shared project...</h1>
        </section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel">
          <p className="eyebrow">Read-Only Share</p>
          <h1>Shared project unavailable</h1>
          <p className="form-error">{pageState.message}</p>
          <Link className="button-secondary" to="/">
            Return home
          </Link>
        </section>
      </div>
    )
  }

  const { payload } = pageState

  return (
    <div className="page-shell">
      <section className="panel shared-hero">
        <div className="shared-hero__copy">
          <p className="eyebrow">Read-Only Share</p>
          <h1>{payload.project.title}</h1>
          <p className="panel__summary">
            This page is frozen to version "{payload.version_label}" and follows the Phase 8
            read-only sharing flow from PROJECT_FOUNDATION.
          </p>
        </div>

        <div className="status-grid">
          <div className="mini-card">
            <span>Share label</span>
            <strong>{payload.label}</strong>
          </div>
          <div className="mini-card">
            <span>Version captured</span>
            <strong>{formatDate(payload.version_created_at)}</strong>
          </div>
          <div className="mini-card">
            <span>Access scope</span>
            <strong>{payload.access_scope}</strong>
          </div>
          <div className="mini-card">
            <span>Expires</span>
            <strong>{payload.expires_at ? formatDate(payload.expires_at) : 'Never'}</strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Snapshot Summary</p>
          <h2>Frozen review snapshot</h2>
        </div>

        <div className="card-grid">
          <article className="panel">
            <div className="mini-grid">
              <div className="mini-card">
                <span>Guide</span>
                <strong>{payload.snapshot_summary.has_guide ? 'Attached' : 'Missing'}</strong>
              </div>
              <div className="mini-card">
                <span>Takes</span>
                <strong>{payload.snapshot_summary.take_count}</strong>
              </div>
              <div className="mini-card">
                <span>Ready takes</span>
                <strong>{payload.snapshot_summary.ready_take_count}</strong>
              </div>
              <div className="mini-card">
                <span>Arrangements</span>
                <strong>{payload.snapshot_summary.arrangement_count}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Guide and Takes</p>
          <h2>Review source material and score state</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Guide</p>
                <h2>Reference track</h2>
              </div>
              <span className={`status-pill ${payload.guide ? 'status-pill--ready' : 'status-pill--loading'}`}>
                {payload.guide ? payload.guide.track_status : 'Missing'}
              </span>
            </div>

            {payload.guide ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Format</span>
                    <strong>{payload.guide.source_format ?? 'Unknown'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(payload.guide.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Sample rate</span>
                    <strong>{payload.guide.actual_sample_rate ?? 'Unknown'}</strong>
                  </div>
                </div>

                {payload.guide.source_artifact_url ? (
                  <ManagedAudioPlayer muted={false} src={payload.guide.source_artifact_url} volume={0.85} />
                ) : null}
                {payload.guide.preview_data ? <WaveformPreview preview={payload.guide.preview_data} /> : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No guide was captured in this shared snapshot.</p>
              </div>
            )}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Takes</p>
                <h2>Recorded take results</h2>
              </div>
              <span className="status-pill status-pill--ready">{payload.takes.length} takes</span>
            </div>

            <div className="history-list">
              {payload.takes.length === 0 ? (
                <div className="empty-card">
                  <p>No takes were captured in this version.</p>
                </div>
              ) : (
                payload.takes.map((take) => (
                  <article className="history-card" key={take.track_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>Take {take.take_no ?? '?'}</strong>
                        <span>{take.part_type ?? 'LEAD'} | {take.track_status}</span>
                      </div>
                      <span className="candidate-chip">{formatDuration(take.duration_ms)}</span>
                    </div>

                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>Total score</span>
                        <strong>
                          {take.latest_score ? take.latest_score.total_score.toFixed(1) : 'Pending'}
                        </strong>
                      </div>
                      <div className="mini-card">
                        <span>Melody notes</span>
                        <strong>{take.latest_melody?.note_count ?? 0}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Key estimate</span>
                        <strong>{take.latest_melody?.key_estimate ?? 'Pending'}</strong>
                      </div>
                    </div>

                    {take.source_artifact_url ? (
                      <ManagedAudioPlayer muted={false} src={take.source_artifact_url} volume={1} />
                    ) : null}
                    {take.preview_data ? <WaveformPreview preview={take.preview_data} /> : null}
                    {take.latest_score?.feedback_json[0]?.message ? (
                      <p className="status-card__hint">{take.latest_score.feedback_json[0].message}</p>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Arrangements and Exports</p>
          <h2>Read-only arrangement review</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Candidates</p>
                <h2>Arrangement exports in this version</h2>
              </div>
              <span className="status-pill status-pill--ready">{payload.arrangements.length} candidates</span>
            </div>

            <div className="history-list">
              {payload.arrangements.length === 0 ? (
                <div className="empty-card">
                  <p>No arrangement candidates were frozen in this snapshot.</p>
                </div>
              ) : (
                payload.arrangements.map((arrangement) => (
                  <article className="history-card" key={arrangement.arrangement_id}>
                    <div className="history-card__header">
                      <div>
                        <strong>{arrangement.candidate_code} - {arrangement.title}</strong>
                        <span>{arrangement.style} | {arrangement.difficulty}</span>
                      </div>
                      <span className="candidate-chip">{arrangement.part_count} parts</span>
                    </div>

                    <div className="button-row">
                      {arrangement.musicxml_artifact_url ? (
                        <a className="button-secondary" href={arrangement.musicxml_artifact_url}>
                          Export MusicXML
                        </a>
                      ) : null}
                      {arrangement.midi_artifact_url ? (
                        <a className="button-secondary" href={arrangement.midi_artifact_url}>
                          Export MIDI
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Mixdown</p>
                <h2>Shared stereo review artifact</h2>
              </div>
              <span className={`status-pill ${payload.mixdown ? 'status-pill--ready' : 'status-pill--loading'}`}>
                {payload.mixdown ? payload.mixdown.track_status : 'Missing'}
              </span>
            </div>

            {payload.mixdown ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(payload.mixdown.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Status</span>
                    <strong>{payload.mixdown.track_status}</strong>
                  </div>
                </div>
                {payload.mixdown.source_artifact_url ? (
                  <ManagedAudioPlayer muted={false} src={payload.mixdown.source_artifact_url} volume={1} />
                ) : null}
                {payload.mixdown.preview_data ? <WaveformPreview preview={payload.mixdown.preview_data} /> : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No mixdown was saved in this shared version.</p>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  )
}
