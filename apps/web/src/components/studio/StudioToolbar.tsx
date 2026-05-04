import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatTrackName, type PlaybackSourceMode } from '../../lib/studio'
import type { TempoChange, TrackSlot, UpdateStudioTimingRequest } from '../../types/studio'
import { StudioPurposeNav } from './StudioPurposeNav'

type ActionState =
  | { phase: 'idle' }
  | { phase: 'busy'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type StudioToolbarProps = {
  actionState: ActionState
  bpm: number
  globalPlaying: boolean
  metronomeEnabled: boolean
  playbackPickerOpen: boolean
  playbackRange: { maxSeconds: number; minSeconds: number } | null
  playbackSource: PlaybackSourceMode
  playheadSeconds: number | null
  registeredTrackCount: number
  registeredTracks: TrackSlot[]
  selectedPlaybackSlotIds: Set<number>
  studioId: string
  studioTitle: string
  syncStepSeconds: number
  tempoChanges: TempoChange[]
  timingDisabled: boolean
  timingDisabledReason: string | null
  transportDisabled: boolean
  transportDisabledReason: string | null
  onMetronomeChange: (enabled: boolean) => void
  onOpenPlaybackPicker: () => void
  onPlaybackSourceChange: (source: PlaybackSourceMode) => void
  onSeekPlayback: (seconds: number) => void
  onSelectAllPlaybackTracks: () => void
  onStartSelectedPlayback: () => void
  onStopGlobalPlayback: () => void
  onShiftAllSync: (deltaSeconds: number) => void
  onSyncStepChange: (seconds: number) => void
  onTimingChange: (payload: UpdateStudioTimingRequest) => void
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

function parseBpmInput(rawValue: string): number | null {
  const parsedValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue < 40 || parsedValue > 240) {
    return null
  }
  return parsedValue
}

function parseMeasureInput(rawValue: string): number | null {
  const parsedValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue < 2 || parsedValue > 10000) {
    return null
  }
  return parsedValue
}

function nextTempoMeasure(tempoChanges: TempoChange[]): number {
  return Math.max(2, 1 + Math.max(1, ...tempoChanges.map((change) => change.measure_index)))
}

function sortedTempoChanges(tempoChanges: TempoChange[]): TempoChange[] {
  return tempoChanges.slice().sort((left, right) => left.measure_index - right.measure_index)
}

