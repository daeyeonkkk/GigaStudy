export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000'

export function buildApiUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString()
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
