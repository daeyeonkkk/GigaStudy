import { Link } from 'react-router-dom'

import { describeReferences, formatDate } from '../../lib/studio'
import type { ScoringReport, TrackSlot } from '../../types/studio'
import './ReportFeed.css'

type ReportFeedProps = {
  reports: ScoringReport[]
  studioId: string
  tracks: TrackSlot[]
}

function reportTitle(report: ScoringReport): string {
  return `${report.target_track_name} ${report.score_mode === 'harmony' ? '화음 채점' : '정답 채점'}`
}

export function ReportFeed({ reports, studioId, tracks }: ReportFeedProps) {
  return (
    <section className="report-feed" data-testid="report-feed" aria-label="채점 리포트">
      <div className="report-feed__header">
        <p className="eyebrow">Report feed</p>
        <h2>채점 리포트</h2>
      </div>

      {reports.length === 0 ? (
        <div className="report-empty">
          <strong>아직 리포트가 없습니다.</strong>
          <p>트랙에서 채점을 시작하면 제목과 시간이 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div className="report-list">
          {[...reports].reverse().map((report) => (
            <article className="report-card" key={report.report_id}>
              <header>
                <div>
                  <span>{formatDate(report.created_at)}</span>
                  <h3>{reportTitle(report)}</h3>
                </div>
                <p>{describeReferences(report, tracks)}</p>
              </header>
              <Link
                className="report-card__open"
                data-testid={`report-open-${report.report_id}`}
                to={`/studios/${studioId}/reports/${report.report_id}`}
              >
                리포트 열기
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
