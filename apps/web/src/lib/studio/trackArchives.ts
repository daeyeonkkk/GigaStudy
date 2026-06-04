import type { TrackMaterialArchiveSummary } from '../../types/studio'
import { formatSourceLabel } from './labels'

export function getTrackArchiveDisplayLabel(archive: TrackMaterialArchiveSummary): string {
  if (archive.label?.trim()) {
    return archive.label.trim()
  }
  if (archive.reason === 'original_recording') {
    return '원본 녹음'
  }
  if (archive.reason === 'tuned_recording') {
    return '보정본'
  }
  if (archive.reason === 'previous_active') {
    return '이전 사용본'
  }
  if (archive.reason === 'original_score' || archive.pinned) {
    return '원본 악보'
  }
  if (archive.source_kind === 'recording' || archive.source_kind === 'audio') {
    return '이전 녹음'
  }
  if (archive.source_kind === 'ai') {
    return '이전 생성'
  }
  if (archive.source_kind === 'midi' || archive.source_kind === 'document') {
    return '이전 악보'
  }
  return '이전 보관본'
}

export function describeTrackArchiveSource(archive: TrackMaterialArchiveSummary): string {
  return formatSourceLabel(archive.source_label)
}

export function sortTrackArchivesForDisplay(
  archives: TrackMaterialArchiveSummary[],
): TrackMaterialArchiveSummary[] {
  return archives
    .slice()
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1
      }
      return right.archived_at.localeCompare(left.archived_at)
    })
}
