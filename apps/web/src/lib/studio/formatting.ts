import type { ReportIssue, ScoringReport, TrackSlot } from '../../types/studio'

export function safeDownloadName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
  return normalized || 'gigastudy-score'
}

export function formatSeconds(seconds: number): string {
  const sign = seconds > 0 ? '+' : ''
  const centisecond = Math.round(seconds * 100) / 100
  const precision = Math.abs(seconds - centisecond) < 0.0005 ? 2 : 3
  return `${sign}${seconds.toFixed(precision)}s`
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
  const labels: Record<ReportIssue['issue_type'], string> = {
    pitch: 'Pitch',
    rhythm: 'Rhythm',
    pitch_rhythm: 'Pitch + Rhythm',
    missing: 'Missing',
    extra: 'Extra',
    harmony: 'Harmony',
    chord_fit: 'Chord fit',
    range: 'Range',
    spacing: 'Spacing',
    voice_leading: 'Voice leading',
    crossing: 'Voice crossing',
    parallel_motion: 'Parallel motion',
    tension_resolution: 'Tension resolution',
    bass_foundation: 'Bass foundation',
    chord_coverage: 'Chord coverage',
  }
  return labels[issue.issue_type]
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
