import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getStudio } from '../lib/api'
import {
  describeReferences,
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
  return `${report.target_track_name} ${report.score_mode === 'harmony' ? '화음 채점' : '정답 채점'}`
}

function buildMetricCards(report: ScoringReport): MetricCard[] {
  if (report.score_mode === 'harmony') {
    return [
      { label: 'Harmony', value: formatNullableScore(report.harmony_score) },
      { label: 'Chord', value: formatNullableScore(report.chord_fit_score) },
      { label: 'Rhythm', value: formatScore(report.rhythm_score) },
      { label: 'Spacing', value: formatNullableScore(report.spacing_score) },
      { label: 'Range', value: formatNullableScore(report.range_score) },
      { label: 'Voice lead', value: formatNullableScore(report.voice_leading_score) },
      { label: 'Arrangement', value: formatNullableScore(report.arrangement_score) },
      { label: 'Auto Sync', value: formatSeconds(report.alignment_offset_seconds) },
      { label: 'Events', value: String(report.performance_event_count) },
    ]
  }

  return [
    { label: 'Pitch', value: formatScore(report.pitch_score) },
    { label: 'Rhythm', value: formatScore(report.rhythm_score) },
    { label: 'Auto Sync', value: formatSeconds(report.alignment_offset_seconds) },
    { label: 'Matched', value: `${report.matched_event_count}/${report.answer_event_count}` },
    { label: 'Missing', value: String(report.missing_event_count) },
    { label: 'Extra', value: String(report.extra_event_count) },
  ]
}

function getIssueDetail(issue: ReportIssue): string {
  const coordinate = getIssueCoordinate(issue)
  if (
    issue.message &&
    [
      'harmony',
      'chord_fit',
      'range',
      'spacing',
      'voice_leading',
      'crossing',
      'parallel_motion',
      'tension_resolution',
      'bass_foundation',
      'chord_coverage',
    ].includes(issue.issue_type)
  ) {
    return coordinate ? `${issue.message} / ${coordinate}` : issue.message
  }

  const expected = issue.answer_label ?? '-'
  const actual = issue.performance_label ?? '-'
  const detail = `expected ${expected} / actual ${actual} / time ${formatNullableSeconds(
    issue.timing_error_seconds,
  )} / pitch ${formatNullableSemitones(issue.pitch_error_semitones)}`
  return coordinate ? `${detail} / ${coordinate}` : detail
}

function getIssueCoordinate(issue: ReportIssue): string {
  const expectedBeat = issue.expected_beat !== null ? `expected beat ${issue.expected_beat}` : null
  const actualBeat = issue.actual_beat !== null ? `actual beat ${issue.actual_beat}` : null
  const eventId = issue.answer_event_id ?? issue.performance_event_id
  const eventText = eventId ? `event ${eventId}` : null
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
        eyebrow="Report error"
        title="리포트를 찾을 수 없습니다"
        body="스튜디오 주소가 올바르지 않습니다."
        to="/"
        buttonLabel="홈으로"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return <ReportRouteState eyebrow="Report loading" title="리포트를 불러오는 중입니다" />
  }

  if (loadState.phase === 'error' || !studio || !report) {
    return (
      <ReportRouteState
        eyebrow="Report error"
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
            <p className="eyebrow">Scoring report</p>
            <h1>{reportTitle(report)}</h1>
          </div>
          <Link className="app-button app-button--secondary" to={`/studios/${studio.studio_id}`}>
            스튜디오
          </Link>
        </header>

        <section className="report-hero">
          <div>
            <span>{formatDateTime(report.created_at)}</span>
            <h2>{report.target_track_name}</h2>
            <p>{describeReferences(report, studio.tracks as TrackSlot[])}</p>
            {report.score_mode === 'harmony' && report.harmony_summary ? (
              <p>{report.harmony_summary}</p>
            ) : null}
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
            <p className="eyebrow">Issue timeline</p>
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
                          Open in piano roll
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
