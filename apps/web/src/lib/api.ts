import type {
  AdminDeleteResult,
  AdminEngineDrainResult,
  AdminStorageSummary,
  CreateStudioRequest,
  DirectUploadTarget,
  CopyRegionRequest,
  PlaybackInstrumentConfig,
  PitchEvent,
  ScoreMode,
  SaveRegionRevisionRequest,
  SplitRegionRequest,
  Studio,
  StudioListItem,
  UpdatePitchEventRequest,
  UpdateRegionRequest,
} from '../types/studio'

const defaultApiBaseUrl = import.meta.env.PROD
  ? 'https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app'
  : 'http://127.0.0.1:8000'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || defaultApiBaseUrl
const OWNER_TOKEN_STORAGE_KEY = 'gigastudy.ownerToken.v1'
const ADMIN_SESSION_STORAGE_KEY = 'gigastudy.adminSession.v1'

export type AdminCredentials = {
  username: string
  password: string
}

type AdminStorageQuery = {
  studioLimit?: number
  studioOffset?: number
  assetLimit?: number
  assetOffset?: number
  syncMissingAssets?: boolean
  studioStatus?: 'active' | 'inactive' | 'all'
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('파일을 읽지 못했습니다.'))
      }
    })
    reader.addEventListener('error', () => reject(new Error('파일을 읽지 못했습니다.')))
    reader.readAsDataURL(file)
  })
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T
  }

  try {
    const payload = (await response.json()) as { detail?: unknown; message?: unknown }
    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      throw new Error(payload.detail.trim())
    }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      throw new Error(payload.message.trim())
    }
  } catch (error) {
    if (error instanceof Error && error.message !== fallbackMessage) {
      throw error
    }
  }

  throw new Error(fallbackMessage)
}

async function requestJson<T>(
  path: string,
  options: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  try {
    const response = await fetch(new URL(path, apiBaseUrl), {
      headers: {
        'Content-Type': 'application/json',
        ...ownerHeaders(),
        ...storedAdminHeaders(),
        ...options.headers,
      },
      ...options,
    })
    return await readJson<T>(response, fallbackMessage)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('API 서버에 연결하지 못했습니다.')
    }
    throw error
  }
}

export function listStudios(limit = 12, offset = 0): Promise<StudioListItem[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  return requestJson<StudioListItem[]>(
    `/api/studios?${params.toString()}`,
    {},
    '스튜디오 목록을 불러오지 못했습니다.',
  )
}

export function createStudio(payload: CreateStudioRequest): Promise<Studio> {
  return requestJson<Studio>(
    '/api/studios',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '스튜디오를 만들지 못했습니다.',
  )
}

export function createStudioUploadTarget(payload: {
  source_kind: 'document' | 'music'
  filename: string
  size_bytes: number
  content_type?: string
}): Promise<DirectUploadTarget> {
  return requestJson<DirectUploadTarget>(
    '/api/studios/upload-target',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '업로드 준비 정보를 만들지 못했습니다.',
  )
}

export function getStudio(studioId: string): Promise<Studio> {
  return requestJson<Studio>(`/api/studios/${studioId}`, {}, '스튜디오를 불러오지 못했습니다.')
}

export function getTrackAudioUrl(studioId: string, slotId: number): string {
  const url = new URL(`/api/studios/${studioId}/tracks/${slotId}/audio`, apiBaseUrl)
  const ownerToken = getOwnerToken()
  if (ownerToken) {
    url.searchParams.set('owner_token', ownerToken)
  }
  return url.toString()
}

export function getStudioMidiExportUrl(studioId: string): string {
  const url = new URL(`/api/studios/${studioId}/exports/midi`, apiBaseUrl)
  const ownerToken = getOwnerToken()
  if (ownerToken) {
    url.searchParams.set('owner_token', ownerToken)
  }
  return url.toString()
}

export function getDocumentJobSourcePreviewUrl(studioId: string, jobId: string, pageIndex = 0): string {
  const url = new URL(`/api/studios/${studioId}/jobs/${jobId}/source-preview`, apiBaseUrl)
  url.searchParams.set('page_index', String(pageIndex))
  const ownerToken = getOwnerToken()
  if (ownerToken) {
    url.searchParams.set('owner_token', ownerToken)
  }
  return url.toString()
}

