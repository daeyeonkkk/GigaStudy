import { getPlaybackInstrument } from '../api'
import type { PlaybackInstrumentConfig } from '../../types/studio'
import type { SamplePlaybackInstrument } from './instruments'

const PLAYBACK_INSTRUMENT_CONFIG_TTL_MS = 60_000

let cachedInstrument:
  | {
      cacheKey: string
      instrument: SamplePlaybackInstrument
    }
  | null = null
let cachedConfig:
  | {
      config: PlaybackInstrumentConfig
      loadedAtMs: number
    }
  | null = null

export async function loadCustomGuideInstrument(
  context: AudioContext,
): Promise<SamplePlaybackInstrument | null> {
  const config = await loadPlaybackInstrumentConfig()
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

export function clearCustomGuideInstrumentCache(): void {
  cachedConfig = null
  cachedInstrument = null
}

async function loadPlaybackInstrumentConfig(): Promise<PlaybackInstrumentConfig> {
  const now = performance.now()
  if (cachedConfig && now - cachedConfig.loadedAtMs < PLAYBACK_INSTRUMENT_CONFIG_TTL_MS) {
    return cachedConfig.config
  }
  const config = await getPlaybackInstrument()
  cachedConfig = { config, loadedAtMs: now }
  return config
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}
