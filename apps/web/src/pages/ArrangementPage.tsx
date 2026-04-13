import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { buildApiUrl } from '../lib/api'
import { getArrangementPartRoleLabel, getTrackStatusLabel } from '../lib/localizedLabels'
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
  { value: 'beginner', label: '입문', description: '도약을 짧게 유지하고 받쳐주는 성부를 더 안전하게 만듭니다.' },
  { value: 'basic', label: '기본', description: '움직임과 안정감이 균형 잡힌 기본 프리셋입니다.' },
  { value: 'strict', label: '엄격', description: '도약을 더 강하게 제한하고 위험한 진행을 더 많이 피합니다.' },
] as const

const voiceRangeOptions = [
  { value: 'soprano', label: '소프라노(S)', description: '높은 리드 라인을 기준으로 편곡합니다.' },
  { value: 'alto', label: '알토(A)', description: '가장 무난한 기본 리드 음역입니다.' },
  { value: 'tenor', label: '테너(T)', description: '낮은 리드 라인을 중심으로 편곡합니다.' },
  { value: 'bass', label: '베이스(B)', description: '가장 낮은 리드 음역을 기준으로 잡습니다.' },
  { value: 'baritone', label: '바리톤', description: '중저역 리드에 맞춘 절충형 프리셋입니다.' },
] as const

const beatboxOptions = [
  { value: 'off', label: '사용 안 함', description: '비트박스 레이어를 추가하지 않습니다.' },
  { value: 'pulse', label: '펄스', description: '킥과 스네어가 단순하게 반복되는 기본 패턴입니다.' },
  { value: 'drive', label: '드라이브', description: '킥이 조금 더 촘촘하게 들어가는 추진형 패턴입니다.' },
  { value: 'halftime', label: '하프타임', description: '여백이 넓은 느린 백비트 패턴입니다.' },
  { value: 'syncopated', label: '싱코페이션', description: '엇박 강조가 들어간 더 생동감 있는 패턴입니다.' },
] as const

