import { Link } from 'react-router-dom'

type StudioRouteStatePanelProps = {
  backLinkLabel?: string
  backLinkTo?: string
  eyebrow: string
  errorMessage?: string
  summary?: string
  title: string
}

export function StudioRouteStatePanel({
  backLinkLabel,
  backLinkTo,
  eyebrow,
  errorMessage,
  summary,
  title,
}: StudioRouteStatePanelProps) {
  return (
    <div className="page-shell page-shell--studio">
      <section className="panel studio-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {summary ? <p className="panel__summary">{summary}</p> : null}
        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        {backLinkLabel && backLinkTo ? (
          <Link className="back-link" to={backLinkTo}>
            {backLinkLabel}
          </Link>
        ) : null}
      </section>
    </div>
  )
}
