import { fetchAudioArrayBuffer } from './playback'

const MAX_AUDIO_BUFFER_CACHE_ITEMS = 12
const MAX_AUDIO_BUFFER_CACHE_BYTES = 256 * 1024 * 1024

type CachedAudioBuffer = {
  audioBuffer: AudioBuffer
  byteSize: number
  lastUsedAt: number
}

const audioBufferCache = new Map<string, CachedAudioBuffer>()

export function getEstimatedAudioBufferBytes(audioBuffer: AudioBuffer): number {
  return Math.ceil(audioBuffer.duration * audioBuffer.sampleRate * audioBuffer.numberOfChannels * 4)
}

export async function getCachedDecodedAudioBuffer(
  context: AudioContext,
  cacheKey: string,
  audioUrl: string,
  fetchArrayBuffer: (audioUrl: string) => Promise<ArrayBuffer> = fetchAudioArrayBuffer,
): Promise<AudioBuffer> {
  const cached = audioBufferCache.get(cacheKey)
  if (cached) {
    cached.lastUsedAt = performance.now()
    return cached.audioBuffer
  }

  const arrayBuffer = await fetchArrayBuffer(audioUrl)
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
  audioBufferCache.set(cacheKey, {
    audioBuffer,
    byteSize: getEstimatedAudioBufferBytes(audioBuffer),
    lastUsedAt: performance.now(),
  })
  pruneAudioBufferCache()
  return audioBuffer
}

export function clearAudioBufferCache(): void {
  audioBufferCache.clear()
}

export function getAudioBufferCacheSize(): number {
  return audioBufferCache.size
}

function pruneAudioBufferCache() {
  let totalBytes = 0
  for (const cached of audioBufferCache.values()) {
    totalBytes += cached.byteSize
  }

  while (
    audioBufferCache.size > MAX_AUDIO_BUFFER_CACHE_ITEMS ||
    totalBytes > MAX_AUDIO_BUFFER_CACHE_BYTES
  ) {
    const oldest = [...audioBufferCache.entries()].sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    )[0]
    if (!oldest) {
      return
    }
    audioBufferCache.delete(oldest[0])
    totalBytes -= oldest[1].byteSize
  }
}
