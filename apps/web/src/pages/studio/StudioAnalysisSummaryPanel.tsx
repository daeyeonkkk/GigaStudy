type StatusTone = 'error' | 'loading' | 'ready'
type SurfaceTone = 'alert' | 'good' | 'hint' | 'neutral' | 'warn'

type AnalysisMiniCard = {
  detail?: string
  label: string
  value: string
}

type AnalysisScoreCard = {
  highlight?: boolean
  label: string
  value: string
}

type AnalysisChip = {
  label: string
  tone: Exclude<SurfaceTone, 'hint'>
}

type AnalysisMessage = {
  text: string
  tone: 'error' | 'hint'
}

type StudioAnalysisSummaryPanelProps = {
  actionMessages: AnalysisMessage[]
  chips: AnalysisChip[]
  harmonyFallbackWarning: boolean
  hasSelectedTake: boolean
  miniCards: AnalysisMiniCard[]
  onRefreshSnapshot: () => void
  onRetryAnalysis: () => void
  onRunAnalysis: () => void
  retryDisabled: boolean
  runButtonDisabled: boolean
  runButtonLabel: string
  scoreCards: AnalysisScoreCard[]
  statusLabel: string
  statusTone: StatusTone
}

export function StudioAnalysisSummaryPanel({
  actionMessages,
  chips,
  harmonyFallbackWarning,
  hasSelectedTake,
  miniCards,
  onRefreshSnapshot,
  onRetryAnalysis,
  onRunAnalysis,
  retryDisabled,
  runButtonDisabled,
  runButtonLabel,
  scoreCards,
  statusLabel,
  statusTone,
}: StudioAnalysisSummaryPanelProps) {
  return (
    <article className="panel studio-block" data-testid="analysis-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">다시 확인</p>
          <h2>점수</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        실시간 표시보다 녹음 후 정렬과 해석 가능한 피드백을 우선합니다. 이 단계에서 정렬 신뢰도, 3축
        점수, 채점 모드, 구간 및 노트 피드백을 모두 스튜디오 히스토리에 반영합니다.
      </p>

      {hasSelectedTake ? (
        <div className="support-stack">
          <div className="mini-grid">
            {miniCards.map((card) => (
              <div className="mini-card" key={`${card.label}-${card.value}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                {card.detail ? <small>{card.detail}</small> : null}
              </div>
            ))}
          </div>

          <div className="score-grid">
            {scoreCards.map((card) => (
              <div
                className={`score-card ${card.highlight ? 'score-card--highlight' : ''}`}
                key={`${card.label}-${card.value}`}
              >
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <div className="button-row">
            <button
              data-testid="run-post-analysis-button"
              className="button-primary"
              type="button"
              disabled={runButtonDisabled}
              onClick={onRunAnalysis}
            >
              {runButtonLabel}
            </button>

            <button
              className="button-secondary"
              type="button"
              disabled={retryDisabled}
              onClick={onRetryAnalysis}
            >
              실패한 작업 다시 실행
            </button>

            <button className="button-secondary" type="button" onClick={onRefreshSnapshot}>
              스냅샷 새로고침
            </button>
          </div>

          {chips.length > 0 ? (
            <div className="candidate-chip-row">
              {chips.map((chip) => (
                <span className={`candidate-chip candidate-chip--${chip.tone}`} key={chip.label}>
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}

          {harmonyFallbackWarning ? (
            <div className="empty-card empty-card--warn">
              <p>화성 적합도는 아직 키 기준 대체 경로로 계산되고 있습니다.</p>
              <p>프로젝트의 코드 타임라인이 연결되기 전에는 이 점수를 코드 인식 기반 확정 점수처럼 쓰지 마세요.</p>
            </div>
          ) : null}

          {actionMessages.map((message, index) => (
            <p className={message.tone === 'error' ? 'form-error' : 'status-card__hint'} key={index}>
              {message.text}
            </p>
          ))}
        </div>
      ) : (
        <div className="empty-card">
          <p>선택된 테이크가 없습니다.</p>
          <p>녹음 후 분석을 실행하기 전에 테이크를 먼저 선택해 주세요.</p>
        </div>
      )}
    </article>
  )
}
