import { Link } from 'react-router-dom'

type WorkspaceFlowItem = {
  id: string
  step: string
  label: string
  summary: string
  to?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  current?: boolean
  testId?: string
}

type WorkspaceFlowBarProps = {
  eyebrow: string
  title: string
  summary: string
  items: WorkspaceFlowItem[]
  ariaLabel: string
}

function WorkspaceFlowAction({ item }: { item: WorkspaceFlowItem }) {
  const className = `workspace-flow-bar__item${item.current ? ' workspace-flow-bar__item--current' : ''}${
    item.disabled ? ' workspace-flow-bar__item--disabled' : ''
  }`
  const content = (
    <>
      <span>{item.step}</span>
      <strong>{item.label}</strong>
      <small>{item.summary}</small>
    </>
  )

  if (item.onClick) {
    return (
      <button
        aria-current={item.current ? 'step' : undefined}
        aria-selected={item.current}
        className={className}
        data-testid={item.testId}
        disabled={item.disabled}
        type="button"
        onClick={item.onClick}
      >
        {content}
      </button>
    )
  }

  if (item.current || (!item.to && !item.href)) {
    return (
      <div aria-current={item.current ? 'step' : undefined} className={className} data-testid={item.testId}>
        {content}
      </div>
    )
  }

  if (item.to) {
    return (
      <Link className={className} data-testid={item.testId} to={item.to}>
        {content}
      </Link>
    )
  }

  return (
    <a className={className} data-testid={item.testId} href={item.href}>
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
