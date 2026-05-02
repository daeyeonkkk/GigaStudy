import { AUDIO_UPLOAD_EXTENSIONS, isAudioUploadFile } from '../audio/audioUpload'

type UploadKind = 'audio' | 'midi' | 'document'

const DOCUMENT_UPLOAD_EXTENSIONS = [
  '.musicxml',
  '.mxl',
  '.xml',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
] as const

export const TRACK_UPLOAD_ACCEPT = [
  ...AUDIO_UPLOAD_EXTENSIONS,
  '.mid',
  '.midi',
  ...DOCUMENT_UPLOAD_EXTENSIONS,
].join(',')

export function detectUploadKind(file: File): UploadKind | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.mid') || name.endsWith('.midi')) {
    return 'midi'
  }
  if (DOCUMENT_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return 'document'
  }
  if (isAudioUploadFile(file)) {
    return 'audio'
  }
  return null
}

export function isDocumentImageUpload(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp') ||
    name.endsWith('.bmp') ||
    name.endsWith('.tif') ||
    name.endsWith('.tiff')
  )
}
