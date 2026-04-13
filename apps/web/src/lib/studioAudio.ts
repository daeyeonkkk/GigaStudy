import { getAudioContextConstructor } from './audioContext'

export type MetronomeController = {
  stop: () => Promise<void>
}

type UploadHeaders = Record<string, string>

type UploadBlobOptions = {
  url: string
  method: string
  blob: Blob
  headers?: UploadHeaders
  contentType?: string
  onProgress?: (progress: number) => void
}

type CountInOptions = {
  bpm: number
  beats: number
  accentEvery?: number
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function scheduleClick(
  audioContext: AudioContext,
  when: number,
  accent: boolean,
): void {
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(accent ? 1560 : 920, when)

  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(accent ? 0.24 : 0.14, when + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08)

  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(when)
  oscillator.stop(when + 0.1)
}

export async function playCountInSequence({
  bpm,
  beats,
  accentEvery = 4,
}: CountInOptions): Promise<void> {
  const AudioContextCtor = getAudioContextConstructor()
  if (beats <= 0 || typeof AudioContextCtor === 'undefined') {
    return
  }

  const audioContext = new AudioContextCtor()
  const beatDurationSec = 60 / bpm
  const startAt = audioContext.currentTime + 0.05

  try {
    for (let beat = 0; beat < beats; beat += 1) {
      scheduleClick(
        audioContext,
        startAt + beat * beatDurationSec,
        beat % accentEvery === 0,
      )
    }

    await wait((beats * beatDurationSec + 0.2) * 1000)
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

export function startMetronomeLoop({
  bpm,
  accentEvery = 4,
}: CountInOptions): MetronomeController {
  const AudioContextCtor = getAudioContextConstructor()
  if (typeof AudioContextCtor === 'undefined') {
    return {
      stop: async () => undefined,
    }
  }

  const audioContext = new AudioContextCtor()
  const beatDurationMs = (60 / bpm) * 1000
  let beat = 0
  let stopped = false
  let timerId = 0

  const tick = (): void => {
    if (stopped) {
      return
    }

    scheduleClick(audioContext, audioContext.currentTime + 0.02, beat % accentEvery === 0)
    beat += 1
    timerId = window.setTimeout(tick, beatDurationMs)
  }

  tick()

  return {
    stop: async () => {
      stopped = true
      window.clearTimeout(timerId)
      await audioContext.close().catch(() => undefined)
    },
  }
}

export function pickSupportedRecordingMimeType(): string | undefined {
  return listSupportedRecordingMimeTypes()[0]
}

export function listSupportedRecordingMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') {
    return []
  }

  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].filter((candidate) => MediaRecorder.isTypeSupported(candidate))
}

function hasContentTypeHeader(headers: UploadHeaders): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
}

export function buildUploadHeaders(
  headers?: UploadHeaders,
  contentType?: string,
): UploadHeaders | undefined {
  const resolvedHeaders: UploadHeaders = { ...(headers ?? {}) }
  if (contentType && !hasContentTypeHeader(resolvedHeaders)) {
    resolvedHeaders['Content-Type'] = contentType
  }

  return Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined
}

export function uploadBlobWithProgress({
  url,
  method,
  blob,
  headers,
  contentType,
  onProgress,
}: UploadBlobOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const resolvedHeaders = buildUploadHeaders(headers, contentType)

    request.open(method, url)
    for (const [key, value] of Object.entries(resolvedHeaders ?? {})) {
      request.setRequestHeader(key, value)
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return
      }

      onProgress(Math.round((event.loaded / event.total) * 100))
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100)
        resolve()
        return
      }

      reject(new Error(`업로드에 실패했습니다. 상태 코드: ${request.status}`))
    }

    request.onerror = () => reject(new Error('업로드 중 네트워크 오류가 발생했습니다.'))
    request.onabort = () => reject(new Error('업로드가 중단되었습니다.'))
    request.send(blob)
  })
}
