export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000'

export function buildApiUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString()
}

type JsonErrorPayload = {
  detail?: unknown
  message?: unknown
}

const rawNetworkErrorMessages = new Set(['Failed to fetch', 'Load failed', 'Network request failed'])

export async function readApiErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as JsonErrorPayload

    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      return payload.detail.trim()
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim()
    }
  } catch {
    // Fall through to the fallback message when the response body is empty or not JSON.
  }

  return fallbackMessage
}

export function normalizeRequestError(
  error: unknown,
  fallbackMessage: string,
  networkFallbackMessage = '지금은 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
): string {
  if (error instanceof Error) {
    const trimmedMessage = error.message.trim()

    if (!trimmedMessage) {
      return fallbackMessage
    }

    if (
      rawNetworkErrorMessages.has(trimmedMessage) ||
      (error instanceof TypeError && /fetch|network/i.test(trimmedMessage))
    ) {
      return networkFallbackMessage
    }

    return trimmedMessage
  }

  return fallbackMessage
}

export function normalizeAssetUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }

  try {
    const normalized = new URL(url, apiBaseUrl)

    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      normalized.protocol === 'http:'
    ) {
      normalized.protocol = 'https:'
    }

    return normalized.toString()
  } catch {
    return url
  }
}