function getOptionMeta<T extends { value: string }>(options: readonly T[], value: string | null | undefined): T {
  return options.find((option) => option.value === value) ?? options[0]!
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '없음'
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
  const [errorMessage, setErrorMessage] = useState('편곡 작업 화면을 불러오지 못했습니다.')
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
    message: '편곡 미리듣기를 시작할 수 있습니다.',
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
      setErrorMessage('프로젝트 ID가 없습니다.')
      return
    }

    const response = await fetch(buildApiUrl(`/api/projects/${projectId}/studio`))
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, '편곡 작업 화면을 불러오지 못했습니다.'))
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
    setArrangementTransportState({ phase: 'ready', message: '편곡 미리듣기를 시작할 수 있습니다.' })
  }

  useEffect(() => {
    let cancelled = false
    setLoadingState('loading')
    void refreshSnapshot().catch((error) => {
      if (cancelled) {
        return
      }
      setLoadingState('error')
      setErrorMessage(error instanceof Error ? error.message : '편곡 작업 화면을 불러오지 못했습니다.')
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
        message: '멜로디 초안을 추출하기 전에 테이크를 먼저 선택해 주세요.',
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
        { method: 'POST' },
      )
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '멜로디 초안을 추출하지 못했습니다.'))
      }

      const melodyDraft = (await response.json()) as MelodyDraftSummary
      await refreshSnapshot()
      setMelodyState({
        phase: 'success',
        message: `멜로디 초안을 저장했습니다. 노트 ${melodyDraft.note_count}개, 키는 ${melodyDraft.key_estimate ?? '추정 중'}입니다.`,
      })
    } catch (error) {
      setMelodyState({
        phase: 'error',
        message: error instanceof Error ? error.message : '멜로디 초안을 추출하지 못했습니다.',
      })
    }
  }

  async function handleGenerateArrangements(): Promise<void> {
    if (!projectId || !selectedTakeMelody) {
      setArrangementState({
        phase: 'error',
        message: '편곡 후보를 만들기 전에 멜로디 초안을 먼저 추출해 주세요.',
      })
      return
    }

    setArrangementState({
      phase: 'submitting',
      message: '최신 멜로디 초안으로 편곡 후보를 생성하는 중입니다...',
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
        throw new Error(await readErrorMessage(response, '편곡 후보를 생성하지 못했습니다.'))
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
        message: `비교할 수 있는 편곡 후보 ${payload.items.length}개를 준비했습니다.`,
      })
    } catch (error) {
      setArrangementState({
        phase: 'error',
        message: error instanceof Error ? error.message : '편곡 후보를 생성하지 못했습니다.',
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
        message: '재생을 시작하기 전에 편곡 후보를 먼저 선택해 주세요.',
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
            phase: 'ready',
            message: '편곡 미리듣기가 끝났습니다. 다른 후보를 비교하거나 여기서 내보낼 수 있습니다.',
          })
        },
      })
      arrangementPlaybackRef.current = controller
      setArrangementTransportState({
        phase: 'playing',
        message: '분리된 편곡 미리듣기 엔진으로 재생 중입니다.',
      })
    } catch (error) {
      setArrangementTransportState({
        phase: 'error',
        message: error instanceof Error ? error.message : '편곡 미리듣기에 실패했습니다.',
      })
    }
  }

  if (loadingState === 'loading') {
    return <div className="page-shell"><section className="panel"><p>편곡 작업 화면을 불러오는 중입니다...</p></section></div>
  }

  if (loadingState === 'error' || !project) {
    return (
      <div className="page-shell">
        <section className="panel">
          <p className="form-error">{errorMessage}</p>
          <Link className="back-link" to="/">홈으로 돌아가기</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell arrangement-page">
      <section className="arrangement-shell">
        <div className="arrangement-topbar">
          <div className="arrangement-tabs" role="tablist" aria-label="편곡 후보">
            {arrangements.length === 0 ? (
              <span className="arrangement-tab arrangement-tab--empty">아직 후보가 없습니다</span>
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
            <span>미리듣기 {formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}</span>
          </div>

          <div className="arrangement-topbar__actions">
            <button
              className="button-primary"
              disabled={selectedArrangement === null}
              type="button"
              onClick={() => void handlePlayArrangement()}
            >
              미리듣기 재생
            </button>
            <button
              className="button-secondary"
              disabled={arrangementPlaybackPositionMs === 0 && arrangementTransportState.phase !== 'playing'}
              type="button"
              onClick={() => void stopArrangementPlayback()}
            >
              정지
            </button>
            <Link className="back-link" to={`/projects/${projectId}/studio#arrangement`}>
              스튜디오로 돌아가기
            </Link>
          </div>
        </div>

        <div className="arrangement-grid">
          <aside className="panel arrangement-rail arrangement-rail--left">
            <div>
              <p className="eyebrow">왼쪽 레일</p>
              <h1>테이크에 맞는 화음 구성을 고르세요</h1>
              <p className="panel__summary">
                후보 성부를 비교하고, 미리듣기로 확인한 뒤, 악보 패키지로 내보낼 수 있습니다.
              </p>
            </div>

            <div className="field-grid arrangement-field-grid">
              <label className="field">
                <span>기준 테이크</span>
                <select
                  className="text-input"
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

              <label className="field">
                <span>스타일</span>
                <select
                  className="text-input"
                  value={arrangementConfig.style}
                  onChange={(event) =>
                    setArrangementConfig((current) => ({ ...current, style: event.target.value }))
                  }
                >
                  <option value="contemporary">컨템퍼러리</option>
                  <option value="ballad">발라드</option>
                  <option value="anthem">앤섬</option>
                </select>
              </label>

              <label className="field">
                <span>난이도</span>
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
                <span>리드 음역</span>
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
                <span>비트박스</span>
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
                {melodyState.phase === 'submitting' ? '멜로디 추출 중...' : '멜로디 초안 추출'}
              </button>
              <button
                className="button-primary"
                disabled={arrangementState.phase === 'submitting'}
                type="button"
                onClick={() => void handleGenerateArrangements()}
              >
                {arrangementState.phase === 'submitting'
                  ? '후보 생성 중...'
                  : '편곡 후보 생성'}
              </button>
            </div>

            <div className="arrangement-summary-block">
              <div className="mini-card mini-card--stack">
                <span>멜로디 초안</span>
                <strong>{selectedTakeMelody ? `노트 ${selectedTakeMelody.note_count}개` : '아직 없음'}</strong>
                <small>
                  {selectedTakeMelody
                    ? `${selectedTakeMelody.key_estimate ?? '키 추정 중'} · ${selectedTakeMelody.grid_division}`
                    : '선택한 테이크에서 최신 멜로디 초안을 먼저 추출해 주세요.'}
                </small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>난이도 프리셋</span>
                <strong>{selectedDifficultyMeta.label}</strong>
                <small>{selectedDifficultyMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>리드 음역</span>
                <strong>{selectedVoiceRangeMeta.label}</strong>
                <small>{selectedVoiceRangeMeta.description}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>비트박스</span>
                <strong>{selectedBeatboxMeta.label}</strong>
                <small>{selectedBeatboxMeta.description}</small>
              </div>
            </div>

            {selectedArrangement ? (
              <div className="arrangement-compare-card">
                <p className="eyebrow">후보 비교</p>
                <strong>{`${selectedArrangement.candidate_code} · ${selectedArrangement.title}`}</strong>
                <div className="arrangement-compare-list">
                  <span>리드 적합도: {formatCompactPercent(selectedArrangement.comparison_summary?.lead_range_fit_percent)}</span>
                  <span>최대 도약: {selectedArrangement.comparison_summary?.support_max_leap ?? '없음'} 반음</span>
                  <span>병행 경고: {selectedArrangement.comparison_summary?.parallel_motion_alerts ?? 0}</span>
                  <span>비트박스 타격 수: {selectedArrangement.comparison_summary?.beatbox_note_count ?? 0}</span>
                </div>
              </div>
            ) : (
              <div className="empty-card">
                <p>아직 편곡 후보가 없습니다.</p>
                <p>멜로디를 추출한 뒤 A/B/C 후보를 생성하면 악보 중심 작업 화면을 열 수 있습니다.</p>
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
                <p className="eyebrow">악보 캔버스</p>
                <h2>편곡을 미리 듣고 악보 패키지로 내보내세요</h2>
              </div>
              <div className="candidate-chip-row">
                <span className="candidate-chip">
                  {arrangementGenerationId ? arrangementGenerationId.slice(0, 8) : '배치 없음'}
                </span>
                {selectedArrangement ? (
                  <span className="candidate-chip">{selectedArrangement.part_count}성부</span>
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
                  <span>{selectedArrangement ? `${selectedArrangement.part_count}성부` : '선택한 편곡이 없습니다'}</span>
                </div>
                <div className="transport-progress" aria-hidden="true">
                  <div
                    className="transport-progress__fill"
                    style={{ width: `${Math.min(100, arrangementPlaybackRatio * 100)}%` }}
                  />
                </div>
              </div>

              <Link className="button-secondary" to={`/projects/${projectId}/studio#score-playback`}>
                스튜디오에서 자세히 수정하기
              </Link>
            </div>
          </section>

          <aside className="panel arrangement-rail arrangement-rail--right">
            <div>
              <p className="eyebrow">오른쪽 레일</p>
              <h2>파트 집중과 내보내기</h2>
            </div>

            <div className="button-row">
              {selectedArrangement?.musicxml_artifact_url ? (
                <a className="button-primary" href={selectedArrangement.musicxml_artifact_url}>
                  MusicXML 내보내기
                </a>
              ) : null}
              {selectedArrangement?.midi_artifact_url ? (
                <a className="button-secondary" href={selectedArrangement.midi_artifact_url}>
                  편곡 MIDI 내보내기
                </a>
              ) : null}
              {guide?.guide_wav_artifact_url ? (
                <a className="button-secondary" href={guide.guide_wav_artifact_url}>
                  가이드 WAV 내보내기
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
                <strong>가이드 모드</strong>
                <span>선택한 기준 파트를 더 또렷하게 두고 나머지 성부는 한걸음 뒤로 물립니다.</span>
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
                          <span>{`${getArrangementPartRoleLabel(part.role)} | 노트 ${part.notes.length}개`}</span>
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
                        <span>사용</span>
                      </label>

                      <button
                        className={`button-secondary button-secondary--small ${partMixer.solo ? 'button-secondary--active' : ''}`}
                        type="button"
                        onClick={() =>
                          updateArrangementPartMixer(part.part_name, { solo: !partMixer.solo })
                        }
                      >
                        {partMixer.solo ? '솔로 켜짐' : '솔로'}
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
                        {isGuideFocus ? '가이드 기준' : '기준으로 지정'}
                      </button>

                      <label className="arrangement-part-volume">
                        <span>음량</span>
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
                <p>아직 파트 제어를 열 수 없습니다.</p>
                <p>후보를 선택하거나 생성하면 솔로, 기준 지정, 내보내기 도구를 사용할 수 있습니다.</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}
