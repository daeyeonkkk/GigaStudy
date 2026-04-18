import type { CSSProperties } from 'react'

type Tone = 'alert' | 'good' | 'neutral' | 'warn'

type SegmentFeedbackItem = {
  end_ms: number
  harmony_fit_score: number
  message: string
  pitch_score: number
  rhythm_score: number
  segment_index: number
  start_ms: number
}

type NoteFeedbackItem = {
  attack_end_ms: number
  attack_score: number
  attack_signed_cents: number | null
  attack_start_ms: number
  confidence: number
  end_ms: number
  in_tune_ratio: number | null
  max_flat_cents: number | null
  max_sharp_cents: number | null
  message: string
  note_index: number
  note_score: number
  start_ms: number
  stability_score: number
  sustain_mad_cents: number | null
  sustain_median_cents: number | null
  sustain_score: number
  target_midi: number
  timing_offset_ms: number | null
  timing_score: number
}

type NoteFeedbackScore = {
  feedback_json: SegmentFeedbackItem[]
  harmony_reference_mode: string | null
  pitch_quality_mode: string | null
  score_id: string
}

type StudioNoteFeedbackPanelProps = {
  chordMarkerCount: number
  formatConfidence: (value: number | null) => string
  formatRatio: (value: number | null) => string
  formatSignedCents: (value: number | null) => string
  formatSignedMs: (value: number | null) => string
  formatTimeSpan: (startMs: number, endMs: number) => string
  getConfidenceTone: (value: number | null) => Tone
  getHarmonyReferenceHint: (mode: string | null | undefined, chordMarkerCount: number) => string
  getHarmonyReferenceLabel: (mode: string | null | undefined) => string
  getPitchDirectionLabel: (value: number | null) => string
  getPitchDirectionTone: (value: number | null) => Tone
  getPitchQualityModeHint: (mode: string | null | undefined) => string
  getPitchQualityModeLabel: (mode: string | null | undefined) => string
  getScoreTone: (value: number | null) => Tone
  midiToPitchName: (pitchMidi: number) => string
  noteFeedbackDetailSummaryLabel: string
  noteFeedbackSegmentSummaryLabel: string
  noteFeedbackSummaryLabel: string
  noteFeedbackTimelineDurationMs: number
  onSelectNoteFeedback: (index: number) => void
  selectedNoteFeedback: NoteFeedbackItem | null
  selectedTakeNoteFeedback: NoteFeedbackItem[]
  selectedTakeScore: NoteFeedbackScore | null
}

