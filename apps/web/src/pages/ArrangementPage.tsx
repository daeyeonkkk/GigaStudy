import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
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
  type ArrangementPlaybackPart,
} from '../lib/arrangementParts'
import type { Project } from '../types/project'

type ActionState =
  | { phase: 'idle' }
  | { phase: 'submitting'; message?: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type MelodyDraftSummary = {
  melody_draft_id: string
  key_estimate: string | null
  grid_division: string
  note_count: number
}

type TakeTrack = {
  track_id: string
  take_no: number | null
  track_status: string
  latest_melody: MelodyDraftSummary | null
}

type GuideTrack = {
  track_id: string
  guide_wav_artifact_url: string | null
}

type ArrangementCandidate = {
  arrangement_id: string
  candidate_code: string
  title: string
  style: string
  difficulty: string
  voice_range_preset: string | null
  beatbox_template: string | null
  part_count: number
  comparison_summary: {
    lead_range_fit_percent: number
    support_max_leap: number
    parallel_motion_alerts: number
    beatbox_note_count: number
  } | null
  parts_json: ArrangementPlaybackPart[]
  midi_artifact_url: string | null
  musicxml_artifact_url: string | null
  updated_at: string
}

type SnapshotPayload = {
  project: Project
  guide: GuideTrack | null
  takes: TakeTrack[]
  arrangement_generation_id: string | null
  arrangements: ArrangementCandidate[]
}

type ArrangementConfig = {
  style: string
  difficulty: string
  voiceRangePreset: string
  beatboxTemplate: string
}

const defaultArrangementConfig: ArrangementConfig = {
  style: 'contemporary',
  difficulty: 'basic',
  voiceRangePreset: 'alto',
  beatboxTemplate: 'off',
}

const difficultyOptions = [
  { value: 'beginner', label: 'Beginner', description: 'Shorter leaps and safer support motion.' },
  { value: 'basic', label: 'Basic', description: 'Balanced default preset with moderate movement.' },
  { value: 'strict', label: 'Strict', description: 'Tighter leap control and stronger avoidance.' },
] as const

const voiceRangeOptions = [
  { value: 'soprano', label: 'S (Soprano)', description: 'Higher lead preset.' },
  { value: 'alto', label: 'A (Alto)', description: 'Balanced default preset.' },
  { value: 'tenor', label: 'T (Tenor)', description: 'Lower lead preset.' },
  { value: 'bass', label: 'B (Bass)', description: 'Lowest lead preset.' },
  { value: 'baritone', label: 'Baritone', description: 'Middle-low lead preset.' },
] as const

const beatboxOptions = [
  { value: 'off', label: 'Off', description: 'No beatbox layer.' },
  { value: 'pulse', label: 'Pulse', description: 'Simple kick and snare pulse.' },
  { value: 'drive', label: 'Drive', description: 'Busier groove with extra kick support.' },
  { value: 'halftime', label: 'Half-Time', description: 'Slower backbeat with more phrase space.' },
  { value: 'syncopated', label: 'Syncopated', description: 'Off-beat accents for livelier motion.' },
] as const

function getOptionMeta<T extends { value: string }>(options: readonly T[], value: string | null | undefined): T {
  return options.find((option) => option.value === value) ?? options[0]!
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a'
  }
  return `${Math.round(value)}%`
}

