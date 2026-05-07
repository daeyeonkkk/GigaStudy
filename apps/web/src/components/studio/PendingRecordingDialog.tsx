import { useEffect, useState } from 'react'

import { formatDurationSeconds, formatTrackName } from '../../lib/studio'
import './PendingRecordingDialog.css'
import type { PendingTrackRecording } from './useStudioRecording'

type PendingRecordingReview = Pick<
  PendingTrackRecording,
  'audioDataUrl' | 'durationSeconds' | 'expiresAtMs' | 'trackName'
>

type PendingRecordingDialogProps = {
  busy: boolean
  discardLabel?: string
  description?: string
  eyebrow?: string
  recording: PendingRecordingReview
  registerLabel?: string
  retentionLabel?: string
  title?: string
  onDiscard: () => void
  onRegister: () => void
}

export function PendingRecordingDialog({
  busy,
  discardLabel = '삭제',
  description,
  eyebrow = '녹음 확인',
  registerLabel = '트랙 등록',
  recording,
  retentionLabel,
  title,
  onDiscard,
  onRegister,
}: PendingRecordingDialogProps) {
  const trackLabel = formatTrackName(recording.trackName)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const remainingMs = Math.max(0, recording.expiresAtMs - nowMs)

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <section
      aria-labelledby="pending-recording-title"
      aria-modal="true"
      className="recording-review-backdrop"
      data-testid="pending-recording-dialog"
      role="dialog"
    >
      <div className="recording-review-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="pending-recording-title">{title ?? `${trackLabel} 녹음`}</h2>
        <p>{description ?? '아직 트랙에 등록하지 않았습니다. 들어보고 트랙에 등록하거나 삭제하세요.'}</p>
        <p className="recording-review-panel__retention">
          {retentionLabel ?? `임시 녹음은 ${formatRemainingTime(remainingMs)} 뒤 자동으로 비워집니다.`}
        </p>
        <dl>
          <div>
            <dt>트랙</dt>
            <dd>{trackLabel}</dd>
          </div>
          <div>
            <dt>길이</dt>
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
            {discardLabel}
          </button>
          <button
            className="app-button"
            data-testid="pending-recording-register"
            disabled={busy}
            type="button"
            onClick={onRegister}
          >
            {registerLabel}
          </button>
        </div>
      </div>
    </section>
  )
}

function formatRemainingTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds}초`
  }
  return `${minutes}분 ${seconds.toString().padStart(2, '0')}초`
}
