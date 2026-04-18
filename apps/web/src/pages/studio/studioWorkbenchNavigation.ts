import type {
  StudioSectionId,
  StudioWorkspaceMode,
  StudioWorkspaceModeId,
} from './studioWorkbenchConfig'

type WorkbenchLink = {
  id: StudioSectionId
  label: string
}

export type StudioModeButton = {
  active: boolean
  id: string
  label: string
  onSelect: () => void
}

export type StudioWorkbenchTabItem = {
  active: boolean
  id: string
  label: string
  onSelect: () => void
}

export function buildStudioModeButtons({
  activeModeId,
  modes,
  onSelectMode,
}: {
  activeModeId: StudioWorkspaceModeId
  modes: ReadonlyArray<StudioWorkspaceMode>
  onSelectMode: (mode: StudioWorkspaceMode) => void
}): StudioModeButton[] {
  return modes.map((mode) => ({
    active: activeModeId === mode.id,
    id: mode.id,
    label: mode.label,
    onSelect: () => onSelectMode(mode),
  }))
}

export function buildWorkbenchTabItems({
  activeMode,
  activeSectionId,
  links,
  onSelectSection,
  railLabels,
}: {
  activeMode: StudioWorkspaceMode
  activeSectionId: StudioSectionId
  links: ReadonlyArray<WorkbenchLink>
  onSelectSection: (sectionId: StudioSectionId) => void
  railLabels: Record<StudioSectionId, string>
}): StudioWorkbenchTabItem[] {
  return links
    .filter((link) => activeMode.sectionIds.includes(link.id))
    .map((link) => ({
      active: activeSectionId === link.id,
      id: link.id,
      label: railLabels[link.id],
      onSelect: () => onSelectSection(link.id),
    }))
}
