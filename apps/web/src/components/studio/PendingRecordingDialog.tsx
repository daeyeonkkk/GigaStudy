import { formatDurationSeconds } from '../../lib/studio'
import './PendingRecordingDialog.css'
import type { PendingTrackRecording } from './useStudioRecording'

type PendingRecordingDialogProps = {
  busy: boolean
  recording: PendingTrackRecording
  onDiscard: () => void
  onRegister: () => void
}

export function PendingRecordingDialog({
  busy,
  recording,
  onDiscard,
  onRegister,
}: PendingRecordingDialogProps) {
  return (
    <section
      aria-labelledby="pending-recording-title"
      aria-modal="true"
      className="recording-review-backdrop"
      data-testid="pending-recording-dialog"
      role="dialog"
    >
      <div className="recording-review-panel">
        <p className="eyebrow">Recording review</p>
        <h2 id="pending-recording-title">{recording.trackName} 녹음 확인</h2>
        <p>
          아직 트랙에 등록하지 않았습니다. 원음을 확인한 뒤 피치 이벤트 추출을 시작하거나 녹음을 삭제하세요.
        </p>
        <dl>
          <div>
            <dt>대상 트랙</dt>
            <dd>{recording.trackName}</dd>
          </div>
          <div>
            <dt>녹음 길이</dt>
            <dd>{formatDurationSeconds(recording.durationSeconds)}</dd>
          </div>
        </dl>
        <audio controls src={recording.audioDataUrl}>
          녹음 미리듣기를 지원하지 않는 브라우저입니다.
        </audio>
        <div className="recording-review-panel__actions">
          <button
            className="app-button app-button--secondary"
            data-testid="pending-recording-discard"
            disabled={busy}
            type="button"
            onClick={onDiscard}
          >
            녹음 삭제
          </button>
          <button
            className="app-button"
            data-testid="pending-recording-register"
            disabled={busy}
            type="button"
            onClick={onRegister}
          >
            트랙 등록
          </button>
        </div>
      </div>
    </section>
  )
}