function formatPlaybackClock(positionMs: number, durationMs: number): string {
  const safePosition = Math.max(0, Math.round(positionMs / 1000))
  const safeDuration = Math.max(0, Math.round(durationMs / 1000))
  return `${Math.floor(safePosition / 60)}:${String(safePosition % 60).padStart(2, '0')} / ${Math.floor(safeDuration / 60)}:${String(safeDuration % 60).padStart(2, '0')}`
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

function syncArrangementPartMixerState(
  current: Record<string, ArrangementPlaybackMixerState>,
  parts: ArrangementPlaybackPart[],
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

export function ArrangementPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [guide, setGuide] = useState<GuideTrack | null>(null)
  const [takes, setTakes] = useState<TakeTrack[]>([])
  const [arrangements, setArrangements] = useState<ArrangementCandidate[]>([])
  const [arrangementGenerationId, setArrangementGenerationId] = useState<string | null>(null)
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('Unable to load arrangement workspace.')
  const [arrangementConfig, setArrangementConfig] = useState(defaultArrangementConfig)
  const [melodyState, setMelodyState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementState, setArrangementState] = useState<ActionState>({ phase: 'idle' })
  const [guideModeEnabled, setGuideModeEnabled] = useState(false)
  const [guideFocusPartName, setGuideFocusPartName] = useState<string | null>(null)
  const [arrangementPartMixerState, setArrangementPartMixerState] = useState<Record<string, ArrangementPlaybackMixerState>>({})
  const [arrangementPlaybackPositionMs, setArrangementPlaybackPositionMs] = useState(0)
  const [arrangementTransportState, setArrangementTransportState] = useState<{
    phase: 'ready' | 'playing' | 'error'
    message: string
  }>({
    phase: 'ready',
    message: 'Arrangement playback is ready.',
  })
  const arrangementPlaybackRef = useRef<ArrangementPlaybackController | null>(null)

  const selectedTake = takes.find((take) => take.track_id === selectedTakeId) ?? takes[0] ?? null
  const selectedTakeMelody = selectedTake?.latest_melody ?? null
  const selectedArrangement =
    arrangements.find((item) => item.arrangement_id === selectedArrangementId) ?? arrangements[0] ?? null
  const arrangementDurationMs = getArrangementDurationMs(selectedArrangement?.parts_json ?? [])
  const arrangementPlaybackRatio =
    arrangementDurationMs > 0 ? Math.min(1, arrangementPlaybackPositionMs / arrangementDurationMs) : 0
  const selectedDifficultyMeta = getOptionMeta(difficultyOptions, arrangementConfig.difficulty)
  const selectedVoiceRangeMeta = getOptionMeta(voiceRangeOptions, arrangementConfig.voiceRangePreset)
  const selectedBeatboxMeta = getOptionMeta(beatboxOptions, arrangementConfig.beatboxTemplate)

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setLoadingState('error')
      setErrorMessage('Project id is missing.')
      return
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/studio`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Unable to load arrangement workspace.'))
    }

    const payload = (await response.json()) as SnapshotPayload
    setProject(payload.project)
    setGuide(payload.guide)
    setTakes(payload.takes)
    setArrangements(payload.arrangements)
    setArrangementGenerationId(payload.arrangement_generation_id)
    setLoadingState('ready')
  }, [projectId])

  async function stopArrangementPlayback(resetPosition = true): Promise<void> {
    const activePlayback = arrangementPlaybackRef.current
    arrangementPlaybackRef.current = null
    if (activePlayback) {
      await activePlayback.stop()
    }
    if (resetPosition) {
      setArrangementPlaybackPositionMs(0)
    }
      setArrangementTransportState({ phase: 'ready', message: 'Arrangement playback is ready.' })
  }

  useEffect(() => {
    let cancelled = false
    setLoadingState('loading')
    void refreshSnapshot().catch((error) => {
      if (cancelled) {
        return
      }
      setLoadingState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load arrangement workspace.')
    })
    return () => {
      cancelled = true
    }
  }, [refreshSnapshot])

  useEffect(() => {
    if (!selectedTakeId && takes[0]) {
      setSelectedTakeId(takes[0].track_id)
    }
  }, [selectedTakeId, takes])

  useEffect(() => {
    if (selectedArrangementId && arrangements.some((item) => item.arrangement_id === selectedArrangementId)) {
      return
    }
    setSelectedArrangementId(arrangements[0]?.arrangement_id ?? null)
  }, [arrangements, selectedArrangementId])

  useEffect(() => {
    const parts = selectedArrangement?.parts_json ?? []
    setArrangementPartMixerState((current) => syncArrangementPartMixerState(current, parts))
    if (parts.length === 0) {
      setGuideFocusPartName(null)
      setGuideModeEnabled(false)
      setArrangementPlaybackPositionMs(0)
      return
    }
    setGuideFocusPartName((current) =>
      current && parts.some((part) => part.part_name === current)
        ? current
        : parts.find((part) => part.role === 'MELODY')?.part_name ?? parts[0]?.part_name ?? null,
    )
  }, [selectedArrangement])

  useEffect(() => {
    return () => {
      void stopArrangementPlayback(false)
    }
  }, [])

  async function handleExtractMelody(): Promise<void> {
    if (!projectId || !selectedTake) {
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
        { method: 'POST' },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to extract melody draft.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraftSummary
      await refreshSnapshot()
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

  async function handleGenerateArrangements(): Promise<void> {
    if (!projectId || !selectedTakeMelody) {
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
        headers: { 'Content-Type': 'application/json' },
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
      setArrangements(payload.items)
      setArrangementGenerationId(payload.generation_id)
      setSelectedArrangementId(payload.items[0]?.arrangement_id ?? null)
      await refreshSnapshot()
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

  function updateArrangementPartMixer(
    partName: string,
    nextValue: Partial<ArrangementPlaybackMixerState>,
  ): void {
    setArrangementPartMixerState((current) => ({
      ...current,
      [partName]: current[partName]
        ? { ...current[partName], ...nextValue }
        : { enabled: true, solo: false, volume: 0.8, ...nextValue },
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
            phase: 'ready',
            message: 'Arrangement playback finished. Compare another candidate or export from here.',
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

  if (loadingState === 'loading') {
    return <div className="page-shell"><section className="panel"><p>Loading the arrangement workspace...</p></section></div>
  }

  if (loadingState === 'error' || !project) {
    return (
      <div className="page-shell">
        <section className="panel">
          <p className="form-error">{errorMessage}</p>
          <Link className="back-link" to="/">Return Home</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell arrangement-page">
      <section className="arrangement-shell">
        <div className="arrangement-topbar">
          <div className="arrangement-tabs" role="tablist" aria-label="arrangement candidates">
            {arrangements.length === 0 ? (
              <span className="arrangement-tab arrangement-tab--empty">No candidate yet</span>
            ) : (
              arrangements.map((arrangement) => (
                <button
                  key={arrangement.arrangement_id}
                  aria-selected={selectedArrangement?.arrangement_id === arrangement.arrangement_id}
                  className={`arrangement-tab ${
                    selectedArrangement?.arrangement_id === arrangement.arrangement_id
                      ? 'arrangement-tab--active'
                      : ''
                  }`}
                  type="button"
                  onClick={() => setSelectedArrangementId(arrangement.arrangement_id)}
                >
                  {arrangement.candidate_code}
                </button>
              ))
            )}
          </div>

          <div className="arrangement-topbar__meta">
            <strong>{project.title}</strong>
            <span>Preview {formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}</span>
          </div>

          <div className="arrangement-topbar__actions">
            <button
              className="button-primary"
              disabled={selectedArrangement === null}
              type="button"
              onClick={() => void handlePlayArrangement()}
            >
              Play preview
            </button>
            <button
              className="button-secondary"
              disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
              type="button"
              onClick={() => void stopArrangementPlayback()}
            >
              Stop
            </button>
            <Link className="back-link" to={`/projects/${projectId}/studio#arrangement`}>
              Return to studio
            </Link>
          </div>
        </div>

        <div className="arrangement-grid">
          <aside className="panel arrangement-rail arrangement-rail--left">
            <div>
              <p className="eyebrow">Left Rail</p>
              <h1>Choose the harmony stack that fits the take</h1>
              <p className="panel__summary">
                Compare candidate voicing, preview the arrangement, then export the score package.
              </p>
            </div>

            <div className="field-grid arrangement-field-grid">
              <label className="field">
                <span>Source take</span>
                <select
                  className="text-input"
                  value={selectedTake?.track_id ?? ''}
                  onChange={(event) => setSelectedTakeId(event.target.value || null)}
                >
                  {takes.map((take) => (
                    <option key={take.track_id} value={take.track_id}>
                      {`Take ${take.take_no ?? '?'} · ${take.track_status}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Style</span>
                <select
                  className="text-input"
                  value={arrangementConfig.style}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({ ...current, style: event.target.value }))
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
                    setArrangementConfig((current) => ({ ...current, difficulty: event.target.value }))
                  }
                >
                  {difficultyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Lead range</span>
                <select
                  className="text-input"
                  value={arrangementConfig.voiceRangePreset}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({ ...current, voiceRangePreset: event.target.value }))
                  }
                >
                  {voiceRangeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Beatbox</span>
                <select
                  className="text-input"
                  value={arrangementConfig.beatboxTemplate}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({ ...current, beatboxTemplate: event.target.value }))
                  }
                >
                  {beatboxOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="arrangement-action-row">
              <button
                className="button-secondary"
                disabled={melodyState.phase === 'submitting'}
                type="button"
                onClick={() => void handleExtractMelody()}
              >
                {melodyState.phase === 'submitting' ? 'Extracting melody...' : 'Extract melody draft'}
              </button>
              <button
                className="button-primary"
                disabled={arrangementState.phase === 'submitting'}
                type="button"
                onClick={() => void handleGenerateArrangements()}
              >
                {arrangementState.phase === 'submitting'
                  ? 'Generating candidates...'
                  : 'Generate arrangement candidates'}
              </button>
            </div>

            <div className="arrangement-summary-block">
              <div className="mini-card mini-card--stack">
                <span>Melody draft</span>
                <strong>{selectedTakeMelody ? `${selectedTakeMelody.note_count} notes` : 'Not ready'}</strong>
                <small>
                  {selectedTakeMelody
                    ? `${selectedTakeMelody.key_estimate ?? 'Pending key'} · ${selectedTakeMelody.grid_division}`
                    : 'Extract the latest melody draft from the selected take first.'}
                </small>
              </div>
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
            </div>

            {selectedArrangement ? (
              <div className="arrangement-compare-card">
                <p className="eyebrow">Candidate compare</p>
                <strong>{`${selectedArrangement.candidate_code} · ${selectedArrangement.title}`}</strong>
                <div className="arrangement-compare-list">
                  <span>Lead fit: {formatCompactPercent(selectedArrangement.comparison_summary?.lead_range_fit_percent)}</span>
                  <span>Max leap: {selectedArrangement.comparison_summary?.support_max_leap ?? 'n/a'} semitones</span>
                  <span>Parallel alerts: {selectedArrangement.comparison_summary?.parallel_motion_alerts ?? 0}</span>
                  <span>Beatbox hits: {selectedArrangement.comparison_summary?.beatbox_note_count ?? 0}</span>
                </div>
              </div>
            ) : (
              <div className="empty-card">
                <p>No arrangement candidates yet.</p>
                <p>Extract melody, then generate candidate A/B/C to open the score-first workspace.</p>
              </div>
            )}

            {melodyState.phase !== 'idle' ? (
              <p className={melodyState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {melodyState.message}
              </p>
            ) : null}

            {arrangementState.phase !== 'idle' ? (
              <p className={arrangementState.phase === 'error' ? 'form-error' : 'status-card__hint'}>
                {arrangementState.message}
              </p>
            ) : null}
          </aside>

          <section className="panel arrangement-center">
            <div className="arrangement-center__header">
              <div>
                <p className="eyebrow">Score Canvas</p>
                <h2>Preview the arrangement, then export the score package</h2>
              </div>
              <div className="candidate-chip-row">
                <span className="candidate-chip">
                  {arrangementGenerationId ? arrangementGenerationId.slice(0, 8) : 'No batch'}
                </span>
                {selectedArrangement ? (
                  <span className="candidate-chip">{selectedArrangement.part_count} parts</span>
                ) : null}
              </div>
            </div>

            <ArrangementScore
              musicXmlUrl={selectedArrangement?.musicxml_artifact_url ?? null}
              playheadRatio={arrangementPlaybackRatio}
              renderKey={
                selectedArrangement
                  ? `${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`
                  : 'empty-arrangement'
              }
            />

            <div className="arrangement-center__footer">
              <div className="transport-card">
                <div className="transport-card__row">
                  <strong>{formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}</strong>
                  <span>{selectedArrangement ? `${selectedArrangement.part_count} parts` : 'No arrangement selected'}</span>
                </div>
                <div className="transport-progress" aria-hidden="true">
                  <div
                    className="transport-progress__fill"
                    style={{ width: `${Math.min(100, arrangementPlaybackRatio * 100)}%` }}
                  />
                </div>
              </div>

              <Link className="button-secondary" to={`/projects/${projectId}/studio#score-playback`}>
                Open deep edit tools in studio
              </Link>
            </div>
          </section>

          <aside className="panel arrangement-rail arrangement-rail--right">
            <div>
              <p className="eyebrow">Right Rail</p>
              <h2>Part focus and export</h2>
            </div>

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
              {guide?.guide_wav_artifact_url ? (
                <a className="button-secondary" href={guide.guide_wav_artifact_url}>
                  Export guide WAV
                </a>
              ) : null}
            </div>

            <label className="toggle-card">
              <input
                checked={guideModeEnabled}
                type="checkbox"
                onChange={(event) => setGuideModeEnabled(event.target.checked)}
              />
              <div>
                <strong>Guide mode</strong>
                <span>Keep the guide-focus part louder while the rest of the stack drops back.</span>
              </div>
            </label>

            <p
              className={arrangementTransportState.phase === 'error' ? 'form-error' : 'status-card__hint'}
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
                          <span>{`${part.role} | ${part.notes.length} notes`}</span>
                        </div>
                      </div>

                      <label className="toggle-inline">
                        <input
                          checked={partMixer.enabled}
                          type="checkbox"
                          onChange={(event) =>
                            updateArrangementPartMixer(part.part_name, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        <span>Active</span>
                      </label>

                      <button
                        className={`button-secondary button-secondary--small ${partMixer.solo ? 'button-secondary--active' : ''}`}
                        type="button"
                        onClick={() =>
                          updateArrangementPartMixer(part.part_name, { solo: !partMixer.solo })
                        }
                      >
                        {partMixer.solo ? 'Solo on' : 'Solo'}
                      </button>

                      <button
                        className={`button-secondary button-secondary--small ${isGuideFocus ? 'button-secondary--active' : ''}`}
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
                        <span>Vol</span>
                        <input
                          max={1}
                          min={0}
                          step={0.05}
                          type="range"
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
                <p>No part focus controls yet.</p>
                <p>Select or generate a candidate before opening solo, focus, and export tools.</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}
