import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  type AdminCredentials,
  deleteAdminAsset,
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

export function AdminPage() {
  const [username, setUsername] = useState(DEFAULT_LOGIN_ID)
  const [password, setPassword] = useState('')
  const [credentials, setCredentials] = useState<AdminCredentials | null>(null)
  const [summary, setSummary] = useState<AdminStorageSummary | null>(null)
  const [status, setStatus] = useState<AdminStatus>({
    phase: 'idle',
    message: 'admin 계정으로 로그인하세요.',
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

  const isBusy = status.phase === 'loading' || busyKey !== null
  const activeCredentials = credentials ?? {
    username: username.trim(),
    password,
  }

  async function loadSummary(nextCredentials: AdminCredentials) {
    setStatus({ phase: 'loading', message: '저장 현황을 불러오는 중입니다.' })
    const nextSummary = await getAdminStorage(nextCredentials)
    setSummary(nextSummary)
    setCredentials(nextCredentials)
    setStatus({ phase: 'success', message: '저장 현황을 갱신했습니다.' })
  }

  async function login() {
    const nextCredentials = {
      username: username.trim(),
      password,
    }
    if (!nextCredentials.username || !nextCredentials.password) {
      setStatus({ phase: 'error', message: '아이디와 비밀번호를 입력하세요.' })
      return
    }

    try {
      await loadSummary(nextCredentials)
    } catch (error) {
      setCredentials(null)
      setSummary(null)
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : '로그인하지 못했습니다.',
      })
    }
  }

  async function refreshSummary() {
    if (credentials === null) {
      await login()
      return
    }

    try {
      await loadSummary(credentials)
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : '저장 현황을 불러오지 못했습니다.',
      })
    }
  }

  function logout() {
    setCredentials(null)
    setSummary(null)
    setPassword('')
    setExpandedStudios(new Set())
    setStatus({ phase: 'idle', message: '로그아웃했습니다.' })
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
    setStatus({ phase: 'loading', message: '삭제 요청을 처리하는 중입니다.' })
    try {
      await action()
      await loadSummary(activeCredentials)
      setStatus({ phase: 'success', message: '삭제가 완료되었습니다.' })
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : '삭제하지 못했습니다.',
      })
    } finally {
      setBusyKey(null)
    }
  }

  function handleDeleteAsset(asset: AdminAssetSummary) {
    if (!window.confirm(`${asset.filename} 파일을 삭제할까요? TrackNote와 리포트는 유지됩니다.`)) {
      return
    }
    void runDeletion(`asset:${asset.asset_id}`, () =>
      deleteAdminAsset(activeCredentials, asset.asset_id),
    )
  }

  function handleDeleteStudioAssets(studio: AdminStudioSummary) {
    if (
      !window.confirm(
        `${studio.title} 스튜디오의 파일 ${studio.asset_count}개를 모두 삭제할까요? 스튜디오와 TrackNote는 유지됩니다.`,
      )
    ) {
      return
    }
    void runDeletion(`studio-assets:${studio.studio_id}`, () =>
      deleteAdminStudioAssets(activeCredentials, studio.studio_id),
    )
  }

  function handleDeleteStudio(studio: AdminStudioSummary) {
    if (
      !window.confirm(
        `${studio.title} 스튜디오를 완전히 삭제할까요? 리포트와 저장 파일도 함께 삭제됩니다.`,
      )
    ) {
      return
    }
    void runDeletion(`studio:${studio.studio_id}`, () =>
      deleteAdminStudio(activeCredentials, studio.studio_id),
    )
  }

  return (
    <main className="app-shell admin-page">
      <section className="admin-window" aria-label="GigaStudy admin">
        <header className="admin-titlebar">
          <Link to="/" className="admin-mark" aria-label="홈으로 이동">
            GS
          </Link>
          <span>GigaStudy - Admin</span>
        </header>

        <nav className="admin-menubar" aria-label="관리 메뉴">
          <span>Storage</span>
          <span>Studios</span>
          <span>Assets</span>
          <span>Cleanup</span>
        </nav>

        <section className="admin-auth" aria-label="관리자 로그인">
          <label>
            <span>아이디</span>
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
            <span>비밀번호</span>
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
              로그인
            </button>
          ) : (
            <div className="admin-auth-actions">
              <button className="app-button" type="button" disabled={isBusy} onClick={() => void refreshSummary()}>
                새로고침
              </button>
              <button type="button" disabled={isBusy} onClick={logout}>
                로그아웃
              </button>
            </div>
          )}
          <span className={`admin-status admin-status--${status.phase}`} role="status">
            {status.message}
          </span>
        </section>

        {credentials !== null ? (
          <>
            <section className="admin-overview" aria-label="저장 현황">
              <AdminMetric label="Studios" value={summary?.studio_count ?? 0} />
              <AdminMetric label="Files" value={summary?.asset_count ?? 0} />
              <AdminMetric label="Storage" value={formatBytes(summary?.total_bytes ?? 0)} />
              <AdminMetric label="Metadata" value={formatBytes(summary?.metadata_bytes ?? 0)} />
              <AdminMetric label="Tracks" value={totalRegisteredTracks} />
            </section>

            <section className="admin-storage-path" aria-label="스토리지 백엔드">
              <span>Storage backend</span>
              <strong>{summary?.storage_root ?? '-'}</strong>
            </section>

            <section className="admin-studios" aria-label="스튜디오 목록">
              <header className="admin-section-header">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h1>스튜디오 관리</h1>
                </div>
                <span>{summary ? `${summary.studios.length} studios` : 'No data'}</span>
              </header>

              {summary?.studios.length === 0 ? (
                <p className="admin-empty">저장된 스튜디오가 없습니다.</p>
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
                        <span>트랙 {studio.registered_track_count}/6</span>
                        <span>리포트 {studio.report_count}</span>
                        <span>후보 {studio.candidate_count}</span>
                        <span>파일 {studio.asset_count}</span>
                        <span>{formatBytes(studio.asset_bytes)}</span>
                      </div>
                    </div>
                    <div className="admin-row-actions">
                      <Link className="admin-link-button" to={`/studios/${studio.studio_id}`}>
                        열기
                      </Link>
                      <button
                        type="button"
                        disabled={isBusy || studio.asset_count === 0}
                        onClick={() => handleDeleteStudioAssets(studio)}
                      >
                        파일 삭제
                      </button>
                      <button
                        className="admin-danger"
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteStudio(studio)}
                      >
                        스튜디오 삭제
                      </button>
                    </div>

                    {expandedStudios.has(studio.studio_id) ? (
                      <AssetTable
                        assets={studio.assets}
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
          <section className="admin-login-empty" aria-label="로그인 안내">
            <h1>Admin</h1>
            <p>스튜디오와 저장 파일을 삭제하려면 로그인하세요.</p>
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

function AssetTable({
  assets,
  busyKey,
  onDeleteAsset,
}: {
  assets: AdminAssetSummary[]
  busyKey: string | null
  onDeleteAsset: (asset: AdminAssetSummary) => void
}) {
  if (assets.length === 0) {
    return <p className="admin-empty admin-empty--inline">이 스튜디오에 저장된 파일이 없습니다.</p>
  }

  return (
    <div className="admin-asset-table" role="table" aria-label="스튜디오 파일 목록">
      <div className="admin-asset-row admin-asset-row--head" role="row">
        <span role="columnheader">파일</span>
        <span role="columnheader">종류</span>
        <span role="columnheader">크기</span>
        <span role="columnheader">참조</span>
        <span role="columnheader">수정</span>
        <span role="columnheader">관리</span>
      </div>
      {assets.map((asset) => (
        <div className="admin-asset-row" role="row" key={asset.asset_id}>
          <span role="cell" title={asset.relative_path}>
            {asset.filename}
          </span>
          <span role="cell">{asset.kind}</span>
          <span role="cell">{formatBytes(asset.size_bytes)}</span>
          <span role="cell">{asset.referenced ? '사용 중' : '미참조'}</span>
          <span role="cell">{formatDate(asset.updated_at)}</span>
          <span role="cell">
            <button
              type="button"
              disabled={busyKey === `asset:${asset.asset_id}`}
              onClick={() => onDeleteAsset(asset)}
            >
              삭제
            </button>
          </span>
        </div>
      ))}
    </div>
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
