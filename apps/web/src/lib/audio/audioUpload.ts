import { readFileAsDataUrl } from '../api'
import { getBrowserAudioContextConstructor } from './audioContext'
import { encodeAudioBufferToWavDataUrl } from './wavEncoding'

export const AUDIO_UPLOAD_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'] as const

const AUDIO_UPLOAD_EXTENSION_SET = new Set<string>(AUDIO_UPLOAD_EXTENSIONS)
const AUDIO_DECODE_TIMEOUT_MS = 30_000

type PreparedAudioUpload = {
  filename: string
  contentBase64: string
  blob: Blob
  contentType: string
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
      blob: file,
      contentType: file.type || 'audio/wav',
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
    const contentBase64 = encodeAudioBufferToWavDataUrl(audioBuffer)
    return {
      filename: replaceFileExtension(file.name, '.wav'),
      contentBase64,
      blob: dataUrlToBlob(contentBase64),
      contentType: 'audio/wav',
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

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2)
  if (!header || !payload) {
    throw new Error('Invalid audio data URL.')
  }
  const mimeMatch = /^data:([^;]+);base64$/.exec(header)
  const contentType = mimeMatch?.[1] || 'application/octet-stream'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType })
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
