import { ArrangementScore } from '../../components/ArrangementScore'

type StatusTone = 'error' | 'loading' | 'ready'

type StudioScoreViewPanelProps = {
  guideWavUrl: string | null
  hasSelectedArrangement: boolean
  midiUrl: string | null
  musicXmlUrl: string | null
  renderKey: string | null
  scoreStatusLabel: string
  scoreStatusTone: StatusTone
  playheadRatio: number
}

export function StudioScoreViewPanel({
  guideWavUrl,
  hasSelectedArrangement,
  midiUrl,
  musicXmlUrl,
  playheadRatio,
  renderKey,
  scoreStatusLabel,
  scoreStatusTone,
}: StudioScoreViewPanelProps) {
  return (
    <article className="panel studio-block" data-testid="score-view-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">악보 보기</p>
          <h2>악보</h2>
        </div>
        <span className={`status-pill status-pill--${scoreStatusTone}`}>{scoreStatusLabel}</span>
      </div>

      <p className="panel__summary">
        악보 보기와 미리듣기를 따로 유지하고, 이 표면은 악보 파일 확인과 내려받기에 집중합니다.
      </p>

      <div className="button-row">
        {musicXmlUrl ? (
          <a className="button-primary" href={musicXmlUrl}>
            MusicXML 내려받기
          </a>
        ) : null}

        {midiUrl ? (
          <a className="button-secondary" href={midiUrl}>
            편곡 MIDI 내려받기
          </a>
        ) : null}

        {guideWavUrl ? (
          <a className="button-secondary" href={guideWavUrl}>
            가이드 WAV 내려받기
          </a>
        ) : null}
      </div>

      {hasSelectedArrangement ? (
        <ArrangementScore
          musicXmlUrl={musicXmlUrl}
          playheadRatio={playheadRatio}
          renderKey={renderKey ?? 'studio-score-view'}
        />
      ) : (
        <div className="empty-card">
          <p>선택된 편곡 후보가 없습니다.</p>
          <p>악보와 내려받기 도구를 열기 전에 후보를 생성하거나 선택해 주세요.</p>
        </div>
      )}
    </article>
  )
}
