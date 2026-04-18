import { Link } from 'react-router-dom'

type StudioTopbarProps = {
  arrangementRoute: string | null
  baseKey: string | null
  canLaunchShareFlow: boolean
  chordMarkerCount: number
  consoleAlignmentLabel: string
  consoleChordLabel: string
  consoleMicLabel: string
  consoleMicTone: 'ready' | 'error' | 'loading'
  countInBeats: number
  onOpenArrangementWorkbench: () => void
  onOpenProjectSettingsDrawer: () => void
  onOpenShareModal: () => void
  projectIdentityLabel: string
  projectTitle: string
  transportBpm: number
}

export function StudioTopbar({
  arrangementRoute,
  baseKey,
  canLaunchShareFlow,
  chordMarkerCount,
  consoleAlignmentLabel,
  consoleChordLabel,
  consoleMicLabel,
  consoleMicTone,
  countInBeats,
  onOpenArrangementWorkbench,
  onOpenProjectSettingsDrawer,
  onOpenShareModal,
  projectIdentityLabel,
  projectTitle,
  transportBpm,
}: StudioTopbarProps) {
  return (
    <div className="studio-wave-editor__topbar">
      <div className="studio-wave-editor__title">
        <p className="studio-wave-editor__subtitle">{projectIdentityLabel}</p>
        <h1>{projectTitle}</h1>
      </div>

      <div className="studio-wave-editor__status">
        <span className="studio-wave-editor__status-chip">
          <small>템포</small>
          <strong>{transportBpm} BPM</strong>
        </span>
        <span className="studio-wave-editor__status-chip">
          <small>키</small>
          <strong>{baseKey ?? '미정'}</strong>
        </span>
        <span className="studio-wave-editor__status-chip">
          <small>코드 타임라인</small>
          <strong>{chordMarkerCount > 0 ? `${chordMarkerCount}개` : consoleChordLabel}</strong>
        </span>
        <span className="studio-wave-editor__status-chip">
          <small>카운트인</small>
          <strong>{countInBeats}박</strong>
        </span>
        <span className={`studio-wave-editor__status-chip studio-wave-editor__status-chip--${consoleMicTone}`}>
          <small>마이크</small>
          <strong>{consoleMicLabel}</strong>
        </span>
        <span className="studio-wave-editor__status-chip">
          <small>정렬</small>
          <strong>{consoleAlignmentLabel}</strong>
        </span>
      </div>

      <div className="studio-wave-editor__utilities">
        <button
          className="button-secondary button-secondary--small"
          type="button"
          onClick={onOpenProjectSettingsDrawer}
        >
          프로젝트 설정
        </button>
        <button
          className="button-secondary button-secondary--small"
          type="button"
          disabled={!canLaunchShareFlow}
          onClick={onOpenShareModal}
        >
          공유
        </button>
        {arrangementRoute ? (
          <Link className="button-primary button-primary--small studio-wave-editor__utility-link" to={arrangementRoute}>
            편곡실
          </Link>
        ) : (
          <button
            className="button-primary button-primary--small"
            type="button"
            onClick={onOpenArrangementWorkbench}
          >
            편곡실
          </button>
        )}
      </div>
    </div>
  )
}
