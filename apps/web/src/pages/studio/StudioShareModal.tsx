type MessageTone = 'error' | 'hint'

type SummaryCard = {
  label: string
  value: string
}

type ShareVersionOption = {
  label: string
  value: string
}

type ShareArtifactItem = {
  checked: boolean
  description: string
  disabled: boolean
  key: string
  label: string
}

type StudioShareModalProps = {
  artifactItems: ShareArtifactItem[]
  createButtonDisabled: boolean
  createButtonLabel: string
  feedbackMessage: { text: string; tone: MessageTone } | null
  isOpen: boolean
  onClose: () => void
  onCreate: () => void
  onExpiryDaysChange: (value: number) => void
  onLabelChange: (value: string) => void
  onToggleArtifact: (key: string) => void
  onVersionChange: (value: string) => void
  shareExpiryDays: number
  shareLabelDraft: string
  shareVersionIdDraft: string
  summaryCards: SummaryCard[]
  versionOptions: ShareVersionOption[]
}

export function StudioShareModal({
  artifactItems,
  createButtonDisabled,
  createButtonLabel,
  feedbackMessage,
  isOpen,
  onClose,
  onCreate,
  onExpiryDaysChange,
  onLabelChange,
  onToggleArtifact,
  onVersionChange,
  shareExpiryDays,
  shareLabelDraft,
  shareVersionIdDraft,
  summaryCards,
  versionOptions,
}: StudioShareModalProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="studio-surface-overlay studio-surface-overlay--modal" onClick={onClose}>
      <div
        className="studio-surface-panel studio-surface-panel--modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-share-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-surface-panel__header">
          <div>
            <p className="eyebrow">공유</p>
            <h2 id="studio-share-modal-title">읽기 전용 공유 만들기</h2>
          </div>
          <button className="studio-surface-panel__close" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="studio-surface-panel__body studio-surface-panel__body--share">
          <div className="studio-share-summary">
            {summaryCards.map((card) => (
              <div className="mini-card" key={`${card.label}-${card.value}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <div className="field-grid studio-surface-panel__field-grid">
            <label className="field">
              <span>공유 이름</span>
              <input
                data-testid="share-label-input"
                className="text-input"
                value={shareLabelDraft}
                onChange={(event) => onLabelChange(event.target.value)}
                placeholder="코치 리뷰"
              />
            </label>

            <label className="field field--compact">
              <span>만료 일수</span>
              <input
                className="text-input"
                type="number"
                min={1}
                max={90}
                value={shareExpiryDays}
                onChange={(event) => onExpiryDaysChange(Number(event.target.value) || 7)}
              />
            </label>

            <label className="field">
              <span>스냅샷 버전</span>
              <select
                className="text-input"
                value={shareVersionIdDraft}
                onChange={(event) => onVersionChange(event.target.value)}
              >
                <option value="">현재 작업면 그대로</option>
                {versionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="studio-share-checklist">
            <span className="studio-share-checklist__label">포함 항목</span>
            <div className="studio-share-checklist__grid">
              {artifactItems.map((item) => (
                <label
                  key={item.key}
                  className={`studio-share-checklist__item ${
                    item.disabled ? 'studio-share-checklist__item--disabled' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={item.disabled}
                    onChange={() => onToggleArtifact(item.key)}
                  />
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </label>
              ))}
            </div>
          </div>

          {feedbackMessage ? (
            <p className={feedbackMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
              {feedbackMessage.text}
            </p>
          ) : null}
        </div>

        <div className="studio-surface-panel__footer">
          <button className="button-secondary" type="button" onClick={onClose}>
            취소
          </button>
          <button
            data-testid="create-share-link-button"
            className="button-primary"
            type="button"
            disabled={createButtonDisabled}
            onClick={onCreate}
          >
            {createButtonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
