export type WorkspaceKind = 'studio' | 'arrangement'

type WorkspaceVisitRecord = {
  kind: WorkspaceKind
  visitedAt: string | null
}

const workspaceHistoryStorageKey = 'gigastudy.workspace-history.v2'
const pinnedProjectsStorageKey = 'gigastudy.launch-pinned-projects.v1'
const workspaceRoutePattern = /^\/projects\/([^/]+)\/(studio|arrangement)$/

function readStorageValue(storageKey: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeStorageValue(storageKey: string, value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    // Ignore storage write failures and keep the workspace usable.
  }
}

function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return value === 'studio' || value === 'arrangement'
}

function readWorkspaceHistory(): Record<string, WorkspaceVisitRecord> {
  const serialized = readStorageValue(workspaceHistoryStorageKey)
  if (!serialized) {
    return {}
  }

  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>
    const history: Record<string, WorkspaceVisitRecord> = {}

    for (const [projectId, rawRecord] of Object.entries(parsed)) {
      if (isWorkspaceKind(rawRecord)) {
        history[projectId] = { kind: rawRecord, visitedAt: null }
        continue
      }

      if (!rawRecord || typeof rawRecord !== 'object') {
        continue
      }

      const candidate = rawRecord as { kind?: unknown; visitedAt?: unknown }
      if (!isWorkspaceKind(candidate.kind)) {
        continue
      }

      history[projectId] = {
        kind: candidate.kind,
        visitedAt: typeof candidate.visitedAt === 'string' ? candidate.visitedAt : null,
      }
    }

    return history
  } catch {
    return {}
  }
}

function writeWorkspaceHistory(history: Record<string, WorkspaceVisitRecord>): void {
  writeStorageValue(workspaceHistoryStorageKey, JSON.stringify(history))
}

function readPinnedProjects(): string[] {
  const serialized = readStorageValue(pinnedProjectsStorageKey)
  if (!serialized) {
    return []
  }

  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function writePinnedProjects(projectIds: string[]): void {
  writeStorageValue(pinnedProjectsStorageKey, JSON.stringify(projectIds))
}

export function buildWorkspacePath(projectId: string, workspaceKind: WorkspaceKind): string {
  return `/projects/${projectId}/${workspaceKind}`
}

export function rememberWorkspaceVisit(pathname: string): void {
  const matchedRoute = pathname.match(workspaceRoutePattern)
  if (!matchedRoute) {
    return
  }

  const [, projectId, workspaceKind] = matchedRoute
  const history = readWorkspaceHistory()
  history[projectId] = {
    kind: workspaceKind as WorkspaceKind,
    visitedAt: new Date().toISOString(),
  }
  writeWorkspaceHistory(history)
}

export function getRememberedWorkspaceVisit(projectId: string): WorkspaceVisitRecord | null {
  const history = readWorkspaceHistory()
  return history[projectId] ?? null
}

export function getRememberedWorkspaceKind(projectId: string): WorkspaceKind | null {
  return getRememberedWorkspaceVisit(projectId)?.kind ?? null
}

export function getPinnedProjectIds(): string[] {
  return readPinnedProjects()
}

export function togglePinnedProjectId(projectId: string): string[] {
  const pinnedProjectIds = new Set(readPinnedProjects())
  if (pinnedProjectIds.has(projectId)) {
    pinnedProjectIds.delete(projectId)
  } else {
    pinnedProjectIds.add(projectId)
  }

  const nextPinnedProjectIds = Array.from(pinnedProjectIds)
  writePinnedProjects(nextPinnedProjectIds)
  return nextPinnedProjectIds
}
