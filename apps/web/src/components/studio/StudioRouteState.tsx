import { Link } from 'react-router-dom'
import './StudioRouteState.css'

type StudioRouteStateProps = {
  actionDisabled?: boolean
  actionLabel?: string
  homeLabel?: string
  message?: string
  onAction?: () => void
  pulseCount?: number
  title: string
  tone: string
}

export function StudioRouteState({
  actionDisabled = false,
  actionLabel,
  homeLabel,
  message,
  onAction,
  pulseCount = 3,
  title,
  tone,
}: StudioRouteStateProps) {
  return (
    <main className="app-shell studio-route-state">
      <div className="studio-route-state__meter" aria-hidden="true">
        {Array.from({ length: pulseCount }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div>
        <p className="eyebrow">{tone}</p>
        <h1>{title}</h1>
        {message ? <p>{message}</p> : null}
        {homeLabel || onAction ? (
          <div className="studio-route-state__actions">
            {onAction ? (
              <button className="app-button" disabled={actionDisabled} type="button" onClick={onAction}>
                {actionLabel ?? '다시 시도'}
              </button>
            ) : null}
            {homeLabel ? (
              <Link className="app-button app-button--secondary" to="/">
                {homeLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  )
}
