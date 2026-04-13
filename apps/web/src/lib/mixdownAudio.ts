import {
  getAudioContextConstructor,
  getOfflineAudioContextConstructor,
} from './audioContext'

export type MixdownSource = {
  gain: number
  label: string
  url: string
}

export type RenderedMixdown = {
  actualSampleRate: number
  blob: Blob
  durationMs: number
  labels: string[]
}

async function decodeAudioFromUrl(url: string): Promise<AudioBuffer> {
  const AudioContextCtor =
    typeof window === 'undefined' ? undefined : getAudioContextConstructor(window)
  if (typeof window === 'undefined' || typeof AudioContextCtor === 'undefined') {
    throw new Error('현재 브라우저에서는 오디오를 해석할 수 없습니다.')
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`오디오를 불러오지 못했습니다. 상태 코드: ${response.status}`)
  }

  const encodedAudio = await response.arrayBuffer()
  const audioContext = new AudioContextCtor()

  try {
    return await audioContext.decodeAudioData(encodedAudio.slice(0))
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const channelCount = audioBuffer.numberOfChannels
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const byteRate = audioBuffer.sampleRate * blockAlign
  const dataSize = audioBuffer.length * blockAlign
  const output = new ArrayBuffer(44 + dataSize)
  const view = new DataView(output)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, audioBuffer.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = audioBuffer.getChannelData(channel)[frame] ?? 0
      const clampedSample = Math.max(-1, Math.min(1, sample))
      const pcmValue =
        clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff
      view.setInt16(offset, Math.round(pcmValue), true)
      offset += bytesPerSample
    }
  }

  return new Blob([output], { type: 'audio/wav' })
}

export async function renderOfflineMixdown(
  sources: MixdownSource[],
): Promise<RenderedMixdown> {
  const AudioContextCtor =
    typeof window === 'undefined' ? undefined : getAudioContextConstructor(window)
  const OfflineAudioContextCtor =
    typeof window === 'undefined' ? undefined : getOfflineAudioContextConstructor(window)
  if (
    typeof window === 'undefined' ||
    typeof AudioContextCtor === 'undefined' ||
    typeof OfflineAudioContextCtor === 'undefined'
  ) {
    throw new Error('현재 브라우저에서는 오프라인 믹스다운 렌더링을 사용할 수 없습니다.')
  }

  const audibleSources = sources.filter((source) => source.gain > 0)
  if (audibleSources.length === 0) {
    throw new Error('믹스다운에 사용할 수 있는 가이드나 테이크 오디오가 없습니다.')
  }

  const decodedSources = await Promise.all(
    audibleSources.map(async (source) => ({
      ...source,
      buffer: await decodeAudioFromUrl(source.url),
    })),
  )

  const channelCount = Math.max(
    1,
    Math.min(2, ...decodedSources.map((source) => source.buffer.numberOfChannels)),
  )
  const sampleRate = Math.max(...decodedSources.map((source) => source.buffer.sampleRate))
  const durationSec = Math.max(...decodedSources.map((source) => source.buffer.duration), 0.25)
  const frameCount = Math.max(1, Math.ceil(durationSec * sampleRate))
  const offlineContext = new OfflineAudioContextCtor(channelCount, frameCount, sampleRate)

  for (const source of decodedSources) {
    const sourceNode = offlineContext.createBufferSource()
    const gainNode = offlineContext.createGain()

    sourceNode.buffer = source.buffer
    gainNode.gain.value = source.gain
    sourceNode.connect(gainNode)
    gainNode.connect(offlineContext.destination)
    sourceNode.start(0)
  }

  const renderedBuffer = await offlineContext.startRendering()
  return {
    actualSampleRate: renderedBuffer.sampleRate,
    blob: encodeAudioBufferToWav(renderedBuffer),
    durationMs: Math.round(renderedBuffer.duration * 1000),
    labels: decodedSources.map((source) => source.label),
  }
}
