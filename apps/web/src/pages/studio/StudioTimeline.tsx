import { ManagedAudioPlayer } from '../../components/ManagedAudioPlayer'

type TimelineMessage = {
  text: string
  tone: 'error' | 'info'
}

type TimelinePlayer = {
  label: string
  muted: boolean
  src: string
  volume: number
}

type TimelineTrackRow = {
  id: string
  label: string
  meta: string
  progress: number | null
  selected: boolean
  primaryActionLabel: string
  onPrimaryAction: () => void
  muted: boolean
  onToggleMute: () => void
  solo: boolean
  onToggleSolo: () => void
  volume: number
  onVolumeChange: (value: number) => void
}

type StudioTimelineProps = {
  emptyDetail: string
  emptyTitle: string
  guideRow: TimelineTrackRow | null
  message: TimelineMessage | null
  mobileSummaryLabel: string
  players: TimelinePlayer[]
  rows: TimelineTrackRow[]
  totalTrackCount: number
}

export function StudioTimeline({
  emptyDetail,
  emptyTitle,
  guideRow,
  message,
  mobileSummaryLabel,
  players,
  rows,
  totalTrackCount,
}: StudioTimelineProps) {
  return (
    <article className="panel studio-wave-editor__timeline">
      <div className="studio-wave-editor__timeline-header">
        <div>
          <p className="eyebrow">재생</p>
          <h2>재생 / 트랙</h2>
        </div>
        <span className="status-pill status-pill--ready">{totalTrackCount}개 트랙</span>
      </div>

      {message ? (
        message.tone === 'error' ? (
          <p className="form-error">{message.text}</p>
        ) : (
          <p className="studio-wave-editor__signal">{message.text}</p>
        )
      ) : null}

      {players.length > 0 ? (
        <div className="studio-wave-editor__players">
          {players.map((player) => (
            <div className="studio-wave-editor__player" key={`${player.label}-${player.src}`}>
              <span>{player.label}</span>
              <ManagedAudioPlayer muted={player.muted} src={player.src} volume={player.volume} />
            </div>
          ))}
        </div>
      ) : null}

      <details className="studio-mobile-fold studio-mobile-fold--take-list">
        <summary className="studio-mobile-fold__summary">
          <span>트랙 목록</span>
          <strong>{mobileSummaryLabel}</strong>
        </summary>
        <div className="studio-mobile-fold__body">
          <div className="track-lane">
            {guideRow ? <TimelineTrackRowView row={guideRow} /> : null}
            {rows.map((row) => (
              <TimelineTrackRowView key={row.id} row={row} />
            ))}

            {rows.length === 0 ? (
              <div className="empty-card">
                <p>{emptyTitle}</p>
                <p>{emptyDetail}</p>
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </article>
  )
}

function TimelineTrackRowView({ row }: { row: TimelineTrackRow }) {
  return (
    <div className={`track-row ${row.selected ? 'track-row--selected' : ''}`}>
      <div className="track-row__meta">
        <strong>{row.label}</strong>
        <span>{row.meta}</span>
      </div>

      <div className="track-row__controls">
        {typeof row.progress === 'number' && row.progress < 100 ? (
          <span className="studio-inline-status">업로드 {row.progress}%</span>
        ) : null}

        <button
          className="button-secondary button-secondary--small"
          type="button"
          onClick={row.onPrimaryAction}
        >
          {row.primaryActionLabel}
        </button>

        <details className="track-row__details">
          <summary className="track-row__details-summary">믹스</summary>
          <div className="track-row__details-body">
            <button
              className="button-secondary button-secondary--small"
              type="button"
              onClick={row.onToggleMute}
            >
              {row.muted ? '뮤트 해제' : '뮤트'}
            </button>

            <button
              className="button-secondary button-secondary--small"
              type="button"
              onClick={row.onToggleSolo}
            >
              {row.solo ? '솔로 해제' : '솔로'}
            </button>

            <label className="track-row__slider">
              <span>볼륨</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={row.volume}
                onChange={(event) => row.onVolumeChange(Number(event.target.value))}
              />
            </label>
          </div>
        </details>
      </div>
    </div>
  )
}
