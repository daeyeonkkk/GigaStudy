import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

import './ArrangementPage.css'

import { ArrangementScore } from '../components/ArrangementScore'
import { buildApiUrl, normalizeAssetUrl, normalizeRequestError } from '../lib/api'
import {
  getArrangementPartRoleLabel,
  getArrangementStyleLabel,
  getDifficultyLabel,
  getTrackStatusLabel,
} from '../lib/localizedLabels'
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

type ExportSelectionKey = 'xml' | 'midi' | 'guide'
type ScoreZoomLevel = '75' | '100' | '125' | 'fit'
type ScoreViewMode = 'full' | 'section' | 'focus'
type GuideMode = 'off' | 'lead' | 'full'

const defaultArrangementConfig: ArrangementConfig = {
  style: 'contemporary',
  difficulty: 'basic',
  voiceRangePreset: 'alto',
  beatboxTemplate: 'off',
}

const defaultExportSelections: Record<ExportSelectionKey, boolean> = {
  xml: true,
  midi: true,
  guide: false,
}

const difficultyOptions = [
  { value: 'beginner', label: '입문' },
  { value: 'basic', label: '기본' },
  { value: 'strict', label: '엄격' },
] as const

const voiceRangeOptions = [
  { value: 'soprano', label: '소프라노(S)' },
  { value: 'alto', label: '알토(A)' },
  { value: 'tenor', label: '테너(T)' },
  { value: 'bass', label: '베이스(B)' },
  { value: 'baritone', label: '바리톤' },
] as const

const beatboxOptions = [
  { value: 'off', label: '사용 안 함' },
  { value: 'pulse', label: '펄스' },
  { value: 'drive', label: '드라이브' },
  { value: 'halftime', label: '하프타임' },
  { value: 'syncopated', label: '싱코페이션' },
] as const

const candidatePlaceholders = ['A', 'B', 'C']
const rehearsalMarks = ['A', 'B', 'C', 'D']

function getOptionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null | undefined,
): string {
  return options.find((option) => option.value === value)?.label ?? options[0]?.label ?? '-'
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  return `${Math.round(value)}`
}

