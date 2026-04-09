import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { buildApiUrl } from '../lib/api'
import type { AudioPreviewData } from '../lib/audioPreview'
import type { Project } from '../types/project'

type AnalysisFeedbackItem = {
  message: string
}

type NoteFeedbackItem = {
  note_index: number
  attack_signed_cents: number | null
  sustain_median_cents: number | null
  confidence: number
  message: string
}

type TrackScoreSummary = {
  total_score: number
  pitch_score: number
  rhythm_score: number
  harmony_fit_score: number
  feedback_json: AnalysisFeedbackItem[]
  note_feedback_json: NoteFeedbackItem[]
}

type MelodyDraft = {
  note_count: number
  key_estimate: string | null
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
  alignment_confidence: number | null
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
  updated_at: string
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

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Pending'
  }

  return value.toFixed(1)
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${Math.round(value * 100)}%`
}

function formatSignedCents(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a'
  }

  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}c`
}

function getDefaultTake(takes: TakeTrack[]): TakeTrack | null {
  return takes.find((take) => take.latest_score !== null) ?? takes[0] ?? null
}

function getDefaultArrangement(arrangements: ArrangementCandidate[]): ArrangementCandidate | null {
  return arrangements[0] ?? null
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
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)

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
        setSelectedTakeId(getDefaultTake(payload.takes)?.track_id ?? null)
        setSelectedArrangementId(getDefaultArrangement(payload.arrangements)?.arrangement_id ?? null)
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
  const selectedTake =
    payload.takes.find((take) => take.track_id === selectedTakeId) ?? getDefaultTake(payload.takes)
  const selectedArrangement =
    payload.arrangements.find((arrangement) => arrangement.arrangement_id === selectedArrangementId) ??
    getDefaultArrangement(payload.arrangements)
  const noteHighlight = selectedTake?.latest_score?.note_feedback_json[0] ?? null
  const selectedMessages = selectedTake?.latest_score?.feedback_json.slice(0, 3) ?? []

  return (
    <div className="page-shell shared-review-page">
      <section className="shared-review-shell">
        <header className="shared-review-header">
          <div className="shared-review-header__copy">
            <p className="eyebrow">Read-Only Share</p>
            <h1>{payload.project.title}</h1>
            <p className="panel__summary">
              Shared studio snapshot from "{payload.version_label}". Review the selected take,
              score, and arrangement without editing controls.
            </p>
          </div>

          <div className="shared-review-header__meta">
            <div className="mini-card">
              <span>Share label</span>
              <strong>{payload.label}</strong>
            </div>
            <div className="mini-card">
              <span>Snapshot date</span>
              <strong>{formatDate(payload.version_created_at)}</strong>
            </div>
            <div className="mini-card">
              <span>Status</span>
              <strong>{payload.access_scope}</strong>
            </div>
            <div className="mini-card">
              <span>Expires</span>
              <strong>{payload.expires_at ? formatDate(payload.expires_at) : 'Never'}</strong>
            </div>
          </div>
        </header>

        <section className="shared-review-strip" aria-label="snapshot summary">
          <div className="shared-review-strip__item">
            <span>Guide</span>
            <strong>{payload.snapshot_summary.has_guide ? 'Yes' : 'No'}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>Takes</span>
            <strong>{payload.snapshot_summary.take_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>Ready takes</span>
            <strong>{payload.snapshot_summary.ready_take_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>Arrangements</span>
            <strong>{payload.snapshot_summary.arrangement_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>Mixdown</span>
            <strong>{payload.snapshot_summary.has_mixdown ? 'Yes' : 'No'}</strong>
          </div>
        </section>

        <div className="shared-review-grid">
          <aside className="panel shared-review-rail shared-review-rail--left">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Left Rail</p>
                <h2>Selected source take</h2>
              </div>
            </div>

            <p className="panel__summary">
              Switch between frozen takes, then inspect the guide, take audio, and waveform without
              reopening the studio editor.
            </p>

            <div className="shared-review-pill-row" role="tablist" aria-label="shared takes">
              {payload.takes.map((take) => (
                <button
                  key={take.track_id}
                  aria-selected={selectedTake?.track_id === take.track_id}
                  className={`shared-review-pill ${
                    selectedTake?.track_id === take.track_id ? 'shared-review-pill--active' : ''
                  }`}
                  type="button"
                  onClick={() => setSelectedTakeId(take.track_id)}
                >
                  {`Take ${take.take_no ?? '?'}`}
                </button>
              ))}
            </div>

            {selectedTake ? (
              <>
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Status</span>
                    <strong>{selectedTake.track_status}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(selectedTake.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Alignment confidence</span>
                    <strong>{formatPercent(selectedTake.alignment_confidence)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Melody draft</span>
                    <strong>
                      {selectedTake.latest_melody
                        ? `${selectedTake.latest_melody.note_count} notes`
                        : 'Pending'}
                    </strong>
                  </div>
                </div>

                {selectedTake.source_artifact_url ? (
                  <div className="shared-review-audio">
                    <span className="shared-review-label">Selected take audio</span>
                    <ManagedAudioPlayer muted={false} src={selectedTake.source_artifact_url} volume={1} />
                  </div>
                ) : null}

                {selectedTake.preview_data ? (
                  <WaveformPreview preview={selectedTake.preview_data} />
                ) : (
                  <div className="empty-card">
                    <p>No waveform preview was frozen for this take.</p>
                  </div>
                )}

                {payload.guide?.source_artifact_url ? (
                  <div className="shared-review-audio shared-review-audio--subtle">
                    <span className="shared-review-label">Guide reference</span>
                    <ManagedAudioPlayer muted={false} src={payload.guide.source_artifact_url} volume={0.8} />
                  </div>
                ) : null}

                {payload.mixdown?.source_artifact_url ? (
                  <div className="shared-review-audio shared-review-audio--subtle">
                    <span className="shared-review-label">Frozen mixdown</span>
                    <ManagedAudioPlayer muted={false} src={payload.mixdown.source_artifact_url} volume={0.9} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-card">
                <p>No takes were captured in this version.</p>
              </div>
            )}
          </aside>

          <section className="panel shared-review-canvas">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Center Canvas</p>
                <h2>Frozen review snapshot</h2>
              </div>
            </div>

            <p className="panel__summary">
              This page stays read-only on purpose. You can compare the frozen arrangement and
              export artifacts, but editing happens back in the studio.
            </p>

            {payload.arrangements.length > 0 ? (
              <div className="shared-review-pill-row" role="tablist" aria-label="shared arrangements">
                {payload.arrangements.map((arrangement) => (
                  <button
                    key={arrangement.arrangement_id}
                    aria-selected={selectedArrangement?.arrangement_id === arrangement.arrangement_id}
                    className={`shared-review-pill ${
                      selectedArrangement?.arrangement_id === arrangement.arrangement_id
                        ? 'shared-review-pill--active'
                        : ''
                    }`}
                    type="button"
                    onClick={() => setSelectedArrangementId(arrangement.arrangement_id)}
                  >
                    {arrangement.candidate_code}
                  </button>
                ))}
              </div>
            ) : null}

            {selectedArrangement ? (
              <>
                <div className="shared-review-canvas__meta">
                  <div className="mini-card">
                    <span>Arrangement</span>
                    <strong>{selectedArrangement.title}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Style</span>
                    <strong>{selectedArrangement.style}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Difficulty</span>
                    <strong>{selectedArrangement.difficulty}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Parts</span>
                    <strong>{selectedArrangement.part_count}</strong>
                  </div>
                </div>

                <ArrangementScore
                  musicXmlUrl={selectedArrangement.musicxml_artifact_url}
                  playheadRatio={0}
                  renderKey={`${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`}
                />
              </>
            ) : selectedTake?.preview_data ? (
              <WaveformPreview preview={selectedTake.preview_data} />
            ) : (
              <div className="empty-card">
                <p>No arrangement score or waveform preview was frozen for this snapshot.</p>
              </div>
            )}

            <div className="button-row shared-review-export-row">
              {selectedTake?.source_artifact_url ? (
                <a className="button-secondary" href={selectedTake.source_artifact_url}>
                  Open selected take audio
                </a>
              ) : null}
              {payload.guide?.guide_wav_artifact_url ? (
                <a className="button-secondary" href={payload.guide.guide_wav_artifact_url}>
                  Open guide WAV
                </a>
              ) : null}
              {selectedArrangement?.midi_artifact_url ? (
                <a className="button-secondary" href={selectedArrangement.midi_artifact_url}>
                  Open arrangement MIDI
                </a>
              ) : null}
              {selectedArrangement?.musicxml_artifact_url ? (
                <a className="button-secondary" href={selectedArrangement.musicxml_artifact_url}>
                  Open MusicXML
                </a>
              ) : null}
            </div>
          </section>

          <aside className="panel shared-review-rail shared-review-rail--right">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Right Rail</p>
                <h2>Recorded take results</h2>
              </div>
            </div>

            {selectedTake?.latest_score ? (
              <>
                <div className="shared-review-score-grid">
                  <div className="mini-card">
                    <span>Total</span>
                    <strong>{formatScore(selectedTake.latest_score.total_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Pitch</span>
                    <strong>{formatScore(selectedTake.latest_score.pitch_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Rhythm</span>
                    <strong>{formatScore(selectedTake.latest_score.rhythm_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Harmony</span>
                    <strong>{formatScore(selectedTake.latest_score.harmony_fit_score)}</strong>
                  </div>
                </div>

                {noteHighlight ? (
                  <div className="shared-review-highlight">
                    <span className="shared-review-label">Note highlight</span>
                    <strong>{`Note ${noteHighlight.note_index + 1}`}</strong>
                    <p>{noteHighlight.message}</p>
                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>Attack</span>
                        <strong>{formatSignedCents(noteHighlight.attack_signed_cents)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Sustain</span>
                        <strong>{formatSignedCents(noteHighlight.sustain_median_cents)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>Confidence</span>
                        <strong>{formatPercent(noteHighlight.confidence)}</strong>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="shared-review-message-list">
                  <span className="shared-review-label">Frozen feedback</span>
                  {selectedMessages.length > 0 ? (
                    <ul>
                      {selectedMessages.map((item, index) => (
                        <li key={`${selectedTake.track_id}-${index}`}>{item.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-card">
                      <p>No feedback messages were frozen for this take.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-card">
                <p>No scored take is selected in this frozen snapshot.</p>
              </div>
            )}

            <div className="empty-card empty-card--warn">
              <p>This is a frozen review artifact. Editing, rescoring, and share creation stay in the studio.</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
