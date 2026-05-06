import { formatTrackName } from '../../lib/studio'
import type { TrackSlot } from '../../types/studio'
import {
  isRecordingReferenceTrackAvailable,
  type RecordingReferenceSetup,
} from './recordingReferences'
import './RecordingReferenceDialog.css'

type RecordingReferenceDialogProps = {
  busy: boolean
  setup: RecordingReferenceSetup
  tracks: TrackSlot[]
  onCancel: () => void
  onClearTracks: () => void
  onIncludeMetronomeChange: (includeMetronome: boolean) => void
  onSelectAllTracks: () => void
  onStart: () => void
  onToggleTrack: (slotId: number) => void
}

export function RecordingReferenceDialog({
  busy,
  setup,
  tracks,
  onCancel,
  onClearTracks,
  onIncludeMetronomeChange,
  onSelectAllTracks,
  onStart,
  onToggleTrack,
}: RecordingReferenceDialogProps) {
  const targetTrack = tracks.find((track) => track.slot_id === setup.targetSlotId) ?? null
  const targetName = formatTrackName(targetTrack?.name ?? `트랙 ${setup.targetSlotId}`)

  return (
    <div
      aria-labelledby="recording-reference-title"
      aria-modal="true"
      className="recording-reference-backdrop"
      data-testid="recording-reference-dialog"
      role="dialog"
    >
      <div className="recording-reference-panel">
        <div className="recording-reference-panel__heading">
          <p className="eyebrow">녹음</p>
          <h2 id="recording-reference-title">{targetName} 녹음</h2>
        </div>

        <section className="recording-reference-list" aria-label="들으면서 녹음할 트랙">
          {tracks.map((track) => {
            const available = isRecordingReferenceTrackAvailable(track)
            const checked = available && setup.selectedReferenceSlotIds.includes(track.slot_id)
            const isTarget = track.slot_id === setup.targetSlotId
            return (
              <label
                className={!available ? 'is-disabled' : isTarget ? 'is-target' : ''}
                key={track.slot_id}
              >
                <input
                  checked={checked}
                  data-testid={`recording-reference-track-${track.slot_id}`}
                  disabled={!available || busy}
                  type="checkbox"
                  onChange={() => onToggleTrack(track.slot_id)}
                />
                <span>{formatTrackName(track.name)}</span>
                {!available ? <em>비어 있음</em> : isTarget ? <em>녹음할 트랙</em> : null}
              </label>
            )
          })}
        </section>

        <div className="recording-reference-tools">
          <button
            className="app-button app-button--secondary"
            disabled={busy}
            type="button"
            onClick={onSelectAllTracks}
          >
            전체 켜기
          </button>
          <button
            className="app-button app-button--secondary"
            disabled={busy}
            type="button"
            onClick={onClearTracks}
          >
            모두 끄기
          </button>
        </div>

        <label className="recording-reference-metronome">
          <input
            checked={setup.includeMetronome}
            data-testid="recording-reference-metronome"
            disabled={busy}
            type="checkbox"
            onChange={(event) => onIncludeMetronomeChange(event.currentTarget.checked)}
          />
          <span>메트로놈</span>
        </label>

        <p className="recording-reference-hint">
          기준 소리가 마이크에 들어가지 않도록 이어폰을 착용하고 녹음하세요.
        </p>

        <div className="recording-reference-actions">
          <button
            className="app-button app-button--secondary"
            disabled={busy}
            type="button"
            onClick={onCancel}
          >
            취소
          </button>
          <button
            className="app-button"
            data-testid="recording-reference-start"
            disabled={busy}
            type="button"
            onClick={onStart}
          >
            녹음 시작
          </button>
        </div>
      </div>
    </div>
  )
}
