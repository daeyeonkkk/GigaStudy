import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  type AdminCredentials,
  deleteAdminAsset,
  deleteAdminExpiredStagedAssets,
  deleteAdminStagedAssets,
  deleteAdminStudio,
  deleteAdminStudioAssets,
  getAdminStorage,
} from '../lib/api'
import type { AdminAssetSummary, AdminStorageSummary, AdminStudioSummary } from '../types/studio'
import './AdminPage.css'

type AdminStatus =
  | { phase: 'idle'; message: string }
  | { phase: 'loading'; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'success'; message: string }

const DEFAULT_LOGIN_ID = 'admin'
const ADMIN_STUDIO_PAGE_SIZE = 50
const ADMIN_ASSET_PAGE_SIZE = 25

export function AdminPage() {
  const [username, setUsername] = useState(DEFAULT_LOGIN_ID)
  const [password, setPassword] = useState('')
  const [credentials, setCredentials] = useState<AdminCredentials | null>(null)
  const [summary, setSummary] = useState<AdminStorageSummary | null>(null)
  const [studioOffset, setStudioOffset] = useState(0)
  const [status, setStatus] = useState<AdminStatus>({
    phase: 'idle',
    message: 'Log in to manage studios and stored files.',
  })
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expandedStudios, setExpandedStudios] = useState<Set<string>>(() => new Set())

  const totalRegisteredTracks = useMemo(
    () =>
      summary?.studios.reduce(
        (total, studio) => total + studio.registered_track_count,
        0,
      ) ?? 0,
    [summary],
  )

  const pageStart = summary && summary.listed_studio_count > 0 ? summary.studio_offset + 1 : 0
  const pageEnd = summary ? summary.studio_offset + summary.listed_studio_count : 0
  const isBusy = status.phase === 'loading' || busyKey !== null
  const activeCredentials = credentials ?? {
    username: username.trim(),
    password,
  }

  async function loadSummary(nextCredentials: AdminCredentials, nextOffset = studioOffset) {
    setStatus({ phase: 'loading', message: 'Loading storage summary.' })
    const nextSummary = await getAdminStorage(nextCredentials, {
      studioLimit: ADMIN_STUDIO_PAGE_SIZE,
      studioOffset: nextOffset,
      assetLimit: ADMIN_ASSET_PAGE_SIZE,
      assetOffset: 0,
    })
    setSummary(nextSummary)
    setCredentials(nextCredentials)
    setStudioOffset(nextSummary.studio_offset)
    setStatus({ phase: 'success', message: 'Storage summary refreshed.' })
  }

  async function login() {
    const nextCredentials = {
      username: username.trim(),
      password,
    }
    if (!nextCredentials.username || !nextCredentials.password) {
      setStatus({ phase: 'error', message: 'Enter both admin ID and password.' })
      return
    }

    try {
      setExpandedStudios(new Set())
      await loadSummary(nextCredentials, 0)
    } catch (error) {
      setCredentials(null)
      setSummary(null)
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Login failed.',
      })
    }
  }

  async function refreshSummary() {
    if (credentials === null) {
      await login()
      return
    }

    try {
      await loadSummary(credentials, studioOffset)
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Storage summary could not be loaded.',
      })
    }
  }

  async function goToOffset(nextOffset: number) {
    if (credentials === null) {
      return
    }
    setExpandedStudios(new Set())
    try {
      await loadSummary(credentials, Math.max(0, nextOffset))
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Studio page could not be loaded.',
      })
    }
  }

  function logout() {
    setCredentials(null)
    setSummary(null)
    setPassword('')
    setStudioOffset(0)
    setExpandedStudios(new Set())
    setStatus({ phase: 'idle', message: 'Logged out.' })
  }

  function toggleStudio(studioId: string) {
    setExpandedStudios((current) => {
      const next = new Set(current)
      if (next.has(studioId)) {
        next.delete(studioId)
      } else {
        next.add(studioId)
      }
      return next
    })
  }

  async function runDeletion(key: string, action: () => Promise<unknown>) {
    setBusyKey(key)
    setStatus({ phase: 'loading', message: 'Processing deletion.' })
    try {
      await action()
      const nextOffset =
        summary?.studios.length === 1 && studioOffset > 0
          ? Math.max(0, studioOffset - ADMIN_STUDIO_PAGE_SIZE)
          : studioOffset
      await loadSummary(activeCredentials, nextOffset)
      setStatus({ phase: 'success', message: 'Deletion completed.' })
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Deletion failed.',
      })
    } finally {
      setBusyKey(null)
    }
  }

  function handleDeleteAsset(asset: AdminAssetSummary) {
    if (!window.confirm(`Delete ${asset.filename}? TrackNote and report data will remain.`)) {
      return
    }
    void runDeletion(`asset:${asset.asset_id}`, () =>
      deleteAdminAsset(activeCredentials, asset.asset_id),
    )
  }

  function handleDeleteStudioAssets(studio: AdminStudioSummary) {
    if (
      !window.confirm(
        `Delete ${studio.asset_count} stored file(s) for ${studio.title}? Normalized TrackNote data will remain.`,
      )
    ) {
      return
    }
    void runDeletion(`studio-assets:${studio.studio_id}`, () =>
      deleteAdminStudioAssets(activeCredentials, studio.studio_id),
    )
  }

  function handleDeleteStudio(studio: AdminStudioSummary) {
    if (!window.confirm(`Delete studio ${studio.title} and all stored files?`)) {
      return
    }
    void runDeletion(`studio:${studio.studio_id}`, () =>
      deleteAdminStudio(activeCredentials, studio.studio_id),
    )
  }

  function handleDeleteStagedAssets() {
    if (!window.confirm('Delete abandoned staged upload files? Active studio files will remain.')) {
      return
    }
    void runDeletion('staged-assets', () => deleteAdminStagedAssets(activeCredentials))
  }

  function handleDeleteExpiredStagedAssets() {
    if (!window.confirm('Delete only expired staged upload files? Active studio files will remain.')) {
      return
    }
    void runDeletion('expired-staged-assets', () => deleteAdminExpiredStagedAssets(activeCredentials))
  }

  return (
    <main className="app-shell admin-page">
      <section className="admin-window" aria-label="GigaStudy admin">
        <header className="admin-titlebar">
          <Link to="/" className="admin-mark" aria-label="Go home">
            GS
          </Link>
          <span>GigaStudy - Admin</span>
        </header>

        <nav className="admin-menubar" aria-label="Admin menu">
          <span>Storage</span>
          <span>Studios</span>
          <span>Assets</span>
          <span>Cleanup</span>
        </nav>

        <section className="admin-auth" aria-label="Admin login">
          <label>
            <span>ID</span>
            <input
              value={username}
              autoComplete="username"
              disabled={credentials !== null}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void login()
                }
              }}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              disabled={credentials !== null}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void login()
                }
              }}
            />
          </label>
          {credentials === null ? (
            <button className="app-button" type="button" disabled={isBusy} onClick={() => void login()}>
              Login
            </button>
          ) : (
            <div className="admin-auth-actions">
              <button className="app-button" type="button" disabled={isBusy} onClick={() => void refreshSummary()}>
                Refresh
              </button>
              <button type="button" disabled={isBusy} onClick={logout}>
                Logout
              </button>
            </div>
          )}
          <span className={`admin-status admin-status--${status.phase}`} role="status">
            {status.message}
          </span>
        </section>

        {credentials !== null ? (
          <>
            <section className="admin-overview" aria-label="Storage overview">
              <AdminMetric label="Studios" value={summary?.studio_count ?? 0} />
              <AdminMetric label="Files" value={summary?.asset_count ?? 0} />
              <AdminMetric label="Storage" value={formatBytes(summary?.total_bytes ?? 0)} />
              <AdminMetric label="Metadata" value={formatBytes(summary?.metadata_bytes ?? 0)} />
              <AdminMetric label="Upload Max" value={formatBytes(summary?.limits.max_upload_bytes ?? 0)} />
              <AdminMetric label="Page Tracks" value={totalRegisteredTracks} />
            </section>

            <section className="admin-storage-path" aria-label="Storage backend">
              <span>Storage backend</span>
              <strong>{summary?.storage_root ?? '-'}</strong>
            </section>

            {summary ? <AdminLimits summary={summary} /> : null}

            <section className="admin-cleanup" aria-label="Cleanup operations">
              <div>
                <span>Cleanup</span>
                <strong>Abandoned staged uploads</strong>
                <p>Expired staged files are also cleaned automatically when new upload targets are created.</p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleDeleteExpiredStagedAssets}
              >
                Delete Expired
              </button>
              <button
                className="admin-danger"
                type="button"
                disabled={isBusy}
                onClick={handleDeleteStagedAssets}
              >
                Delete Staged Files
              </button>
            </section>

            <section className="admin-studios" aria-label="Studio list">
              <header className="admin-section-header">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h1>Studio Management</h1>
                </div>
                <div className="admin-pager" aria-label="Studio pagination">
                  <span>
                    {summary ? `${pageStart}-${pageEnd} / ${summary.studio_count}` : 'No data'}
                  </span>
                  <button
                    type="button"
                    disabled={isBusy || !summary || summary.studio_offset === 0}
                    onClick={() => void goToOffset(studioOffset - ADMIN_STUDIO_PAGE_SIZE)}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || !summary?.has_more_studios}
                    onClick={() => void goToOffset(studioOffset + ADMIN_STUDIO_PAGE_SIZE)}
                  >
                    Next
                  </button>
                </div>
              </header>

              {summary?.studios.length === 0 ? (
                <p className="admin-empty">No studios on this page.</p>
              ) : null}

              <div className="admin-studio-list">
                {summary?.studios.map((studio) => (
                  <article className="admin-studio-row" key={studio.studio_id}>
                    <div className="admin-studio-main">
                      <button
                        className="admin-disclosure"
                        type="button"
                        aria-expanded={expandedStudios.has(studio.studio_id)}
                        onClick={() => toggleStudio(studio.studio_id)}
                      >
                        <span aria-hidden="true">{expandedStudios.has(studio.studio_id) ? '-' : '+'}</span>
                        <strong>{studio.title}</strong>
                      </button>
                      <div className="admin-studio-meta">
                        <span>{maskId(studio.studio_id)}</span>
                        <span>{studio.bpm} BPM</span>
                        <span>tracks {studio.registered_track_count}/6</span>
                        <span>reports {studio.report_count}</span>
                        <span>candidates {studio.candidate_count}</span>
                        <span>files {studio.asset_count}</span>
                        <span>{formatBytes(studio.asset_bytes)}</span>
                      </div>
                    </div>
                    <div className="admin-row-actions">
                      <Link className="admin-link-button" to={`/studios/${studio.studio_id}`}>
                        Open
                      </Link>
                      <button
                        type="button"
                        disabled={isBusy || studio.asset_count === 0}
                        onClick={() => handleDeleteStudioAssets(studio)}
                      >
                        Delete Files
                      </button>
                      <button
                        className="admin-danger"
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteStudio(studio)}
                      >
                        Delete Studio
                      </button>
                    </div>

                    {expandedStudios.has(studio.studio_id) ? (
                      <AssetTable
                        assets={studio.assets}
                        totalAssetCount={studio.asset_count}
                        busyKey={busyKey}
                        onDeleteAsset={handleDeleteAsset}
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="admin-login-empty" aria-label="Login prompt">
            <h1>Admin</h1>
            <p>Log in to delete studios, uploads, recordings, generated files, and OMR outputs.</p>
          </section>
        )}

        <footer className="admin-statusbar">
          <span>Ready</span>
          <span>{credentials === null ? 'Login required' : 'Admin session active'}</span>
        </footer>
      </section>
    </main>
  )
}

function AdminMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AdminLimits({ summary }: { summary: AdminStorageSummary }) {
  const limits = summary.limits
  const hasWarning = limits.warnings.length > 0
  return (
    <section className={`admin-limits${hasWarning ? ' admin-limits--warning' : ''}`} aria-label="Alpha limits">
      <div>
        <span>Alpha operating limits</span>
        <strong>
          Studios {summary.studio_count}/{limits.studio_hard_limit} · Assets{' '}
          {formatBytes(summary.total_asset_bytes)}/{formatBytes(limits.asset_hard_bytes)} · Engine jobs{' '}
          {limits.max_active_engine_jobs}
        </strong>
      </div>
      <p>
        Soft line {limits.studio_soft_limit} studios · warning at {formatBytes(limits.asset_warning_bytes)}.
      </p>
      {hasWarning ? (
        <ul>
          {limits.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function AssetTable({
  assets,
  totalAssetCount,
  busyKey,
  onDeleteAsset,
}: {
  assets: AdminAssetSummary[]
  totalAssetCount: number
  busyKey: string | null
  onDeleteAsset: (asset: AdminAssetSummary) => void
}) {
  if (assets.length === 0) {
    return <p className="admin-empty admin-empty--inline">No stored files for this studio.</p>
  }

  return (
    <>
      <div className="admin-asset-table" role="table" aria-label="Stored files">
        <div className="admin-asset-row admin-asset-row--head" role="row">
          <span role="columnheader">File</span>
          <span role="columnheader">Kind</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Ref</span>
          <span role="columnheader">Updated</span>
          <span role="columnheader">Action</span>
        </div>
        {assets.map((asset) => (
          <div className="admin-asset-row" role="row" key={asset.asset_id}>
            <span role="cell" title={asset.relative_path}>
              {asset.filename}
            </span>
            <span role="cell">{asset.kind}</span>
            <span role="cell">{formatBytes(asset.size_bytes)}</span>
            <span role="cell">{asset.referenced ? 'in use' : 'orphan'}</span>
            <span role="cell">{formatDate(asset.updated_at)}</span>
            <span role="cell">
              <button
                type="button"
                disabled={busyKey === `asset:${asset.asset_id}`}
                onClick={() => onDeleteAsset(asset)}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
      </div>
      {totalAssetCount > assets.length ? (
        <p className="admin-empty admin-empty--inline">
          Showing first {assets.length} of {totalAssetCount} files for this studio.
        </p>
      ) : null}
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function maskId(studioId: string): string {
  if (studioId.length <= 10) {
    return studioId
  }
  return `${studioId.slice(0, 6)}...${studioId.slice(-4)}`
}
