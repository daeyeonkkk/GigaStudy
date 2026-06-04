import { useEffect, useMemo, useState } from 'react'

import type { StudioActionState } from './studioActionState'
import { sanitizeNoticeState } from './studioNoticePresenter'

type StudioNoticeLineProps = {
  className?: string
  notice: StudioActionState
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export function StudioNoticeLine({ className, notice }: StudioNoticeLineProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const safeNotice = useMemo(() => sanitizeNoticeState(notice), [notice])
  const shouldTick = safeNotice.phase === 'busy' && typeof safeNotice.startedAtMs === 'number'

  useEffect(() => {
    if (!shouldTick) {
      return undefined
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [shouldTick])

  if (safeNotice.phase === 'idle') {
    return null
  }

  const elapsedSeconds =
    safeNotice.phase === 'busy' && typeof safeNotice.startedAtMs === 'number'
      ? Math.max(0, Math.floor((nowMs - safeNotice.startedAtMs) / 1000))
      : safeNotice.phase === 'busy'
        ? safeNotice.elapsedSeconds
        : undefined
  const progressPercent =
    safeNotice.phase === 'busy' && typeof safeNotice.progressPercent === 'number'
      ? Math.max(0, Math.min(100, safeNotice.progressPercent))
      : undefined
  const estimatedSecondsRemaining =
    safeNotice.phase === 'busy' ? safeNotice.estimatedSecondsRemaining : undefined

  return (
    <section
      className={['studio-status-line', className].filter(Boolean).join(' ')}
      aria-live="polite"
    >
      <span className={`studio-status-line__dot studio-status-line__dot--${safeNotice.phase}`} />
      <div className="studio-status-line__content">
        <p>{safeNotice.message}</p>
        {safeNotice.detail || elapsedSeconds !== undefined || estimatedSecondsRemaining !== undefined ? (
          <div className="studio-status-line__detail">
            {safeNotice.detail ? <span>{safeNotice.detail}</span> : null}
            {elapsedSeconds !== undefined ? <span>경과 {formatClock(elapsedSeconds)}</span> : null}
            {estimatedSecondsRemaining !== undefined ? (
              <span>남은 시간 약 {formatClock(estimatedSecondsRemaining)}</span>
            ) : null}
          </div>
        ) : null}
        {progressPercent !== undefined ? (
          <div
            className="studio-status-line__progress"
            aria-label={`진행률 ${progressPercent}%`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
