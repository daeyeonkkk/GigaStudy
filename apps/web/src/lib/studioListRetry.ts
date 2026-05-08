const STUDIO_LIST_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const

export function getStudioListRetryDelayMs(attemptIndex: number): number {
  if (!Number.isFinite(attemptIndex) || attemptIndex <= 0) {
    return STUDIO_LIST_RETRY_DELAYS_MS[0]
  }
  const index = Math.min(Math.floor(attemptIndex), STUDIO_LIST_RETRY_DELAYS_MS.length - 1)
  return STUDIO_LIST_RETRY_DELAYS_MS[index]
}

