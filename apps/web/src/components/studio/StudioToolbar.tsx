import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { PlaybackSourceMode } from '../../lib/studio'
import type { TrackSlot } from '../../types/studio'

type ActionState =
  | { phase: 'idle' }
  | { phase: 'busy'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type StudioToolbarProps = {
  actionState: ActionState
  globalPlaying: boolean
  metronomeEnabled: boolean
  playbackPickerOpen: boolean
  playbackRange: { maxSeconds: number; minSeconds: number } | null
  playbackSource: PlaybackSourceMode
  playheadSeconds: number | null
  registeredTrackCount: number
  registeredTracks: TrackSlot[]
  selectedPlaybackSlotIds: Set<number>
  studioTitle: string
  syncStepSeconds: number
  onMetronomeChange: (enabled: boolean) => void
  onPlaybackSourceChange: (source: PlaybackSourceMode) => void
  onSeekPlayback: (seconds: number) => void
  onSelectAllPlaybackTracks: () => void
  onStartSelectedPlayback: () => void
  onStopGlobalPlayback: () => void
  onShiftAllSync: (deltaSeconds: number) => void
  onSyncStepChange: (seconds: number) => void
  onTogglePlaybackPicker: () => void
  onTogglePlaybackSelection: (slotId: number) => void
  onToggleGlobalPlayback: () => void
}

function formatClockSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds - minutes * 60
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`
}

function formatStepInput(seconds: number): string {
  return Number(seconds.toFixed(3)).toString()
}

export function StudioToolbar({
  actionState,
  globalPlaying,
  metronomeEnabled,
  playbackPickerOpen,
  playbackRange,
  playbackSource,
  playheadSeconds,
  registeredTrackCount,
  registeredTracks,
  selectedPlaybackSlotIds,
  studioTitle,
  syncStepSeconds,
  onMetronomeChange,
  onPlaybackSourceChange,
  onSeekPlayback,
  onSelectAllPlaybackTracks,
  onStartSelectedPlayback,
  onStopGlobalPlayback,
  onShiftAllSync,
  onSyncStepChange,
  onTogglePlaybackPicker,
  onTogglePlaybackSelection,
  onToggleGlobalPlayback,
}: StudioToolbarProps) {
  const [syncStepInput, setSyncStepInput] = useState(() => formatStepInput(syncStepSeconds))
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null)

  useEffect(() => {
    setSyncStepInput(formatStepInput(syncStepSeconds))
  }, [syncStepSeconds])

  useEffect(() => {
    if (!globalPlaying) {
      setSeekDraftSeconds(null)
    }
  }, [globalPlaying])

  const selectedTrackCount = registeredTracks.filter((track) =>
    selectedPlaybackSlotIds.has(track.slot_id),
  ).length
  const seekValue = playbackRange
    ? Math.max(
        playbackRange.minSeconds,
        Math.min(
          playbackRange.maxSeconds,
          seekDraftSeconds ?? playheadSeconds ?? playbackRange.minSeconds,
        ),
      )
    : 0

  function updateSyncStep(rawValue: string) {
    setSyncStepInput(rawValue)
    const parsedValue = Number.parseFloat(rawValue)
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      onSyncStepChange(Math.min(10, Math.max(0.001, parsedValue)))
    }
  }

  function restoreSyncStepInput() {
    const parsedValue = Number.parseFloat(syncStepInput)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setSyncStepInput(formatStepInput(syncStepSeconds))
    }
  }

  function commitSeek(nextSeconds = seekDraftSeconds) {
    if (!playbackRange || nextSeconds === null) {
      return
    }
    const committedSeconds = Math.max(
      playbackRange.minSeconds,
      Math.min(playbackRange.maxSeconds, nextSeconds),
    )
    setSeekDraftSeconds(null)
    onSeekPlayback(committedSeconds)
  }

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
        <span>Practice</span>
        <span>Tools</span>
        <span>Help</span>
      </nav>

      <div className="composer-toolbar" aria-label="전체 트랙 재생 제어">
        <Link className="composer-tool composer-tool--home" to="/" aria-label="홈으로">
          <span aria-hidden="true">H</span>
          <span>Home</span>
        </Link>
        <button
          aria-label={globalPlaying ? '선택 재생 일시정지' : '트랙 선택 재생'}
          className="composer-tool composer-tool--primary"
          data-testid="global-play-button"
          type="button"
          onClick={globalPlaying ? onToggleGlobalPlayback : onTogglePlaybackPicker}
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
        <label className="composer-sync-step">
          <span>Sync</span>
          <input
            aria-label="싱크 조정 단위"
            data-testid="sync-step-input"
            inputMode="decimal"
            max="10"
            min="0.001"
            step="0.001"
            type="number"
            value={syncStepInput}
            onBlur={restoreSyncStepInput}
            onChange={(event) => updateSyncStep(event.target.value)}
          />
          <span>s</span>
        </label>
        <div className="composer-sync-all" role="group" aria-label="등록된 전체 트랙 싱크 이동">
          <button
            aria-label={`등록된 전체 트랙을 ${formatStepInput(syncStepSeconds)}초 앞으로 이동`}
            className="composer-tool composer-tool--text composer-tool--sync-all"
            data-testid="sync-all-earlier-button"
            disabled={registeredTrackCount === 0 || actionState.phase === 'busy'}
            type="button"
            onClick={() => onShiftAllSync(-syncStepSeconds)}
          >
            전체 -
          </button>
          <button
            aria-label={`등록된 전체 트랙을 ${formatStepInput(syncStepSeconds)}초 뒤로 이동`}
            className="composer-tool composer-tool--text composer-tool--sync-all"
            data-testid="sync-all-later-button"
            disabled={registeredTrackCount === 0 || actionState.phase === 'busy'}
            type="button"
            onClick={() => onShiftAllSync(syncStepSeconds)}
          >
            전체 +
          </button>
        </div>
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
            노트
          </button>
        </div>
      </div>

      {(playbackPickerOpen || globalPlaying) && (
        <section className="composer-playback-panel" data-testid="selected-playback-panel">
          <div className="composer-track-picker" aria-label="동시 재생 트랙 선택">
            {registeredTracks.length === 0 ? (
              <p>등록된 트랙 없음</p>
            ) : (
              registeredTracks.map((track) => (
                <label key={track.slot_id}>
                  <input
                    checked={selectedPlaybackSlotIds.has(track.slot_id)}
                    data-testid={`playback-track-checkbox-${track.slot_id}`}
                    type="checkbox"
                    onChange={() => onTogglePlaybackSelection(track.slot_id)}
                  />
                  <span>{track.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="composer-playback-actions">
            <button
              className="composer-mini-button"
              disabled={registeredTracks.length === 0}
              type="button"
              onClick={onSelectAllPlaybackTracks}
            >
              전체 선택
            </button>
            <button
              className="composer-mini-button composer-mini-button--primary"
              data-testid="selected-play-button"
              disabled={selectedTrackCount === 0 || actionState.phase === 'busy'}
              type="button"
              onClick={onStartSelectedPlayback}
            >
              {globalPlaying ? '처음부터' : '선택 재생'}
            </button>
          </div>
          {playbackRange ? (
            <label className="composer-seek">
              <span>{formatClockSeconds(seekValue)}</span>
              <input
                aria-label="선택 재생 위치"
                data-testid="selected-playback-seek"
                disabled={!globalPlaying}
                max={playbackRange.maxSeconds}
                min={playbackRange.minSeconds}
                step="0.01"
                type="range"
                value={seekValue}
                onChange={(event) => setSeekDraftSeconds(Number(event.target.value))}
                onKeyUp={(event) => {
                  if (
                    event.key === 'ArrowLeft' ||
                    event.key === 'ArrowRight' ||
                    event.key === 'Home' ||
                    event.key === 'End' ||
                    event.key === 'PageUp' ||
                    event.key === 'PageDown' ||
                    event.key === 'Enter'
                  ) {
                    commitSeek(Number(event.currentTarget.value))
                  }
                }}
                onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
              />
              <span>{formatClockSeconds(playbackRange.maxSeconds)}</span>
            </label>
          ) : null}
        </section>
      )}

      <section className="studio-status-line" aria-live="polite">
        <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
        <p>
          {actionState.phase === 'idle'
            ? `트랙을 녹음, 업로드, AI 생성으로 채운 뒤 ${formatStepInput(syncStepSeconds)}s 단위로 맞춰보세요.`
            : actionState.message}
        </p>
      </section>
    </>
  )
}
