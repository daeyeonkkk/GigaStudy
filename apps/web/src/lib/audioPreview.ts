import { getAudioContextConstructor } from './audioContext'
import { buildPitchContour, buildWaveform, toMonoSamples } from './audioPreviewMath'

export type AudioPreviewData = {
  waveform: number[]
  contour: Array<number | null>
  durationMs: number | null
  source: 'local' | 'remote'
  pipeline?: 'main-thread-fallback' | 'server-artifact' | 'worker-js-fallback' | 'worker-wasm' | null
}

type AudioPreviewWorkerResponse =
  | {
      contour: Array<number | null>
      pipeline: 'worker-js-fallback' | 'worker-wasm'
      waveform: number[]
    }
  | {
      error: string
    }

async function decodeAudioBuffer(encoded: ArrayBuffer): Promise<AudioBuffer> {
  const AudioContextCtor = getAudioContextConstructor()
  if (typeof AudioContextCtor === 'undefined') {
    throw new Error('현재 브라우저에서는 오디오 미리보기를 해석할 수 없습니다.')
  }

  const audioContext = new AudioContextCtor()

  try {
    return await audioContext.decodeAudioData(encoded.slice(0))
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

async function buildPreviewInWorker(
  samples: Float32Array,
  sampleRate: number,
): Promise<Pick<AudioPreviewData, 'contour' | 'pipeline' | 'waveform'>> {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker를 사용할 수 없습니다.')
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audioPreview.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<AudioPreviewWorkerResponse>) => {
      worker.terminate()
      if ('error' in event.data) {
        reject(new Error(event.data.error))
        return
      }

      resolve(event.data)
    }

    worker.onerror = () => {
      worker.terminate()
      reject(new Error('워커에서 미리보기를 만들지 못했습니다.'))
    }

    worker.postMessage(
      {
        bins: 96,
        points: 64,
        sampleRate,
        samples,
      },
      [samples.buffer],
    )
  })
}

function toPreviewData(audioBuffer: AudioBuffer, source: 'local' | 'remote'): AudioPreviewData {
  const mono = toMonoSamples(audioBuffer)

  return {
    waveform: buildWaveform(mono),
    contour: buildPitchContour(mono, audioBuffer.sampleRate),
    durationMs: Math.round(audioBuffer.duration * 1000),
    source,
    pipeline: 'main-thread-fallback',
  }
}

async function toPreviewDataWithWorker(
  audioBuffer: AudioBuffer,
  source: 'local' | 'remote',
): Promise<AudioPreviewData> {
  const mono = toMonoSamples(audioBuffer)
  const workerPreview = await buildPreviewInWorker(mono, audioBuffer.sampleRate)

  return {
    ...workerPreview,
    durationMs: Math.round(audioBuffer.duration * 1000),
    source,
  }
}

export async function buildAudioPreviewFromBlob(blob: Blob): Promise<AudioPreviewData> {
  const encoded = await blob.arrayBuffer()
  const audioBuffer = await decodeAudioBuffer(encoded)

  try {
    return await toPreviewDataWithWorker(audioBuffer, 'local')
  } catch {
    return toPreviewData(audioBuffer, 'local')
  }
}

export async function buildAudioPreviewFromUrl(url: string): Promise<AudioPreviewData> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`오디오 미리보기를 불러오지 못했습니다. 상태 코드: ${response.status}`)
  }

  const encoded = await response.arrayBuffer()
  const audioBuffer = await decodeAudioBuffer(encoded)

  try {
    return await toPreviewDataWithWorker(audioBuffer, 'remote')
  } catch {
    return toPreviewData(audioBuffer, 'remote')
  }
}
