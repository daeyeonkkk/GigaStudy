import type { ScoreMode, TrackSlot } from '../../types/studio'

export type ScoreSessionState = {
  targetSlotId: number
  scoreMode: ScoreMode
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
  onScoreModeChange: (scoreMode: ScoreMode) => void
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
  onScoreModeChange,
  onStart,
  onStop,
  onToggleReference,
}: ScoringDrawerProps) {
  if (!scoreSession || !targetTrack) {
    return null
  }

  const registeredReferenceCount = tracks.filter(
    (track) => track.status === 'registered' && track.slot_id !== scoreSession.targetSlotId,
  ).length
  const canUseAnswerMode = targetTrack.status === 'registered'
  const canUseHarmonyMode = registeredReferenceCount > 0
  const isHarmonyMode = scoreSession.scoreMode === 'harmony'

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

        <div className="score-mode-switch" role="group" aria-label="채점 모드">
          <button
            className={scoreSession.scoreMode === 'answer' ? 'is-active' : ''}
            disabled={!canUseAnswerMode || scoreSession.phase !== 'ready'}
            type="button"
            onClick={() => onScoreModeChange('answer')}
          >
            <strong>정답 채점</strong>
            <span>이 트랙 악보대로 불렀는지</span>
          </button>
          <button
            className={isHarmonyMode ? 'is-active' : ''}
            disabled={!canUseHarmonyMode || scoreSession.phase !== 'ready'}
            type="button"
            onClick={() => onScoreModeChange('harmony')}
          >
            <strong>화음 채점</strong>
            <span>선택한 트랙들과 어울리는 새 파트인지</span>
          </button>
        </div>

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
          <label className={isHarmonyMode ? 'is-optional' : ''}>
            <input
              checked={scoreSession.includeMetronome}
              type="checkbox"
              onChange={(event) => onIncludeMetronomeChange(event.target.checked)}
            />
            <span>{isHarmonyMode ? '보조' : '기준'}</span>
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
            : isHarmonyMode
              ? '화음 채점은 정답 악보 없이, 새로 부른 파트가 선택한 트랙 위에서 얼마나 안정적으로 어울리는지 평가합니다.'
              : '정답 채점은 이 트랙 악보를 답안지로 삼아 박자와 음정 정확도를 평가합니다.'}
        </p>
      </div>
    </section>
  )
}