export function StudioToolbar({
  actionState,
  bpm,
  globalPlaying,
  metronomeEnabled,
  playbackPickerOpen,
  playbackRange,
  playbackSource,
  playheadSeconds,
  registeredTrackCount,
  registeredTracks,
  selectedPlaybackSlotIds,
  studioId,
  studioTitle,
  syncStepSeconds,
  tempoChanges,
  timingDisabled,
  timingDisabledReason,
  transportDisabled,
  transportDisabledReason,
  onMetronomeChange,
  onOpenPlaybackPicker,
  onPlaybackSourceChange,
  onSeekPlayback,
  onSelectAllPlaybackTracks,
  onStartSelectedPlayback,
  onStopGlobalPlayback,
  onShiftAllSync,
  onSyncStepChange,
  onTimingChange,
  onTogglePlaybackSelection,
  onToggleGlobalPlayback,
}: StudioToolbarProps) {
  const [bpmInput, setBpmInput] = useState(() => String(bpm))
  const [syncStepInput, setSyncStepInput] = useState(() => formatStepInput(syncStepSeconds))
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null)
  const [tempoEditorOpen, setTempoEditorOpen] = useState(false)
  const [newTempoMeasureInput, setNewTempoMeasureInput] = useState(() => String(nextTempoMeasure(tempoChanges)))
  const [newTempoBpmInput, setNewTempoBpmInput] = useState(() => String(bpm))

  useEffect(() => {
    setBpmInput(String(bpm))
    setNewTempoBpmInput(String(bpm))
  }, [bpm])

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
  const actionBusy = actionState.phase === 'busy'
  const editControlsDisabled = actionBusy || transportDisabled || globalPlaying
  const timingControlsDisabled = actionBusy || timingDisabled || globalPlaying
  const orderedTempoChanges = sortedTempoChanges(tempoChanges)

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

  function commitBaseBpm(rawValue = bpmInput) {
    const nextBpm = parseBpmInput(rawValue)
    if (nextBpm === null) {
      setBpmInput(String(bpm))
      return
    }
    setBpmInput(String(nextBpm))
    if (nextBpm !== bpm) {
      onTimingChange({ bpm: nextBpm })
    }
  }

  function openTempoEditor() {
    setTempoEditorOpen((current) => !current)
    setNewTempoMeasureInput(String(nextTempoMeasure(tempoChanges)))
    setNewTempoBpmInput(String(bpm))
  }

  function addTempoChange() {
    const measureIndex = parseMeasureInput(newTempoMeasureInput)
    const nextBpm = parseBpmInput(newTempoBpmInput)
    if (measureIndex === null || nextBpm === null) {
      return
    }
    const nextChanges = sortedTempoChanges([
      ...tempoChanges.filter((change) => change.measure_index !== measureIndex),
      { measure_index: measureIndex, bpm: nextBpm },
    ])
    onTimingChange({ tempo_changes: nextChanges })
    setNewTempoMeasureInput(String(nextTempoMeasure(nextChanges)))
    setNewTempoBpmInput(String(nextBpm))
  }

  function deleteTempoChange(measureIndex: number) {
    onTimingChange({
      tempo_changes: tempoChanges.filter((change) => change.measure_index !== measureIndex),
    })
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
      </header>

      <StudioPurposeNav
        active="studio"
        studioId={studioId}
      />

      <div className="composer-toolbar" aria-label="전체 트랙 재생 제어">
        <button
          aria-label={globalPlaying ? '선택 재생 일시정지' : '트랙 선택 재생'}
          className="composer-tool composer-tool--primary"
          data-testid="global-play-button"
          disabled={!globalPlaying && (transportDisabled || registeredTrackCount === 0)}
          title={!globalPlaying ? transportDisabledReason ?? undefined : undefined}
          type="button"
          onClick={globalPlaying ? onToggleGlobalPlayback : onOpenPlaybackPicker}
        >
          <span aria-hidden="true">{globalPlaying ? '일시정지' : '재생'}</span>
        </button>
        <button
          aria-label="전체 중지"
          className="composer-tool"
          data-testid="global-stop-button"
          disabled={!globalPlaying}
          type="button"
          onClick={onStopGlobalPlayback}
        >
          <span aria-hidden="true">중지</span>
        </button>
        <label className="composer-bpm-control">
          <span>BPM</span>
          <input
            aria-label="스튜디오 BPM"
            data-testid="studio-bpm-edit-input"
            disabled={timingControlsDisabled}
            inputMode="numeric"
            max="240"
            min="40"
            step="1"
            type="number"
            title={timingControlsDisabled ? timingDisabledReason ?? undefined : undefined}
            value={bpmInput}
            onBlur={() => commitBaseBpm()}
            onChange={(event) => setBpmInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitBaseBpm(event.currentTarget.value)
              }
            }}
          />
          <button
            aria-label="마디별 BPM 추가"
            className="composer-inline-button"
            data-testid="studio-tempo-add-toggle"
            disabled={timingControlsDisabled}
            title={timingControlsDisabled ? timingDisabledReason ?? undefined : '특정 마디부터 BPM을 바꿉니다.'}
            type="button"
            onClick={openTempoEditor}
          >
            +
          </button>
        </label>
        <label className="composer-sync-step">
          <span>싱크</span>
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
          <span>초</span>
        </label>
        <div className="composer-sync-all" role="group" aria-label="등록된 전체 트랙 싱크 이동">
          <button
            aria-label={`등록된 전체 트랙을 ${formatStepInput(syncStepSeconds)}초 앞으로 이동`}
            className="composer-tool composer-tool--text composer-tool--sync-all"
            data-testid="sync-all-earlier-button"
            disabled={registeredTrackCount === 0 || editControlsDisabled}
            type="button"
            onClick={() => onShiftAllSync(-syncStepSeconds)}
          >
            전체 -
          </button>
          <button
            aria-label={`등록된 전체 트랙을 ${formatStepInput(syncStepSeconds)}초 뒤로 이동`}
            className="composer-tool composer-tool--text composer-tool--sync-all"
            data-testid="sync-all-later-button"
            disabled={registeredTrackCount === 0 || editControlsDisabled}
            type="button"
            onClick={() => onShiftAllSync(syncStepSeconds)}
          >
            전체 +
          </button>
        </div>
        <label className="composer-metronome">
          <input
            checked={metronomeEnabled}
            disabled={actionBusy}
            type="checkbox"
            onChange={(event) => onMetronomeChange(event.target.checked)}
          />
          메트로놈
        </label>
        <div className="composer-source-toggle" role="group" aria-label="재생 방식">
          <button
            aria-pressed={playbackSource === 'audio'}
            className={playbackSource === 'audio' ? 'is-active' : ''}
            data-testid="playback-source-audio"
            disabled={globalPlaying || transportDisabled}
            type="button"
            onClick={() => onPlaybackSourceChange('audio')}
          >
            원음 우선
          </button>
          <button
            aria-pressed={playbackSource === 'events'}
            className={playbackSource === 'events' ? 'is-active' : ''}
            data-testid="playback-source-events"
            disabled={globalPlaying || transportDisabled}
            type="button"
            onClick={() => onPlaybackSourceChange('events')}
          >
            연주음만
          </button>
        </div>
      </div>

      {tempoEditorOpen ? (
        <section className="composer-tempo-panel" data-testid="studio-tempo-panel">
          <div className="composer-tempo-list" aria-label="마디별 BPM 변경">
            {orderedTempoChanges.length === 0 ? (
              <p>마디별 BPM 변경 없음</p>
            ) : (
              orderedTempoChanges.map((change) => (
                <span key={change.measure_index}>
                  {change.measure_index}마디부터 {change.bpm} BPM
                  <button
                    aria-label={`${change.measure_index}마디 BPM 변경 삭제`}
                    disabled={timingControlsDisabled}
                    type="button"
                    onClick={() => deleteTempoChange(change.measure_index)}
                  >
                    삭제
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="composer-tempo-add">
            <label>
              <span>마디</span>
              <input
                aria-label="BPM 변경 시작 마디"
                data-testid="studio-tempo-measure-input"
                disabled={timingControlsDisabled}
                inputMode="numeric"
                min="2"
                type="number"
                value={newTempoMeasureInput}
                onChange={(event) => setNewTempoMeasureInput(event.target.value)}
              />
            </label>
            <label>
              <span>BPM</span>
              <input
                aria-label="변경 BPM"
                data-testid="studio-tempo-bpm-input"
                disabled={timingControlsDisabled}
                inputMode="numeric"
                max="240"
                min="40"
                type="number"
                value={newTempoBpmInput}
                onChange={(event) => setNewTempoBpmInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    addTempoChange()
                  }
                }}
              />
            </label>
            <button
              className="composer-mini-button composer-mini-button--primary"
              disabled={timingControlsDisabled}
              type="button"
              onClick={addTempoChange}
            >
              추가
            </button>
          </div>
        </section>
      ) : null}

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
                    disabled={globalPlaying || transportDisabled}
                    type="checkbox"
                    onChange={() => onTogglePlaybackSelection(track.slot_id)}
                  />
                  <span>{formatTrackName(track.name)}</span>
                </label>
              ))
            )}
          </div>
          <div className="composer-playback-actions">
            <button
              className="composer-mini-button"
              disabled={registeredTracks.length === 0 || globalPlaying || transportDisabled}
              type="button"
              onClick={onSelectAllPlaybackTracks}
            >
              전체 선택
            </button>
            <button
              className="composer-mini-button composer-mini-button--primary"
              data-testid="selected-play-button"
              disabled={selectedTrackCount === 0 || actionBusy || transportDisabled}
              type="button"
              onClick={globalPlaying ? onToggleGlobalPlayback : onStartSelectedPlayback}
            >
              {globalPlaying ? '일시정지' : '재생'}
            </button>
          </div>
          {playbackRange ? (
            <label className="composer-seek">
              <span>{formatClockSeconds(seekValue)}</span>
              <input
                aria-label="재생 위치"
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

      {actionState.phase !== 'idle' ? (
        <section className="studio-status-line" aria-live="polite">
          <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
          <p>{actionState.message}</p>
        </section>
      ) : null}
    </>
  )
}
