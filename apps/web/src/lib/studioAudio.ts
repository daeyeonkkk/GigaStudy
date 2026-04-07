export type MetronomeController = {
  stop: () => Promise<void>
}

type UploadBlobOptions = {
  url: string
  method: string
  blob: Blob
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
  if (beats <= 0 || typeof window.AudioContext === 'undefined') {
    return
  }

  const audioContext = new AudioContext()
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
  if (typeof window.AudioContext === 'undefined') {
    return {
      stop: async () => undefined,
    }
  }

  const audioContext = new AudioContext()
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
  if (typeof MediaRecorder === 'undefined') {
    return undefined
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

export function uploadBlobWithProgress({
  url,
  method,
  blob,
  contentType,
  onProgress,
}: UploadBlobOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.open(method, url)
    if (contentType) {
      request.setRequestHeader('Content-Type', contentType)
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

      reject(new Error(`Upload failed with status ${request.status}`))
    }

    request.onerror = () => reject(new Error('Network error while uploading audio.'))
    request.onabort = () => reject(new Error('Audio upload was aborted.'))
    request.send(blob)
  })
}
