declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort

  constructor(options?: unknown)

  abstract process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void

class InputLevelMeterProcessor extends AudioWorkletProcessor {
  private framesUntilPost = 0

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    void outputs
    void parameters

    const channelData = inputs[0]?.[0]
    if (!channelData || channelData.length === 0) {
      return true
    }

    let peak = 0
    let sumSquares = 0

    for (let index = 0; index < channelData.length; index += 1) {
      const sample = channelData[index] ?? 0
      const absolute = Math.abs(sample)
      peak = Math.max(peak, absolute)
      sumSquares += sample * sample
    }

    this.framesUntilPost -= 1
    if (this.framesUntilPost <= 0) {
      this.port.postMessage({
        peak,
        rms: Math.sqrt(sumSquares / channelData.length),
      })
      this.framesUntilPost = 3
    }

    return true
  }
}

registerProcessor('gigastudy-input-level-meter', InputLevelMeterProcessor)
