import type { ReactNode } from 'react'

type StudioWorkbenchSectionProps = {
  children: ReactNode
  className: string
  eyebrow: string
  id: string
  title: string
  useGrid?: boolean
}

export function StudioWorkbenchSection({
  children,
  className,
  eyebrow,
  id,
  title,
  useGrid = false,
}: StudioWorkbenchSectionProps) {
  return (
    <section className={className} id={id}>
      <div className="section__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>

      {useGrid ? <div className="card-grid studio-work-grid">{children}</div> : children}
    </section>
  )
}
