import { getBrowserAudioContextConstructor } from './audioContext'
import { encodeAudioChunksToWavBlob } from './wavEncoding'

type RecorderEncoding = 'media_recorder' | 'wav_fallback'

export type RecordedAudioBlob = {
  blob: Blob
  contentType: string
  encoding: RecorderEncoding
  extension: string
  sizeBytes: number
}

export type MicrophoneRecorder = {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  stream: MediaStream
  wavChunks: Float32Array[]
  mediaChunks: Blob[]
  mediaRecorder: MediaRecorder | null
  mediaType: string
  extension: string
  sampleRate: number
  startedAt: number
  capturing: boolean
  rmsLevel: number
  peakLevel: number
}

const MEDIA_RECORDER_CANDIDATES = [
  { extension: '.webm', mimeType: 'audio/webm;codecs=opus' },
  { extension: '.ogg', mimeType: 'audio/ogg;codecs=opus' },
  { extension: '.mp4', mimeType: 'audio/mp4' },
] as const

export function getRecordingLevelPercent(level: number): number {
  return Math.round(Math.max(0, Math.min(1, level * 12)) * 100)
}

export async function startMicrophoneRecorder(
  options: { captureImmediately?: boolean } = {},
): Promise<MicrophoneRecorder | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return null
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const AudioContextConstructor = getBrowserAudioContextConstructor()
    if (!AudioContextConstructor) {
      stream.getTracks().forEach((track) => track.stop())
      return null
    }

    const context = new AudioContextConstructor()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const wavChunks: Float32Array[] = []
    const mediaChunks: Blob[] = []
    let mediaConfig = getSupportedMediaRecorderConfig()
    let mediaRecorder: MediaRecorder | null = null
    if (mediaConfig) {
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: mediaConfig.mimeType })
      } catch {
        mediaConfig = null
      }
    }
    const recorder: MicrophoneRecorder = {
      context,
      source,
      processor,
      stream,
      wavChunks,
      mediaChunks,
      mediaRecorder,
      mediaType: mediaRecorder?.mimeType || mediaConfig?.mimeType || 'audio/wav',
      extension: mediaConfig?.extension ?? '.wav',
      sampleRate: context.sampleRate,
      startedAt: performance.now(),
      capturing: false,
      rmsLevel: 0,
      peakLevel: 0,
    }

    if (mediaRecorder) {
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          mediaChunks.push(event.data)
        }
      })
    }

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      if (recorder.capturing && recorder.mediaRecorder === null) {
        wavChunks.push(new Float32Array(input))
      }

      let peak = 0
      let squareTotal = 0
      for (let index = 0; index < input.length; index += 1) {
        const absoluteSample = Math.abs(input[index])
        peak = Math.max(peak, absoluteSample)
        squareTotal += input[index] * input[index]
      }
      recorder.peakLevel = peak
      recorder.rmsLevel = Math.sqrt(squareTotal / input.length)
    }

    source.connect(processor)
    processor.connect(context.destination)
    void context.resume().catch(() => undefined)

    if (options.captureImmediately !== false) {
      beginMicrophoneCapture(recorder)
    }

    return recorder
  } catch {
    return null
  }
}

export function beginMicrophoneCapture(recorder: MicrophoneRecorder | null): boolean {
  if (!recorder) {
    return false
  }
  recorder.wavChunks.length = 0
  recorder.mediaChunks.length = 0
  recorder.startedAt = performance.now()
  recorder.capturing = true
  if (recorder.mediaRecorder && recorder.mediaRecorder.state === 'inactive') {
    try {
      recorder.mediaRecorder.start(1000)
    } catch {
      recorder.mediaRecorder = null
      recorder.mediaType = 'audio/wav'
      recorder.extension = '.wav'
    }
  }
  return true
}

async function waitForInitialCapturedChunk(recorder: MicrophoneRecorder, timeoutMs = 300): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (
    recorder.capturing &&
    recorder.mediaRecorder === null &&
    recorder.wavChunks.length === 0 &&
    performance.now() < deadline
  ) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 16)
    })
  }
}

export async function stopMicrophoneRecorder(recorder: MicrophoneRecorder | null): Promise<RecordedAudioBlob | null> {
  if (!recorder) {
    return null
  }

  if (recorder.wavChunks.length === 0 && recorder.mediaChunks.length === 0) {
    await waitForInitialCapturedChunk(recorder)
  }

  recorder.capturing = false
  await stopMediaRecorder(recorder)
  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  if (recorder.context.state !== 'closed') {
    await recorder.context.close().catch(() => undefined)
  }

  if (recorder.mediaChunks.length > 0) {
    const contentType = recorder.mediaType || recorder.mediaChunks[0]?.type || 'audio/webm'
    const blob = new Blob(recorder.mediaChunks, { type: contentType })
    if (blob.size > 0) {
      return {
        blob,
        contentType,
        encoding: 'media_recorder',
        extension: recorder.extension,
        sizeBytes: blob.size,
      }
    }
  }

  if (recorder.wavChunks.length === 0) {
    return null
  }

  const blob = encodeAudioChunksToWavBlob(recorder.wavChunks, recorder.sampleRate)
  return {
    blob,
    contentType: blob.type || 'audio/wav',
    encoding: 'wav_fallback',
    extension: '.wav',
    sizeBytes: blob.size,
  }
}

function getSupportedMediaRecorderConfig(): { extension: string; mimeType: string } | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null
  }
  return MEDIA_RECORDER_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null
}

function stopMediaRecorder(recorder: MicrophoneRecorder): Promise<void> {
  const mediaRecorder = recorder.mediaRecorder
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, 2000)
    mediaRecorder.addEventListener('stop', finish, { once: true })
    try {
      mediaRecorder.stop()
    } catch {
      finish()
    }
  })
}
