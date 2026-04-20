import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getStudio } from '../lib/api'
import type { ReportIssue, ScoringReport, Studio, TrackSlot } from '../types/studio'
import './ReportPage.css'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function formatSeconds(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}s`
}

function formatNullableSeconds(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}s`
}

function formatNullableSemitones(value: number | null): string {
  return value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(2)} st`
}

function getIssueLabel(issue: ReportIssue): string {
  const labels: Record<ReportIssue['issue_type'], string> = {
    pitch: 'Pitch',
    rhythm: 'Rhythm',
    pitch_rhythm: 'Pitch + Rhythm',
    missing: 'Missing',
    extra: 'Extra',
  }
  return labels[issue.issue_type]
}

function describeReferences(report: ScoringReport, tracks: TrackSlot[]): string {
  const referenceNames = report.reference_slot_ids
    .map((slotId) => tracks.find((track) => track.slot_id === slotId)?.name)
    .filter(Boolean)

  if (report.include_metronome) {
    referenceNames.push('Metronome')
  }

  return referenceNames.length > 0 ? referenceNames.join(', ') : '기준 없음'
}

function getIssueDetail(issue: ReportIssue): string {
  const expected = issue.answer_label ?? '-'
  const actual = issue.performance_label ?? '-'
  return `expected ${expected} / actual ${actual} / time ${formatNullableSeconds(
    issue.timing_error_seconds,
  )} / pitch ${formatNullableSemitones(issue.pitch_error_semitones)}`
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
      <main className="app-shell report-route-state">
        <p className="eyebrow">Report error</p>
        <h1>리포트를 열 수 없습니다</h1>
        <p>스튜디오 주소가 올바르지 않습니다.</p>
        <Link className="app-button" to="/">
          홈으로
        </Link>
      </main>
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <main className="app-shell report-route-state">
        <p className="eyebrow">Report loading</p>
        <h1>리포트를 불러오는 중입니다</h1>
      </main>
    )
  }

  if (loadState.phase === 'error' || !studio || !report) {
    return (
      <main className="app-shell report-route-state">
        <p className="eyebrow">Report error</p>
        <h1>리포트를 열 수 없습니다</h1>
        <p>{loadState.phase === 'error' ? loadState.message : '존재하지 않는 리포트입니다.'}</p>
        <Link className="app-button" to={studioId ? `/studios/${studioId}` : '/'}>
          스튜디오로
        </Link>
      </main>
    )
  }

  return (
    <main className="app-shell report-page" data-testid="report-detail">
      <section className="report-document">
        <header className="report-document__top">
          <Link className="composer-app-mark" to={`/studios/${studio.studio_id}`} aria-label="스튜디오로">
            GS
          </Link>
          <div>
            <p className="eyebrow">Scoring report</p>
            <h1>{report.target_track_name} 채점 리포트</h1>
          </div>
          <Link className="app-button app-button--secondary" to={`/studios/${studio.studio_id}`}>
            스튜디오
          </Link>
        </header>

        <section className="report-hero">
          <div>
            <span>{formatDateTime(report.created_at)}</span>
            <h2>{report.target_track_name}</h2>
            <p>{describeReferences(report, studio.tracks)}</p>
          </div>
          <strong>{formatScore(report.overall_score)}</strong>
        </section>

        <section className="report-metrics" aria-label="리포트 지표">
          <div>
            <span>Pitch</span>
            <strong>{formatScore(report.pitch_score)}</strong>
          </div>
          <div>
            <span>Rhythm</span>
            <strong>{formatScore(report.rhythm_score)}</strong>
          </div>
          <div>
            <span>Auto Sync</span>
            <strong>{formatSeconds(report.alignment_offset_seconds)}</strong>
          </div>
          <div>
            <span>Matched</span>
            <strong>
              {report.matched_note_count}/{report.answer_note_count}
            </strong>
          </div>
          <div>
            <span>Missing</span>
            <strong>{report.missing_note_count}</strong>
          </div>
          <div>
            <span>Extra</span>
            <strong>{report.extra_note_count}</strong>
          </div>
        </section>

        <section className="report-issues" data-testid="report-issues">
          <header>
            <p className="eyebrow">Issue timeline</p>
            <h2>오차 목록</h2>
          </header>

          {report.issues.length === 0 ? (
            <div className="report-issues__empty">
              <strong>표시할 오차가 없습니다.</strong>
              <p>이번 시도는 등록된 답안지와 안정적으로 일치했습니다.</p>
            </div>
          ) : (
            <ol>
              {report.issues.map((issue, index) => (
                <li className={`report-issue report-issue--${issue.issue_type}`} key={`${issue.at_seconds}-${index}`}>
                  <strong>{formatSeconds(issue.at_seconds)}</strong>
                  <div>
                    <span>{getIssueLabel(issue)}</span>
                    <p>{getIssueDetail(issue)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  )
}
