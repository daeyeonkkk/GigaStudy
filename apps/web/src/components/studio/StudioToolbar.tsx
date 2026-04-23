import { Link } from 'react-router-dom'

import type { PlaybackSourceMode } from '../../lib/studio'

type ActionState =
  | { phase: 'idle' }
  | { phase: 'busy'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type StudioToolbarProps = {
  actionState: ActionState
  globalPlaying: boolean
  metronomeEnabled: boolean
  playbackSource: PlaybackSourceMode
  registeredTrackCount: number
  studioTitle: string
  onExportPdf: () => void
  onMetronomeChange: (enabled: boolean) => void
  onPlaybackSourceChange: (source: PlaybackSourceMode) => void
  onStopGlobalPlayback: () => void
  onToggleGlobalPlayback: () => void
}

export function StudioToolbar({
  actionState,
  globalPlaying,
  metronomeEnabled,
  playbackSource,
  registeredTrackCount,
  studioTitle,
  onExportPdf,
  onMetronomeChange,
  onPlaybackSourceChange,
  onStopGlobalPlayback,
  onToggleGlobalPlayback,
}: StudioToolbarProps) {
  return (
    <>
      <header className="composer-titlebar">
        <Link className="composer-app-mark" to="/" aria-label="홈으로">
          GS
        </Link>
        <span>GigaStudy - {studioTitle}</span>
        <div className="composer-window-buttons" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </header>

      <nav className="composer-menubar" aria-label="스튜디오 메뉴">
        <span>File</span>
        <span>Track</span>
        <span>Play</span>
        <span>Score</span>
        <span>Tools</span>
        <span>Help</span>
      </nav>

      <div className="composer-toolbar" aria-label="전체 트랙 재생 제어">
        <Link className="composer-tool composer-tool--home" to="/" aria-label="홈으로">
          <span aria-hidden="true">H</span>
          <span>Home</span>
        </Link>
        <button
          aria-label={globalPlaying ? '전체 일시정지' : '전체 재생'}
          className="composer-tool composer-tool--primary"
          data-testid="global-play-button"
          type="button"
          onClick={onToggleGlobalPlayback}
        >
          <span aria-hidden="true">{globalPlaying ? 'II' : '▶'}</span>
        </button>
        <button
          aria-label="전체 중지"
          className="composer-tool"
          data-testid="global-stop-button"
          type="button"
          onClick={onStopGlobalPlayback}
        >
          <span aria-hidden="true">■</span>
        </button>
        <button className="composer-tool" type="button" aria-label="확대">
          <span aria-hidden="true">+</span>
        </button>
        <button className="composer-tool" type="button" aria-label="축소">
          <span aria-hidden="true">-</span>
        </button>
        <label className="composer-metronome">
          <input
            checked={metronomeEnabled}
            type="checkbox"
            onChange={(event) => onMetronomeChange(event.target.checked)}
          />
          <span aria-hidden="true">♪</span>
          메트로놈
        </label>
        <div className="composer-source-toggle" role="group" aria-label="재생 소스">
          <button
            aria-pressed={playbackSource === 'audio'}
            className={playbackSource === 'audio' ? 'is-active' : ''}
            data-testid="playback-source-audio"
            type="button"
            onClick={() => onPlaybackSourceChange('audio')}
          >
            녹음
          </button>
          <button
            aria-pressed={playbackSource === 'score'}
            className={playbackSource === 'score' ? 'is-active' : ''}
            data-testid="playback-source-score"
            type="button"
            onClick={() => onPlaybackSourceChange('score')}
          >
            악보
          </button>
        </div>
        <button
          className="composer-tool composer-tool--text"
          data-testid="export-pdf-button"
          disabled={registeredTrackCount === 0 || actionState.phase === 'busy'}
          type="button"
          onClick={onExportPdf}
        >
          PDF
        </button>
      </div>

      <section className="studio-status-line" aria-live="polite">
        <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
        <p>
          {actionState.phase === 'idle'
            ? '트랙을 녹음, 업로드, AI 생성으로 채운 뒤 0.01s 단위로 맞춰보세요.'
            : actionState.message}
        </p>
      </section>
    </>
  )
}
