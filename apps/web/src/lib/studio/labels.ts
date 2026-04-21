import type { SourceKind, TrackExtractionJob, TrackSlot } from '../../types/studio'

export const statusLabels: Record<TrackSlot['status'], string> = {
  empty: '공란',
  recording: '녹음 중',
  uploading: '업로드 중',
  extracting: '악보화 중',
  generating: 'AI 생성 중',
  needs_review: '검토 필요',
  registered: '등록 완료',
  failed: '등록 실패',
}

export const sourceLabels: Record<SourceKind, string> = {
  recording: '녹음',
  audio: '음성파일',
  midi: 'MIDI',
  score: '악보',
  music: '음악',
  ai: 'AI 생성',
}

export function getJobStatusLabel(status: TrackExtractionJob['status']): string {
  const labels: Record<TrackExtractionJob['status'], string> = {
    queued: 'Queued',
    running: 'Running',
    needs_review: 'Review ready',
    completed: 'Completed',
    failed: 'Failed',
  }
  return labels[status]
}

export function getTrackSourceLabel(track: TrackSlot): string {
  if (!track.source_kind) {
    return '아직 등록된 소스 없음'
  }
  return `${sourceLabels[track.source_kind]} - ${track.source_label ?? '소스'}`
}
