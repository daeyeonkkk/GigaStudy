type StudioWorkbenchTabItem = {
  active: boolean
  id: string
  label: string
  onSelect: () => void
}

type StudioWorkbenchTabsProps = {
  items: StudioWorkbenchTabItem[]
}

export function StudioWorkbenchTabs({ items }: StudioWorkbenchTabsProps) {
  return (
    <div className="studio-workbench__tabs" data-testid="studio-workbench-tabs">
      {items.map((item) => (
        <button
          key={`studio-workbench-tab-${item.id}`}
          className={`studio-workbench__tab ${item.active ? 'studio-workbench__tab--active' : ''}`}
          data-testid={`studio-workbench-tab-${item.id}`}
          type="button"
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
