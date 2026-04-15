import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrangementScore } from '../components/ArrangementScore'
import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { buildApiUrl, normalizeAssetUrl } from '../lib/api'
import type { AudioPreviewData } from '../lib/audioPreview'
import {
  getArrangementStyleLabel,
  getDifficultyLabel,
  getShareAccessScopeLabel,
  getShareErrorLabel,
  getTrackStatusLabel,
} from '../lib/localizedLabels'
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
    return '알 수 없음'
  }

  return `${(durationMs / 1000).toFixed(2)}초`
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '대기 중'
  }

  return value.toFixed(1)
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '없음'
  }

  return `${Math.round(value * 100)}%`
}

function formatSignedCents(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '없음'
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
  const [workspaceMode, setWorkspaceMode] = useState<'take' | 'score' | 'summary'>('take')

  useEffect(() => {
    if (!shareToken) {
      setPageState({ phase: 'error', message: '공유 토큰이 없습니다.' })
      return
    }

    const controller = new AbortController()

    async function loadSharedProject(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/shared/${shareToken}`), {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '공유 프로젝트를 불러오지 못했습니다.'))
        }

        const payload = (await response.json()) as SharedProjectPayload
        setPageState({ phase: 'ready', payload })
        setSelectedTakeId(getDefaultTake(payload.takes)?.track_id ?? null)
        setSelectedArrangementId(getDefaultArrangement(payload.arrangements)?.arrangement_id ?? null)
        setWorkspaceMode(payload.arrangements.length > 0 ? 'score' : 'take')
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setPageState({
          phase: 'error',
          message:
            error instanceof Error
              ? getShareErrorLabel(error.message)
              : '공유 프로젝트를 불러오지 못했습니다.',
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
          <p className="eyebrow">읽기 전용 공유</p>
          <h1>공유 프로젝트를 불러오는 중입니다...</h1>
        </section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel">
          <p className="eyebrow">읽기 전용 공유</p>
          <h1>공유 프로젝트를 열 수 없습니다</h1>
          <p className="form-error">{pageState.message}</p>
          <Link className="button-secondary" to="/">
            홈으로 돌아가기
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
  const selectedTakeLabel = selectedTake ? `${selectedTake.take_no ?? '?'}번 테이크` : '선택한 테이크 없음'
  const selectedArrangementLabel = selectedArrangement
    ? `${selectedArrangement.candidate_code} · ${selectedArrangement.title}`
    : '선택한 편곡 없음'

  return (
    <div className="page-shell shared-review-page">
      <section className="shared-review-shell">
        <header className="shared-review-header">
          <div className="shared-review-header__copy">
            <p className="eyebrow">읽기 전용 공유</p>
            <h1>{payload.project.title}</h1>
            <p className="panel__summary">
              "{payload.version_label}" 시점의 스튜디오 스냅샷입니다. 선택한 테이크, 점수,
              편곡 결과를 수정 없이 검토할 수 있습니다.
            </p>
          </div>

          <div className="shared-review-header__meta">
            <div className="mini-card">
              <span>공유 이름</span>
              <strong>{payload.label}</strong>
            </div>
            <div className="mini-card">
              <span>스냅샷 날짜</span>
              <strong>{formatDate(payload.version_created_at)}</strong>
            </div>
            <div className="mini-card">
              <span>상태</span>
              <strong>{getShareAccessScopeLabel(payload.access_scope)}</strong>
            </div>
            <div className="mini-card">
              <span>만료</span>
              <strong>{payload.expires_at ? formatDate(payload.expires_at) : '없음'}</strong>
            </div>
          </div>
        </header>

        <section className="shared-review-strip" aria-label="스냅샷 요약">
          <div className="shared-review-strip__item">
            <span>가이드</span>
            <strong>{payload.snapshot_summary.has_guide ? '있음' : '없음'}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>테이크 수</span>
            <strong>{payload.snapshot_summary.take_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>준비 완료 테이크</span>
            <strong>{payload.snapshot_summary.ready_take_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>편곡 수</span>
            <strong>{payload.snapshot_summary.arrangement_count}</strong>
          </div>
          <div className="shared-review-strip__item">
            <span>믹스다운</span>
            <strong>{payload.snapshot_summary.has_mixdown ? '있음' : '없음'}</strong>
          </div>
        </section>

        <div className="shared-review-grid">
          <aside
            className={`panel shared-review-rail shared-review-rail--left shared-review-workspace-panel ${
              workspaceMode === 'take' ? 'shared-review-workspace-panel--active' : ''
            }`}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">검토 흐름</p>
                <h2>왼쪽에서는 검토 대상을 고릅니다</h2>
              </div>
            </div>

            <p className="panel__summary">
              이 화면은 수정 없이 읽는 자리입니다. 먼저 테이크를 고르고, 필요하면 악보나 결과 요약으로
              바로 넘어가면 됩니다.
            </p>

            <div className="shared-review-mode-switch" role="tablist" aria-label="공유 검토 흐름">
              <button
                aria-selected={workspaceMode === 'take'}
                className={`shared-review-mode-button ${
                  workspaceMode === 'take' ? 'shared-review-mode-button--active' : ''
                }`}
                type="button"
                onClick={() => setWorkspaceMode('take')}
              >
                <span>1단계</span>
                <strong>테이크 보기</strong>
              </button>
              <button
                aria-selected={workspaceMode === 'score'}
                className={`shared-review-mode-button ${
                  workspaceMode === 'score' ? 'shared-review-mode-button--active' : ''
                }`}
                disabled={payload.arrangements.length === 0}
                type="button"
                onClick={() => setWorkspaceMode('score')}
              >
                <span>2단계</span>
                <strong>악보 보기</strong>
              </button>
              <button
                aria-selected={workspaceMode === 'summary'}
                className={`shared-review-mode-button ${
                  workspaceMode === 'summary' ? 'shared-review-mode-button--active' : ''
                }`}
                type="button"
                onClick={() => setWorkspaceMode('summary')}
              >
                <span>3단계</span>
                <strong>결과 읽기</strong>
              </button>
            </div>

            <div className="shared-review-quick-cards">
              <div className="mini-card mini-card--stack">
                <span>지금 보는 테이크</span>
                <strong>{selectedTakeLabel}</strong>
                <small>{selectedTake ? getTrackStatusLabel(selectedTake.track_status) : '없음'}</small>
              </div>
              <div className="mini-card mini-card--stack">
                <span>지금 보는 악보</span>
                <strong>{selectedArrangementLabel}</strong>
                <small>{selectedArrangement ? getArrangementStyleLabel(selectedArrangement.style) : '없음'}</small>
              </div>
            </div>

            <div className="shared-review-pill-row" role="tablist" aria-label="공유 테이크">
              {payload.takes.map((take) => (
                <button
                  key={take.track_id}
                  aria-selected={selectedTake?.track_id === take.track_id}
                  className={`shared-review-pill ${
                    selectedTake?.track_id === take.track_id ? 'shared-review-pill--active' : ''
                  }`}
                  type="button"
                  onClick={() => {
                    setSelectedTakeId(take.track_id)
                    setWorkspaceMode('take')
                  }}
                >
                  {`${take.take_no ?? '?'}번 테이크`}
                </button>
              ))}
            </div>

            {selectedTake ? (
              <>
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>상태</span>
                    <strong>{getTrackStatusLabel(selectedTake.track_status)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>길이</span>
                    <strong>{formatDuration(selectedTake.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>정렬 신뢰도</span>
                    <strong>{formatPercent(selectedTake.alignment_confidence)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>멜로디 초안</span>
                    <strong>
                      {selectedTake.latest_melody
                        ? `노트 ${selectedTake.latest_melody.note_count}개`
                        : '대기 중'}
                    </strong>
                  </div>
                </div>

                {selectedTake.source_artifact_url ? (
                  <div className="shared-review-audio">
                    <span className="shared-review-label">선택한 테이크 오디오</span>
                    <ManagedAudioPlayer muted={false} src={selectedTake.source_artifact_url} volume={1} />
                  </div>
                ) : null}

                {selectedTake.preview_data ? (
                  <WaveformPreview preview={selectedTake.preview_data} />
                ) : (
                  <div className="empty-card">
                    <p>이 테이크에는 저장된 파형 미리보기가 없습니다.</p>
                  </div>
                )}

                {payload.guide?.source_artifact_url ? (
                  <div className="shared-review-audio shared-review-audio--subtle">
                    <span className="shared-review-label">가이드 참고 오디오</span>
                    <ManagedAudioPlayer muted={false} src={payload.guide.source_artifact_url} volume={0.8} />
                  </div>
                ) : null}

                {payload.mixdown?.source_artifact_url ? (
                  <div className="shared-review-audio shared-review-audio--subtle">
                    <span className="shared-review-label">스냅샷 믹스다운</span>
                    <ManagedAudioPlayer muted={false} src={payload.mixdown.source_artifact_url} volume={0.9} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-card">
                <p>이 버전에는 저장된 테이크가 없습니다.</p>
              </div>
            )}
          </aside>

          <section
            className={`panel shared-review-canvas shared-review-workspace-panel ${
              workspaceMode === 'score' ? 'shared-review-workspace-panel--active' : ''
            }`}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">악보와 스냅샷</p>
                <h2>고정된 리뷰 스냅샷</h2>
              </div>
            </div>

            <p className="panel__summary">
              이 화면은 의도적으로 읽기 전용입니다. 고정된 편곡 결과와 내보내기 산출물은 비교할 수
              있지만, 수정은 스튜디오에서 진행합니다.
            </p>

            {payload.arrangements.length > 0 ? (
              <div className="shared-review-pill-row" role="tablist" aria-label="공유 편곡">
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
                    onClick={() => {
                      setSelectedArrangementId(arrangement.arrangement_id)
                      setWorkspaceMode('score')
                    }}
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
                    <span>편곡</span>
                    <strong>{selectedArrangement.title}</strong>
                  </div>
                  <div className="mini-card">
                    <span>스타일</span>
                    <strong>{getArrangementStyleLabel(selectedArrangement.style)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>난이도</span>
                    <strong>{getDifficultyLabel(selectedArrangement.difficulty)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>성부 수</span>
                    <strong>{selectedArrangement.part_count}</strong>
                  </div>
                </div>

                <ArrangementScore
                  musicXmlUrl={normalizeAssetUrl(selectedArrangement.musicxml_artifact_url)}
                  playheadRatio={0}
                  renderKey={`${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`}
                />
              </>
            ) : selectedTake?.preview_data ? (
              <WaveformPreview preview={selectedTake.preview_data} />
            ) : (
              <div className="empty-card">
                <p>이 스냅샷에는 저장된 편곡 악보나 파형 미리보기가 없습니다.</p>
              </div>
            )}

            <div className="button-row shared-review-export-row">
              {normalizeAssetUrl(selectedTake?.source_artifact_url) ? (
                <a
                  className="button-secondary"
                  href={normalizeAssetUrl(selectedTake?.source_artifact_url) ?? undefined}
                >
                  선택한 테이크 오디오 열기
                </a>
              ) : null}
              {normalizeAssetUrl(payload.guide?.guide_wav_artifact_url) ? (
                <a
                  className="button-secondary"
                  href={normalizeAssetUrl(payload.guide?.guide_wav_artifact_url) ?? undefined}
                >
                  가이드 WAV 열기
                </a>
              ) : null}
              {normalizeAssetUrl(selectedArrangement?.midi_artifact_url) ? (
                <a
                  className="button-secondary"
                  href={normalizeAssetUrl(selectedArrangement?.midi_artifact_url) ?? undefined}
                >
                  편곡 MIDI 열기
                </a>
              ) : null}
              {normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url) ? (
                <a
                  className="button-secondary"
                  href={normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url) ?? undefined}
                >
                  MusicXML 열기
                </a>
              ) : null}
            </div>

            <div className="shared-review-canvas__footer">
              <button
                className="button-secondary"
                type="button"
                onClick={() => setWorkspaceMode('summary')}
              >
                결과 요약 보기
              </button>
            </div>
          </section>

          <aside
            className={`panel shared-review-rail shared-review-rail--right shared-review-workspace-panel ${
              workspaceMode === 'summary' ? 'shared-review-workspace-panel--active' : ''
            }`}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">결과 요약</p>
                <h2>녹음 결과 요약</h2>
              </div>
            </div>

            {selectedTake?.latest_score ? (
              <>
                <div className="shared-review-score-grid">
                  <div className="mini-card">
                    <span>총점</span>
                    <strong>{formatScore(selectedTake.latest_score.total_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>음정</span>
                    <strong>{formatScore(selectedTake.latest_score.pitch_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>리듬</span>
                    <strong>{formatScore(selectedTake.latest_score.rhythm_score)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>화성</span>
                    <strong>{formatScore(selectedTake.latest_score.harmony_fit_score)}</strong>
                  </div>
                </div>

                {noteHighlight ? (
                  <div className="shared-review-highlight">
                    <span className="shared-review-label">주목할 노트</span>
                    <strong>{`${noteHighlight.note_index + 1}번 노트`}</strong>
                    <p>{noteHighlight.message}</p>
                    <div className="mini-grid">
                      <div className="mini-card">
                        <span>시작음</span>
                        <strong>{formatSignedCents(noteHighlight.attack_signed_cents)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>유지음</span>
                        <strong>{formatSignedCents(noteHighlight.sustain_median_cents)}</strong>
                      </div>
                      <div className="mini-card">
                        <span>신뢰도</span>
                        <strong>{formatPercent(noteHighlight.confidence)}</strong>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="shared-review-message-list">
                  <span className="shared-review-label">저장된 피드백</span>
                  {selectedMessages.length > 0 ? (
                    <ul>
                      {selectedMessages.map((item, index) => (
                        <li key={`${selectedTake.track_id}-${index}`}>{item.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-card">
                      <p>이 테이크에는 저장된 피드백 문구가 없습니다.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-card">
                <p>이 스냅샷에는 점수가 기록된 테이크가 선택되어 있지 않습니다.</p>
              </div>
            )}

            <div className="empty-card empty-card--warn">
              <p>이 화면은 고정된 리뷰 결과입니다. 수정, 재채점, 새 공유 링크 생성은 스튜디오에서 진행합니다.</p>
            </div>

            <button
              className="button-secondary"
              type="button"
              onClick={() => setWorkspaceMode(payload.arrangements.length > 0 ? 'score' : 'take')}
            >
              다시 악보 보기
            </button>
          </aside>
        </div>
      </section>
    </div>
  )
}
