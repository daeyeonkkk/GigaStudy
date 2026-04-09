import meterWorkletUrl from './inputLevelMeter.worklet?url'
import { getAudioContextConstructor } from './audioContext'

export type LiveInputMeterController = {
  mode: 'audio-worklet' | 'unsupported'
  stop: () => Promise<void>
}

export type LiveInputMeterReading = {
  peak: number
  rms: number
}

export async function createLiveInputMeter(
  stream: MediaStream,
  onReading: (reading: LiveInputMeterReading) => void,
): Promise<LiveInputMeterController> {
  const AudioContextCtor =
    typeof window === 'undefined' ? undefined : getAudioContextConstructor(window)

  if (
    typeof window === 'undefined' ||
    typeof AudioContextCtor === 'undefined' ||
    typeof AudioWorkletNode === 'undefined'
  ) {
    return {
      mode: 'unsupported',
      stop: async () => undefined,
    }
  }

  const audioContext = new AudioContextCtor()
  const sourceNode = audioContext.createMediaStreamSource(stream)
  const sinkNode = audioContext.createGain()
  sinkNode.gain.value = 0

  try {
    await audioContext.audioWorklet.addModule(meterWorkletUrl)
    const workletNode = new AudioWorkletNode(audioContext, 'gigastudy-input-level-meter')
    workletNode.port.onmessage = (event: MessageEvent<LiveInputMeterReading>) => {
      onReading(event.data)
    }

    sourceNode.connect(workletNode)
    workletNode.connect(sinkNode)
    sinkNode.connect(audioContext.destination)
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    return {
      mode: 'audio-worklet',
      stop: async () => {
        workletNode.port.onmessage = null
        sourceNode.disconnect()
        workletNode.disconnect()
        sinkNode.disconnect()
        await audioContext.close().catch(() => undefined)
      },
    }
  } catch {
    sourceNode.disconnect()
    sinkNode.disconnect()
    await audioContext.close().catch(() => undefined)
    return {
      mode: 'unsupported',
      stop: async () => undefined,
    }
  }
}
