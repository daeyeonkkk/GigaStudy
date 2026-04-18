type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type StudioMixdownRenderPanelProps = {
  guideSourceLabel: string
  guideVolumeLabel: string
  onRefresh: () => void
  onRender: () => void
  onSave: () => void
  previewButtonDisabled: boolean
  previewButtonLabel: string
  previewMessage: { text: string; tone: MessageTone }
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveMessage: { text: string; tone: MessageTone } | null
  selectedTakeLabel: string
  statusLabel: string
  statusTone: StatusTone
  takeVolumeLabel: string
}

export function StudioMixdownRenderPanel({
  guideSourceLabel,
  guideVolumeLabel,
  onRefresh,
  onRender,
  onSave,
  previewButtonDisabled,
  previewButtonLabel,
  previewMessage,
  saveButtonDisabled,
  saveButtonLabel,
  saveMessage,
  selectedTakeLabel,
  statusLabel,
  statusTone,
  takeVolumeLabel,
}: StudioMixdownRenderPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">믹스다운 렌더</p>
          <h2>미리듣기 렌더</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        흐름은 단순하게 유지합니다. 현재 믹서 값으로 가이드와 선택한 테이크를 렌더링하고, 로컬에서
        확인한 뒤 괜찮으면 프로젝트 산출물로 저장합니다.
      </p>

      <div className="mini-grid">
        <div className="mini-card">
          <span>가이드 소스</span>
          <strong>{guideSourceLabel}</strong>
        </div>
        <div className="mini-card">
          <span>선택한 테이크</span>
          <strong>{selectedTakeLabel}</strong>
        </div>
        <div className="mini-card">
          <span>가이드 음량</span>
          <strong>{guideVolumeLabel}</strong>
        </div>
        <div className="mini-card">
          <span>테이크 음량</span>
          <strong>{takeVolumeLabel}</strong>
        </div>
      </div>

      <div className="button-row">
        <button
          className="button-primary"
          type="button"
          disabled={previewButtonDisabled}
          onClick={onRender}
        >
          {previewButtonLabel}
        </button>

        <button
          className="button-secondary"
          type="button"
          disabled={saveButtonDisabled}
          onClick={onSave}
        >
          {saveButtonLabel}
        </button>

        <button className="button-secondary" type="button" onClick={onRefresh}>
          스튜디오 스냅샷 새로고침
        </button>
      </div>

      <p className={previewMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
        {previewMessage.text}
      </p>

      {saveMessage ? (
        <p className={saveMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {saveMessage.text}
        </p>
      ) : null}
    </article>
  )
}