export function createTrackUploadTarget(
  studioId: string,
  slotId: number,
  payload: {
    source_kind: 'audio' | 'midi' | 'document'
    filename: string
    size_bytes: number
    content_type?: string
  },
): Promise<DirectUploadTarget> {
  return requestJson<DirectUploadTarget>(
    `/api/studios/${studioId}/tracks/${slotId}/upload-target`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '업로드 준비 정보를 만들지 못했습니다.',
  )
}

export async function putDirectUpload(target: DirectUploadTarget, blob: Blob): Promise<void> {
  const response = await fetch(target.upload_url, {
    method: target.method,
    headers: target.headers,
    body: blob,
  })
  if (!response.ok) {
    throw new Error('파일 업로드에 실패했습니다.')
  }
}

export function uploadTrack(
  studioId: string,
  slotId: number,
  payload: {
    source_kind: 'audio' | 'midi' | 'document'
    filename: string
    content_base64?: string
    asset_path?: string
    review_before_register?: boolean
    allow_overwrite?: boolean
  },
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/${slotId}/upload`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '트랙 업로드를 등록하지 못했습니다.',
  )
}

export function approveCandidate(
  studioId: string,
  candidateId: string,
  targetSlotId?: number,
  allowOverwrite = false,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/candidates/${candidateId}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({
        target_slot_id: targetSlotId ?? null,
        allow_overwrite: allowOverwrite,
      }),
    },
    '추출 후보를 승인하지 못했습니다.',
  )
}

export function rejectCandidate(studioId: string, candidateId: string): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/candidates/${candidateId}/reject`,
    { method: 'POST' },
    '추출 후보를 제외하지 못했습니다.',
  )
}

export function approveJobCandidates(
  studioId: string,
  jobId: string,
  allowOverwrite = false,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/jobs/${jobId}/approve-candidates`,
    {
      method: 'POST',
      body: JSON.stringify({
        allow_overwrite: allowOverwrite,
      }),
    },
    '문서 분석 결과를 트랙에 등록하지 못했습니다.',
  )
}

export function retryExtractionJob(studioId: string, jobId: string): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/jobs/${jobId}/retry`,
    { method: 'POST' },
    '추출 작업을 다시 시작하지 못했습니다.',
  )
}

export function generateTrack(
  studioId: string,
  slotId: number,
  contextSlotIds: number[],
  allowOverwrite = false,
  candidateCount = 3,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/${slotId}/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        context_slot_ids: contextSlotIds,
        allow_overwrite: allowOverwrite,
        review_before_register: true,
        candidate_count: candidateCount,
      }),
    },
    'AI 생성에 실패했습니다.',
  )
}

export function updateTrackSync(
  studioId: string,
  slotId: number,
  syncOffsetSeconds: number,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/${slotId}/sync`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sync_offset_seconds: syncOffsetSeconds }),
    },
    '싱크를 저장하지 못했습니다.',
  )
}

export function shiftRegisteredTrackSyncs(
  studioId: string,
  deltaSeconds: number,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/sync`,
    {
      method: 'PATCH',
      body: JSON.stringify({ delta_seconds: deltaSeconds }),
    },
    '전체 트랙 싱크를 저장하지 못했습니다.',
  )
}

export function updateTrackVolume(
  studioId: string,
  slotId: number,
  volumePercent: number,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/${slotId}/volume`,
    {
      method: 'PATCH',
      body: JSON.stringify({ volume_percent: volumePercent }),
    },
    '트랙 음량을 저장하지 못했습니다.',
  )
}

export function updateRegion(
  studioId: string,
  regionId: string,
  payload: UpdateRegionRequest,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    '구간을 저장하지 못했습니다.',
)
}

export function saveRegionRevision(
  studioId: string,
  regionId: string,
  payload: SaveRegionRevisionRequest,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}/revision`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    '편집 내용을 저장하지 못했습니다.',
  )
}

