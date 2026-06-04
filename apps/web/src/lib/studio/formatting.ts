import type { ReportIssue, ScoringReport, TrackSlot } from '../../types/studio'
import { formatTrackName } from './labels'

export function safeDownloadName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
  return normalized || 'gigastudy-session'
}

export function formatSeconds(seconds: number): string {
  const sign = seconds > 0 ? '+' : ''
  const centisecond = Math.round(seconds * 100) / 100
  const precision = Math.abs(seconds - centisecond) < 0.0005 ? 2 : 3
  return `${sign}${seconds.toFixed(precision)}초`
}

export function formatDurationSeconds(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(2)}초`
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
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}초`
}

export function formatNullableSemitones(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}반음`
}

export function getIssueLabel(issue: ReportIssue): string {
  const labels: Record<ReportIssue['issue_type'], string> = {
    pitch: '음정',
    rhythm: '박자',
    pitch_rhythm: '음정 + 박자',
    missing: '누락',
    extra: '추가 입력',
    harmony: '화음',
    chord_fit: '코드 적합도',
    range: '음역',
    spacing: '간격',
    voice_leading: '성부 진행',
    crossing: '성부 교차',
    parallel_motion: '병행 진행',
    tension_resolution: '긴장 해결',
    bass_foundation: '베이스 기반',
    chord_coverage: '코드 커버리지',
  }
  return labels[issue.issue_type]
}

export function describeReferences(report: ScoringReport, tracks: TrackSlot[]): string {
  const referenceNames = report.reference_slot_ids
    .map((slotId) => {
      const track = tracks.find((item) => item.slot_id === slotId)
      return track ? formatTrackName(track.name) : null
    })
    .filter(Boolean)

  if (report.include_metronome) {
    referenceNames.push('메트로놈')
  }

  return referenceNames.length > 0 ? referenceNames.join(', ') : '기준 없음'
}
