import { Link } from 'react-router-dom'

type WorkspaceFlowItem = {
  id: string
  step: string
  label: string
  summary: string
  to?: string
  href?: string
  current?: boolean
}

type WorkspaceFlowBarProps = {
  eyebrow: string
  title: string
  summary: string
  items: WorkspaceFlowItem[]
  ariaLabel: string
}

function WorkspaceFlowAction({ item }: { item: WorkspaceFlowItem }) {
  const className = `workspace-flow-bar__item${item.current ? ' workspace-flow-bar__item--current' : ''}`
  const content = (
    <>
      <span>{item.step}</span>
      <strong>{item.label}</strong>
      <small>{item.summary}</small>
    </>
  )

  if (item.current || (!item.to && !item.href)) {
    return (
      <div aria-current={item.current ? 'step' : undefined} className={className}>
        {content}
      </div>
    )
  }

  if (item.to) {
    return (
      <Link className={className} to={item.to}>
        {content}
      </Link>
    )
  }

  return (
    <a className={className} href={item.href}>
      {content}
    </a>
  )
}

export function WorkspaceFlowBar({ eyebrow, title, summary, items, ariaLabel }: WorkspaceFlowBarProps) {
  return (
    <section aria-label={ariaLabel} className="workspace-flow-bar">
      <div className="workspace-flow-bar__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="panel__summary">{summary}</p>
      </div>

      <div className="workspace-flow-bar__items" role="list">
        {items.map((item) => (
          <WorkspaceFlowAction item={item} key={item.id} />
        ))}
      </div>
    </section>
  )
}
