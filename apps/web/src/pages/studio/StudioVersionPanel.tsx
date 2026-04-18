type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type VersionHistoryCard = {
  arrangementCountLabel: string
  createdAtLabel: string
  hasGuideLabel: string
  id: string
  label: string
  note: string | null
  readyTakeCountLabel: string
  sourceLabel: string
  takeSummaryLabel: string
  takeCountLabel: string
}

type StudioVersionPanelProps = {
  cards: VersionHistoryCard[]
  feedbackMessage: { text: string; tone: MessageTone } | null
  onCapture: () => void
  onRefresh: () => void
  onVersionLabelChange: (value: string) => void
  onVersionNoteChange: (value: string) => void
  saveButtonDisabled: boolean
  saveButtonLabel: string
  statusLabel: string
  statusTone: StatusTone
  versionLabelDraft: string
  versionNoteDraft: string
}

export function StudioVersionPanel({
  cards,
  feedbackMessage,
  onCapture,
  onRefresh,
  onVersionLabelChange,
  onVersionNoteChange,
  saveButtonDisabled,
  saveButtonLabel,
  statusLabel,
  statusTone,
  versionLabelDraft,
  versionNoteDraft,
}: StudioVersionPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">버전 히스토리</p>
          <h2>버전</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        가벼운 프로젝트 버전 히스토리를 유지합니다. 현재 스튜디오 상태를 스냅샷으로 남겨 공유 전이나 큰
        편곡 수정 전에 흐름을 추적할 수 있게 합니다.
      </p>

      <details className="advanced-panel">
        <summary className="advanced-panel__summary">이름 / 메모 직접 쓰기</summary>
        <div className="advanced-panel__body">
          <div className="field-grid">
            <label className="field">
              <span>스냅샷 이름</span>
              <input
                className="text-input"
                value={versionLabelDraft}
                onChange={(event) => onVersionLabelChange(event.target.value)}
                placeholder="리뷰 전 체크포인트"
              />
            </label>

            <label className="field">
              <span>스냅샷 메모</span>
              <input
                className="text-input"
                value={versionNoteDraft}
                onChange={(event) => onVersionNoteChange(event.target.value)}
                placeholder="무엇이 바뀌었는지, 왜 남기는지"
              />
            </label>
          </div>
        </div>
      </details>

      <div className="button-row">
        <button
          className="button-primary"
          type="button"
          disabled={saveButtonDisabled}
          onClick={onCapture}
        >
          {saveButtonLabel}
        </button>

        <button className="button-secondary" type="button" onClick={onRefresh}>
          버전 새로고침
        </button>
      </div>

      {feedbackMessage ? (
        <p className={feedbackMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {feedbackMessage.text}
        </p>
      ) : null}

      <div className="history-list">
        {cards.length === 0 ? (
          <div className="empty-card">
            <p>아직 프로젝트 버전이 없습니다.</p>
            <p>공유하기 전이나 큰 편곡 수정을 하기 전에 스냅샷을 남겨 주세요.</p>
          </div>
        ) : (
          cards.map((card) => (
            <article className="history-card" key={card.id}>
              <div className="history-card__header">
                <div>
                  <strong>{card.label}</strong>
                  <span>
                    {card.sourceLabel} | {card.createdAtLabel}
                  </span>
                </div>
                <span className="candidate-chip">{card.takeSummaryLabel}</span>
              </div>

              {card.note ? <p className="status-card__hint">{card.note}</p> : null}

              <div className="mini-grid">
                <div className="mini-card">
                  <span>가이드</span>
                  <strong>{card.hasGuideLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>테이크</span>
                  <strong>{card.takeCountLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>준비 완료 테이크</span>
                  <strong>{card.readyTakeCountLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>편곡 후보</span>
                  <strong>{card.arrangementCountLabel}</strong>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </article>
  )
}
