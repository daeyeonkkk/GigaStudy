import { getAudioContextConstructor } from './audioContext'

export type AudioPreviewData = {
  waveform: number[]
  contour: Array<number | null>
  durationMs: number | null
  source: 'local' | 'remote'
}

function toMonoSamples(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer
  const mono = new Float32Array(length)

  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      mono[index] += channelData[index] / numberOfChannels
    }
  }

  return mono
}

function buildWaveform(samples: Float32Array, bins = 96): number[] {
  const result: number[] = []
  const windowSize = Math.max(1, Math.floor(samples.length / bins))

  for (let bin = 0; bin < bins; bin += 1) {
    const start = bin * windowSize
    const end = Math.min(samples.length, start + windowSize)
    let peak = 0

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]))
    }

    result.push(peak)
  }

  return result
}

function estimateWindowPitch(
  samples: Float32Array,
  sampleRate: number,
  start: number,
  end: number,
): number | null {
  let crossings = 0
  let rmsAccumulator = 0

  for (let index = start; index < end; index += 1) {
    const value = samples[index]
    rmsAccumulator += value * value

    if (index > start) {
      const previous = samples[index - 1]
      if ((previous <= 0 && value > 0) || (previous >= 0 && value < 0)) {
        crossings += 1
      }
    }
  }

  const sampleCount = end - start
  if (sampleCount <= 0) {
    return null
  }

  const rms = Math.sqrt(rmsAccumulator / sampleCount)
  if (rms < 0.01) {
    return null
  }

  const estimatedFrequency = (crossings * sampleRate) / (2 * sampleCount)
  if (estimatedFrequency < 60 || estimatedFrequency > 1200) {
    return null
  }

  return estimatedFrequency
}

function buildPitchContour(
  samples: Float32Array,
  sampleRate: number,
  points = 64,
): Array<number | null> {
  const result: Array<number | null> = []
  const windowSize = Math.max(2048, Math.floor(samples.length / points))

  for (let point = 0; point < points; point += 1) {
    const start = point * windowSize
    const end = Math.min(samples.length, start + windowSize)
    result.push(estimateWindowPitch(samples, sampleRate, start, end))
  }

  return result
}

async function decodeAudioBuffer(encoded: ArrayBuffer): Promise<AudioBuffer> {
  const AudioContextCtor = getAudioContextConstructor()
  if (typeof AudioContextCtor === 'undefined') {
    throw new Error('Audio preview decoding is not available in this browser.')
  }

  const audioContext = new AudioContextCtor()

  try {
    return await audioContext.decodeAudioData(encoded.slice(0))
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

function toPreviewData(audioBuffer: AudioBuffer, source: 'local' | 'remote'): AudioPreviewData {
  const mono = toMonoSamples(audioBuffer)

  return {
    waveform: buildWaveform(mono),
    contour: buildPitchContour(mono, audioBuffer.sampleRate),
    durationMs: Math.round(audioBuffer.duration * 1000),
    source,
  }
}

export async function buildAudioPreviewFromBlob(blob: Blob): Promise<AudioPreviewData> {
  const encoded = await blob.arrayBuffer()
  const audioBuffer = await decodeAudioBuffer(encoded)
  return toPreviewData(audioBuffer, 'local')
}

export async function buildAudioPreviewFromUrl(url: string): Promise<AudioPreviewData> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Audio preview fetch failed with status ${response.status}`)
  }

  const encoded = await response.arrayBuffer()
  const audioBuffer = await decodeAudioBuffer(encoded)
  return toPreviewData(audioBuffer, 'remote')
}
