import { formatTrackName } from '../../lib/studio'
import type { ScoreMode, TrackSlot } from '../../types/studio'
import './ScoringDrawer.css'

export type ScoreCountInState = {
  pulsesRemaining: number
  totalPulses: number
}

export type ScoreSessionState = {
  targetSlotId: number
  scoreMode: ScoreMode
  selectedReferenceIds: number[]
  playbackReferenceIds: number[]
  includeMetronome: boolean
  phase: 'ready' | 'counting_in' | 'listening' | 'analyzing'
  countIn?: ScoreCountInState | null
}

type ScoringDrawerProps = {
  busy: boolean
  scoreSession: ScoreSessionState | null
  targetTrack: TrackSlot | null
  tracks: TrackSlot[]
  onCancel: () => void
  onIncludeMetronomeChange: (includeMetronome: boolean) => void
  onScoreModeChange: (scoreMode: ScoreMode) => void
  onStart: () => void
  onStop: () => void
  onToggleReference: (slotId: number) => void
  onToggleReferencePlayback: (slotId: number) => void
}

export function ScoringDrawer({
  busy,
  scoreSession,
  targetTrack,
  tracks,
  onCancel,
  onIncludeMetronomeChange,
  onScoreModeChange,
  onStart,
  onStop,
  onToggleReference,
  onToggleReferencePlayback,
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
  const selectedReferenceCount = scoreSession.selectedReferenceIds.length
  const playbackReferenceCount = scoreSession.playbackReferenceIds.filter((slotId) =>
    scoreSession.selectedReferenceIds.includes(slotId),
  ).length
  const modeSummary = isHarmonyMode
    ? `화음 채점. ${selectedReferenceCount}개 기준 트랙을 기준으로 내 파트의 안정감과 충돌을 평가하고, ${playbackReferenceCount}개 트랙을 들려줍니다.`
    : `정답 채점. ${formatTrackName(targetTrack.name)} 음표를 답안지로 삼고, ${selectedReferenceCount}개 기준 트랙은 채점 맥락으로만 사용하며 ${playbackReferenceCount}개 트랙을 들려줍니다.`
  const phaseLocked = scoreSession.phase !== 'ready'

  return (
    <section className="score-drawer" aria-label="채점 체크리스트">
      <div className="score-drawer__panel">
        <header>
          <div>
            <p className="eyebrow">채점 체크리스트</p>
            <h2>{formatTrackName(targetTrack.name)} 채점</h2>
          </div>
          <button
            aria-label="채점 체크리스트 닫기"
            className="studio-icon-button"
            disabled={scoreSession.phase === 'analyzing'}
            type="button"
            onClick={onCancel}
          >
            <span aria-hidden="true">x</span>
          </button>
        </header>

        <div className="score-mode-switch" role="group" aria-label="채점 모드">
          <button
            className={scoreSession.scoreMode === 'answer' ? 'is-active' : ''}
            disabled={!canUseAnswerMode || phaseLocked || busy}
            type="button"
            onClick={() => onScoreModeChange('answer')}
          >
            <strong>정답 채점</strong>
            <span>내 트랙 음표와 얼마나 맞는지</span>
          </button>
          <button
            className={isHarmonyMode ? 'is-active' : ''}
            disabled={!canUseHarmonyMode || phaseLocked || busy}
            type="button"
            onClick={() => onScoreModeChange('harmony')}
          >
            <strong>화음 채점</strong>
            <span>선택한 트랙들과 어울리는 내 파트인지</span>
          </button>
        </div>

        <div className={`score-drawer__mode-summary ${isHarmonyMode ? 'is-harmony' : 'is-answer'}`}>
          <strong>{isHarmonyMode ? '화음 기준' : '정답 기준'}</strong>
          <span>{modeSummary}</span>
          <em>{scoreSession.includeMetronome ? '메트로놈 포함' : '메트로놈 제외'}</em>
        </div>

        <div className="score-checklist" aria-label="기준 트랙과 연주 여부">
          <div className="score-checklist__heading" aria-hidden="true">
            <span>트랙</span>
            <span>기준</span>
            <span>연주</span>
          </div>
          {tracks.map((track) => {
            const isTarget = track.slot_id === scoreSession.targetSlotId
            const disabled = track.status !== 'registered' || isTarget
            const isReference = scoreSession.selectedReferenceIds.includes(track.slot_id)
            const isAudible = isReference && scoreSession.playbackReferenceIds.includes(track.slot_id)
            return (
              <div
                className={`score-checklist__row ${disabled ? 'is-disabled' : ''}`}
                key={track.slot_id}
              >
                <div className="score-checklist__track">
                  <span>트랙 {track.slot_id}</span>
                  <strong>{formatTrackName(track.name)}</strong>
                </div>
                <label>
                  <input
                    checked={isReference}
                    disabled={disabled || phaseLocked || busy}
                    type="checkbox"
                    onChange={() => onToggleReference(track.slot_id)}
                  />
                  <span>기준</span>
                </label>
                <label>
                  <input
                    checked={isAudible}
                    disabled={disabled || !isReference || phaseLocked || busy}
                    type="checkbox"
                    onChange={() => onToggleReferencePlayback(track.slot_id)}
                  />
                  <span>연주</span>
                </label>
              </div>
            )
          })}
          <label className={`score-checklist__metronome ${isHarmonyMode ? 'is-optional' : ''}`}>
            <input
              checked={scoreSession.includeMetronome}
              disabled={phaseLocked || busy}
              type="checkbox"
              onChange={(event) => onIncludeMetronomeChange(event.target.checked)}
            />
            <span>{isHarmonyMode ? '보조 연주' : '박자 기준'}</span>
            <strong>메트로놈</strong>
          </label>
        </div>

        <div className="score-drawer__actions">
          <button
            className="app-button"
            data-testid="score-start-button"
            disabled={scoreSession.phase !== 'ready' || busy}
            type="button"
            onClick={onStart}
          >
            시작
          </button>
          <button
            className="app-button app-button--record"
            data-testid="score-stop-button"
            disabled={scoreSession.phase !== 'counting_in' && scoreSession.phase !== 'listening'}
            type="button"
            onClick={onStop}
          >
            {scoreSession.phase === 'counting_in' ? '취소' : '중지'}
          </button>
          <button
            className="app-button app-button--secondary"
            disabled={scoreSession.phase === 'analyzing'}
            type="button"
            onClick={onCancel}
          >
            닫기
          </button>
        </div>

        {scoreSession.countIn ? (
          <div className="score-drawer__count-in" data-testid="score-count-in">
            <span>1마디 준비</span>
            <strong>{scoreSession.countIn.pulsesRemaining}</strong>
            <em>{scoreSession.includeMetronome ? '메트로놈 카운트' : '무음 카운트'}</em>
          </div>
        ) : null}

        <p className="score-drawer__hint">
          {scoreSession.phase === 'counting_in'
            ? '카운트인이 끝나는 다운비트부터 기준 트랙 재생과 마이크 입력이 동시에 시작됩니다.'
            : scoreSession.phase === 'listening'
              ? '연주로 선택한 트랙만 스피커로 재생합니다. 기준 체크는 채점 계산에 그대로 사용됩니다.'
              : isHarmonyMode
                ? '화음 채점은 정답 음표 없이, 기준 트랙 위에 내 파트가 안정적으로 얹히는지 평가합니다.'
                : '정답 채점은 내 트랙 음표를 답안지로 삼고, 기준 트랙과 메트로놈은 평가 맥락과 연습 재생을 보조합니다.'}
        </p>
      </div>
    </section>
  )
}
