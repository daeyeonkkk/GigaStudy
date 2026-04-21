import { getBrowserAudioContextConstructor } from './audioContext'
import { encodeAudioChunksToWavDataUrl } from './wavEncoding'

export type MicrophoneRecorder = {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  stream: MediaStream
  chunks: Float32Array[]
  sampleRate: number
  startedAt: number
  rmsLevel: number
  peakLevel: number
}

export function getRecordingLevelPercent(level: number): number {
  return Math.round(Math.max(0, Math.min(1, level * 12)) * 100)
}

export async function startMicrophoneRecorder(): Promise<MicrophoneRecorder | null> {
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
    const chunks: Float32Array[] = []
    const recorder: MicrophoneRecorder = {
      context,
      source,
      processor,
      stream,
      chunks,
      sampleRate: context.sampleRate,
      startedAt: performance.now(),
      rmsLevel: 0,
      peakLevel: 0,
    }

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(input))

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

    return recorder
  } catch {
    return null
  }
}

export async function stopMicrophoneRecorder(recorder: MicrophoneRecorder | null): Promise<string | null> {
  if (!recorder) {
    return null
  }

  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  if (recorder.context.state !== 'closed') {
    await recorder.context.close().catch(() => undefined)
  }

  if (recorder.chunks.length === 0) {
    return null
  }

  return encodeAudioChunksToWavDataUrl(recorder.chunks, recorder.sampleRate)
}
