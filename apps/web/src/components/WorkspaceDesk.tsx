import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

type WorkspaceDeskProps = {
  className?: string
  children: ReactNode
}

type WorkspaceDeskPanelProps<T extends ElementType> = {
  as?: T
  active?: boolean
  className?: string
  children: ReactNode
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function WorkspaceDesk({ className, children }: WorkspaceDeskProps) {
  return <div className={joinClassNames('workspace-desk', className)}>{children}</div>
}

export function WorkspaceDeskPanel<T extends ElementType = 'section'>({
  as,
  active = false,
  className,
  children,
  ...rest
}: WorkspaceDeskPanelProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof WorkspaceDeskPanelProps<T>>) {
  const Component = (as ?? 'section') as ElementType

  return (
    <Component
      className={joinClassNames(
        'workspace-desk__panel',
        active && 'workspace-desk__panel--active',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  )
}
