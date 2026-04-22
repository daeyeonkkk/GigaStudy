import type { CreateStudioRequest, ScoreNote, Studio, StudioListItem } from '../types/studio'

export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000'

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
        ...options.headers,
      },
      ...options,
    })
    return await readJson<T>(response, fallbackMessage)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('API 서버에 연결할 수 없습니다.')
    }
    throw error
  }
}

async function requestBlob(path: string, fallbackMessage: string): Promise<Blob> {
  try {
    const response = await fetch(new URL(path, apiBaseUrl))
    if (response.ok) {
      return await response.blob()
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
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('API 서버에 연결할 수 없습니다.')
    }
    throw error
  }
}

export function listStudios(): Promise<StudioListItem[]> {
  return requestJson<StudioListItem[]>('/api/studios', {}, '스튜디오 목록을 불러오지 못했습니다.')
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

export function getStudio(studioId: string): Promise<Studio> {
  return requestJson<Studio>(`/api/studios/${studioId}`, {}, '스튜디오를 불러오지 못했습니다.')
}

export function getTrackAudioUrl(studioId: string, slotId: number): string {
  return new URL(`/api/studios/${studioId}/tracks/${slotId}/audio`, apiBaseUrl).toString()
}

export function uploadTrack(
  studioId: string,
  slotId: number,
  payload: {
    source_kind: 'audio' | 'midi' | 'score'
    filename: string
    content_base64: string
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
    '추출 후보를 거절하지 못했습니다.',
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
    'OMR 결과를 트랙에 등록하지 못했습니다.',
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

export function scoreTrack(
  studioId: string,
  slotId: number,
  payload: {
    reference_slot_ids: number[]
    include_metronome: boolean
    performance_notes?: ScoreNote[]
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

export function exportStudioPdf(studioId: string): Promise<Blob> {
  return requestBlob(`/api/studios/${studioId}/export/pdf`, 'PDF를 생성하지 못했습니다.')
}
