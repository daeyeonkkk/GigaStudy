/// <reference lib="webworker" />

import { buildPitchContour, buildWaveform } from './audioPreviewMath'
import { getPcmMathWasmRuntime } from './pcmMathWasm'

type AudioPreviewWorkerRequest = {
  bins: number
  points: number
  sampleRate: number
  samples: Float32Array
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

const workerScope = self as DedicatedWorkerGlobalScope
const wasmRuntimePromise = getPcmMathWasmRuntime()

workerScope.onmessage = async (event: MessageEvent<AudioPreviewWorkerRequest>) => {
  const { bins, points, sampleRate, samples } = event.data

  try {
    const wasmRuntime = await wasmRuntimePromise
    workerScope.postMessage({
      waveform: buildWaveform(samples, bins, wasmRuntime?.abs ?? Math.abs),
      contour: buildPitchContour(samples, sampleRate, points),
      pipeline: wasmRuntime ? 'worker-wasm' : 'worker-js-fallback',
    } satisfies AudioPreviewWorkerResponse)
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : '워커에서 미리보기를 만들지 못했습니다.',
    } satisfies AudioPreviewWorkerResponse)
  }
}

export {}