function formatPlaybackClock(positionMs: number, durationMs: number): string {
  const safePosition = Math.max(0, Math.round(positionMs / 1000))
  const safeDuration = Math.max(0, Math.round(durationMs / 1000))
  return `${Math.floor(safePosition / 60)}:${String(safePosition % 60).padStart(2, '0')} / ${Math.floor(
    safeDuration / 60,
  )}:${String(safeDuration % 60).padStart(2, '0')}`
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

function getConstraintReadout(config: ArrangementConfig): { maxLeap: string; avoidParallel: string } {
  if (config.difficulty === 'strict') {
    return { maxLeap: 'P4', avoidParallel: 'Strict' }
  }
  if (config.difficulty === 'beginner') {
    return { maxLeap: 'P5', avoidParallel: 'Guide' }
  }
  return { maxLeap: 'P4', avoidParallel: 'Standard' }
}

function getScoreScale(zoomLevel: ScoreZoomLevel): number {
  if (zoomLevel === 'fit') {
    return 1
  }
  return Number(zoomLevel) / 100
}

function triggerAssetDownload(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function ArrangementPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [guide, setGuide] = useState<GuideTrack | null>(null)
  const [takes, setTakes] = useState<TakeTrack[]>([])
  const [arrangements, setArrangements] = useState<ArrangementCandidate[]>([])
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('편곡 화면을 불러오지 못했습니다.')
  const [arrangementConfig, setArrangementConfig] = useState(defaultArrangementConfig)
  const [melodyState, setMelodyState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementState, setArrangementState] = useState<ActionState>({ phase: 'idle' })
  const [exportState, setExportState] = useState<ActionState>({ phase: 'idle' })
  const [guideModeEnabled, setGuideModeEnabled] = useState(false)
  const [guideFocusPartName, setGuideFocusPartName] = useState<string | null>(null)
  const [arrangementPartMixerState, setArrangementPartMixerState] = useState<Record<string, ArrangementPlaybackMixerState>>({})
  const [arrangementPlaybackPositionMs, setArrangementPlaybackPositionMs] = useState(0)
  const [arrangementTransportState, setArrangementTransportState] = useState<{
    phase: 'ready' | 'playing' | 'error'
    message: string
  }>({
    phase: 'ready',
    message: '미리듣기를 시작할 수 있습니다.',
  })
  const [isCompareDrawerOpen, setIsCompareDrawerOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportSelections, setExportSelections] = useState<Record<ExportSelectionKey, boolean>>(defaultExportSelections)
  const [exportPackName, setExportPackName] = useState('')
  const [scoreZoomLevel, setScoreZoomLevel] = useState<ScoreZoomLevel>('100')
  const [scoreViewMode, setScoreViewMode] = useState<ScoreViewMode>('full')
  const arrangementPlaybackRef = useRef<ArrangementPlaybackController | null>(null)

  const selectedTake = takes.find((take) => take.track_id === selectedTakeId) ?? takes[0] ?? null
  const selectedTakeMelody = selectedTake?.latest_melody ?? null
  const selectedArrangement =
    arrangements.find((item) => item.arrangement_id === selectedArrangementId) ?? arrangements[0] ?? null
  const selectedComparisonSummary = selectedArrangement?.comparison_summary ?? null
  const selectedLeadFitLabel = selectedComparisonSummary
    ? formatCompactPercent(selectedComparisonSummary.lead_range_fit_percent)
    : '-'
  const arrangementDurationMs = getArrangementDurationMs(selectedArrangement?.parts_json ?? [])
  const arrangementPlaybackRatio =
    arrangementDurationMs > 0 ? Math.min(1, arrangementPlaybackPositionMs / arrangementDurationMs) : 0
  const constraintReadout = getConstraintReadout(arrangementConfig)
  const scoreScale = getScoreScale(scoreZoomLevel)
  const scoreViewLabel =
    scoreViewMode === 'full' ? '전체 악보' : scoreViewMode === 'section' ? '현재 구간' : '파트 강조'
  const leadPartName =
    selectedArrangement?.parts_json.find((part) => part.role.toUpperCase() === 'MELODY')?.part_name ??
    selectedArrangement?.parts_json[0]?.part_name ??
    null
  const currentGuideMode: GuideMode = !guideModeEnabled ? 'off' : guideFocusPartName ? 'lead' : 'full'
  const estimatedBarCount = selectedArrangement
    ? Math.max(8, Math.min(64, Math.round(arrangementDurationMs / 3500) || 16))
    : 0
  const currentBar = estimatedBarCount
    ? Math.min(estimatedBarCount, Math.max(1, Math.round(arrangementPlaybackRatio * (estimatedBarCount - 1)) + 1))
    : null
  const currentRehearsalMark = currentBar
    ? rehearsalMarks[
        Math.min(
          rehearsalMarks.length - 1,
          Math.floor((currentBar - 1) / Math.max(1, Math.ceil(estimatedBarCount / rehearsalMarks.length))),
        )
      ]
    : '-'
  const selectedArrangementLabel = selectedArrangement
    ? `${selectedArrangement.candidate_code} · ${selectedArrangement.title}`
    : '후보 없음'
  const transportClockLabel = formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)
  const availableExportItems = [
    {
      key: 'xml' as const,
      label: 'MusicXML 받기',
      url: normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url),
    },
    {
      key: 'midi' as const,
      label: 'MIDI 받기',
      url: normalizeAssetUrl(selectedArrangement?.midi_artifact_url),
    },
    {
      key: 'guide' as const,
      label: 'Guide WAV 받기',
      url: normalizeAssetUrl(guide?.guide_wav_artifact_url),
    },
  ]
  const candidateTabs = candidatePlaceholders.map((_, index) => arrangements[index] ?? null)
  const scoreRenderKey = selectedArrangement
    ? `${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`
    : 'empty-arrangement'

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setLoadingState('error')
      setErrorMessage('프로젝트 ID가 없습니다.')
      return
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/studio`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, '편곡 화면을 불러오지 못했습니다.'))
    }

    const payload = (await response.json()) as SnapshotPayload
    setProject(payload.project)
    setGuide(payload.guide)
    setTakes(payload.takes)
    setArrangements(payload.arrangements)
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
    setArrangementTransportState({ phase: 'ready', message: '미리듣기를 시작할 수 있습니다.' })
  }

  useEffect(() => {
    let cancelled = false
    setLoadingState('loading')
    void refreshSnapshot().catch((error) => {
      if (cancelled) {
        return
      }
      setLoadingState('error')
      setErrorMessage(normalizeRequestError(error, '편곡 화면을 불러오지 못했습니다.'))
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

  function handleResetConstraints(): void {
    setArrangementConfig(defaultArrangementConfig)
    setMelodyState({ phase: 'idle' })
    setArrangementState({ phase: 'idle' })
  }

  function handleGuideModeChange(nextMode: GuideMode): void {
    if (nextMode === 'off') {
      setGuideModeEnabled(false)
      setGuideFocusPartName(null)
      return
    }

    setGuideModeEnabled(true)
    if (nextMode === 'lead') {
      setGuideFocusPartName(leadPartName)
      return
    }
    setGuideFocusPartName(null)
  }

  function handleOpenExportModal(): void {
    if (!selectedArrangement) {
      return
    }
    setExportPackName(`${project?.title ?? 'project'}-${selectedArrangement.candidate_code}`)
    setExportSelections({
      xml: Boolean(availableExportItems.find((item) => item.key === 'xml')?.url),
      midi: Boolean(availableExportItems.find((item) => item.key === 'midi')?.url),
      guide: Boolean(availableExportItems.find((item) => item.key === 'guide')?.url),
    })
    setExportState({ phase: 'idle' })
    setIsExportModalOpen(true)
  }

  function handleDownloadExportPack(): void {
    const selectedItems = availableExportItems.filter(
      (item) => item.url && exportSelections[item.key],
    )

    if (selectedItems.length === 0) {
      setExportState({
        phase: 'error',
        message: '내보낼 항목을 하나 이상 고르세요.',
      })
      return
    }

    for (const item of selectedItems) {
      if (item.url) {
        triggerAssetDownload(item.url)
      }
    }

    setExportState({
      phase: 'success',
      message: `${exportPackName || selectedArrangementLabel} 내보내기를 시작했습니다.`,
    })
    setIsExportModalOpen(false)
  }

  async function handleExtractMelody(): Promise<void> {
    if (!projectId || !selectedTake) {
      setMelodyState({
        phase: 'error',
        message: '기준 테이크를 먼저 고르세요.',
      })
      return
    }

    setMelodyState({
      phase: 'submitting',
      message: '멜로디 초안을 추출하고 있습니다...',
    })

    try {
      const response = await fetch(buildApiUrl(`/api/projects/${projectId}/tracks/${selectedTake.track_id}/melody`), {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '멜로디 초안을 추출하지 못했습니다.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraftSummary
      await refreshSnapshot()
      setMelodyState({
        phase: 'success',
        message: `노트 ${melodyDraft.note_count}개를 읽었습니다.`,
      })
    } catch (error) {
      setMelodyState({
        phase: 'error',
        message: normalizeRequestError(error, '멜로디 초안을 추출하지 못했습니다.'),
      })
    }
  }

  async function handleGenerateArrangements(): Promise<void> {
    if (!projectId || !selectedTakeMelody) {
      setArrangementState({
        phase: 'error',
        message: '멜로디 초안을 먼저 준비하세요.',
      })
      return
    }

    setArrangementState({
      phase: 'submitting',
      message: '후보 악보를 생성하고 있습니다...',
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
        throw new Error(await readErrorMessage(response, '후보 악보를 생성하지 못했습니다.'))
      }

      const payload = (await response.json()) as {
        generation_id: string
        items: ArrangementCandidate[]
      }
      setArrangements(payload.items)
      setSelectedArrangementId(payload.items[0]?.arrangement_id ?? null)
      await refreshSnapshot()
      setArrangementState({
        phase: 'success',
        message: `후보 ${payload.items.length}개를 준비했습니다.`,
      })
    } catch (error) {
      setArrangementState({
        phase: 'error',
        message: normalizeRequestError(error, '후보 악보를 생성하지 못했습니다.'),
      })
    }
  }

  async function handlePlayArrangement(): Promise<void> {
    if (!selectedArrangement) {
      setArrangementTransportState({
        phase: 'error',
        message: '후보를 먼저 고르세요.',
      })
      return
    }

    const playableParts = selectedArrangement.parts_json.filter((part) => part.notes.length > 0)
    if (playableParts.length === 0) {
      setArrangementTransportState({
        phase: 'error',
        message: '재생할 노트가 없습니다.',
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
            message: '미리듣기가 끝났습니다.',
          })
        },
      })
      arrangementPlaybackRef.current = controller
      setArrangementTransportState({
        phase: 'playing',
        message: '미리듣기 재생 중',
      })
    } catch (error) {
      setArrangementTransportState({
        phase: 'error',
        message: normalizeRequestError(error, '미리듣기를 시작하지 못했습니다.'),
      })
    }
  }

  if (loadingState === 'loading') {
    return (
      <div className="page-shell arrangement-page">
        <section className="arrangement-loading-state">편곡 화면을 불러오는 중입니다...</section>
      </div>
    )
  }

  if (loadingState === 'error' || !project) {
    return (
      <div className="page-shell arrangement-page">
        <section className="arrangement-loading-state">
          <p className="form-error">{errorMessage}</p>
          <Link className="back-link" to="/">
            처음으로
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell arrangement-page">
      <header className="arrangement-workspace-bar">
        <div className="arrangement-workspace-bar__project">
          <span>{project.title}</span>
        </div>

        <div className="arrangement-workspace-bar__candidates" role="tablist" aria-label="후보 선택">
          {candidateTabs.map((arrangement, index) => {
            const fallbackCode = candidatePlaceholders[index] ?? `${index + 1}`
            const isActive = arrangement?.arrangement_id === selectedArrangement?.arrangement_id
            return (
              <button
                aria-selected={isActive}
                className={`arrangement-candidate-tab${isActive ? ' arrangement-candidate-tab--active' : ''}`}
                disabled={!arrangement}
                key={arrangement?.arrangement_id ?? fallbackCode}
                type="button"
                onClick={() => arrangement && setSelectedArrangementId(arrangement.arrangement_id)}
              >
                <strong>{arrangement?.candidate_code ?? fallbackCode}</strong>
                <span>{arrangement ? `fit ${formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent)}` : '대기'}</span>
              </button>
            )
          })}
        </div>

        <div className="arrangement-workspace-bar__transport" aria-label="상단 미리듣기">
          <button
            className="arrangement-toolbar-button arrangement-toolbar-button--primary"
            disabled={!selectedArrangement}
            type="button"
            onClick={() => void handlePlayArrangement()}
          >
            재생
          </button>
          <button
            className="arrangement-toolbar-button"
            disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
            type="button"
            onClick={() => void stopArrangementPlayback()}
          >
            정지
          </button>
          <span className="arrangement-workspace-bar__clock">{transportClockLabel}</span>
        </div>

        <div className="arrangement-workspace-bar__utilities">
          <Link className="arrangement-toolbar-button" to={`/projects/${projectId}/studio#arrangement`}>
            스튜디오
          </Link>
          <button
            className="arrangement-toolbar-button"
            disabled={arrangements.length < 2}
            type="button"
            onClick={() => setIsCompareDrawerOpen(true)}
          >
            후보 비교
          </button>
          <button
            className="arrangement-toolbar-button arrangement-toolbar-button--primary"
            disabled={!selectedArrangement || availableExportItems.every((item) => !item.url)}
            type="button"
            onClick={handleOpenExportModal}
          >
            내보내기
          </button>
        </div>
      </header>

      <section className="arrangement-workspace">
        <aside className="arrangement-panel arrangement-panel--left" aria-label="제약">
          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h1>제약</h1>
            </div>

            <div className="arrangement-form-grid">
              <label className="arrangement-field">
                <span>style</span>
                <select
                  value={arrangementConfig.style}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({ ...current, style: event.target.value }))
                  }
                >
                  <option value="contemporary">Contemporary choir</option>
                  <option value="ballad">Ballad</option>
                  <option value="anthem">Anthem</option>
                </select>
              </label>

              <label className="arrangement-field">
                <span>difficulty</span>
                <select
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

              <label className="arrangement-field">
                <span>voice range preset</span>
                <select
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
              <label className="arrangement-field">
                <span>beatbox</span>
                <select
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

            <dl className="arrangement-readout-list">
              <div>
                <dt>max leap</dt>
                <dd>{constraintReadout.maxLeap}</dd>
              </div>
              <div>
                <dt>avoid parallel</dt>
                <dd>{constraintReadout.avoidParallel}</dd>
              </div>
            </dl>
          </section>

          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>생성</h2>
            </div>

            <label className="arrangement-field">
              <span>기준 테이크</span>
              <select
                value={selectedTake?.track_id ?? ''}
                onChange={(event) => setSelectedTakeId(event.target.value || null)}
              >
                {takes.map((take) => (
                  <option key={take.track_id} value={take.track_id}>
                    {`${take.take_no ?? '?'}번 테이크 · ${getTrackStatusLabel(take.track_status)}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="arrangement-generation-actions">
              <button
                className="arrangement-toolbar-button"
                disabled={melodyState.phase === 'submitting'}
                type="button"
                onClick={() => void handleExtractMelody()}
              >
                {melodyState.phase === 'submitting' ? '추출 중' : '후보 다시 생성'}
              </button>
              <button className="arrangement-toolbar-button" type="button" onClick={handleResetConstraints}>
                제약 초기화
              </button>
              <button
                className="arrangement-toolbar-button arrangement-toolbar-button--primary"
                disabled={arrangementState.phase === 'submitting' || !selectedTakeMelody}
                type="button"
                onClick={() => void handleGenerateArrangements()}
              >
                {arrangementState.phase === 'submitting' ? '생성 중' : '편곡 후보 생성'}
              </button>
            </div>

            {melodyState.phase !== 'idle' ? (
              <p className={melodyState.phase === 'error' ? 'form-error arrangement-inline-feedback' : 'arrangement-inline-feedback'}>
                {melodyState.message}
              </p>
            ) : null}
            {arrangementState.phase !== 'idle' ? (
              <p
                className={
                  arrangementState.phase === 'error'
                    ? 'form-error arrangement-inline-feedback'
                    : 'arrangement-inline-feedback'
                }
              >
                {arrangementState.message}
              </p>
            ) : null}
          </section>

          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>후보 요약</h2>
            </div>

            <dl className="arrangement-summary-metrics">
              <div>
                <dt>lead fit</dt>
                <dd>{selectedLeadFitLabel}</dd>
              </div>
              <div>
                <dt>max leap</dt>
                <dd>{selectedComparisonSummary?.support_max_leap ?? '-'}</dd>
              </div>
              <div>
                <dt>parallel alerts</dt>
                <dd>{selectedComparisonSummary?.parallel_motion_alerts ?? '-'}</dd>
              </div>
              <div>
                <dt>beatbox hits</dt>
                <dd>{selectedComparisonSummary?.beatbox_note_count ?? '-'}</dd>
              </div>
            </dl>

            <dl className="arrangement-compact-facts">
              <div>
                <dt>기준 테이크</dt>
                <dd>{selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '-'}</dd>
              </div>
              <div>
                <dt>멜로디</dt>
                <dd>{selectedTakeMelody ? `노트 ${selectedTakeMelody.note_count}개` : '없음'}</dd>
              </div>
              <div>
                <dt>style</dt>
                <dd>{getArrangementStyleLabel(arrangementConfig.style)}</dd>
              </div>
              <div>
                <dt>voice range</dt>
                <dd>{getOptionLabel(voiceRangeOptions, arrangementConfig.voiceRangePreset)}</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className="arrangement-panel arrangement-panel--center" aria-label="악보">
          <div className="arrangement-score-header">
            <div>
              <h2>{selectedArrangement ? `Candidate ${selectedArrangement.candidate_code}` : 'Candidate'}</h2>
              <p>
                {selectedArrangement
                  ? `${getArrangementStyleLabel(selectedArrangement.style)} / ${getDifficultyLabel(selectedArrangement.difficulty)} / ${selectedArrangement.part_count} voices`
                  : '후보를 만들면 악보가 표시됩니다.'}
              </p>
            </div>

            <div className="arrangement-score-header__controls">
              <label className="arrangement-compact-select">
                <span>Zoom</span>
                <select value={scoreZoomLevel} onChange={(event) => setScoreZoomLevel(event.target.value as ScoreZoomLevel)}>
                  <option value="75">75%</option>
                  <option value="100">100%</option>
                  <option value="125">125%</option>
                  <option value="fit">맞춤</option>
                </select>
              </label>

              <label className="arrangement-compact-select">
                <span>보기</span>
                <select value={scoreViewMode} onChange={(event) => setScoreViewMode(event.target.value as ScoreViewMode)}>
                  <option value="full">전체 악보</option>
                  <option value="section">현재 구간</option>
                  <option value="focus">파트 강조</option>
                </select>
              </label>
            </div>
          </div>

          <div className="arrangement-score-paper">
            <div
              className="arrangement-score-paper__inner"
              data-view-mode={scoreViewMode}
              style={{ '--arrangement-score-scale': String(scoreScale) } as CSSProperties}
            >
              <ArrangementScore
                musicXmlUrl={normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url)}
                playheadRatio={arrangementPlaybackRatio}
                renderKey={scoreRenderKey}
              />
            </div>
          </div>

          <div className="arrangement-bar-strip">
            <strong>{currentBar ? `현재 마디 ${currentBar}` : '현재 마디 -'}</strong>
            <button className="arrangement-strip-button" disabled type="button">
              이전 리허설 마크
            </button>
            <button className="arrangement-strip-button" disabled type="button">
              다음 리허설 마크
            </button>
            <button className="arrangement-strip-button" disabled type="button">
              현재 섹션 반복
            </button>
          </div>

          <div className="arrangement-score-footer">
            <span>{transportClockLabel}</span>
            <span>{scoreViewLabel}</span>
            <span>{currentRehearsalMark}</span>
            <span>{selectedArrangement ? `${selectedArrangement.part_count}성부` : '-'}</span>
          </div>
        </section>

        <aside className="arrangement-panel arrangement-panel--right" aria-label="재생과 내보내기">
          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>Playback</h2>
            </div>

            <div className="arrangement-transport-stack">
              <div className="arrangement-transport-buttons">
                <button
                  className="arrangement-toolbar-button arrangement-toolbar-button--primary"
                  disabled={!selectedArrangement}
                  type="button"
                  onClick={() => void handlePlayArrangement()}
                >
                  재생
                </button>
                <button
                  className="arrangement-toolbar-button"
                  disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
                  type="button"
                  onClick={() => void stopArrangementPlayback()}
                >
                  정지
                </button>
                <button
                  className="arrangement-toolbar-button"
                  disabled={arrangementPlaybackPositionMs === 0}
                  type="button"
                  onClick={() => setArrangementPlaybackPositionMs(0)}
                >
                  처음으로
                </button>
              </div>
              <strong className="arrangement-transport-clock">{transportClockLabel}</strong>
              <p
                className={
                  arrangementTransportState.phase === 'error'
                    ? 'form-error arrangement-inline-feedback'
                    : 'arrangement-inline-feedback'
                }
              >
                {arrangementTransportState.message}
              </p>
            </div>
          </section>

          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>Part mixer</h2>
            </div>

            <div className="arrangement-mixer-list">
              {(selectedArrangement?.parts_json ?? []).map((part, index) => {
                const partMixer = arrangementPartMixerState[part.part_name] ?? {
                  enabled: true,
                  solo: false,
                  volume: getDefaultArrangementPartVolume(part.role),
                }
                return (
                  <div className="arrangement-mixer-row" key={part.part_name}>
                    <div className="arrangement-mixer-row__identity">
                      <span
                        className="arrangement-mixer-row__swatch"
                        style={{ backgroundColor: getArrangementPartColor(part.role, index) }}
                      />
                      <div>
                        <strong>{part.part_name}</strong>
                        <span>{getArrangementPartRoleLabel(part.role)}</span>
                      </div>
                    </div>
                    <button
                      aria-pressed={partMixer.solo}
                      className={`arrangement-mixer-button${partMixer.solo ? ' arrangement-mixer-button--active' : ''}`}
                      type="button"
                      onClick={() => updateArrangementPartMixer(part.part_name, { solo: !partMixer.solo })}
                    >
                      S
                    </button>
                    <button
                      aria-pressed={!partMixer.enabled}
                      className={`arrangement-mixer-button${!partMixer.enabled ? ' arrangement-mixer-button--active' : ''}`}
                      type="button"
                      onClick={() => updateArrangementPartMixer(part.part_name, { enabled: !partMixer.enabled })}
                    >
                      M
                    </button>
                    <input
                      aria-label={`${part.part_name} 볼륨`}
                      max={1}
                      min={0}
                      step={0.05}
                      type="range"
                      value={partMixer.volume}
                      onChange={(event) =>
                        updateArrangementPartMixer(part.part_name, { volume: Number(event.target.value) })
                      }
                    />
                  </div>
                )
              })}
              {selectedArrangement?.parts_json.length ? null : (
                <p className="arrangement-inline-feedback">후보를 고르면 파트 믹서가 열립니다.</p>
              )}
            </div>
          </section>

          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>Guide mode</h2>
            </div>

            <div className="arrangement-guide-mode">
              <button
                aria-pressed={currentGuideMode === 'off'}
                className={`arrangement-guide-button${currentGuideMode === 'off' ? ' arrangement-guide-button--active' : ''}`}
                type="button"
                onClick={() => handleGuideModeChange('off')}
              >
                Guide 없음
              </button>
              <button
                aria-pressed={currentGuideMode === 'lead'}
                className={`arrangement-guide-button${currentGuideMode === 'lead' ? ' arrangement-guide-button--active' : ''}`}
                disabled={!selectedArrangement}
                type="button"
                onClick={() => handleGuideModeChange('lead')}
              >
                Lead 기준
              </button>
              <button
                aria-pressed={currentGuideMode === 'full'}
                className={`arrangement-guide-button${currentGuideMode === 'full' ? ' arrangement-guide-button--active' : ''}`}
                disabled={!selectedArrangement}
                type="button"
                onClick={() => handleGuideModeChange('full')}
              >
                전체 겹치기
              </button>
            </div>
          </section>

          <section className="arrangement-block">
            <div className="arrangement-block__header">
              <h2>Export</h2>
            </div>

            <div className="arrangement-export-list">
              {availableExportItems.map((item) =>
                item.url ? (
                  <a
                    className={`arrangement-export-link${item.key === 'guide' ? ' arrangement-export-link--primary' : ''}`}
                    href={item.url}
                    key={item.key}
                  >
                    {item.label}
                  </a>
                ) : null,
              )}
              {availableExportItems.every((item) => !item.url) ? (
                <p className="arrangement-inline-feedback">받을 수 있는 파일이 아직 없습니다.</p>
              ) : null}
              {exportState.phase !== 'idle' ? (
                <p className={exportState.phase === 'error' ? 'form-error arrangement-inline-feedback' : 'arrangement-inline-feedback'}>
                  {exportState.message}
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </section>

      {isCompareDrawerOpen ? (
        <div
          className="arrangement-surface-overlay arrangement-surface-overlay--drawer"
          onClick={() => setIsCompareDrawerOpen(false)}
        >
          <aside
            aria-label="후보 비교"
            className="arrangement-surface-panel arrangement-surface-panel--drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="arrangement-surface-panel__header">
              <h2>후보 비교</h2>
              <button className="arrangement-toolbar-button" type="button" onClick={() => setIsCompareDrawerOpen(false)}>
                닫기
              </button>
            </div>

            <div className="arrangement-compare-grid">
              {arrangements.map((arrangement) => (
                <section className="arrangement-compare-column" key={arrangement.arrangement_id}>
                  <header>
                    <strong>{arrangement.candidate_code}</strong>
                    <span>{arrangement.title}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>lead fit</dt>
                      <dd>{formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent)}</dd>
                    </div>
                    <div>
                      <dt>max leap</dt>
                      <dd>{arrangement.comparison_summary?.support_max_leap ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>parallel alerts</dt>
                      <dd>{arrangement.comparison_summary?.parallel_motion_alerts ?? '-'}</dd>
                    </div>
                    <div>
                      <dt>beatbox hits</dt>
                      <dd>{arrangement.comparison_summary?.beatbox_note_count ?? '-'}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

      {isExportModalOpen ? (
        <div
          className="arrangement-surface-overlay arrangement-surface-overlay--modal"
          onClick={() => setIsExportModalOpen(false)}
        >
          <div
            aria-label="내보내기"
            className="arrangement-surface-panel arrangement-surface-panel--modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="arrangement-surface-panel__header">
              <h2>내보내기</h2>
              <button className="arrangement-toolbar-button" type="button" onClick={() => setIsExportModalOpen(false)}>
                닫기
              </button>
            </div>

            <label className="arrangement-field">
              <span>export name</span>
              <input
                type="text"
                value={exportPackName}
                onChange={(event) => setExportPackName(event.target.value)}
              />
            </label>

            <div className="arrangement-export-checkboxes">
              {availableExportItems.map((item) => (
                <label className="arrangement-export-checkbox" key={item.key}>
                  <input
                    checked={item.url ? exportSelections[item.key] : false}
                    disabled={!item.url}
                    type="checkbox"
                    onChange={(event) =>
                      setExportSelections((current) => ({
                        ...current,
                        [item.key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            {exportState.phase === 'error' ? <p className="form-error">{exportState.message}</p> : null}

            <div className="arrangement-surface-panel__footer">
              <button className="arrangement-toolbar-button" type="button" onClick={() => setIsExportModalOpen(false)}>
                취소
              </button>
              <button className="arrangement-toolbar-button arrangement-toolbar-button--primary" type="button" onClick={handleDownloadExportPack}>
                내보내기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
