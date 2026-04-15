import { buildApiUrl } from './api'

type RuntimeSeverity = 'info' | 'warn' | 'error'

type RuntimeEventPayload = {
  severity: RuntimeSeverity
  eventType: string
  message: string
  requestId?: string | null
  requestMethod?: string | null
  requestPath?: string | null
  statusCode?: number | null
  details?: Record<string, unknown>
}

declare global {
  interface Window {
    __gigastudyRuntimeMonitoringInstalled?: boolean
    __gigastudyOriginalFetch?: typeof window.fetch
  }
}

const RUNTIME_EVENT_PATH = '/api/runtime-events'
const RUNTIME_EVENT_LIMIT_MS = 5_000
const recentEventSignatures = new Map<string, number>()

function trimString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function getCurrentSurface(pathname: string): string {
  if (pathname === '/') {
    return 'home'
  }
  if (pathname === '/ops') {
    return 'ops'
  }
  if (pathname.includes('/arrangement')) {
    return 'arrangement'
  }
  if (pathname.includes('/studio')) {
    return 'studio'
  }
  if (pathname.startsWith('/shared/')) {
    return 'shared'
  }
  return 'app'
}

function serializeUnknownError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? trimString(value.stack, 1600) : null,
    }
  }

  if (typeof value === 'string') {
    return { value: trimString(value, 600) }
  }

  return { value: String(value) }
}

function shouldSkipEvent(signature: string): boolean {
  const now = Date.now()
  const recentAt = recentEventSignatures.get(signature)
  recentEventSignatures.set(signature, now)

  if (recentAt && now - recentAt < RUNTIME_EVENT_LIMIT_MS) {
    return true
  }

  for (const [key, value] of recentEventSignatures) {
    if (now - value > RUNTIME_EVENT_LIMIT_MS) {
      recentEventSignatures.delete(key)
    }
  }

  return false
}

export function reportRuntimeEvent(payload: RuntimeEventPayload): void {
  if (typeof window === 'undefined') {
    return
  }

  const routePath = window.location.pathname
  const signature = `${payload.eventType}:${payload.requestMethod ?? ''}:${payload.requestPath ?? ''}:${payload.message}`
  if (shouldSkipEvent(signature)) {
    return
  }

  const body = JSON.stringify({
    source: 'client',
    severity: payload.severity,
    event_type: payload.eventType,
    message: trimString(payload.message, 2000),
    surface: getCurrentSurface(routePath),
    route_path: trimString(routePath, 256),
    request_id: payload.requestId ?? null,
    request_method: payload.requestMethod ?? null,
    request_path: payload.requestPath ?? null,
    status_code: payload.statusCode ?? null,
    user_agent: trimString(window.navigator.userAgent, 1024),
    details: payload.details ?? null,
  })

  void fetch(buildApiUrl(RUNTIME_EVENT_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export function installRuntimeMonitoring(): void {
  if (typeof window === 'undefined' || window.__gigastudyRuntimeMonitoringInstalled) {
    return
  }

  window.__gigastudyRuntimeMonitoringInstalled = true
  const originalFetch = window.fetch.bind(window)
  window.__gigastudyOriginalFetch = originalFetch

  window.fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const requestMethod =
      init?.method ??
      (typeof input !== 'string' && !(input instanceof URL) ? input.method : undefined) ??
      'GET'

    if (requestUrl.includes(RUNTIME_EVENT_PATH)) {
      return originalFetch(input, init)
    }

    try {
      const response = await originalFetch(input, init)
      if (response.status >= 500) {
        reportRuntimeEvent({
          severity: 'error',
          eventType: 'fetch_failure',
          message: `${response.status} 응답이 돌아왔습니다.`,
          requestId: response.headers.get('X-Request-ID'),
          requestMethod,
          requestPath: requestUrl,
          statusCode: response.status,
          details: {
            statusText: response.statusText,
          },
        })
      }
      return response
    } catch (error) {
      reportRuntimeEvent({
        severity: 'error',
        eventType: 'fetch_network_error',
        message: error instanceof Error ? error.message : '네트워크 요청이 실패했습니다.',
        requestMethod,
        requestPath: requestUrl,
        details: serializeUnknownError(error),
      })
      throw error
    }
  }

  window.addEventListener('error', (event) => {
    reportRuntimeEvent({
      severity: 'error',
      eventType: 'window_error',
      message: event.message || '처리되지 않은 화면 오류가 발생했습니다.',
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: serializeUnknownError(event.error),
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportRuntimeEvent({
      severity: 'error',
      eventType: 'unhandled_rejection',
      message: '화면에서 처리되지 않은 Promise 실패가 발생했습니다.',
      details: {
        reason: serializeUnknownError(event.reason),
      },
    })
  })
}
