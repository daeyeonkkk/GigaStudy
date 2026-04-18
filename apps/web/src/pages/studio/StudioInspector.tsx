import type { RefObject } from 'react'

import { useStudioCompactViewport } from './useStudioCompactViewport'

type SelectedTake = {
  track_status: string
}

type SelectedTakeScore = {
  pitch_score: number | null
  rhythm_score: number | null
  harmony_fit_score: number | null
  total_score: number | null
  pitch_quality_mode: string
  harmony_reference_mode: string
} | null

type SelectedNoteFeedback = {
  note_index: number
  target_midi: number
  message: string
  attack_signed_cents: number | null
  sustain_median_cents: number | null
  timing_offset_ms: number | null
  confidence: number
} | null

type NoteFeedbackListItem = {
  note_index: number
  target_midi: number
  sustain_median_cents: number | null
  timing_offset_ms: number | null
}

type StudioInspectorProps = {
  canOpenArrangementWorkbench: boolean
  canOpenMelodyWorkbench: boolean
  chordMarkerCount: number
  consoleChordLabel: string
  editorRangeTitle: string
  formatConfidence: (value: number | null) => string
  formatScoreCell: (value: number | null | undefined) => string
  formatSignedCents: (value: number | null) => string
  formatSignedMs: (value: number | null) => string
  getHarmonyReferenceLabel: (mode: string | null | undefined) => string
  getPitchDirectionLabel: (value: number | null) => string
  getPitchDirectionTone: (value: number | null) => 'good' | 'warn' | 'alert' | 'neutral'
  getPitchQualityModeLabel: (mode: string | null | undefined) => string
  getTrackStatusLabel: (status: string) => string
  humanRatingPacketUrl: string | null
  inspectorDirectionValue: number | null
  inspectorNoteListRef: RefObject<HTMLDivElement | null>
  inspectorPanelRef: RefObject<HTMLDetailsElement | null>
  midiToPitchName: (pitchMidi: number) => string
  mobileInspectorSummaryLabel: string
  noteFeedbackSummaryLabel: string
  onOpenArrangementWorkbench: () => void
  onOpenHarmonyWorkbench: () => void
  onOpenMelodyWorkbench: () => void
  onSelectNoteFeedback: (index: number) => void
  selectedNoteFeedback: SelectedNoteFeedback
  selectedTake: SelectedTake | null
  selectedTakeLabel: string
  selectedTakeNoteFeedback: NoteFeedbackListItem[]
  selectedTakeScore: SelectedTakeScore
}