export function StudioNoteFeedbackPanel({
  chordMarkerCount,
  formatConfidence,
  formatRatio,
  formatSignedCents,
  formatSignedMs,
  formatTimeSpan,
  getConfidenceTone,
  getHarmonyReferenceHint,
  getHarmonyReferenceLabel,
  getPitchDirectionLabel,
  getPitchDirectionTone,
  getPitchQualityModeHint,
  getPitchQualityModeLabel,
  getScoreTone,
  midiToPitchName,
  noteFeedbackDetailSummaryLabel,
  noteFeedbackSegmentSummaryLabel,
  noteFeedbackSummaryLabel,
  noteFeedbackTimelineDurationMs,
  onSelectNoteFeedback,
  selectedNoteFeedback,
  selectedTakeNoteFeedback,
  selectedTakeScore,
}: StudioNoteFeedbackPanelProps) {
  return (
          <article className="panel studio-block" data-testid="note-feedback-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">노트 피드백</p>
                <h2>노트 피드백</h2>
              </div>
              <span
                className={`status-pill ${
                  selectedTakeNoteFeedback.length > 0
                    ? 'status-pill--ready'
                    : selectedTakeScore
                      ? 'status-pill--loading'
                      : 'status-pill--loading'
                }`}
              >
                {selectedTakeScore
                  ? selectedTakeNoteFeedback.length > 0
                    ? `노트 ${selectedTakeNoteFeedback.length}개`
                    : '구간 요약만 있음'
                  : '점수 대기 중'}
              </span>
            </div>

            {selectedTakeScore ? (
              <div className="support-stack">
                <p className="panel__summary">
                  이 패널은 구간 요약을 넘어서 노트 단위 교정 포인트까지 보여줍니다. 노트 목록에서
                  문제가 시작음, 유지음, 타이밍, 신뢰도 중 어디에 있는지 확인해 보세요.
                </p>

                <div className="mini-grid">
                  <div className="mini-card">
                    <span>음정 기준</span>
                    <strong>{getPitchQualityModeLabel(selectedTakeScore.pitch_quality_mode)}</strong>
                    <small>{getPitchQualityModeHint(selectedTakeScore.pitch_quality_mode)}</small>
                  </div>
                  <div className="mini-card">
                    <span>화음 기준</span>
                    <strong>{getHarmonyReferenceLabel(selectedTakeScore.harmony_reference_mode)}</strong>
                    <small>
                      {getHarmonyReferenceHint(
                        selectedTakeScore.harmony_reference_mode,
                        chordMarkerCount,
                      )}
                    </small>
                  </div>
                  <div className="mini-card">
                    <span>노트 피드백</span>
                    <strong>
                      {selectedTakeNoteFeedback.length > 0 ? '준비됨' : '연결 안 됨'}
                    </strong>
                    <small>
                      {selectedTakeNoteFeedback.length > 0
                        ? '방향성 cents 오차와 신뢰도를 교정 작업에 바로 사용할 수 있습니다.'
                        : '이 점수에는 구간 피드백만 있으니 거친 가이드로만 봐 주세요.'}
                    </small>
                  </div>
                  <div className="mini-card">
                    <span>코드 마커</span>
                    <strong>
                      {chordMarkerCount > 0 ? `${chordMarkerCount}개 마커` : '연결 안 됨'}
                    </strong>
                    <small>
                      {chordMarkerCount > 0
                        ? '무엇을 기준으로 채점하는지 코드 인식 화성 기준을 투명하게 보여줄 수 있습니다.'
                        : '코드 타임라인을 연결하면 화성 적합도를 키 기준 대체 경로에서 벗어나게 할 수 있습니다.'}
                    </small>
                  </div>
                </div>

                {selectedTakeNoteFeedback.length > 0 ? (
                  <>
                    <details className="studio-mobile-fold studio-mobile-fold--secondary">
                      <summary className="studio-mobile-fold__summary">
                        <span>교정 타임라인</span>
                        <strong>{noteFeedbackDetailSummaryLabel}</strong>
                      </summary>
                      <div className="studio-mobile-fold__body">
                    <div className="note-timeline-card">
                      <div className="note-timeline-card__header">
                        <div>
                          <strong>교정 타임라인</strong>
                          <p>
                            노트를 눌러 방향성, 타이밍, 유지음 안정도, 신뢰도를 확인해 보세요.
                          </p>
                        </div>
                        <div className="candidate-chip-row">
                          <span className="candidate-chip candidate-chip--good">안정</span>
                          <span className="candidate-chip candidate-chip--warn">검토</span>
                          <span className="candidate-chip candidate-chip--alert">우선 수정</span>
                        </div>
                      </div>

                      <div className="note-timeline">
                        {selectedTakeNoteFeedback.map((item, index) => {
                          const leftPercent =
                            noteFeedbackTimelineDurationMs > 0
                              ? (item.start_ms / noteFeedbackTimelineDurationMs) * 100
                              : 0
                          const widthPercent =
                            noteFeedbackTimelineDurationMs > 0
                              ? Math.max(
                                  4,
                                  ((item.end_ms - item.start_ms) / noteFeedbackTimelineDurationMs) * 100,
                                )
                              : 8
                          const noteTone = getScoreTone(item.note_score)
                          const style = {
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          } satisfies CSSProperties

                          return (
                            <button
                              key={`${selectedTakeScore.score_id}-${item.note_index}`}
                              className={`note-timeline__note note-timeline__note--${noteTone} ${
                                selectedNoteFeedback?.note_index === item.note_index
                                  ? 'note-timeline__note--selected'
                                  : ''
                              }`}
                              style={style}
                              type="button"
                              onClick={() => onSelectNoteFeedback(index)}
                            >
                              N{item.note_index + 1}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {selectedNoteFeedback ? (
                      <article className="note-detail-card">
                        <div className="note-detail-card__header">
                          <div>
                            <p className="eyebrow">선택한 노트</p>
                            <h3>
                              {selectedNoteFeedback.note_index + 1}번 노트 ·{' '}
                              {midiToPitchName(selectedNoteFeedback.target_midi)}
                            </h3>
                            <p className="status-card__hint">
                              {formatTimeSpan(
                                selectedNoteFeedback.start_ms,
                                selectedNoteFeedback.end_ms,
                              )}
                            </p>
                          </div>
                          <div className="candidate-chip-row">
                            <span
                              className={`candidate-chip candidate-chip--${getScoreTone(
                                selectedNoteFeedback.note_score,
                              )}`}
                            >
                              노트 점수 {selectedNoteFeedback.note_score.toFixed(1)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                selectedNoteFeedback.sustain_median_cents ??
                                  selectedNoteFeedback.attack_signed_cents,
                              )}`}
                            >
                              {getPitchDirectionLabel(
                                selectedNoteFeedback.sustain_median_cents ??
                                  selectedNoteFeedback.attack_signed_cents,
                              )}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getConfidenceTone(
                                selectedNoteFeedback.confidence,
                              )}`}
                            >
                              신뢰도 {formatConfidence(selectedNoteFeedback.confidence)}
                            </span>
                          </div>
                        </div>

                        <p>{selectedNoteFeedback.message}</p>

                        <div className="score-grid">
                          <div className="score-card">
                            <span>시작음</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.attack_signed_cents)}</strong>
                          </div>
                          <div className="score-card">
                            <span>유지음</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.sustain_median_cents)}</strong>
                          </div>
                          <div className="score-card">
                            <span>타이밍</span>
                            <strong>{formatSignedMs(selectedNoteFeedback.timing_offset_ms)}</strong>
                          </div>
                          <div className="score-card score-card--highlight">
                            <span>정확 비율</span>
                            <strong>{formatRatio(selectedNoteFeedback.in_tune_ratio)}</strong>
                          </div>
                        </div>

                        <div className="mini-grid">
                          <div className="mini-card">
                            <span>시작음 구간</span>
                            <strong>
                              {formatTimeSpan(
                                selectedNoteFeedback.attack_start_ms,
                                selectedNoteFeedback.attack_end_ms,
                              )}
                            </strong>
                          </div>
                          <div className="mini-card">
                            <span>유지음 편차</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.sustain_mad_cents)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>최대 샤프</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.max_sharp_cents)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>최대 플랫</span>
                            <strong>{formatSignedCents(selectedNoteFeedback.max_flat_cents)}</strong>
                          </div>
                        </div>

                        <div className="note-subscore-grid">
                          <div className="mini-card">
                            <span>시작음 점수</span>
                            <strong>{selectedNoteFeedback.attack_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>유지음 점수</span>
                            <strong>{selectedNoteFeedback.sustain_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>안정도</span>
                            <strong>{selectedNoteFeedback.stability_score.toFixed(1)}</strong>
                          </div>
                          <div className="mini-card">
                            <span>타이밍 점수</span>
                            <strong>{selectedNoteFeedback.timing_score.toFixed(1)}</strong>
                          </div>
                        </div>
                      </article>
                    ) : null}
                      </div>
                    </details>

                    <details className="studio-mobile-fold studio-mobile-fold--secondary">
                      <summary className="studio-mobile-fold__summary">
                        <span>노트 교정 목록</span>
                        <strong>{noteFeedbackSummaryLabel}</strong>
                      </summary>
                      <div className="studio-mobile-fold__body">
                    <div className="note-feedback-list">
                      {selectedTakeNoteFeedback.map((item, index) => (
                        <button
                          key={`${selectedTakeScore.score_id}-row-${item.note_index}`}
                          className={`note-feedback-row note-feedback-row--${getScoreTone(item.note_score)} ${
                            selectedNoteFeedback?.note_index === item.note_index
                              ? 'note-feedback-row--selected'
                              : ''
                          }`}
                          type="button"
                          onClick={() => onSelectNoteFeedback(index)}
                        >
                          <div className="note-feedback-row__identity">
                            <strong>
                              {item.note_index + 1}번 노트 · {midiToPitchName(item.target_midi)}
                            </strong>
                            <span>{formatTimeSpan(item.start_ms, item.end_ms)}</span>
                          </div>

                          <div className="note-feedback-row__chips">
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                item.attack_signed_cents,
                              )}`}
                            >
                              시작음 {formatSignedCents(item.attack_signed_cents)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getPitchDirectionTone(
                                item.sustain_median_cents,
                              )}`}
                            >
                              유지음 {formatSignedCents(item.sustain_median_cents)}
                            </span>
                            <span
                              className={`candidate-chip candidate-chip--${getConfidenceTone(
                                item.confidence,
                              )}`}
                            >
                              신뢰도 {formatConfidence(item.confidence)}
                            </span>
                          </div>

                          <div className="note-feedback-row__summary">
                            <span>타이밍 {formatSignedMs(item.timing_offset_ms)}</span>
                            <span>정확도 {formatRatio(item.in_tune_ratio)}</span>
                            <span>점수 {item.note_score.toFixed(1)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="empty-card empty-card--warn">
                    <p>이 점수에는 아직 노트 단위 교정 데이터가 연결되지 않았습니다.</p>
                    <p>
                      처리 완료된 테이크에서 분석을 다시 실행하면 방향성 cents 오차 기반 노트
                      피드백을 받을 수 있습니다. 그전까지는 아래 구간 요약을 거친 가이드로만
                      활용해 주세요.
                    </p>
                  </div>
                )}

                {selectedTakeScore.feedback_json.length > 0 ? (
                  <details className="studio-mobile-fold studio-mobile-fold--secondary">
                    <summary className="studio-mobile-fold__summary">
                      <span>구간 진단</span>
                      <strong>{noteFeedbackSegmentSummaryLabel}</strong>
                    </summary>
                    <div className="studio-mobile-fold__body">
                      <div className="support-stack">
                    <p className="json-label">구간 맥락</p>
                    <div className="feedback-list">
                      {selectedTakeScore.feedback_json.map((item) => (
                        <article
                          className="feedback-card"
                          key={`${selectedTakeScore.score_id}-${item.segment_index}`}
                        >
                          <div className="feedback-card__header">
                            <strong>
                              구간 {item.segment_index + 1} · {formatTimeSpan(item.start_ms, item.end_ms)}
                            </strong>
                            <span>{item.end_ms - item.start_ms} ms</span>
                          </div>

                          <div className="feedback-card__scores">
                            <span>음정 {item.pitch_score.toFixed(1)}</span>
                            <span>리듬 {item.rhythm_score.toFixed(1)}</span>
                            <span>화성 {item.harmony_fit_score.toFixed(1)}</span>
                          </div>

                          <p>{item.message}</p>
                        </article>
                      ))}
                    </div>
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>아직 점수 피드백이 없습니다.</p>
                <p>녹음 후 분석을 실행하면 노트 단위와 구간 요약 피드백이 프로젝트에 저장됩니다.</p>
              </div>
            )}
          </article>

  )
}
