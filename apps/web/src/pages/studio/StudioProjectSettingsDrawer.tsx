type MessageTone = 'error' | 'hint'

type SummaryCard = {
  label: string
  value: string
}

type ProjectSettingsDraftValue = {
  baseKey: string
  bpm: string
  timeSignature: string
  title: string
}

type StudioProjectSettingsDrawerProps = {
  draft: ProjectSettingsDraftValue
  feedbackMessage: { text: string; tone: MessageTone } | null
  isOpen: boolean
  onClose: () => void
  onDraftChange: (field: keyof ProjectSettingsDraftValue, value: string) => void
  onSave: () => void
  saveButtonDisabled: boolean
  saveButtonLabel: string
  summaryCards: SummaryCard[]
}

export function StudioProjectSettingsDrawer({
  draft,
  feedbackMessage,
  isOpen,
  onClose,
  onDraftChange,
  onSave,
  saveButtonDisabled,
  saveButtonLabel,
  summaryCards,
}: StudioProjectSettingsDrawerProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="studio-surface-overlay studio-surface-overlay--drawer" onClick={onClose}>
      <div
        className="studio-surface-panel studio-surface-panel--drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-project-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-surface-panel__header">
          <div>
            <p className="eyebrow">프로젝트 설정</p>
            <h2 id="studio-project-settings-title">프로젝트 설정</h2>
          </div>
          <button className="studio-surface-panel__close" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="studio-surface-panel__body">
          <div className="mini-grid">
            {summaryCards.map((card) => (
              <div className="mini-card" key={`${card.label}-${card.value}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <div className="field-grid studio-surface-panel__field-grid">
            <label className="field">
              <span>프로젝트 이름</span>
              <input
                className="text-input"
                value={draft.title}
                onChange={(event) => onDraftChange('title', event.target.value)}
              />
            </label>

            <label className="field field--compact">
              <span>템포</span>
              <input
                className="text-input"
                inputMode="numeric"
                value={draft.bpm}
                onChange={(event) => onDraftChange('bpm', event.target.value)}
              />
            </label>

            <label className="field field--compact">
              <span>기준 키</span>
              <input
                className="text-input"
                value={draft.baseKey}
                onChange={(event) => onDraftChange('baseKey', event.target.value)}
              />
            </label>

            <label className="field field--compact">
              <span>박자</span>
              <input
                className="text-input"
                value={draft.timeSignature}
                onChange={(event) => onDraftChange('timeSignature', event.target.value)}
              />
            </label>
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
          <button className="button-primary" type="button" disabled={saveButtonDisabled} onClick={onSave}>
            {saveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
