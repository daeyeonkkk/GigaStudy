import {
  describeTrackArchiveSource,
  formatDate,
  formatDurationSeconds,
  formatTrackName,
  getTrackArchiveDisplayLabel,
  sortTrackArchivesForDisplay,
} from '../../lib/studio'
import type { TrackMaterialArchiveSummary, TrackSlot } from '../../types/studio'
import './TrackArchiveDialog.css'

type TrackArchiveDialogProps = {
  archives: TrackMaterialArchiveSummary[]
  busy: boolean
  track: TrackSlot
  onClose: () => void
  onRestore: (archive: TrackMaterialArchiveSummary) => void
}

export function TrackArchiveDialog({
  archives,
  busy,
  track,
  onClose,
  onRestore,
}: TrackArchiveDialogProps) {
  const sortedArchives = sortTrackArchivesForDisplay(archives)

  return (
    <div
      aria-labelledby="track-archive-title"
      aria-modal="true"
      className="track-archive-backdrop"
      data-testid="track-archive-dialog"
      role="dialog"
    >
      <div className="track-archive-panel">
        <header className="track-archive-panel__heading">
          <p className="eyebrow">보관본</p>
          <h2 id="track-archive-title">{formatTrackName(track.name)}</h2>
        </header>

        <div className="track-archive-list">
          {sortedArchives.map((archive) => (
            <article className="track-archive-item" key={archive.archive_id}>
              <div>
                <strong>{getTrackArchiveDisplayLabel(archive)}</strong>
                <span>{describeTrackArchiveSource(archive)}</span>
              </div>
              <dl>
                <div>
                  <dt>보관</dt>
                  <dd>{formatDate(archive.archived_at)}</dd>
                </div>
                <div>
                  <dt>길이</dt>
                  <dd>{formatDurationSeconds(archive.duration_seconds)}</dd>
                </div>
                <div>
                  <dt>음표</dt>
                  <dd>{archive.event_count}개</dd>
                </div>
              </dl>
              <button
                className="app-button app-button--secondary"
                data-testid={`track-archive-restore-${archive.archive_id}`}
                disabled={busy}
                type="button"
                onClick={() => onRestore(archive)}
              >
                복원
              </button>
            </article>
          ))}
        </div>

        <div className="track-archive-actions">
          <button
            className="app-button app-button--secondary"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
