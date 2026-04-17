import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { buildApiUrl, normalizeRequestError, readApiErrorMessage } from '../lib/api'
import {
  buildWorkspacePath,
  getPinnedProjectIds,
  getRememberedWorkspaceVisit,
  type WorkspaceKind,
  togglePinnedProjectId,
} from '../lib/workspaceHistory'
import type { Project, ProjectListItem } from '../types/project'
import './LaunchPage.css'

type CreateProjectState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'error'; message: string }

type ProjectListState =
  | { phase: 'loading' }
  | { phase: 'ready'; items: ProjectListItem[] }
  | { phase: 'error'; message: string }

type ShareOpenState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'error'; message: string }

type ShareLinkResponse = {
  share_link_id: string
  share_url: string
  is_active: boolean
}

type ShareLinkListResponse = {
  items: ShareLinkResponse[]
}

type LaunchFilter = 'all' | 'recent' | 'pinned'

const initialFormState = {
  title: '',
  bpm: '92',
  baseKey: 'C',
  timeSignature: '4/4',
}

const launchFilters: { id: LaunchFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'recent', label: '최근 연 항목' },
  { id: 'pinned', label: '고정' },
]

const workspaceLabels: Record<WorkspaceKind, string> = {
  studio: '스튜디오',
  arrangement: '편곡실',
}

const launchErrorMessages = {
  recentList: {
    fallback: '최근 작업을 불러오지 못했습니다.',
    network: '최근 작업을 불러올 수 없습니다. 지금은 서비스에 연결할 수 없습니다.',
  },
  createProject: {
    fallback: '프로젝트를 만들지 못했습니다.',
    network: '프로젝트를 만들 수 없습니다. 지금은 서비스에 연결할 수 없습니다.',
  },
  shareLinks: {
    fallback: '공유 링크를 준비하지 못했습니다.',
    network: '공유 링크를 준비할 수 없습니다. 지금은 서비스에 연결할 수 없습니다.',
  },
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCompactDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value))
}

