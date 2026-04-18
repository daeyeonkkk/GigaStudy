type StatusTone = 'error' | 'loading' | 'ready'

type MiniCard = {
  label: string
  value: string
}

type StudioArrangementSummaryPanelProps = {
  arrangementJsonDraft: string
  comparisonHint: string
  comparisonSummaryLabel: string
  detailCards: MiniCard[]
  hasSelectedArrangement: boolean
  onArrangementJsonChange: (value: string) => void
  onTitleChange: (value: string) => void
  sourceMelodyLabel: string
  statusLabel: string
  statusTone: StatusTone
  titleDraft: string
}

export function StudioArrangementSummaryPanel({
  arrangementJsonDraft,
  comparisonHint,
  comparisonSummaryLabel,
  detailCards,
  hasSelectedArrangement,
  onArrangementJsonChange,
  onTitleChange,
  sourceMelodyLabel,
  statusLabel,
  statusTone,
  titleDraft,
}: StudioArrangementSummaryPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">후보 다듬기</p>
          <h2>후보 조정</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      {hasSelectedArrangement ? (
        <div className="support-stack">
          <div className="field-grid">
            <label className="field">
              <span>후보 제목</span>
              <input
                className="text-input"
                value={titleDraft}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </label>

            <div className="mini-card">
              <span>원본 멜로디</span>
              <strong>{sourceMelodyLabel}</strong>
            </div>
          </div>

          <div className="mini-grid">
            {detailCards.map((card) => (
              <div className="mini-card" key={`${card.label}-${card.value}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <div className="mini-card mini-card--stack">
            <span>비교 요약</span>
            <strong>{comparisonSummaryLabel}</strong>
            <small>{comparisonHint}</small>
          </div>

          <details className="advanced-panel">
            <summary className="advanced-panel__summary">고급 편집 열기</summary>
            <div className="advanced-panel__body">
              <p className="status-card__hint">
                파트 구성을 직접 다뤄야 할 때만 여세요. 기본 작업은 위 비교 카드와 악보 화면만으로도 충분합니다.
              </p>
              <textarea
                className="json-card json-card--editor"
                value={arrangementJsonDraft}
                onChange={(event) => onArrangementJsonChange(event.target.value)}
              />
            </div>
          </details>
        </div>
      ) : (
        <div className="empty-card">
          <p>선택된 편곡 후보가 없습니다.</p>
          <p>후보를 만든 뒤 하나를 선택하면 세부 조정과 내보내기를 이어갈 수 있습니다.</p>
        </div>
      )}
    </article>
  )
}
