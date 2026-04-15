import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { WorkspaceFlowBar } from '../components/WorkspaceFlowBar'
import { buildApiUrl, normalizeAssetUrl } from '../lib/api'
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
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('편곡 작업 화면을 불러오지 못했습니다.')
  const [arrangementConfig, setArrangementConfig] = useState(defaultArrangementConfig)
  const [melodyState, setMelodyState] = useState<ActionState>({ phase: 'idle' })
  const [arrangementState, setArrangementState] = useState<ActionState>({ phase: 'idle' })
  const [workspaceMode, setWorkspaceMode] = useState<'compare' | 'review' | 'export'>('compare')
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
  const selectedVoiceRangeMeta = getOptionMeta(voiceRangeOptions, arrangementConfig.voiceRangePreset)
  const selectedBeatboxMeta = getOptionMeta(beatboxOptions, arrangementConfig.beatboxTemplate)
  const selectedStyleLabel = getArrangementStyleLabel(arrangementConfig.style)
  const selectedDifficultyLabel = getDifficultyLabel(arrangementConfig.difficulty)
  const selectedComparisonSummary = selectedArrangement?.comparison_summary ?? null
  const studioRecordingRoute = projectId ? `/projects/${projectId}/studio#recording` : '/'
  const studioSharingRoute = projectId ? `/projects/${projectId}/studio#sharing` : '/'
  const selectedArrangementLabel = selectedArrangement
    ? `${selectedArrangement.candidate_code} · ${selectedArrangement.title}`
    : '아직 선택한 후보가 없습니다'
  const selectedTakeLabel = selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '선택 전'
  const selectedLeadFitLabel = selectedComparisonSummary
    ? formatCompactPercent(selectedComparisonSummary.lead_range_fit_percent)
    : '계산 전'
  const arrangementFlowItems = [
    {
      id: 'arrangement-studio',
      step: '1단계',
      label: '녹음실',
      summary: '테이크를 다시 고르거나 보정 피드백으로 돌아갑니다.',
      to: studioRecordingRoute,
    },
    {
      id: 'arrangement-workspace',
      step: '2단계',
      label: '편곡 작업',
      summary: '후보를 비교하고 악보와 미리듣기로 바로 결정합니다.',
      current: true,
    },
    {
      id: 'arrangement-sharing',
      step: '3단계',
      label: '공유 준비',
      summary: '확정한 결과를 버전과 공유 흐름으로 넘깁니다.',
      to: studioSharingRoute,
    },
  ]

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
      setSelectedArrangementId(payload.items[0]?.arrangement_id ?? null)
      setWorkspaceMode('compare')
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
        message: '편곡 미리듣기를 재생 중입니다.',
      })
      setWorkspaceMode('review')
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
        <div className="arrangement-topbar arrangement-topbar--workspace">
          <div className="arrangement-topbar__copy">
            <p className="eyebrow">편곡 워크스페이스</p>
            <h1>후보를 바꿔 듣고 악보 기준으로 바로 고르세요</h1>
            <p className="arrangement-topbar__summary">
              왼쪽에서 후보와 제약을 고르고, 가운데에서 미리듣기와 악보를 검토한 뒤, 오른쪽
              inspector에서 파트 집중과 내보내기를 마무리합니다.
            </p>
          </div>

          <div className="arrangement-status-cluster" aria-label="현재 편곡 상태">
            <div className="arrangement-status-chip">
              <span>프로젝트</span>
              <strong>{project.title}</strong>
            </div>
            <div className="arrangement-status-chip">
              <span>기준 테이크</span>
              <strong>{selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '선택 전'}</strong>
            </div>
            <div className="arrangement-status-chip">
              <span>선택 후보</span>
              <strong>{selectedArrangement ? selectedArrangement.candidate_code : '없음'}</strong>
            </div>
            <div className="arrangement-status-chip">
              <span>리드 적합도</span>
              <strong>{selectedLeadFitLabel}</strong>
            </div>
            <div className="arrangement-status-chip">
              <span>미리듣기</span>
              <strong>{formatPlaybackClock(arrangementPlaybackPositionMs, arrangementDurationMs)}</strong>
            </div>
          </div>

          <div className="arrangement-topbar__actions">
            <Link className="back-link" to={`/projects/${projectId}/studio#arrangement`}>
              스튜디오로 돌아가기
            </Link>
          </div>
        </div>

        <WorkspaceFlowBar
          ariaLabel="편곡 작업 이동"
          eyebrow="작업 이동"
          items={arrangementFlowItems}
          summary="녹음실에서 준비한 테이크를 바탕으로 편곡을 고르고, 끝나면 공유 준비로 바로 넘깁니다."
          title="편곡 화면도 한 흐름 안에서 이어집니다"
        />

        <div className="arrangement-grid">
          <aside
            className={`panel arrangement-rail arrangement-rail--left arrangement-workspace-panel ${
              workspaceMode === 'compare' ? 'arrangement-workspace-panel--active' : ''
            }`}
          >
            <div className="arrangement-rack__section arrangement-rack__section--modes">
              <div className="arrangement-rack__head">
                <p className="eyebrow">작업 흐름</p>
                <h2>왼쪽에서는 핵심만 고릅니다</h2>
                <p className="panel__summary">
                  후보를 고르고, 보고 싶은 화면을 바꾼 뒤, 자세한 조건은 필요할 때만 펼쳐서 손봅니다.
                </p>
              </div>

              <div className="arrangement-mode-switch" role="tablist" aria-label="편곡 작업 흐름">
                <button
                  aria-selected={workspaceMode === 'compare'}
                  className={`arrangement-mode-button ${
                    workspaceMode === 'compare' ? 'arrangement-mode-button--active' : ''
                  }`}
                  type="button"
                  onClick={() => setWorkspaceMode('compare')}
                >
                  <span>1단계</span>
                  <strong>후보 고르기</strong>
                </button>
                <button
                  aria-selected={workspaceMode === 'review'}
                  className={`arrangement-mode-button ${
                    workspaceMode === 'review' ? 'arrangement-mode-button--active' : ''
                  }`}
                  type="button"
                  onClick={() => setWorkspaceMode('review')}
                >
                  <span>2단계</span>
                  <strong>악보 보기</strong>
                </button>
                <button
                  aria-selected={workspaceMode === 'export'}
                  className={`arrangement-mode-button ${
                    workspaceMode === 'export' ? 'arrangement-mode-button--active' : ''
                  }`}
                  type="button"
                  onClick={() => setWorkspaceMode('export')}
                >
                  <span>3단계</span>
                  <strong>내보내기</strong>
                </button>
              </div>
            </div>

            <div className="arrangement-rack__section">
              <div className="arrangement-rack__head">
                <p className="eyebrow">후보 랙</p>
                <h2>후보와 제약</h2>
                <p className="panel__summary">
                  먼저 후보를 고른 뒤, 아래 제약과 기준 테이크를 조정하면서 악보 미리듣기를 바로
                  비교합니다.
                </p>
              </div>

              <div className="arrangement-candidate-list" role="tablist" aria-label="편곡 후보">
                {arrangements.length === 0 ? (
                  <span className="arrangement-tab arrangement-tab--empty">아직 후보가 없습니다</span>
                ) : (
                  arrangements.map((arrangement) => (
                    <button
                      key={arrangement.arrangement_id}
                      aria-selected={selectedArrangement?.arrangement_id === arrangement.arrangement_id}
                      className={`arrangement-tab arrangement-tab--rack ${
                        selectedArrangement?.arrangement_id === arrangement.arrangement_id
                          ? 'arrangement-tab--active'
                          : ''
                      }`}
                      type="button"
                      onClick={() => {
                        setSelectedArrangementId(arrangement.arrangement_id)
                        setWorkspaceMode('review')
                      }}
                    >
                      <strong>{`${arrangement.candidate_code} · ${arrangement.title}`}</strong>
                      <span>
                        {`리드 적합도 ${formatCompactPercent(arrangement.comparison_summary?.lead_range_fit_percent)} · 병행 경고 ${arrangement.comparison_summary?.parallel_motion_alerts ?? 0}`}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="arrangement-summary-block arrangement-summary-block--compact">
              <div className="mini-card mini-card--stack">
                <span>기준 테이크</span>
                <strong>{selectedTakeLabel}</strong>
                <small>
                  {selectedTake
                    ? `${getTrackStatusLabel(selectedTake.track_status)} · 멜로디 ${selectedTakeMelody ? '준비됨' : '아직 없음'}`
                    : '편곡의 기준이 되는 테이크를 먼저 골라 주세요.'}
                </small>
              </div>
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
                <span>이번 만들기 기준</span>
                <strong>{`${selectedStyleLabel} · ${selectedDifficultyLabel}`}</strong>
                <small>{`${selectedVoiceRangeMeta.label} · ${selectedBeatboxMeta.label}`}</small>
              </div>
            </div>

            <details
              className="advanced-panel arrangement-advanced-panel"
              open={
                workspaceMode === 'compare' ||
                melodyState.phase === 'error' ||
                arrangementState.phase === 'error'
              }
            >
              <summary className="advanced-panel__summary">세부 조건 조정</summary>
              <div className="advanced-panel__body arrangement-advanced-panel__body">
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
              </div>
            </details>

            {selectedArrangement ? (
              <div className="arrangement-compare-card">
                <p className="eyebrow">선택 후보</p>
                <strong>{selectedArrangementLabel}</strong>
                <div className="arrangement-compare-list">
                  <span>리드 적합도: {selectedLeadFitLabel}</span>
                  <span>최대 도약: {selectedComparisonSummary?.support_max_leap ?? '없음'} 반음</span>
                  <span>병행 경고: {selectedComparisonSummary?.parallel_motion_alerts ?? 0}</span>
                  <span>비트박스 타격 수: {selectedComparisonSummary?.beatbox_note_count ?? 0}</span>
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

          <section
            className={`panel arrangement-center arrangement-workspace-panel ${
              workspaceMode === 'review' ? 'arrangement-workspace-panel--active' : ''
            }`}
          >
            <div className="arrangement-center__header">
              <div>
                <p className="eyebrow">악보와 미리듣기</p>
                <h2>{selectedArrangement ? `${selectedArrangement.candidate_code} 악보 미리듣기` : '후보를 선택해 악보를 검토하세요'}</h2>
                <p className="panel__summary">
                  재생, 정지, 가이드 겹치기를 같은 화면에서 다루고, 재생 위치와 악보 진행 위치를 같이
                  확인합니다.
                </p>
              </div>
              <div className="candidate-chip-row">
                {selectedArrangement ? (
                  <span className="candidate-chip">{selectedArrangement.part_count}성부</span>
                ) : null}
                {selectedArrangement ? (
                  <span className="candidate-chip candidate-chip--good">{`리드 적합도 ${selectedLeadFitLabel}`}</span>
                ) : null}
              </div>
            </div>

            <div className="arrangement-center__stage">
              <div className="arrangement-preview-toolbar">
                <div className="arrangement-preview-toolbar__actions">
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
                </div>
                <div className="arrangement-preview-toolbar__meta">
                  <span className="candidate-chip">{guideModeEnabled ? '가이드 겹치기 켜짐' : '가이드 겹치기 꺼짐'}</span>
                  <span className="candidate-chip">{arrangementTransportState.phase === 'playing' ? '재생 중' : '재생 대기'}</span>
                </div>
              </div>

              <ArrangementScore
                musicXmlUrl={normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url)}
                playheadRatio={arrangementPlaybackRatio}
                renderKey={
                  selectedArrangement
                    ? `${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`
                    : 'empty-arrangement'
                }
              />
            </div>

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

              <div className="arrangement-center__footer-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setWorkspaceMode('export')}
                >
                  내보내기 보기
                </button>
                <Link className="button-secondary" to={`/projects/${projectId}/studio#score-playback`}>
                  스튜디오에서 자세히 수정하기
                </Link>
              </div>
            </div>
          </section>

          <aside
            className={`panel arrangement-rail arrangement-rail--right arrangement-workspace-panel ${
              workspaceMode === 'export' ? 'arrangement-workspace-panel--active' : ''
            }`}
          >
            <div>
              <p className="eyebrow">세부 조정</p>
              <h2>파트 집중과 내보내기</h2>
              <p className="panel__summary">
                선택한 후보를 기준으로 내보내기, 가이드 겹치기, 파트 음량과 집중 듣기를 한 곳에서 정리합니다.
              </p>
            </div>

            {selectedArrangement ? (
              <div className="arrangement-inspector-note">
                <span>선택 후보</span>
                <strong>{selectedArrangementLabel}</strong>
                <p>
                  {`리드 적합도 ${selectedLeadFitLabel}, 병행 경고 ${selectedComparisonSummary?.parallel_motion_alerts ?? 0}회, 최대 도약 ${selectedComparisonSummary?.support_max_leap ?? '없음'}반음`}
                </p>
              </div>
            ) : null}

            <div className="button-row arrangement-export-stack">
              {normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url) ? (
                <a
                  className="button-primary"
                  onClick={() => setWorkspaceMode('export')}
                  href={normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url) ?? undefined}
                >
                  MusicXML 내보내기
                </a>
              ) : null}
              {normalizeAssetUrl(selectedArrangement?.midi_artifact_url) ? (
                <a
                  className="button-secondary"
                  onClick={() => setWorkspaceMode('export')}
                  href={normalizeAssetUrl(selectedArrangement?.midi_artifact_url) ?? undefined}
                >
                  편곡 MIDI 내보내기
                </a>
              ) : null}
              {normalizeAssetUrl(guide?.guide_wav_artifact_url) ? (
                <a
                  className="button-secondary"
                  onClick={() => setWorkspaceMode('export')}
                  href={normalizeAssetUrl(guide?.guide_wav_artifact_url) ?? undefined}
                >
                  가이드 WAV 내보내기
                </a>
              ) : null}
            </div>

            <div className="arrangement-focus-block">
              <label className="toggle-card">
                <input
                  checked={guideModeEnabled}
                  type="checkbox"
                  onChange={(event) => setGuideModeEnabled(event.target.checked)}
                />
                <div>
                  <strong>가이드 겹치기</strong>
                  <span>선택한 기준 파트를 더 또렷하게 두고 나머지 성부는 한걸음 뒤로 물립니다.</span>
                </div>
              </label>

              <p
                className={arrangementTransportState.phase === 'error' ? 'form-error' : 'status-card__hint'}
              >
                {arrangementTransportState.message}
              </p>
            </div>

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
