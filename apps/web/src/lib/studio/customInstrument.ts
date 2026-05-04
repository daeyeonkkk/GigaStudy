import { getPlaybackInstrument } from '../api'
import type { SamplePlaybackInstrument } from './instruments'

let cachedInstrument:
  | {
      cacheKey: string
      instrument: SamplePlaybackInstrument
    }
  | null = null

export async function loadCustomGuideInstrument(
  context: AudioContext,
): Promise<SamplePlaybackInstrument | null> {
  const config = await getPlaybackInstrument()
  if (!config.has_custom_file || !config.audio_url || !config.filename) {
    cachedInstrument = null
    return null
  }

  const cacheKey = `${config.filename}:${config.root_midi}:${config.updated_at ?? ''}`
  if (cachedInstrument?.cacheKey === cacheKey) {
    return cachedInstrument.instrument
  }

  const response = await fetch(config.audio_url)
  if (!response.ok) {
    return null
  }
  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
  const instrument: SamplePlaybackInstrument = {
    audioBuffer,
    id: 'custom-guide-sample',
    kind: 'sample',
    label: config.filename,
    rootFrequency: midiToFrequency(config.root_midi),
  }
  cachedInstrument = { cacheKey, instrument }
  return instrument
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}
