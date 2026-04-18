import { getArrangementPartRoleLabel } from '../../lib/localizedLabels'
import { useStudioCompactViewport } from './useStudioCompactViewport'

type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type PartMixRow = {
  color: string
  enabled: boolean
  guideFocus: boolean
  id: string
  noteCountLabel: string
  onGuideFocusToggle: () => void
  onSoloToggle: () => void
  onToggleEnabled: (enabled: boolean) => void
  onVolumeChange: (value: number) => void
  partName: string
  role: string
  solo: boolean
  volume: number
}

type StudioPlaybackPanelProps = {
  guideModeEnabled: boolean
  hasSelectedArrangement: boolean
  mixSummaryLabel: string
  onGuideModeChange: (enabled: boolean) => void
  onPlay: () => void
  onStop: () => void
  partCountLabel: string
  partRows: PartMixRow[]
  playButtonDisabled: boolean
  playbackPositionLabel: string
  progressPercent: number
  statusLabel: string
  statusTone: StatusTone
  stopButtonDisabled: boolean
  transportMessage: { text: string; tone: MessageTone }
}

export function StudioPlaybackPanel({
  guideModeEnabled,
  hasSelectedArrangement,
  mixSummaryLabel,
  onGuideModeChange,
  onPlay,
  onStop,
  partCountLabel,
  partRows,
  playButtonDisabled,
  playbackPositionLabel,
  progressPercent,
  statusLabel,
  statusTone,
  stopButtonDisabled,
  transportMessage,
}: StudioPlaybackPanelProps) {
  const isCompactViewport = useStudioCompactViewport()

  return (
    <article className="panel studio-block" data-testid="playback-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">미리듣기</p>
          <h2>파트 재생</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        재생은 악보 화면과 분리해 안정적으로 처리합니다. 솔로, 가이드 겹치기, 파트 밸런스는 이곳에서
        바로 미리듣습니다.
      </p>

      <div className="transport-card">
        <div className="transport-card__row">
          <strong>{playbackPositionLabel}</strong>
          <span>{partCountLabel}</span>
        </div>
        <div className="transport-progress" aria-hidden="true">
          <div className="transport-progress__fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="button-row">
        <button className="button-primary" type="button" disabled={playButtonDisabled} onClick={onPlay}>
          편곡 미리듣기 재생
        </button>

        <button className="button-secondary" type="button" disabled={stopButtonDisabled} onClick={onStop}>
          재생 중지
        </button>
      </div>

      <label className="toggle-card">
        <input
          type="checkbox"
          checked={guideModeEnabled}
          onChange={(event) => onGuideModeChange(event.target.checked)}
        />
        <div>
          <strong>가이드 겹치기</strong>
          <span>가이드 기준 파트를 더 또렷하게 두고 나머지 스택은 뒤로 물립니다.</span>
        </div>
      </label>

      <p className={transportMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
        {transportMessage.text}
      </p>

      {hasSelectedArrangement ? (
        <details
          className="studio-mobile-fold studio-mobile-fold--secondary"
          open={isCompactViewport ? undefined : true}
        >
          <summary className="studio-mobile-fold__summary">
            <span>파트 믹스</span>
            <strong>{mixSummaryLabel}</strong>
          </summary>
          <div className="studio-mobile-fold__body">
            <div className="arrangement-part-list">
              {partRows.map((row) => (
                <div className="arrangement-part-row" key={row.id}>
                  <div className="arrangement-part-row__identity">
                    <span className="arrangement-part-swatch" style={{ backgroundColor: row.color }} />
                    <div>
                      <strong>{row.partName}</strong>
                      <span>
                        {getArrangementPartRoleLabel(row.role)} | 노트 {row.noteCountLabel}
                      </span>
                    </div>
                  </div>

                  <label className="toggle-inline">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) => row.onToggleEnabled(event.target.checked)}
                    />
                    <span>사용</span>
                  </label>

                  <button
                    className={`button-secondary button-secondary--small ${
                      row.solo ? 'button-secondary--active' : ''
                    }`}
                    type="button"
                    onClick={row.onSoloToggle}
                  >
                    {row.solo ? '솔로 켜짐' : '솔로'}
                  </button>

                  <button
                    className={`button-secondary button-secondary--small ${
                      row.guideFocus ? 'button-secondary--active' : ''
                    }`}
                    type="button"
                    onClick={row.onGuideFocusToggle}
                  >
                    {row.guideFocus ? '가이드 기준' : '기준'}
                  </button>

                  <label className="arrangement-part-volume">
                    <span>{row.volume.toFixed(2)}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={row.volume}
                      onChange={(event) => row.onVolumeChange(Number(event.target.value))}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : (
        <div className="empty-card">
          <p>재생할 후보가 선택되지 않았습니다.</p>
          <p>파트 솔로, 가이드 기준, 트랜스포트 동기화를 쓰려면 후보를 먼저 선택해 주세요.</p>
        </div>
      )}
    </article>
  )
}
