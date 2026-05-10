const STUDIO_LIST_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const

export type ApiRetryNotice = {
  message: string
  tone: 'loading' | 'success' | 'retrying' | 'failed'
}

export function getStudioListRetryDelayMs(attemptIndex: number): number {
  return getApiRetryDelayMs(attemptIndex)
}

export function getApiRetryDelayMs(attemptIndex: number): number {
  if (!Number.isFinite(attemptIndex) || attemptIndex <= 0) {
    return STUDIO_LIST_RETRY_DELAYS_MS[0]
  }
  const index = Math.min(Math.floor(attemptIndex), STUDIO_LIST_RETRY_DELAYS_MS.length - 1)
  return STUDIO_LIST_RETRY_DELAYS_MS[index]
}

export function buildApiLoadingNotice(label: string, retrying = false): ApiRetryNotice {
  return {
    tone: retrying ? 'retrying' : 'loading',
    message: retrying ? `${label}을 다시 확인하는 중입니다.` : `${label}을 불러오는 중입니다.`,
  }
}

export function buildApiSuccessNotice(label: string, count?: number): ApiRetryNotice {
  return {
    tone: 'success',
    message:
      typeof count === 'number'
        ? `${label} ${count}개를 불러왔습니다.`
        : `${label}을 불러왔습니다.`,
  }
}

export function buildApiRetryNotice(
  label: string,
  attemptIndex: number,
  delayMs: number,
  error: unknown,
): ApiRetryNotice {
  const seconds = Math.max(1, Math.round(delayMs / 1000))
  const reason = error instanceof Error && error.message ? ` (${error.message})` : ''
  if (attemptIndex < 2) {
    return {
      tone: 'retrying',
      message: `${label} 확인이 지연되고 있습니다${reason}. ${seconds}초 뒤 자동으로 다시 확인합니다.`,
    }
  }
  return {
    tone: 'failed',
    message: `${label}을 아직 불러오지 못했습니다${reason}. 연결을 계속 확인하고 있으며 ${seconds}초 뒤 다시 시도합니다.`,
  }
}
