import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getStudio } from '../lib/api'
import {
  describeReferences,
  formatTrackName,
  formatNullableSeconds,
  formatNullableSemitones,
  formatScore,
  formatSeconds,
  getIssueLabel,
} from '../lib/studio'
import type { ReportIssue, ScoringReport, Studio, TrackSlot } from '../types/studio'
import './ReportPage.css'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

type MetricCard = {
  label: string
  value: string
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatNullableScore(value: number | null): string {
  return value === null ? '-' : formatScore(value)
}

function reportTitle(report: ScoringReport): string {
  return `${formatTrackName(report.target_track_name)} ${report.score_mode === 'harmony' ? '화음 채점' : '정답 채점'}`
}

function buildMetricCards(report: ScoringReport): MetricCard[] {
  if (report.score_mode === 'harmony') {
    return [
      { label: '화음', value: formatNullableScore(report.harmony_score) },
      { label: '코드', value: formatNullableScore(report.chord_fit_score) },
      { label: '박자', value: formatScore(report.rhythm_score) },
      { label: '간격', value: formatNullableScore(report.spacing_score) },
      { label: '음역', value: formatNullableScore(report.range_score) },
      { label: '성부 진행', value: formatNullableScore(report.voice_leading_score) },
      { label: '편곡', value: formatNullableScore(report.arrangement_score) },
      { label: '자동 싱크', value: formatSeconds(report.alignment_offset_seconds) },
      { label: '이벤트', value: String(report.performance_event_count) },
    ]
  }

  return [
    { label: '음정', value: formatScore(report.pitch_score) },
    { label: '박자', value: formatScore(report.rhythm_score) },
    { label: '자동 싱크', value: formatSeconds(report.alignment_offset_seconds) },
    { label: '일치', value: `${report.matched_event_count}/${report.answer_event_count}` },
    { label: '누락', value: String(report.missing_event_count) },
    { label: '추가', value: String(report.extra_event_count) },
  ]
}

function getReportSummary(report: ScoringReport): string {
  if (report.score_mode === 'harmony') {
    return [
      `화음 ${formatNullableScore(report.harmony_score)}`,
      `코드 ${formatNullableScore(report.chord_fit_score)}`,
      `성부 진행 ${formatNullableScore(report.voice_leading_score)}`,
      `기준 이벤트 ${report.performance_event_count}개`,
    ].join(' · ')
  }

  return [
    `음정 ${formatScore(report.pitch_score)}`,
    `박자 ${formatScore(report.rhythm_score)}`,
    `일치 ${report.matched_event_count}/${report.answer_event_count}`,
  ].join(' · ')
}

function getIssueSummary(issue: ReportIssue): string {
  const labels: Partial<Record<ReportIssue['issue_type'], string>> = {
    chord_fit: '현재 음이 기준 화성의 명확한 코드 톤으로 들리지 않습니다.',
    harmony: '현재 음이 기준 화성과 안정적으로 맞지 않습니다.',
    range: '목표 트랙의 권장 음역을 벗어난 음이 있습니다.',
    rhythm: '기준 박자와 실제 입력 타이밍이 어긋났습니다.',
    pitch: '기준 음정과 실제 음정이 다릅니다.',
    pitch_rhythm: '음정과 박자가 함께 어긋났습니다.',
    spacing: '성부 사이 간격이 권장 범위를 벗어났습니다.',
    voice_leading: '성부 진행이 자연스럽지 않은 구간입니다.',
    crossing: '성부 교차가 발생했습니다.',
    parallel_motion: '병행 진행 위험이 있습니다.',
    tension_resolution: '긴장음 해결이 불안정합니다.',
    bass_foundation: '베이스가 화성의 기반을 충분히 받치지 못합니다.',
    chord_coverage: '코드 구성음 커버리지가 부족합니다.',
    missing: '기준 이벤트가 빠졌습니다.',
    extra: '기준에 없는 추가 이벤트가 감지되었습니다.',
  }
  return labels[issue.issue_type] ?? '확인이 필요한 구간입니다.'
}

function getIssueDetail(issue: ReportIssue): string {
  const coordinate = getIssueCoordinate(issue)
  const parts = [
    getIssueSummary(issue),
    issue.answer_label ? `기준 ${issue.answer_label}` : null,
    issue.performance_label ? `실제 ${issue.performance_label}` : null,
    issue.timing_error_seconds !== null ? `시간 오차 ${formatNullableSeconds(issue.timing_error_seconds)}` : null,
    issue.pitch_error_semitones !== null ? `음정 오차 ${formatNullableSemitones(issue.pitch_error_semitones)}` : null,
    coordinate || null,
    issue.correction_hint ? `힌트 ${issue.correction_hint}` : null,
  ].filter(Boolean)
  return parts.join(' / ')
}

function getIssueCoordinate(issue: ReportIssue): string {
  const expectedBeat = issue.expected_beat !== null ? `기준 박 ${issue.expected_beat}` : null
  const actualBeat = issue.actual_beat !== null ? `실제 박 ${issue.actual_beat}` : null
  const eventId = issue.answer_event_id ?? issue.performance_event_id
  const eventText = eventId ? `이벤트 ${eventId}` : null
  return [expectedBeat, actualBeat, eventText].filter(Boolean).join(' / ')
}

function getIssueFocusPath(studioId: string, issue: ReportIssue): string | null {
  if (!issue.answer_region_id) {
    return null
  }
  const params = new URLSearchParams()
  params.set('region', issue.answer_region_id)
  if (issue.answer_event_id) {
    params.set('event', issue.answer_event_id)
  }
  if (issue.expected_beat !== null) {
    params.set('beat', String(issue.expected_beat))
  }
  return `/studios/${studioId}?${params.toString()}`
}

function ReportRouteState({
  eyebrow,
  title,
  body,
  to,
  buttonLabel,
}: {
  eyebrow: string
  title: string
  body?: string
  to?: string
  buttonLabel?: string
}) {
  return (
    <main className="app-shell report-route-state">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
      {to && buttonLabel ? (
        <Link className="app-button" to={to}>
          {buttonLabel}
        </Link>
      ) : null}
    </main>
  )
}

export function ReportPage() {
  const { studioId, reportId } = useParams()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let ignore = false

    if (!studioId) {
      return () => {
        ignore = true
      }
    }

    getStudio(studioId)
      .then((nextStudio) => {
        if (!ignore) {
          setStudio(nextStudio)
          setLoadState({ phase: 'ready' })
        }
      })
      .catch((error) => {
        if (!ignore) {
          setLoadState({
            phase: 'error',
            message: error instanceof Error ? error.message : '리포트를 불러오지 못했습니다.',
          })
        }
      })

    return () => {
      ignore = true
    }
  }, [studioId])

  const report = useMemo(
    () => studio?.reports.find((candidate) => candidate.report_id === reportId) ?? null,
    [reportId, studio],
  )

  if (!studioId) {
    return (
      <ReportRouteState
        eyebrow="리포트 오류"
        title="리포트를 찾을 수 없습니다"
        body="스튜디오 주소가 올바르지 않습니다."
        to="/"
        buttonLabel="홈으로"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return <ReportRouteState eyebrow="리포트 로딩" title="리포트를 불러오는 중입니다" />
  }

  if (loadState.phase === 'error' || !studio || !report) {
    return (
      <ReportRouteState
        eyebrow="리포트 오류"
        title="리포트를 찾을 수 없습니다"
        body={loadState.phase === 'error' ? loadState.message : '존재하지 않는 리포트입니다.'}
        to={studioId ? `/studios/${studioId}` : '/'}
        buttonLabel="스튜디오로"
      />
    )
  }

  const metricCards = buildMetricCards(report)

  return (
    <main className="app-shell report-page" data-testid="report-detail">
      <section className="report-document">
        <header className="report-document__top">
          <Link className="composer-app-mark" to={`/studios/${studio.studio_id}`} aria-label="스튜디오로">
            GS
          </Link>
          <div>
            <p className="eyebrow">채점 리포트</p>
            <h1>{reportTitle(report)}</h1>
          </div>
          <Link className="app-button app-button--secondary" to={`/studios/${studio.studio_id}`}>
            스튜디오
          </Link>
        </header>

        <section className="report-hero">
          <div>
            <span>{formatDateTime(report.created_at)}</span>
            <h2>{formatTrackName(report.target_track_name)}</h2>
            <p>{describeReferences(report, studio.tracks as TrackSlot[])}</p>
            <p>{getReportSummary(report)}</p>
          </div>
          <strong>{formatScore(report.overall_score)}</strong>
        </section>

        <section className="report-metrics" aria-label="리포트 지표">
          {metricCards.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </section>

        <section className="report-issues" data-testid="report-issues">
          <header>
            <p className="eyebrow">오차 타임라인</p>
            <h2>오차 목록</h2>
          </header>

          {report.issues.length === 0 ? (
            <div className="report-issues__empty">
              <strong>표시할 오차가 없습니다.</strong>
              <p>이번 시도는 등록된 기준과 안정적으로 맞았습니다.</p>
            </div>
          ) : (
            <ol>
              {report.issues.map((issue, index) => {
                const focusPath = getIssueFocusPath(studio.studio_id, issue)
                return (
                  <li
                    className={`report-issue report-issue--${issue.issue_type}`}
                    key={`${issue.at_seconds}-${index}`}
                  >
                    <strong>{formatSeconds(issue.at_seconds)}</strong>
                    <div>
                      <span>{getIssueLabel(issue)}</span>
                      <p>{getIssueDetail(issue)}</p>
                      {focusPath ? (
                        <Link className="report-issue__focus" to={focusPath}>
                          피아노 롤에서 보기
                        </Link>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </section>
    </main>
  )
}
