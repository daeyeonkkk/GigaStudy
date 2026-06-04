import { AUDIO_UPLOAD_EXTENSIONS, isAudioUploadFile } from '../audio/audioUpload'

export type TrackRecordingUploadKind = 'audio'

export const TRACK_RECORDING_UPLOAD_ACCEPT = AUDIO_UPLOAD_EXTENSIONS.join(',')

export function detectTrackRecordingUploadKind(file: File): TrackRecordingUploadKind | null {
  if (isAudioUploadFile(file)) {
    return 'audio'
  }
  return null
}
