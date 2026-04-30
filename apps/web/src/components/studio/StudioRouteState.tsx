import { Link } from 'react-router-dom'

type StudioRouteStateProps = {
  homeLabel?: string
  message?: string
  pulseCount?: number
  title: string
  tone: string
}

export function StudioRouteState({
  homeLabel,
  message,
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
        {homeLabel ? (
          <Link className="app-button" to="/">
            {homeLabel}
          </Link>
        ) : null}
      </div>
    </main>
  )
}
