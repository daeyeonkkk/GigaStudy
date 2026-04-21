import { readFileAsDataUrl } from './api'

export const AUDIO_UPLOAD_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'] as const

const AUDIO_UPLOAD_EXTENSION_SET = new Set<string>(AUDIO_UPLOAD_EXTENSIONS)
const AUDIO_DECODE_TIMEOUT_MS = 30_000

type BrowserAudioWindow = Window & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

export type PreparedAudioUpload = {
  filename: string
  contentBase64: string
  convertedToWav: boolean
}

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : ''
}

export function isAudioUploadFile(file: File): boolean {
  return AUDIO_UPLOAD_EXTENSION_SET.has(getFileExtension(file.name))
}

export async function prepareAudioFileForUpload(file: File): Promise<PreparedAudioUpload> {
  if (!isAudioUploadFile(file)) {
    throw new Error('지원하지 않는 오디오 파일 형식입니다.')
  }

  if (getFileExtension(file.name) === '.wav') {
    return {
      filename: file.name,
      contentBase64: await readFileAsDataUrl(file),
      convertedToWav: false,
    }
  }

  const AudioContextConstructor = getBrowserAudioContextConstructor()
  if (!AudioContextConstructor) {
    throw new Error('이 브라우저에서는 MP3/M4A/OGG/FLAC 오디오 디코딩을 사용할 수 없습니다.')
  }

  let context: AudioContext | null = null
  try {
    context = new AudioContextConstructor()
    const audioBuffer = await decodeAudioDataWithTimeout(context, await file.arrayBuffer())
    return {
      filename: replaceFileExtension(file.name, '.wav'),
      contentBase64: encodeAudioBufferToWavDataUrl(audioBuffer),
      convertedToWav: true,
    }
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      throw new Error(`${file.name} 파일을 오디오로 디코딩하지 못했습니다. ${error.message}`)
    }
    throw new Error(`${file.name} 파일을 오디오로 디코딩하지 못했습니다.`)
  } finally {
    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined)
    }
  }
}

function getBrowserAudioContextConstructor(): typeof AudioContext | null {
  const browserWindow = window as BrowserAudioWindow
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null
}

function replaceFileExtension(filename: string, extension: string): string {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex < 0) {
    return `${filename}${extension}`
  }
  return `${filename.slice(0, dotIndex)}${extension}`
}

function decodeAudioDataWithTimeout(
  context: AudioContext,
  audioData: ArrayBuffer,
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('오디오 디코딩 시간이 초과되었습니다.'))
    }, AUDIO_DECODE_TIMEOUT_MS)

    context.decodeAudioData(audioData).then(
      (audioBuffer) => {
        window.clearTimeout(timeoutId)
        resolve(audioBuffer)
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error instanceof Error ? error : new Error('오디오 디코딩에 실패했습니다.'))
      },
    )
  })
}

function encodeAudioBufferToWavDataUrl(audioBuffer: AudioBuffer): string {
  const sampleCount = audioBuffer.length
  if (sampleCount === 0) {
    throw new Error('오디오 샘플이 비어 있습니다.')
  }

  const channelCount = Math.max(1, audioBuffer.numberOfChannels)
  const monoSamples = new Float32Array(sampleCount)
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      monoSamples[sampleIndex] += channelData[sampleIndex] / channelCount
    }
  }

  return encodeMonoPcm16WavDataUrl(monoSamples, audioBuffer.sampleRate)
}

function encodeMonoPcm16WavDataUrl(samples: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)
  let offset = 0

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index))
      offset += 1
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + samples.length * bytesPerSample, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, sampleRate * bytesPerSample, true)
  offset += 4
  view.setUint16(offset, bytesPerSample, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, samples.length * bytesPerSample, true)
  offset += 4

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += bytesPerSample
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return `data:audio/wav;base64,${btoa(binary)}`
}
