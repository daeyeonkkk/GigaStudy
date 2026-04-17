import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import './SharedProjectPage.css'

import { ArrangementScore } from '../components/ArrangementScore'
import { ManagedAudioPlayer } from '../components/ManagedAudioPlayer'
import { WaveformPreview } from '../components/WaveformPreview'
import { buildApiUrl, normalizeAssetUrl, normalizeRequestError } from '../lib/api'
import type { AudioPreviewData } from '../lib/audioPreview'
import {
  getShareAccessScopeLabel,
  getShareErrorLabel,
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

type ReviewCanvasMode = 'score' | 'waveform'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ko-KR')
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  return value.toFixed(1)
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  return `${Math.round(value * 100)}%`
}

function formatSignedCents(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
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

function triggerAssetDownload(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function SharedProjectPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' })
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null)
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(null)
  const [canvasMode, setCanvasMode] = useState<ReviewCanvasMode>('score')
  const [isGuidePlayerOpen, setIsGuidePlayerOpen] = useState(false)
  const [isNoteDrawerOpen, setIsNoteDrawerOpen] = useState(false)
  const guidePlayerRef = useRef<HTMLDivElement | null>(null)

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
        setCanvasMode(payload.arrangements.length > 0 ? 'score' : 'waveform')
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setPageState({
          phase: 'error',
          message: getShareErrorLabel(
            normalizeRequestError(error, '공유 프로젝트를 불러오지 못했습니다.'),
          ),
        })
      }
    }

    void loadSharedProject()

    return () => controller.abort()
  }, [shareToken])

  useEffect(() => {
    if (pageState.phase !== 'ready') {
      return
    }
    if (canvasMode === 'score' && pageState.payload.arrangements.length === 0) {
      setCanvasMode('waveform')
    }
  }, [canvasMode, pageState])

  if (pageState.phase === 'loading') {
    return (
      <div className="page-shell readonly-review-page">
        <section className="readonly-review-loading">공유 검토 화면을 불러오는 중입니다...</section>
      </div>
    )
  }

  if (pageState.phase === 'error') {
    return (
      <div className="page-shell readonly-review-page">
        <section className="readonly-review-loading">
          <p className="form-error">{pageState.message}</p>
          <Link className="back-link" to="/">
            처음으로
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
  const selectedScore = selectedTake?.latest_score ?? null
  const noteHighlight = selectedScore?.note_feedback_json[0] ?? null
  const briefComment = noteHighlight?.message ?? selectedScore?.feedback_json[0]?.message ?? '핵심 코멘트가 없습니다.'
  const guideAudioUrl = normalizeAssetUrl(payload.guide?.guide_wav_artifact_url ?? payload.guide?.source_artifact_url)
  const xmlUrl = normalizeAssetUrl(selectedArrangement?.musicxml_artifact_url)
  const midiUrl = normalizeAssetUrl(selectedArrangement?.midi_artifact_url)
  const hasWaveformPreview = Boolean(selectedTake?.preview_data)
  const reviewPlayheadRatio = selectedArrangement ? 0.52 : 0

  function handleOpenGuidePlayer(): void {
    if (!guideAudioUrl) {
      return
    }
    setIsGuidePlayerOpen(true)
    window.setTimeout(() => {
      guidePlayerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 0)
  }

  function handleDownload(url: string | null): void {
    if (!url) {
      return
    }
    triggerAssetDownload(url)
  }

  return (
    <div className="page-shell readonly-review-page">
      <section className="readonly-review-shell">
        <header className="readonly-review-header">
          <div className="readonly-review-header__copy">
            <p className="eyebrow">SHARED REVIEW</p>
            <h1>{payload.project.title}</h1>
            <div className="readonly-review-header__meta">
              <span>{`snapshot ${formatDate(payload.version_created_at)}`}</span>
              <strong>{getShareAccessScopeLabel(payload.access_scope)}</strong>
            </div>
          </div>

          <div className="readonly-review-header__actions">
            <button
              className="readonly-review-action"
              disabled={!guideAudioUrl}
              type="button"
              onClick={handleOpenGuidePlayer}
            >
              가이드 듣기
            </button>
            <button
              className="readonly-review-action"
              disabled={!xmlUrl}
              type="button"
              onClick={() => handleDownload(xmlUrl)}
            >
              MusicXML
            </button>
            <button
              className="readonly-review-action readonly-review-action--primary"
              disabled={!midiUrl}
              type="button"
              onClick={() => handleDownload(midiUrl)}
            >
              MIDI
            </button>
          </div>
        </header>

        <section className="readonly-review-strip" aria-label="검토 요약">
          <div className="readonly-review-strip__chip">
            <span>guide</span>
            <strong>{payload.snapshot_summary.has_guide ? '포함' : '없음'}</strong>
          </div>
          <div className="readonly-review-strip__chip">
            <span>takes</span>
            <strong>{payload.snapshot_summary.take_count}</strong>
          </div>
          <div className="readonly-review-strip__chip">
            <span>ready takes</span>
            <strong>{payload.snapshot_summary.ready_take_count}</strong>
          </div>
          <div className="readonly-review-strip__chip">
            <span>arrangements</span>
            <strong>{payload.snapshot_summary.arrangement_count}</strong>
          </div>
          <div className="readonly-review-strip__chip">
            <span>selected version</span>
            <strong>{payload.version_label}</strong>
          </div>
        </section>

        <section className="readonly-review-body">
          <aside className="readonly-review-left" aria-label="선택 요약">
            <section className="readonly-review-block">
              <h2>선택 take</h2>
              {payload.takes.length > 1 ? (
                <label className="readonly-review-select">
                  <span>take</span>
                  <select
                    value={selectedTake?.track_id ?? ''}
                    onChange={(event) => setSelectedTakeId(event.target.value || null)}
                  >
                    {payload.takes.map((take) => (
                      <option key={take.track_id} value={take.track_id}>
                        {`${take.take_no ?? '?'}번 테이크`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <strong className="readonly-review-block__value">
                {selectedTake ? `take_${String(selectedTake.take_no ?? 0).padStart(2, '0')}` : '-'}
              </strong>
              <p>{selectedTake ? `${payload.guide ? '가이드와 가장 가까운' : '현재 선택된'} take` : '선택된 take가 없습니다.'}</p>
            </section>

            <section className="readonly-review-block">
              <h3>alignment confidence</h3>
              <strong className="readonly-review-block__value">
                {formatPercent(selectedTake?.alignment_confidence)}
              </strong>
            </section>

            <section className="readonly-review-block">
              <h3>melody draft status</h3>
              <strong className="readonly-review-block__value">
                {selectedTake?.latest_melody ? '저장됨' : '없음'}
              </strong>
              {selectedTake?.latest_melody ? (
                <p>{`노트 ${selectedTake.latest_melody.note_count}개`}</p>
              ) : null}
            </section>

            <section className="readonly-review-block">
              <h3>current arrangement</h3>
              {payload.arrangements.length > 1 ? (
                <label className="readonly-review-select">
                  <span>arrangement</span>
                  <select
                    value={selectedArrangement?.arrangement_id ?? ''}
                    onChange={(event) => setSelectedArrangementId(event.target.value || null)}
                  >
                    {payload.arrangements.map((arrangement) => (
                      <option key={arrangement.arrangement_id} value={arrangement.arrangement_id}>
                        {`${arrangement.candidate_code} · ${arrangement.title}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <strong className="readonly-review-block__value">
                {selectedArrangement ? `Candidate ${selectedArrangement.candidate_code}` : '-'}
              </strong>
            </section>
          </aside>

          <section className="readonly-review-canvas" aria-label="검토 캔버스">
            <div className="readonly-review-canvas__header">
              <h2>검토 캔버스</h2>
              <label className="readonly-review-select readonly-review-select--inline">
                <span>mode</span>
                <select
                  value={canvasMode}
                  onChange={(event) => setCanvasMode(event.target.value as ReviewCanvasMode)}
                >
                  <option disabled={!selectedArrangement} value="score">
                    악보
                  </option>
                  <option disabled={!hasWaveformPreview} value="waveform">
                    파형
                  </option>
                </select>
              </label>
            </div>

            <div className="readonly-review-canvas__frame">
              {canvasMode === 'score' && selectedArrangement ? (
                <ArrangementScore
                  musicXmlUrl={xmlUrl}
                  playheadRatio={reviewPlayheadRatio}
                  renderKey={`${selectedArrangement.arrangement_id}:${selectedArrangement.updated_at}`}
                />
              ) : selectedTake?.preview_data ? (
                <WaveformPreview preview={selectedTake.preview_data} />
              ) : (
                <div className="empty-card">
                  <p>이 스냅샷에 표시할 악보 또는 파형이 없습니다.</p>
                </div>
              )}
            </div>

            <div className="readonly-review-canvas__summary">
              <span>요약</span>
              <p>읽기 전용으로 현재 선택 버전과 핵심 피드백만 검토합니다.</p>
            </div>

            {isGuidePlayerOpen && guideAudioUrl ? (
              <div className="readonly-review-guide-player" ref={guidePlayerRef}>
                <span>Guide player</span>
                <ManagedAudioPlayer muted={false} src={guideAudioUrl} volume={0.85} />
              </div>
            ) : null}
          </section>

          <aside className="readonly-review-right" aria-label="점수 요약">
            <section className="readonly-review-block">
              <h2>점수 요약</h2>
              <dl className="readonly-review-score-list">
                <div>
                  <dt>pitch</dt>
                  <dd>{formatScore(selectedScore?.pitch_score)}</dd>
                </div>
                <div>
                  <dt>rhythm</dt>
                  <dd>{formatScore(selectedScore?.rhythm_score)}</dd>
                </div>
                <div>
                  <dt>harmony</dt>
                  <dd>{formatScore(selectedScore?.harmony_fit_score)}</dd>
                </div>
              </dl>
            </section>

            <section className="readonly-review-block">
              <h3>highlighted note</h3>
              <strong className="readonly-review-block__value">
                {noteHighlight ? `${noteHighlight.note_index + 1}번 노트` : '-'}
              </strong>
              {noteHighlight ? (
                <div className="readonly-review-note-metrics">
                  <span>{`시작 ${formatSignedCents(noteHighlight.attack_signed_cents)}`}</span>
                  <span>{`유지 ${formatSignedCents(noteHighlight.sustain_median_cents)}`}</span>
                  <span>{`신뢰도 ${formatPercent(noteHighlight.confidence)}`}</span>
                </div>
              ) : null}
            </section>

            <section className="readonly-review-block">
              <h3>brief comment</h3>
              <p className="readonly-review-comment">{briefComment}</p>
            </section>

            <button
              className="readonly-review-action readonly-review-action--primary readonly-review-action--block"
              disabled={!noteHighlight}
              type="button"
              onClick={() => setIsNoteDrawerOpen(true)}
            >
              노트 세부
            </button>
          </aside>
        </section>
      </section>

      {isNoteDrawerOpen && noteHighlight ? (
        <div
          className="readonly-review-overlay"
          onClick={() => setIsNoteDrawerOpen(false)}
        >
          <aside
            aria-label="노트 세부"
            className="readonly-review-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="readonly-review-drawer__header">
              <h2>노트 세부</h2>
              <button className="readonly-review-action" type="button" onClick={() => setIsNoteDrawerOpen(false)}>
                닫기
              </button>
            </div>

            <dl className="readonly-review-drawer__list">
              <div>
                <dt>노트</dt>
                <dd>{`${noteHighlight.note_index + 1}번`}</dd>
              </div>
              <div>
                <dt>시작음</dt>
                <dd>{formatSignedCents(noteHighlight.attack_signed_cents)}</dd>
              </div>
              <div>
                <dt>유지음</dt>
                <dd>{formatSignedCents(noteHighlight.sustain_median_cents)}</dd>
              </div>
              <div>
                <dt>신뢰도</dt>
                <dd>{formatPercent(noteHighlight.confidence)}</dd>
              </div>
            </dl>

            <div className="readonly-review-drawer__message">
              <span>교정 문장</span>
              <p>{noteHighlight.message}</p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