export function restoreRegionRevision(
  studioId: string,
  regionId: string,
  revisionId: string,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}/revision-history/${revisionId}/restore`,
    { method: 'POST' },
    '이전 버전을 복원하지 못했습니다.',
  )
}

export function copyRegion(
  studioId: string,
  regionId: string,
  payload: CopyRegionRequest = {},
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}/copy`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '구간을 복사하지 못했습니다.',
  )
}

export function splitRegion(
  studioId: string,
  regionId: string,
  payload: SplitRegionRequest,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}/split`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '구간을 자르지 못했습니다.',
  )
}

export function deleteRegion(studioId: string, regionId: string): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}`,
    { method: 'DELETE' },
    '구간을 삭제하지 못했습니다.',
  )
}

export function updatePitchEvent(
  studioId: string,
  regionId: string,
  eventId: string,
  payload: UpdatePitchEventRequest,
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/regions/${regionId}/events/${eventId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    '구간을 저장하지 못했습니다.',
  )
}

export function scoreTrack(
  studioId: string,
  slotId: number,
  payload: {
    score_mode?: ScoreMode
    reference_slot_ids: number[]
    include_metronome: boolean
    performance_events?: PitchEvent[]
    performance_audio_base64?: string
    performance_filename?: string
  },
): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}/tracks/${slotId}/score`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    '채점 리포트를 만들지 못했습니다.',
  )
}

export function deactivateStudio(studioId: string): Promise<Studio> {
  return requestJson<Studio>(
    `/api/studios/${studioId}`,
    { method: 'DELETE' },
    '스튜디오를 삭제하지 못했습니다.',
  )
}

function adminHeaders(credentials: AdminCredentials): HeadersInit {
  return {
    'X-GigaStudy-Admin-User': credentials.username,
    'X-GigaStudy-Admin-Password-B64': encodeUtf8Base64(credentials.password),
  }
}

function ownerHeaders(): HeadersInit {
  const ownerToken = getOwnerToken()
  return ownerToken ? { 'X-GigaStudy-Owner-Token': ownerToken } : {}
}

function getOwnerToken(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const existing = window.localStorage.getItem(OWNER_TOKEN_STORAGE_KEY)
  if (existing && existing.length >= 24) {
    return existing
  }
  return ''
}

export async function setOwnerTokenFromStudioPassword(password: string): Promise<void> {
  const normalized = password.trim()
  if (typeof window === 'undefined' || !normalized) {
    return
  }
  window.localStorage.setItem(OWNER_TOKEN_STORAGE_KEY, await deriveOwnerToken(normalized))
}

export function clearOwnerToken(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.removeItem(OWNER_TOKEN_STORAGE_KEY)
}

async function deriveOwnerToken(password: string): Promise<string> {
  const material = new TextEncoder().encode(`gigastudy-studio-password:${password}`)
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', material)
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `gigastudy-studio-password-sha256:${hex}`
  }
  return `gigastudy-studio-password:${encodeUtf8Base64(password)}`
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function storedAdminHeaders(): HeadersInit {
  if (typeof window === 'undefined') {
    return {}
  }
  const stored = window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
  if (!stored) {
    return {}
  }
  try {
    const credentials = JSON.parse(stored) as AdminCredentials
    if (!credentials.username || !credentials.password) {
      return {}
    }
    return adminHeaders(credentials)
  } catch {
    return {}
  }
}

export function storeAdminSession(credentials: AdminCredentials): void {
  if (typeof window === 'undefined') {
    return
  }
  window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(credentials))
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
}

export function getAdminStorage(
  credentials: AdminCredentials,
  query: AdminStorageQuery = {},
): Promise<AdminStorageSummary> {
  return requestJson<AdminStorageSummary>(
    buildAdminStoragePath(query),
    {
      headers: adminHeaders(credentials),
    },
    '관리자 저장소 요약을 불러오지 못했습니다.',
  )
}

function buildAdminStoragePath(query: AdminStorageQuery): string {
  const params = new URLSearchParams()
  if (query.studioLimit !== undefined) {
    params.set('studio_limit', String(query.studioLimit))
  }
  if (query.studioOffset !== undefined) {
    params.set('studio_offset', String(query.studioOffset))
  }
  if (query.assetLimit !== undefined) {
    params.set('asset_limit', String(query.assetLimit))
  }
  if (query.assetOffset !== undefined) {
    params.set('asset_offset', String(query.assetOffset))
  }
  if (query.syncMissingAssets !== undefined) {
    params.set('sync_missing_assets', String(query.syncMissingAssets))
  }
  if (query.studioStatus !== undefined) {
    params.set('studio_status', query.studioStatus)
  }
  const suffix = params.toString()
  return suffix ? `/api/admin/storage?${suffix}` : '/api/admin/storage'
}

export function deactivateAdminStudio(
  credentials: AdminCredentials,
  studioId: string,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    `/api/admin/studios/${studioId}/deactivate`,
    {
      method: 'POST',
      headers: adminHeaders(credentials),
    },
    '스튜디오를 비활성화하지 못했습니다.',
  )
}

export function deleteAdminStudio(
  credentials: AdminCredentials,
  studioId: string,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    `/api/admin/studios/${studioId}?background=true`,
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '스튜디오를 삭제하지 못했습니다.',
  )
}

export function deleteAdminInactiveStudios(
  credentials: AdminCredentials,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    '/api/admin/inactive-studios?background=true',
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '비활성화 스튜디오를 완전삭제하지 못했습니다.',
  )
}

export function deleteAdminStudioAssets(
  credentials: AdminCredentials,
  studioId: string,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    `/api/admin/studios/${studioId}/assets?background=true`,
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '스튜디오 파일을 삭제하지 못했습니다.',
  )
}

export function deleteAdminAsset(
  credentials: AdminCredentials,
  assetId: string,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    `/api/admin/assets/${assetId}`,
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '파일을 삭제하지 못했습니다.',
  )
}

export function deleteAdminStagedAssets(
  credentials: AdminCredentials,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    '/api/admin/staged-assets',
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '임시 업로드 파일을 삭제하지 못했습니다.',
  )
}

export function deleteAdminExpiredStagedAssets(
  credentials: AdminCredentials,
): Promise<AdminDeleteResult> {
  return requestJson<AdminDeleteResult>(
    '/api/admin/expired-staged-assets',
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '만료된 임시 업로드 파일을 삭제하지 못했습니다.',
  )
}

export function drainAdminEngineQueue(
  credentials: AdminCredentials,
  maxJobs = 3,
): Promise<AdminEngineDrainResult> {
  const params = new URLSearchParams({ max_jobs: String(maxJobs) })
  return requestJson<AdminEngineDrainResult>(
    `/api/admin/engine/drain?${params.toString()}`,
    {
      method: 'POST',
      headers: adminHeaders(credentials),
    },
    '엔진 대기열을 처리하지 못했습니다.',
  )
}

export function getPlaybackInstrument(): Promise<PlaybackInstrumentConfig> {
  return requestJson<PlaybackInstrumentConfig>(
    '/api/playback-instrument',
    {},
    '연주음 설정을 불러오지 못했습니다.',
  )
}

export function updateAdminPlaybackInstrument(
  credentials: AdminCredentials,
  payload: {
    filename: string
    content_base64: string
    root_midi: number
  },
): Promise<PlaybackInstrumentConfig> {
  return requestJson<PlaybackInstrumentConfig>(
    '/api/admin/playback-instrument',
    {
      method: 'PUT',
      headers: adminHeaders(credentials),
      body: JSON.stringify(payload),
    },
    '연주음 파일을 저장하지 못했습니다.',
  )
}

export function resetAdminPlaybackInstrument(
  credentials: AdminCredentials,
): Promise<PlaybackInstrumentConfig> {
  return requestJson<PlaybackInstrumentConfig>(
    '/api/admin/playback-instrument',
    {
      method: 'DELETE',
      headers: adminHeaders(credentials),
    },
    '연주음 파일을 초기화하지 못했습니다.',
  )
}
