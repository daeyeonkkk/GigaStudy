import { useStudioCompactViewport } from './useStudioCompactViewport'

type StudioRailModeButton = {
  id: string
  label: string
  active: boolean
  onSelect: () => void
}

type StudioRailTakeButton = {
  id: string
  label: string
  meta: string
  active: boolean
  onSelect: () => void
}

type StudioRailProps = {
  arrangementContextLabel: string
  arrangementSummaryLabel: string
  canFocusInspectorNotes: boolean
  canOpenArrangementWorkbench: boolean
  canOpenMelodyWorkbench: boolean
  consoleAlignmentLabel: string
  consoleMicLabel: string
  guideConnected: boolean
  guideSummaryLabel: string
  melodySummaryLabel: string
  mobileSummaryLabel: string
  modeButtons: StudioRailModeButton[]
  noteFeedbackContextLabel: string
  noteFeedbackSummaryLabel: string
  onFocusInspectorNotes: () => void
  onOpenArrangementWorkbench: () => void
  onOpenAudioSetup: () => void
  onOpenMelodyWorkbench: () => void
  readyTakeCount: number
  selectedTakeLabel: string
  selectedTakeScoreLabel: string
  takeCount: number
  takeItems: StudioRailTakeButton[]
}

export function StudioRail({
  arrangementContextLabel,
  arrangementSummaryLabel,
  canFocusInspectorNotes,
  canOpenArrangementWorkbench,
  canOpenMelodyWorkbench,
  consoleAlignmentLabel,
  consoleMicLabel,
  guideConnected,
  guideSummaryLabel,
  melodySummaryLabel,
  mobileSummaryLabel,
  modeButtons,
  noteFeedbackContextLabel,
  noteFeedbackSummaryLabel,
  onFocusInspectorNotes,
  onOpenArrangementWorkbench,
  onOpenAudioSetup,
  onOpenMelodyWorkbench,
  readyTakeCount,
  selectedTakeLabel,
  selectedTakeScoreLabel,
  takeCount,
  takeItems,
}: StudioRailProps) {
  const isCompactViewport = useStudioCompactViewport()

  return (
    <details
      className="studio-wave-editor__rail-shell studio-mobile-panel studio-mobile-panel--rail"
      open={isCompactViewport ? undefined : true}
    >
      <summary className="studio-mobile-panel__summary">
        <span>프로젝트</span>
        <strong>{mobileSummaryLabel}</strong>
      </summary>
      <aside className="studio-wave-editor__rail studio-mobile-panel__body">
        <div className="studio-wave-editor__mode-switch" data-testid="studio-workspace-modes">
          {modeButtons.map((mode) => (
            <button
              key={mode.id}
              className={`studio-wave-editor__mode-button ${
                mode.active ? 'studio-wave-editor__mode-button--active' : ''
              }`}
              data-testid={`studio-workspace-mode-${mode.id}`}
              type="button"
              aria-pressed={mode.active}
              onClick={mode.onSelect}
            >
              <strong>{mode.label}</strong>
            </button>
          ))}
        </div>

        <section className="studio-wave-editor__rail-section">
          <p className="studio-wave-editor__rail-kicker">프로젝트</p>
          <div className="studio-wave-editor__rail-objects">
            <div className="studio-wave-editor__rail-object">
              <div className="studio-wave-editor__rail-object-copy">
                <span>가이드</span>
                <strong>{guideConnected ? '연결됨' : '없음'}</strong>
                <small>{guideSummaryLabel}</small>
              </div>
              <div className="studio-wave-editor__rail-object-actions">
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onOpenAudioSetup}
                >
                  교체
                </button>
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onOpenAudioSetup}
                >
                  세부
                </button>
              </div>
            </div>

            <div className="studio-wave-editor__rail-object studio-wave-editor__rail-object--takes">
              <div className="studio-wave-editor__rail-object-copy">
                <span>테이크</span>
                <strong>{takeCount}개</strong>
                <small>{readyTakeCount > 0 ? `준비 완료 ${readyTakeCount}개` : '아직 없음'}</small>
              </div>
              <div className="studio-wave-editor__rail-takes">
                {takeItems.length === 0 ? (
                  <div className="studio-wave-editor__rail-take studio-wave-editor__rail-take--empty">
                    아직 테이크가 없습니다.
                  </div>
                ) : (
                  takeItems.map((take) => (
                    <button
                      key={`rail-take-${take.id}`}
                      className={`studio-wave-editor__rail-take ${
                        take.active ? 'studio-wave-editor__rail-take--active' : ''
                      }`}
                      type="button"
                      onClick={take.onSelect}
                    >
                      <strong>{take.label}</strong>
                      <span>{take.meta}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="studio-wave-editor__rail-object">
              <div className="studio-wave-editor__rail-object-copy">
                <span>노트 피드백</span>
                <strong>{noteFeedbackSummaryLabel}</strong>
                <small>{noteFeedbackContextLabel}</small>
              </div>
              <div className="studio-wave-editor__rail-object-actions">
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onFocusInspectorNotes}
                  disabled={!canFocusInspectorNotes}
                >
                  노트 목록 열기
                </button>
              </div>
            </div>

            <div className="studio-wave-editor__rail-object">
              <div className="studio-wave-editor__rail-object-copy">
                <span>멜로디 초안</span>
                <strong>{melodySummaryLabel}</strong>
                <small>{noteFeedbackContextLabel}</small>
              </div>
              <div className="studio-wave-editor__rail-object-actions">
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onOpenMelodyWorkbench}
                  disabled={!canOpenMelodyWorkbench}
                >
                  멜로디 편집
                </button>
              </div>
            </div>

            <div className="studio-wave-editor__rail-object">
              <div className="studio-wave-editor__rail-object-copy">
                <span>편곡 후보</span>
                <strong>{arrangementSummaryLabel}</strong>
                <small>{arrangementContextLabel}</small>
              </div>
              <div className="studio-wave-editor__rail-object-actions">
                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={onOpenArrangementWorkbench}
                  disabled={!canOpenArrangementWorkbench}
                >
                  후보 만들기
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="studio-wave-editor__rail-section studio-wave-editor__rail-section--summary">
          <p className="studio-wave-editor__rail-kicker">상태</p>
          <div className="studio-wave-editor__rail-summary">
            <div className="studio-wave-editor__rail-card">
              <span>선택 take</span>
              <strong>{selectedTakeLabel}</strong>
            </div>
            <div className="studio-wave-editor__rail-card">
              <span>총점</span>
              <strong>{selectedTakeScoreLabel}</strong>
            </div>
            <div className="studio-wave-editor__rail-card">
              <span>마이크 상태</span>
              <strong>{consoleMicLabel}</strong>
            </div>
            <div className="studio-wave-editor__rail-card">
              <span>정렬 흐름값</span>
              <strong>{consoleAlignmentLabel}</strong>
            </div>
          </div>
        </section>
      </aside>
    </details>
  )
}
