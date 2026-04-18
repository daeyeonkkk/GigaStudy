type StatusTone = 'error' | 'loading' | 'ready'

type MiniItem = {
  label: string
  value: string
}

type MessageTone = 'error' | 'hint'

type StudioMelodyPanelProps = {
  extractButtonDisabled: boolean
  extractButtonLabel: string
  hasSelectedTake: boolean
  melodyMessage: { text: string; tone: MessageTone }
  midiDownloadUrl: string | null
  miniItems: MiniItem[]
  onAddNote: () => void
  onExtract: () => void
  onSave: () => void
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveMessage: { text: string; tone: MessageTone } | null
  statusLabel: string
  statusTone: StatusTone
}

export function StudioMelodyPanel({
  extractButtonDisabled,
  extractButtonLabel,
  hasSelectedTake,
  melodyMessage,
  midiDownloadUrl,
  miniItems,
  onAddNote,
  onExtract,
  onSave,
  saveButtonDisabled,
  saveButtonLabel,
  saveMessage,
  statusLabel,
  statusTone,
}: StudioMelodyPanelProps) {
  return (
    <article className="panel studio-block" data-testid="melody-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">멜로디 추출</p>
          <h2>추출</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        채점이 끝난 테이크를 바탕으로 편곡 전에 사용할 수 있는 MIDI 초안을 만들고, 프로젝트 그리드에 맞춰
        박자를 추정하고 노트 목록까지 이어갑니다.
      </p>

      {hasSelectedTake ? (
        <div className="support-stack">
          <div className="mini-grid">
            {miniItems.map((item) => (
              <div className="mini-card" key={`${item.label}-${item.value}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="button-row">
            <button
              data-testid="extract-melody-button"
              className="button-primary"
              type="button"
              disabled={extractButtonDisabled}
              onClick={onExtract}
            >
              {extractButtonLabel}
            </button>

            <button
              className="button-secondary"
              type="button"
              disabled={saveButtonDisabled}
              onClick={onSave}
            >
              {saveButtonLabel}
            </button>

            <button className="button-secondary" type="button" onClick={onAddNote}>
              노트 추가
            </button>

            {midiDownloadUrl ? (
              <a className="button-secondary" href={midiDownloadUrl}>
                MIDI 내려받기
              </a>
            ) : null}
          </div>

          <p className={melodyMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
            {melodyMessage.text}
          </p>

          {saveMessage ? (
            <p className={saveMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
              {saveMessage.text}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="empty-card">
          <p>선택된 테이크가 없습니다.</p>
          <p>멜로디 초안을 추출하기 전에 테이크를 먼저 선택해 주세요.</p>
        </div>
      )}
    </article>
  )
}
