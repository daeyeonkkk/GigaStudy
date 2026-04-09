export type AbsValueFunction = (value: number) => number

export function toMonoSamples(audioBuffer: AudioBuffer): Float32Array {
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

export function buildWaveform(
  samples: Float32Array,
  bins = 96,
  absValue: AbsValueFunction = Math.abs,
): number[] {
  const result: number[] = []
  const windowSize = Math.max(1, Math.floor(samples.length / bins))

  for (let bin = 0; bin < bins; bin += 1) {
    const start = bin * windowSize
    const end = Math.min(samples.length, start + windowSize)
    let peak = 0

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, absValue(samples[index] ?? 0))
    }

    result.push(peak)
  }

  return result
}

export function estimateWindowPitch(
  samples: Float32Array,
  sampleRate: number,
  start: number,
  end: number,
): number | null {
  let crossings = 0
  let rmsAccumulator = 0

  for (let index = start; index < end; index += 1) {
    const value = samples[index] ?? 0
    rmsAccumulator += value * value

    if (index > start) {
      const previous = samples[index - 1] ?? 0
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

export function buildPitchContour(
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
