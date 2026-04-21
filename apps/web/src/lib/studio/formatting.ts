import type { ReportIssue, ScoringReport, TrackSlot } from '../../types/studio'

export function safeDownloadName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
  return normalized || 'gigastudy-score'
}

export function formatSeconds(seconds: number): string {
  const sign = seconds > 0 ? '+' : ''
  return `${sign}${seconds.toFixed(2)}s`
}

export function formatDurationSeconds(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(2)}s`
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

export function formatNullableSeconds(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}s`
}

export function formatNullableSemitones(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} st`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%'
  }
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export function getIssueLabel(issue: ReportIssue): string {
  if (issue.issue_type === 'pitch_rhythm') {
    return 'Pitch + Rhythm'
  }
  return issue.issue_type.charAt(0).toUpperCase() + issue.issue_type.slice(1)
}

export function describeReferences(report: ScoringReport, tracks: TrackSlot[]): string {
  const referenceNames = report.reference_slot_ids
    .map((slotId) => tracks.find((track) => track.slot_id === slotId)?.name)
    .filter(Boolean)

  if (report.include_metronome) {
    referenceNames.push('Metronome')
  }

  return referenceNames.length > 0 ? referenceNames.join(', ') : '기준 없음'
}
