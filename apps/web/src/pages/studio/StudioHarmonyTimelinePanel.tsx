type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type HarmonyMarkerRow = {
  endMs: string
  id: string
  label: string
  onEndMsChange: (value: string) => void
  onLabelChange: (value: string) => void
  onPitchClassesChange: (value: string) => void
  onQualityChange: (value: string) => void
  onRemove: () => void
  onRootChange: (value: string) => void
  onStartMsChange: (value: string) => void
  pitchClasses: string
  quality: string
  root: string
  startMs: string
}

type SummaryCard = {
  description: string
  label: string
  value: string
}

type StudioHarmonyTimelinePanelProps = {
  addButtonLabel: string
  applyImportButtonLabel: string
  feedbackMessage: { text: string; tone: MessageTone }
  importButtonLabel: string
  markerRows: HarmonyMarkerRow[]
  onAddMarker: () => void
  onApplyImport: () => void
  onLoadImport: () => void
  onSave: () => void
  onSeedFromProjectKey: () => void
  saveButtonDisabled: boolean
  saveButtonLabel: string
  seedButtonLabel: string
  statusLabel: string
  statusTone: StatusTone
  summaryCards: SummaryCard[]
}

export function StudioHarmonyTimelinePanel({
  addButtonLabel,
  applyImportButtonLabel,
  feedbackMessage,
  importButtonLabel,
  markerRows,
  onAddMarker,
  onApplyImport,
  onLoadImport,
  onSave,
  onSeedFromProjectKey,
  saveButtonDisabled,
  saveButtonLabel,
  seedButtonLabel,
  statusLabel,
  statusTone,
  summaryCards,
}: StudioHarmonyTimelinePanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">화성 기준 작성</p>
          <h2>코드 편집</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        화성 기준을 직접 연결하면 키 중심의 대체 판정보다 더 구체적인 화성 적합도를 확인할 수 있습니다.
        여기서 코드 마커를 저장한 뒤 분석을 다시 실행해 보세요.
      </p>

      <div className="mini-grid">
        {summaryCards.map((card) => (
          <div className="mini-card" key={`${card.label}-${card.value}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.description}</small>
          </div>
        ))}
      </div>

      <div className="button-row">
        <button className="button-primary" type="button" onClick={onAddMarker}>
          {addButtonLabel}
        </button>
        <button
          data-testid="seed-chord-from-key-button"
          className="button-secondary"
          type="button"
          onClick={onSeedFromProjectKey}
        >
          {seedButtonLabel}
        </button>
        <button className="button-secondary" type="button" onClick={onLoadImport}>
          {importButtonLabel}
        </button>
        <button className="button-secondary" type="button" onClick={onApplyImport}>
          {applyImportButtonLabel}
        </button>
        <button
          data-testid="save-chord-timeline-button"
          className="button-secondary"
          type="button"
          disabled={saveButtonDisabled}
          onClick={onSave}
        >
          {saveButtonLabel}
        </button>
      </div>

      <p className={feedbackMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
        {feedbackMessage.text}
      </p>

      {markerRows.length > 0 ? (
        <div className="chord-list">
          {markerRows.map((item) => (
            <article className="chord-row" key={item.id}>
              <div className="field">
                <span>시작 ms</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={item.startMs}
                  onChange={(event) => item.onStartMsChange(event.target.value)}
                />
              </div>
              <div className="field">
                <span>끝 ms</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={item.endMs}
                  onChange={(event) => item.onEndMsChange(event.target.value)}
                />
              </div>
              <div className="field">
                <span>라벨</span>
                <input
                  className="text-input"
                  value={item.label}
                  onChange={(event) => item.onLabelChange(event.target.value)}
                  placeholder="A 메이저"
                />
              </div>
              <div className="field">
                <span>루트</span>
                <input
                  className="text-input"
                  value={item.root}
                  onChange={(event) => item.onRootChange(event.target.value)}
                  placeholder="A"
                />
              </div>
              <div className="field">
                <span>성격</span>
                <input
                  className="text-input"
                  value={item.quality}
                  onChange={(event) => item.onQualityChange(event.target.value)}
                  placeholder="major, minor, dom7"
                />
              </div>
              <div className="field">
                <span>피치 클래스</span>
                <input
                  className="text-input"
                  value={item.pitchClasses}
                  onChange={(event) => item.onPitchClassesChange(event.target.value)}
                  placeholder="0, 4, 7"
                />
              </div>
              <button className="button-secondary button-secondary--small" type="button" onClick={item.onRemove}>
                삭제
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-card">
          <p>편집기에 아직 코드 마커가 없습니다.</p>
          <p>직접 추가하거나 프로젝트 키에서 시작한 뒤, 준비된 목록을 붙여 넣어 이어갈 수 있습니다.</p>
        </div>
      )}
    </article>
  )
}
