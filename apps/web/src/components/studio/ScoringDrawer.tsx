import type { TrackSlot } from '../../types/studio'

export type ScoreSessionState = {
  targetSlotId: number
  selectedReferenceIds: number[]
  includeMetronome: boolean
  phase: 'ready' | 'listening' | 'analyzing'
}

type ScoringDrawerProps = {
  scoreSession: ScoreSessionState | null
  targetTrack: TrackSlot | null
  tracks: TrackSlot[]
  onCancel: () => void
  onIncludeMetronomeChange: (includeMetronome: boolean) => void
  onStart: () => void
  onStop: () => void
  onToggleReference: (slotId: number) => void
}

export function ScoringDrawer({
  scoreSession,
  targetTrack,
  tracks,
  onCancel,
  onIncludeMetronomeChange,
  onStart,
  onStop,
  onToggleReference,
}: ScoringDrawerProps) {
  if (!scoreSession || !targetTrack) {
    return null
  }

  return (
    <section className="score-drawer" aria-label="채점 체크리스트">
      <div className="score-drawer__panel">
        <header>
          <div>
            <p className="eyebrow">Scoring checklist</p>
            <h2>{targetTrack.name} 채점</h2>
          </div>
          <button
            aria-label="채점 체크리스트 닫기"
            className="studio-icon-button"
            type="button"
            onClick={onCancel}
          >
            <span aria-hidden="true">x</span>
          </button>
        </header>

        <div className="score-checklist">
          {tracks.map((track) => (
            <label className={track.status === 'registered' ? '' : 'is-disabled'} key={track.slot_id}>
              <input
                checked={scoreSession.selectedReferenceIds.includes(track.slot_id)}
                disabled={track.status !== 'registered' || track.slot_id === scoreSession.targetSlotId}
                type="checkbox"
                onChange={() => onToggleReference(track.slot_id)}
              />
              <span>트랙 {track.slot_id}</span>
              <strong>{track.name}</strong>
            </label>
          ))}
          <label>
            <input
              checked={scoreSession.includeMetronome}
              type="checkbox"
              onChange={(event) => onIncludeMetronomeChange(event.target.checked)}
            />
            <span>기준</span>
            <strong>메트로놈</strong>
          </label>
        </div>

        <div className="score-drawer__actions">
          <button
            className="app-button"
            data-testid="score-start-button"
            disabled={scoreSession.phase !== 'ready'}
            type="button"
            onClick={onStart}
          >
            시작
          </button>
          <button
            className="app-button app-button--record"
            data-testid="score-stop-button"
            disabled={scoreSession.phase === 'analyzing'}
            type="button"
            onClick={onStop}
          >
            중지
          </button>
          <button className="app-button app-button--secondary" type="button" onClick={onCancel}>
            취소
          </button>
        </div>

        <p className="score-drawer__hint">
          {scoreSession.phase === 'listening'
            ? '선택한 트랙이 동시에 재생되고 마이크 입력을 받고 있습니다.'
            : '체크한 트랙과 메트로놈을 기준으로 0.01s 단위 리포트를 생성합니다.'}
        </p>
      </div>
    </section>
  )
}
