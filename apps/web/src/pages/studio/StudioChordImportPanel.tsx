type StatusTone = 'error' | 'loading' | 'ready'

type StudioChordImportPanelProps = {
  jsonDraft: string
  onJsonDraftChange: (value: string) => void
  statusLabel: string
  statusTone: StatusTone
}

export function StudioChordImportPanel({
  jsonDraft,
  onJsonDraftChange,
  statusLabel,
  statusTone,
}: StudioChordImportPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">고급 붙여넣기</p>
          <h2>가져오기</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        다른 도구에서 이미 만든 코드 목록이 있다면 여기 붙여 넣어 편집기에 반영할 수 있습니다.
        평소에는 위쪽 행 편집기만으로도 충분합니다.
      </p>

      <details className="advanced-panel">
        <summary className="advanced-panel__summary">고급 붙여넣기 열기</summary>
        <div className="advanced-panel__body">
          <label className="field">
            <span>코드 목록 붙여넣기</span>
            <textarea
              className="text-input json-card--editor"
              value={jsonDraft}
              onChange={(event) => onJsonDraftChange(event.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="empty-card empty-card--warn">
            <p>붙여 넣기 전에 확인하세요.</p>
            <p>각 구간의 시작 시간, 끝 시간, 코드 이름이 순서대로 들어 있으면 대부분 바로 가져올 수 있습니다.</p>
          </div>
        </div>
      </details>
    </article>
  )
}