export function StudioInspector({
  canOpenArrangementWorkbench,
  canOpenMelodyWorkbench,
  chordMarkerCount,
  consoleChordLabel,
  editorRangeTitle,
  formatConfidence,
  formatScoreCell,
  formatSignedCents,
  formatSignedMs,
  getHarmonyReferenceLabel,
  getPitchDirectionLabel,
  getPitchDirectionTone,
  getPitchQualityModeLabel,
  getTrackStatusLabel,
  humanRatingPacketUrl,
  inspectorDirectionValue,
  inspectorNoteListRef,
  inspectorPanelRef,
  midiToPitchName,
  mobileInspectorSummaryLabel,
  noteFeedbackSummaryLabel,
  onOpenArrangementWorkbench,
  onOpenHarmonyWorkbench,
  onOpenMelodyWorkbench,
  onSelectNoteFeedback,
  selectedNoteFeedback,
  selectedTake,
  selectedTakeLabel,
  selectedTakeNoteFeedback,
  selectedTakeScore,
}: StudioInspectorProps) {
  const isCompactViewport = useStudioCompactViewport()

  return (
    <details
            ref={inspectorPanelRef}
            className="studio-wave-editor__inspector-shell studio-mobile-panel studio-mobile-panel--inspector"
            open={isCompactViewport ? undefined : true}
          >
            <summary className="studio-mobile-panel__summary">
              <span>선택 상태</span>
              <strong>{mobileInspectorSummaryLabel}</strong>
            </summary>
            <aside className="panel studio-wave-editor__inspector studio-mobile-panel__body">
              <div className="studio-wave-editor__inspector-section studio-wave-editor__inspector-section--summary">
                <span className="studio-wave-editor__inspector-kicker">선택 take</span>
                <strong>{selectedTakeLabel}</strong>
                <small>
                  {selectedTake ? getTrackStatusLabel(selectedTake.track_status) : '테이크를 고르면 점검할 수 있습니다.'}
                </small>
              </div>

              <div className="studio-wave-editor__inspector-section">
                <div className="studio-wave-editor__focus-grid">
                  <article className="studio-wave-editor__focus-card">
                    <span>선택 노트</span>
                    <div className="studio-wave-editor__focus-heading">
                      <strong>
                        {selectedNoteFeedback
                          ? `${midiToPitchName(selectedNoteFeedback.target_midi)} · ${selectedNoteFeedback.note_index + 1}번째 노트`
                          : selectedTake
                            ? '노트를 선택하세요'
                            : '테이크를 선택하세요'}
                      </strong>
                      {selectedNoteFeedback ? (
                        <span
                          className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                            inspectorDirectionValue,
                          )}`}
                        >
                          {getPitchDirectionLabel(inspectorDirectionValue)}
                        </span>
                      ) : null}
                    </div>
                    {selectedNoteFeedback ? <p>{selectedNoteFeedback.message}</p> : null}
                    <div className="studio-wave-editor__focus-metrics">
                      <div>
                        <small>시작</small>
                        <strong>
                          {selectedNoteFeedback
                            ? formatSignedCents(selectedNoteFeedback.attack_signed_cents)
                            : '--'}
                        </strong>
                      </div>
                      <div>
                        <small>유지</small>
                        <strong>
                          {selectedNoteFeedback
                            ? formatSignedCents(selectedNoteFeedback.sustain_median_cents)
                            : '--'}
                        </strong>
                      </div>
                      <div>
                        <small>타이밍</small>
                        <strong>
                          {selectedNoteFeedback ? formatSignedMs(selectedNoteFeedback.timing_offset_ms) : '--'}
                        </strong>
                      </div>
                      <div>
                        <small>신뢰도</small>
                        <strong>
                          {selectedNoteFeedback ? formatConfidence(selectedNoteFeedback.confidence) : '--'}
                        </strong>
                      </div>
                    </div>
                  </article>

                  <article className="studio-wave-editor__focus-card">
                    <span>점수</span>
                    <div className="studio-wave-editor__score-grid">
                      <div className="studio-wave-editor__score-card">
                        <small>음정</small>
                        <strong>{formatScoreCell(selectedTakeScore?.pitch_score)}</strong>
                      </div>
                      <div className="studio-wave-editor__score-card">
                        <small>리듬</small>
                        <strong>{formatScoreCell(selectedTakeScore?.rhythm_score)}</strong>
                      </div>
                      <div className="studio-wave-editor__score-card">
                        <small>화성</small>
                        <strong>{formatScoreCell(selectedTakeScore?.harmony_fit_score)}</strong>
                      </div>
                      <div className="studio-wave-editor__score-card studio-wave-editor__score-card--highlight">
                        <small>총점</small>
                        <strong>{formatScoreCell(selectedTakeScore?.total_score)}</strong>
                      </div>
                    </div>
                    {selectedTakeScore ? (
                      <p className="studio-wave-editor__focus-note">
                        {`${getPitchQualityModeLabel(selectedTakeScore.pitch_quality_mode)} · ${getHarmonyReferenceLabel(
                          selectedTakeScore.harmony_reference_mode,
                        )}`}
                      </p>
                    ) : null}
                  </article>
                </div>
              </div>

              <div className="studio-wave-editor__inspector-section" ref={inspectorNoteListRef}>
                <div className="studio-wave-editor__inspector-heading">
                  <span>노트 목록</span>
                  <strong>{noteFeedbackSummaryLabel}</strong>
                </div>
                <div className="studio-wave-editor__note-list">
                  {selectedTakeNoteFeedback.length === 0 ? (
                    <div className="studio-wave-editor__note-empty">노트 피드백이 아직 없습니다.</div>
                  ) : (
                    selectedTakeNoteFeedback.slice(0, 8).map((item, index) => (
                      <button
                        key={`inspector-note-${item.note_index}`}
                        className={`studio-wave-editor__note-row ${
                          selectedNoteFeedback?.note_index === item.note_index
                            ? 'studio-wave-editor__note-row--active'
                            : ''
                        }`}
                        type="button"
                        onClick={() => onSelectNoteFeedback(index)}
                      >
                        <strong>{midiToPitchName(item.target_midi)}</strong>
                        <span>N{item.note_index + 1}</span>
                        <small>
                          {formatSignedCents(item.sustain_median_cents)} / {formatSignedMs(item.timing_offset_ms)}
                        </small>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="studio-wave-editor__inspector-section">
                <div className="studio-wave-editor__inspector-heading">
                  <span>화성</span>
                  <strong>{consoleChordLabel}</strong>
                </div>
                <small>
                  {chordMarkerCount > 0 ? `${chordMarkerCount}개 코드 마커` : '코드 타임라인이 아직 없습니다.'}
                </small>
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onOpenHarmonyWorkbench}
                >
                  코드 타임라인
                </button>
              </div>

              <div className="studio-wave-editor__inspector-section studio-wave-editor__inspector-section--actions">
                <div className="studio-wave-editor__inspector-heading">
                  <span>다음 작업</span>
                  <strong>{editorRangeTitle}</strong>
                </div>
                <div className="studio-wave-editor__inspector-actions">
                  <button
                    className="button-primary button-primary--small"
                    type="button"
                    onClick={onOpenMelodyWorkbench}
                    disabled={!canOpenMelodyWorkbench}
                  >
                    멜로디 추출
                  </button>
                  {humanRatingPacketUrl ? (
                    <a
                      data-testid="download-human-rating-packet-button"
                      className="button-secondary button-secondary--small"
                      href={humanRatingPacketUrl}
                    >
                      사람 평가 묶음
                    </a>
                  ) : (
                    <button className="button-secondary button-secondary--small" disabled type="button">
                      사람 평가 묶음
                    </button>
                  )}
                  <button
                    className="button-secondary button-secondary--small"
                    type="button"
                    onClick={onOpenArrangementWorkbench}
                    disabled={!canOpenArrangementWorkbench}
                  >
                    편곡 후보 만들기
                  </button>
                </div>
              </div>
            </aside>
          </details>
  )
}
