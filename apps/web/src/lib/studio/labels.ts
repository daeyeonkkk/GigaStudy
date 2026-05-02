import type { SourceKind, TrackExtractionJob, TrackSlot } from '../../types/studio'

export const statusLabels: Record<TrackSlot['status'], string> = {
  empty: '비어 있음',
  recording: '녹음 중',
  uploading: '업로드 중',
  extracting: '분석 중',
  generating: 'AI 생성 중',
  needs_review: '검토 필요',
  registered: '등록 완료',
  failed: '등록 실패',
}

export const sourceLabels: Record<SourceKind, string> = {
  recording: '녹음',
  audio: '오디오 파일',
  midi: 'MIDI',
  document: '문서',
  music: '음악 파일',
  ai: 'AI 생성',
}

const trackNameLabels: Record<string, string> = {
  Alto: '알토',
  Baritone: '바리톤',
  Bass: '베이스',
  Percussion: '퍼커션',
  Soprano: '소프라노',
  Tenor: '테너',
}

export function getJobStatusLabel(status: TrackExtractionJob['status']): string {
  const labels: Record<TrackExtractionJob['status'], string> = {
    queued: '대기 중',
    running: '처리 중',
    needs_review: '검토 가능',
    completed: '완료',
    failed: '실패',
  }
  return labels[status]
}

export function formatTrackName(name: string | null | undefined): string {
  if (!name) {
    return '트랙'
  }
  const genericTrackMatch = /^Track\s+(\d+)$/i.exec(name.trim())
  if (genericTrackMatch) {
    return `트랙 ${genericTrackMatch[1]}`
  }
  return trackNameLabels[name] ?? name
}

export function getTrackSourceLabel(track: TrackSlot): string {
  if (!track.source_kind) {
    return '아직 등록된 소스 없음'
  }
  return `${sourceLabels[track.source_kind]} - ${track.source_label ?? '소스'}`
}
