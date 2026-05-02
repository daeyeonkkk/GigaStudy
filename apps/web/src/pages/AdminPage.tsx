import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  type AdminCredentials,
  deleteAdminAsset,
  deleteAdminExpiredStagedAssets,
  deleteAdminStagedAssets,
  deleteAdminStudio,
  deleteAdminStudioAssets,
  drainAdminEngineQueue,
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
    message: '스튜디오와 저장 파일을 관리하려면 로그인하세요.',
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
    setStatus({ phase: 'loading', message: '저장소 요약을 불러오는 중입니다.' })
    const nextSummary = await getAdminStorage(nextCredentials, {
      studioLimit: ADMIN_STUDIO_PAGE_SIZE,
      studioOffset: nextOffset,
      assetLimit: ADMIN_ASSET_PAGE_SIZE,
      assetOffset: 0,
    })
    setSummary(nextSummary)
    setCredentials(nextCredentials)
    setStudioOffset(nextSummary.studio_offset)
    setStatus({ phase: 'success', message: '저장소 요약을 새로 불러왔습니다.' })
  }

  async function login() {
    const nextCredentials = {
      username: username.trim(),
      password,
    }
    if (!nextCredentials.username || !nextCredentials.password) {
      setStatus({ phase: 'error', message: '관리자 ID와 비밀번호를 모두 입력하세요.' })
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
        message: error instanceof Error ? error.message : '로그인에 실패했습니다.',
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
        message: error instanceof Error ? error.message : '저장소 요약을 불러오지 못했습니다.',
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
        message: error instanceof Error ? error.message : '스튜디오 페이지를 불러오지 못했습니다.',
      })
    }
  }

  function logout() {
    setCredentials(null)
    setSummary(null)
    setPassword('')
    setStudioOffset(0)
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

  async function runDeletion(key: string, action: () => Promise<{ cleanup_queued?: boolean; message?: string }>) {
    setBusyKey(key)
    setStatus({ phase: 'loading', message: '삭제를 처리하는 중입니다.' })
    try {
      const result = await action()
      const nextOffset =
        summary?.studios.length === 1 && studioOffset > 0
          ? Math.max(0, studioOffset - ADMIN_STUDIO_PAGE_SIZE)
          : studioOffset
      await loadSummary(activeCredentials, nextOffset)
      setStatus({
        phase: 'success',
        message: result.cleanup_queued
          ? '관리 목록에서 제거했습니다. 저장 파일 정리는 백그라운드에서 계속됩니다.'
          : (result.message ?? '삭제를 완료했습니다.'),
      })
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : '삭제에 실패했습니다.',
      })
    } finally {
      setBusyKey(null)
    }
  }

  function handleDeleteAsset(asset: AdminAssetSummary) {
    if (!window.confirm(`${asset.filename} 파일을 삭제할까요? 피치 이벤트와 리포트 데이터는 유지됩니다.`)) {
      return
    }
    void runDeletion(`asset:${asset.asset_id}`, () =>
      deleteAdminAsset(activeCredentials, asset.asset_id),
    )
  }

  function handleDeleteStudioAssets(studio: AdminStudioSummary) {
    if (
      !window.confirm(
        `${studio.title}의 저장 파일을 삭제할까요? 정규화된 피치 이벤트 데이터는 유지됩니다. 저장소 스캔 전까지 파일 수가 일시적으로 맞지 않을 수 있습니다.`,
      )
    ) {
      return
    }
    void runDeletion(`studio-assets:${studio.studio_id}`, () =>
      deleteAdminStudioAssets(activeCredentials, studio.studio_id),
    )
  }

  function handleDeleteStudio(studio: AdminStudioSummary) {
    if (!window.confirm(`${studio.title} 스튜디오와 모든 저장 파일을 삭제할까요?`)) {
      return
    }
    void runDeletion(`studio:${studio.studio_id}`, () =>
      deleteAdminStudio(activeCredentials, studio.studio_id),
    )
  }

  function handleDeleteStagedAssets() {
    if (!window.confirm('버려진 임시 업로드 파일을 삭제할까요? 활성 스튜디오 파일은 유지됩니다.')) {
      return
    }
    void runDeletion('staged-assets', () => deleteAdminStagedAssets(activeCredentials))
  }

  function handleDeleteExpiredStagedAssets() {
    if (!window.confirm('만료된 임시 업로드 파일만 삭제할까요? 활성 스튜디오 파일은 유지됩니다.')) {
      return
    }
    void runDeletion('expired-staged-assets', () => deleteAdminExpiredStagedAssets(activeCredentials))
  }

  async function handleDrainEngineQueue() {
    if (credentials === null) {
      return
    }
    setBusyKey('engine-drain')
    setStatus({ phase: 'loading', message: '엔진 대기열을 처리하는 중입니다.' })
    try {
      const result = await drainAdminEngineQueue(activeCredentials, 3)
      await loadSummary(activeCredentials, studioOffset)
      setStatus({
        phase: 'success',
        message: `엔진 대기열 ${result.processed_jobs}/${result.max_jobs}개를 처리했습니다.${
          result.remaining_runnable ? ' 아직 대기 중인 작업이 있습니다.' : ''
        }`,
      })
    } catch (error) {
      setStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : '엔진 대기열을 처리하지 못했습니다.',
      })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <main className="app-shell admin-page">
      <section className="admin-window" aria-label="GigaStudy 관리자">
        <header className="admin-titlebar">
          <Link to="/" className="admin-mark" aria-label="홈으로 이동">
            GS
          </Link>
          <span>GigaStudy - 관리자</span>
        </header>

        <nav className="admin-menubar" aria-label="관리자 메뉴">
          <span>저장소</span>
          <span>스튜디오</span>
          <span>파일</span>
          <span>정리</span>
        </nav>

        <section className="admin-auth" aria-label="관리자 로그인">
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
            <section className="admin-overview" aria-label="저장소 개요">
              <AdminMetric label="스튜디오" value={summary?.studio_count ?? 0} />
              <AdminMetric label="파일" value={summary?.asset_count ?? 0} />
              <AdminMetric label="저장 용량" value={formatBytes(summary?.total_bytes ?? 0)} />
              <AdminMetric label="메타데이터" value={formatBytes(summary?.metadata_bytes ?? 0)} />
              <AdminMetric label="업로드 한도" value={formatBytes(summary?.limits.max_upload_bytes ?? 0)} />
              <AdminMetric label="현재 페이지 트랙" value={totalRegisteredTracks} />
            </section>

            <section className="admin-storage-path" aria-label="저장소 백엔드">
              <span>저장소 백엔드</span>
              <strong>{summary?.storage_root ?? '-'}</strong>
            </section>

            {summary ? <AdminLimits summary={summary} /> : null}

            <section className="admin-cleanup" aria-label="정리 작업">
              <div>
                <span>정리</span>
                <strong>남은 임시 업로드</strong>
                <p>만료된 임시 파일은 새 업로드 준비 정보를 만들 때도 자동으로 정리됩니다.</p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleDeleteExpiredStagedAssets}
              >
                만료 파일 삭제
              </button>
              <button
                className="admin-danger"
                type="button"
                disabled={isBusy}
                onClick={handleDeleteStagedAssets}
              >
                임시 파일 삭제
              </button>
            </section>

            <section className="admin-queue" aria-label="엔진 대기열 작업">
              <div>
                <span>엔진 대기열</span>
                <strong>문서/음성 추출 처리</strong>
                <p>대기 중이거나 만료된 작업을 최대 3개까지 즉시 처리합니다.</p>
              </div>
              <button
                className="app-button"
                type="button"
                disabled={isBusy}
                onClick={() => void handleDrainEngineQueue()}
              >
                대기열 실행
              </button>
            </section>

            <section className="admin-studios" aria-label="스튜디오 목록">
              <header className="admin-section-header">
                <div>
                  <p className="eyebrow">운영</p>
                  <h1>스튜디오 관리</h1>
                </div>
                <div className="admin-pager" aria-label="스튜디오 페이지 이동">
                  <span>
                    {summary ? `${pageStart}-${pageEnd} / ${summary.studio_count}` : '데이터 없음'}
                  </span>
                  <button
                    type="button"
                    disabled={isBusy || !summary || summary.studio_offset === 0}
                    onClick={() => void goToOffset(studioOffset - ADMIN_STUDIO_PAGE_SIZE)}
                  >
                    이전
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || !summary?.has_more_studios}
                    onClick={() => void goToOffset(studioOffset + ADMIN_STUDIO_PAGE_SIZE)}
                  >
                    다음
                  </button>
                </div>
              </header>

              {summary?.studios.length === 0 ? (
                <p className="admin-empty">이 페이지에 스튜디오가 없습니다.</p>
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
                        disabled={isBusy}
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
          <section className="admin-login-empty" aria-label="로그인 안내">
            <h1>관리자</h1>
            <p>스튜디오, 업로드, 녹음, 생성 파일, 문서 출력물을 삭제하려면 로그인하세요.</p>
          </section>
        )}

        <footer className="admin-statusbar">
          <span>준비 완료</span>
          <span>{credentials === null ? '로그인 필요' : '관리자 세션 활성'}</span>
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
    <section className={`admin-limits${hasWarning ? ' admin-limits--warning' : ''}`} aria-label="알파 운영 한도">
      <div>
        <span>알파 운영 한도</span>
        <strong>
          스튜디오 {summary.studio_count}/{limits.studio_hard_limit} · 파일{' '}
          {formatBytes(summary.total_asset_bytes)}/{formatBytes(limits.asset_hard_bytes)} · 엔진 작업{' '}
          {limits.max_active_engine_jobs}
        </strong>
      </div>
      <p>
        권장선 {limits.studio_soft_limit}개 스튜디오 · {formatBytes(limits.asset_warning_bytes)}부터 경고.
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
    return <p className="admin-empty admin-empty--inline">이 스튜디오에 저장 파일이 없습니다.</p>
  }

  return (
    <>
      <div className="admin-asset-table" role="table" aria-label="저장 파일">
        <div className="admin-asset-row admin-asset-row--head" role="row">
          <span role="columnheader">파일</span>
          <span role="columnheader">종류</span>
          <span role="columnheader">크기</span>
          <span role="columnheader">참조</span>
          <span role="columnheader">수정</span>
          <span role="columnheader">작업</span>
        </div>
        {assets.map((asset) => (
          <div className="admin-asset-row" role="row" key={asset.asset_id}>
            <span role="cell" title={asset.relative_path}>
              {asset.filename}
            </span>
            <span role="cell">{asset.kind}</span>
            <span role="cell">{formatBytes(asset.size_bytes)}</span>
            <span role="cell">{asset.referenced ? '사용 중' : '미사용'}</span>
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
      {totalAssetCount > assets.length ? (
        <p className="admin-empty admin-empty--inline">
          이 스튜디오의 파일 {totalAssetCount}개 중 처음 {assets.length}개를 표시합니다.
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
