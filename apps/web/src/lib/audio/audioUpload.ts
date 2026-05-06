export const AUDIO_UPLOAD_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'] as const

const AUDIO_UPLOAD_EXTENSION_SET = new Set<string>(AUDIO_UPLOAD_EXTENSIONS)

type PreparedAudioUpload = {
  filename: string
  blob: Blob
  contentType: string
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

  return {
    filename: file.name,
    blob: file,
    contentType: file.type || contentTypeFromExtension(getFileExtension(file.name)),
  }
}

function contentTypeFromExtension(extension: string): string {
  switch (extension) {
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    case '.ogg':
      return 'audio/ogg'
    case '.flac':
      return 'audio/flac'
    default:
      return 'application/octet-stream'
  }
}