function formatRelativeTime(value: string): string {
  const updatedAt = new Date(value).getTime()
  const diffMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000))

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}시간 전`
  }

  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) {
    return `${diffDays}일 전`
  }

  return formatTimestamp(value)
}

function parseShareToken(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const fromPath = normalized.match(/\/shared\/([^/?#]+)/)
  if (fromPath?.[1]) {
    return fromPath[1]
  }

  try {
    const parsedUrl = new URL(normalized)
    const matchedPath = parsedUrl.pathname.match(/\/shared\/([^/?#]+)/)
    if (matchedPath?.[1]) {
      return matchedPath[1]
    }
  } catch {
    // Fall back to treating the input itself as the token.
  }

  return normalized.replace(/^\/+/, '')
}

function getDefaultWorkspaceKind(project: ProjectListItem): WorkspaceKind {
  if (project.launch_summary.arrangement_count > 0) {
    return 'arrangement'
  }

  return 'studio'
}

function getWorkspacePreference(project: ProjectListItem): {
  kind: WorkspaceKind
  path: string
  visitedAt: string | null
} {
  const rememberedWorkspaceVisit = getRememberedWorkspaceVisit(project.project_id)
  const workspaceKind = rememberedWorkspaceVisit?.kind ?? getDefaultWorkspaceKind(project)
  return {
    kind: workspaceKind,
    path: buildWorkspacePath(project.project_id, workspaceKind),
    visitedAt: rememberedWorkspaceVisit?.visitedAt ?? null,
  }
}

function buildProgressSummary(project: ProjectListItem): string {
  const summaryParts: string[] = []

  if (project.launch_summary.has_guide) {
    summaryParts.push('가이드 준비')
  }
  if (project.launch_summary.ready_take_count > 0) {
    summaryParts.push(`준비된 테이크 ${project.launch_summary.ready_take_count}`)
  } else if (project.launch_summary.take_count > 0) {
    summaryParts.push(`테이크 ${project.launch_summary.take_count}`)
  }
  if (project.launch_summary.arrangement_count > 0) {
    summaryParts.push(`편곡 ${project.launch_summary.arrangement_count}`)
  }
  if (project.launch_summary.has_mixdown) {
    summaryParts.push('믹스다운 있음')
  }

  if (summaryParts.length > 0) {
    return summaryParts.join(' · ')
  }

  const defaults = [
    project.bpm ? `${project.bpm} BPM` : null,
    project.base_key,
    project.time_signature,
  ]
  return defaults.filter(Boolean).join(' · ') || '새 프로젝트'
}

function buildProgressDetail(project: ProjectListItem): string {
  const detailParts = [
    project.launch_summary.has_guide ? '가이드 있음' : '가이드 없음',
    `테이크 ${project.launch_summary.take_count}`,
  ]

  if (project.launch_summary.arrangement_count > 0) {
    detailParts.push(`편곡 ${project.launch_summary.arrangement_count}`)
  }

  return detailParts.join(' · ')
}

export function LaunchPage() {
  const navigate = useNavigate()
  const projectTitleInputRef = useRef<HTMLInputElement | null>(null)
  const [projectListState, setProjectListState] = useState<ProjectListState>({
    phase: 'loading',
  })
  const [createProjectState, setCreateProjectState] = useState<CreateProjectState>({
    phase: 'idle',
  })
  const [shareOpenState, setShareOpenState] = useState<ShareOpenState>({
    phase: 'idle',
  })
  const [formState, setFormState] = useState(initialFormState)
  const [launchFilter, setLaunchFilter] = useState<LaunchFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [shareInput, setShareInput] = useState('')
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>(() => getPinnedProjectIds())
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null)
  const [recentFeedback, setRecentFeedback] = useState<string | null>(null)
  const [rowActionProjectId, setRowActionProjectId] = useState<string | null>(null)
  const [projectListReloadKey, setProjectListReloadKey] = useState(0)
  const deferredSearchTerm = useDeferredValue(searchTerm)

  useEffect(() => {
    if (!recentFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setRecentFeedback(null)
    }, 2800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [recentFeedback])

  useEffect(() => {
    if (!menuProjectId) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) {
        setMenuProjectId(null)
        return
      }

      if (target.closest(`[data-launch-menu-owner="${menuProjectId}"]`)) {
        return
      }

      setMenuProjectId(null)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuProjectId(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [menuProjectId])

  useEffect(() => {
    let cancelled = false

    async function loadProjects() {
      setProjectListState({ phase: 'loading' })
      try {
        const response = await fetch(buildApiUrl('/api/projects'))
        if (!response.ok) {
          throw new Error(
            await readApiErrorMessage(response, launchErrorMessages.recentList.fallback),
          )
        }

        const payload = (await response.json()) as ProjectListItem[]
        if (!cancelled) {
          setProjectListState({
            phase: 'ready',
            items: payload,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setProjectListState({
            phase: 'error',
            message: normalizeRequestError(
              error,
              launchErrorMessages.recentList.fallback,
              launchErrorMessages.recentList.network,
            ),
          })
        }
      }
    }

    void loadProjects()

    return () => {
      cancelled = true
    }
  }, [projectListReloadKey])

  function handleRetryProjectList() {
    setProjectListReloadKey((current) => current + 1)
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateProjectState({ phase: 'submitting' })

    const payload = {
      title: formState.title,
      bpm: formState.bpm ? Number(formState.bpm) : null,
      base_key: formState.baseKey || null,
      time_signature: formState.timeSignature || null,
      mode: null,
    }

    try {
      const response = await fetch(buildApiUrl('/api/projects'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, launchErrorMessages.createProject.fallback),
        )
      }

      const createdProject = (await response.json()) as Project
      navigate(`/projects/${createdProject.project_id}/studio`)
    } catch (error) {
      setCreateProjectState({
        phase: 'error',
        message: normalizeRequestError(
          error,
          launchErrorMessages.createProject.fallback,
          launchErrorMessages.createProject.network,
        ),
      })
    }
  }

  function focusSection(sectionId: string, target?: HTMLElement | null) {
    const section = document.getElementById(sectionId)
    if (!section) {
      return
    }

    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      target?.focus()
    }, 180)
  }

  async function handlePasteShareLink() {
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('클립보드에서 바로 읽을 수 없습니다.')
      }

      const pastedText = await navigator.clipboard.readText()
      setShareInput(pastedText)
    } catch (error) {
      setShareOpenState({
        phase: 'error',
        message: error instanceof Error ? error.message : '클립보드를 읽지 못했습니다.',
      })
    }
  }

  async function handleOpenSharedReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const shareToken = parseShareToken(shareInput)

    if (!shareToken) {
      setShareOpenState({
        phase: 'error',
        message: '공유 링크나 토큰을 입력해 주세요.',
      })
      return
    }

    setShareOpenState({ phase: 'submitting' })
    navigate(`/shared/${shareToken}`)
  }

  function openWorkspace(project: ProjectListItem, workspaceKind?: WorkspaceKind) {
    const preferredWorkspaceKind = workspaceKind ?? getWorkspacePreference(project).kind
    navigate(buildWorkspacePath(project.project_id, preferredWorkspaceKind))
  }

  async function copyProjectShareLink(project: ProjectListItem) {
    setRowActionProjectId(project.project_id)

    try {
      const listResponse = await fetch(buildApiUrl(`/api/projects/${project.project_id}/share-links`))
      if (!listResponse.ok) {
        throw new Error(
          await readApiErrorMessage(listResponse, launchErrorMessages.shareLinks.fallback),
        )
      }

      const shareLinksPayload = (await listResponse.json()) as ShareLinkListResponse
      let shareUrl =
        shareLinksPayload.items.find((item) => item.is_active)?.share_url ??
        shareLinksPayload.items[0]?.share_url

      if (!shareUrl) {
        const createResponse = await fetch(
          buildApiUrl(`/api/projects/${project.project_id}/share-links`),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expires_in_days: 7 }),
          },
        )

        if (!createResponse.ok) {
          throw new Error(
            await readApiErrorMessage(createResponse, launchErrorMessages.shareLinks.fallback),
          )
        }

        const createdShareLink = (await createResponse.json()) as ShareLinkResponse
        shareUrl = createdShareLink.share_url
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error('브라우저에서 바로 복사할 수 없습니다.')
      }

      await navigator.clipboard.writeText(shareUrl)
      setRecentFeedback('공유 링크를 복사했습니다.')
      setMenuProjectId(null)
    } catch (error) {
      setRecentFeedback(
        normalizeRequestError(
          error,
          launchErrorMessages.shareLinks.fallback,
          launchErrorMessages.shareLinks.network,
        ),
      )
    } finally {
      setRowActionProjectId(null)
    }
  }

  function handleTogglePinnedProject(projectId: string) {
    const nextPinnedProjectIds = togglePinnedProjectId(projectId)
    setPinnedProjectIds(nextPinnedProjectIds)
    setRecentFeedback(
      pinnedProjectIds.includes(projectId) ? '고정을 해제했습니다.' : '최근 작업을 고정했습니다.',
    )
    setMenuProjectId(null)
  }

  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase()
  const recentProjects =
    projectListState.phase === 'ready'
      ? [...projectListState.items]
          .filter((project) => {
            const workspaceVisit = getRememberedWorkspaceVisit(project.project_id)

            if (launchFilter === 'recent' && !workspaceVisit?.visitedAt) {
              return false
            }

            if (launchFilter === 'pinned' && !pinnedProjectIds.includes(project.project_id)) {
              return false
            }

            if (!normalizedSearchTerm) {
              return true
            }

            const searchSource = [
              project.title,
              project.base_key,
              project.time_signature,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()

            return searchSource.includes(normalizedSearchTerm)
          })
          .sort((leftProject, rightProject) => {
            if (launchFilter !== 'recent') {
              return 0
            }

            const leftVisitedAt = getRememberedWorkspaceVisit(leftProject.project_id)?.visitedAt
            const rightVisitedAt = getRememberedWorkspaceVisit(rightProject.project_id)?.visitedAt

            return (
              new Date(rightVisitedAt ?? 0).getTime() - new Date(leftVisitedAt ?? 0).getTime()
            )
          })
      : []

  return (
    <div className="page-shell launch-page">
      <header className="launch-topbar">
        <div className="launch-topbar__brand">
          <strong>GigaStudy</strong>
          <span>Vocal Studio</span>
        </div>

        <nav className="launch-topbar__actions" aria-label="첫 화면 이동">
          <button
            type="button"
            className="launch-topbar__action"
            onClick={() =>
              focusSection('LAUNCH-SECTION-NEW-PROJECT', projectTitleInputRef.current)
            }
          >
            새 프로젝트
          </button>
          <button
            type="button"
            className="launch-topbar__action"
            onClick={() => focusSection('LAUNCH-SECTION-RECENT')}
          >
            최근 작업
          </button>
          <button
            type="button"
            className="launch-topbar__action"
            onClick={() => focusSection('LAUNCH-SECTION-SHARE')}
          >
            공유 검토
          </button>
        </nav>
      </header>

      <main className="launch-shell">
        <section className="launch-region launch-region--recent" id="LAUNCH-SECTION-RECENT">
          <header className="launch-region__header">
            <div>
              <p className="launch-region__eyebrow">작업 진입</p>
              <h1>최근 작업</h1>
            </div>
            {recentFeedback ? (
              <p className="launch-inline-feedback" role="status">
                {recentFeedback}
              </p>
            ) : null}
          </header>

          <div className="launch-search-row">
            <label className="launch-search">
              <span className="sr-only">프로젝트 검색</span>
              <input
                type="search"
                className="launch-search__input"
                placeholder="프로젝트 이름으로 찾기"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <div className="launch-filter-tabs" role="tablist" aria-label="최근 작업 필터">
              {launchFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={launchFilter === filter.id}
                  className={`launch-filter-tab ${
                    launchFilter === filter.id ? 'launch-filter-tab--active' : ''
                  }`}
                  onClick={() => setLaunchFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="launch-recent-list" role="table" aria-label="최근 프로젝트 목록">
            <div className="launch-recent-head" role="row">
              <span>프로젝트</span>
              <span>마지막 수정</span>
              <span>작업 상태</span>
              <span>열 위치</span>
              <span>열기</span>
            </div>

            {projectListState.phase === 'loading' ? (
              <p className="launch-empty-line">최근 작업을 불러오는 중입니다.</p>
            ) : null}

            {projectListState.phase === 'error' ? (
              <div className="launch-state-row">
                <p className="launch-empty-line">{projectListState.message}</p>
                <button
                  type="button"
                  className="launch-inline-button"
                  onClick={handleRetryProjectList}
                >
                  다시 불러오기
                </button>
              </div>
            ) : null}

            {projectListState.phase === 'ready' && recentProjects.length === 0 ? (
              <p className="launch-empty-line">
                {launchFilter === 'recent'
                  ? '아직 최근에 연 작업이 없습니다.'
                  : '아직 프로젝트가 없습니다.'}
              </p>
            ) : null}

            {projectListState.phase === 'ready'
              ? recentProjects.map((project) => {
                  const workspacePreference = getWorkspacePreference(project)
                  const isPinned = pinnedProjectIds.includes(project.project_id)
                  const workspaceVisitLabel = workspacePreference.visitedAt
                    ? `${formatRelativeTime(workspacePreference.visitedAt)} 열었음`
                    : '아직 연 기록 없음'

                  return (
                    <article
                      className="launch-recent-row"
                      key={project.project_id}
                      onClick={() => openWorkspace(project)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openWorkspace(project)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="launch-recent-row__title">
                        <strong>{project.title}</strong>
                        <span>
                          {project.bpm ? `${project.bpm} BPM` : 'BPM 미정'}
                          {' · '}
                          {project.base_key || '키 미정'}
                          {' · '}
                          {project.time_signature || '박자 미정'}
                        </span>
                      </div>

                      <div className="launch-recent-row__meta">
                        <strong>{formatRelativeTime(project.updated_at)}</strong>
                        <span>{formatTimestamp(project.updated_at)}</span>
                      </div>

                      <div className="launch-recent-row__meta">
                        <strong>{buildProgressSummary(project)}</strong>
                        <span>{buildProgressDetail(project)}</span>
                      </div>

                      <div className="launch-recent-row__meta">
                        <strong>{workspaceLabels[workspacePreference.kind]}</strong>
                        <span>{workspaceVisitLabel}</span>
                      </div>

                      <div className="launch-recent-row__mobile-summary">
                        <span>{formatCompactDate(project.updated_at)}</span>
                        <span>{buildProgressSummary(project)}</span>
                        <span>{workspaceLabels[workspacePreference.kind]}</span>
                      </div>

                      <div
                        className="launch-recent-row__actions"
                        data-launch-menu-owner={project.project_id}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="launch-open-button"
                          onClick={() => openWorkspace(project)}
                        >
                          열기
                        </button>
                        <button
                          type="button"
                          className="launch-menu-button"
                          aria-label={`${project.title} 추가 동작`}
                          onClick={() =>
                            setMenuProjectId((current) =>
                              current === project.project_id ? null : project.project_id,
                            )
                          }
                        >
                          ⋯
                        </button>

                        {menuProjectId === project.project_id ? (
                          <div className="launch-popover" role="menu">
                            <button
                              type="button"
                              className="launch-popover__item"
                              onClick={() => openWorkspace(project, 'studio')}
                            >
                              스튜디오로 열기
                            </button>
                            <button
                              type="button"
                              className="launch-popover__item"
                              onClick={() => openWorkspace(project, 'arrangement')}
                            >
                              편곡실로 열기
                            </button>
                            <button
                              type="button"
                              className="launch-popover__item"
                              onClick={() => copyProjectShareLink(project)}
                              disabled={rowActionProjectId === project.project_id}
                            >
                              {rowActionProjectId === project.project_id
                                ? '공유 링크 준비 중...'
                                : '공유 링크 복사'}
                            </button>
                            <button
                              type="button"
                              className="launch-popover__item"
                              onClick={() => handleTogglePinnedProject(project.project_id)}
                            >
                              {isPinned ? '고정 해제' : '고정'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              : null}
          </div>
        </section>

        <aside className="launch-region launch-region--command">
          <section className="launch-command-block" id="LAUNCH-SECTION-NEW-PROJECT">
            <header className="launch-command-block__header">
              <p className="launch-region__eyebrow">새 프로젝트</p>
              <h2>프로젝트 이름과 기본값만 정하면 바로 스튜디오로 들어갑니다</h2>
            </header>

            <form className="launch-form" onSubmit={handleCreateProject}>
              <label className="launch-field launch-field--full">
                <span>프로젝트 이름</span>
                <input
                  ref={projectTitleInputRef}
                  data-testid="project-title-input"
                  className="launch-input"
                  name="title"
                  placeholder="예: 주일 예배 2절 가이드"
                  value={formState.title}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                    if (createProjectState.phase === 'error') {
                      setCreateProjectState({ phase: 'idle' })
                    }
                  }}
                  required
                />
              </label>

              <div className="launch-form__grid">
                <label className="launch-field">
                  <span>템포(BPM)</span>
                  <input
                    className="launch-input"
                    name="bpm"
                    inputMode="numeric"
                    value={formState.bpm}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        bpm: event.target.value,
                      }))
                      if (createProjectState.phase === 'error') {
                        setCreateProjectState({ phase: 'idle' })
                      }
                    }}
                  />
                </label>

                <label className="launch-field">
                  <span>기준 키</span>
                  <input
                    data-testid="base-key-input"
                    className="launch-input"
                    name="baseKey"
                    value={formState.baseKey}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        baseKey: event.target.value,
                      }))
                      if (createProjectState.phase === 'error') {
                        setCreateProjectState({ phase: 'idle' })
                      }
                    }}
                  />
                </label>
              </div>

              <div className="launch-form__grid">
                <label className="launch-field launch-field--full">
                  <span>박자</span>
                  <select
                    className="launch-input"
                    name="timeSignature"
                    value={formState.timeSignature}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        timeSignature: event.target.value,
                      }))
                      if (createProjectState.phase === 'error') {
                        setCreateProjectState({ phase: 'idle' })
                      }
                    }}
                  >
                    <option value="4/4">4/4</option>
                    <option value="3/4">3/4</option>
                    <option value="6/8">6/8</option>
                    <option value="2/4">2/4</option>
                  </select>
                </label>
              </div>

              {createProjectState.phase === 'error' ? (
                <p className="launch-error-line">{createProjectState.message}</p>
              ) : null}

              <button
                data-testid="open-studio-button"
                className="launch-submit-button"
                type="submit"
                disabled={createProjectState.phase === 'submitting'}
              >
                {createProjectState.phase === 'submitting'
                  ? '프로젝트 만드는 중...'
                  : '스튜디오 열기'}
              </button>
            </form>
          </section>

          <section className="launch-command-block" id="LAUNCH-SECTION-SHARE">
            <header className="launch-command-block__header">
              <p className="launch-region__eyebrow">공유 검토</p>
              <h2>공유 링크나 토큰을 붙여 넣고 바로 검토 화면을 엽니다</h2>
            </header>

            <form className="launch-form" onSubmit={handleOpenSharedReview}>
              <label className="launch-field launch-field--full">
                <span>공유 링크 또는 토큰</span>
                <input
                  className="launch-input"
                  name="shareToken"
                  placeholder="https://.../shared/토큰 또는 토큰만 입력"
                  value={shareInput}
                  onChange={(event) => {
                    setShareInput(event.target.value)
                    if (shareOpenState.phase === 'error') {
                      setShareOpenState({ phase: 'idle' })
                    }
                  }}
                />
              </label>

              <div className="launch-share-actions">
                <button
                  type="submit"
                  className="launch-submit-button launch-submit-button--compact"
                  disabled={shareOpenState.phase === 'submitting'}
                >
                  검토 열기
                </button>
                <button
                  type="button"
                  className="launch-inline-button"
                  onClick={() => void handlePasteShareLink()}
                >
                  붙여넣기
                </button>
              </div>

              {shareOpenState.phase === 'error' ? (
                <p className="launch-error-line">{shareOpenState.message}</p>
              ) : null}
            </form>
          </section>
        </aside>
      </main>
    </div>
  )
}
