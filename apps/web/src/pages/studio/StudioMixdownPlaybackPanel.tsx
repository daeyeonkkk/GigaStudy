import { ManagedAudioPlayer } from '../../components/ManagedAudioPlayer'
import { WaveformPreview } from '../../components/WaveformPreview'
import type { AudioPreviewData } from '../../lib/audioPreview'

type StatusTone = 'error' | 'loading' | 'ready'

type StudioMixdownPlaybackPanelProps = {
  durationLabel: string
  includedTracksLabel: string
  playbackSummaryLabel: string
  playbackUrl: string | null
  previewSource: AudioPreviewData | null
  sampleRateLabel: string
  sourceLabel: string
  statusLabel: string
  statusTone: StatusTone
  updatedAtLabel: string
}

export function StudioMixdownPlaybackPanel({
  durationLabel,
  includedTracksLabel,
  playbackSummaryLabel,
  playbackUrl,
  previewSource,
  sampleRateLabel,
  sourceLabel,
  statusLabel,
  statusTone,
  updatedAtLabel,
}: StudioMixdownPlaybackPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">믹스다운 플레이어</p>
          <h2>저장</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <details className="studio-mobile-fold studio-mobile-fold--secondary">
        <summary className="studio-mobile-fold__summary">
          <span>저장 요약</span>
          <strong>{playbackSummaryLabel}</strong>
        </summary>
        <div className="studio-mobile-fold__body">
          <div className="mini-grid">
            <div className="mini-card">
              <span>재생 출처</span>
              <strong>{sourceLabel}</strong>
            </div>
            <div className="mini-card">
              <span>길이</span>
              <strong>{durationLabel}</strong>
            </div>
            <div className="mini-card">
              <span>샘플레이트</span>
              <strong>{sampleRateLabel}</strong>
            </div>
            <div className="mini-card">
              <span>업데이트</span>
              <strong>{updatedAtLabel}</strong>
            </div>
          </div>

          {playbackUrl ? (
            <div className="support-stack">
              <div className="mini-card mini-card--stack">
                <span>포함된 트랙</span>
                <strong>{includedTracksLabel}</strong>
              </div>

              <div className="audio-preview">
                <p className="json-label">믹스다운 재생</p>
                <ManagedAudioPlayer muted={false} src={playbackUrl} volume={1} />
              </div>

              {previewSource ? <WaveformPreview preview={previewSource} /> : null}
            </div>
          ) : (
            <div className="empty-card">
              <p>아직 믹스다운 미리보기가 준비되지 않았습니다.</p>
              <p>현재 가이드와 선택한 테이크를 렌더링하면 미리보기와 저장 흐름이 열립니다.</p>
            </div>
          )}
        </div>
      </details>
    </article>
  )
}
