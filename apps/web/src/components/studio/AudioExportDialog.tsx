import { useMemo, useState } from 'react'

import { formatTrackName } from '../../lib/studio'
import type { Studio, TrackSlot } from '../../types/studio'
import './AudioExportDialog.css'

export type AudioExportPayload = {
  format: 'mp3' | 'wav'
  tracks: Array<{ slot_id: number; source: 'original' | 'guide' }>
}

type TrackExportOption = {
  defaultSource: 'original' | 'guide'
  guideAvailable: boolean
  originalAvailable: boolean
  track: TrackSlot
}

type AudioExportDialogProps = {
  busy: boolean
  studio: Studio
  onClose: () => void
  onCreate: (payload: AudioExportPayload) => void
}

export function AudioExportDialog({
  busy,
  studio,
  onClose,
  onCreate,
}: AudioExportDialogProps) {
  const options = useMemo(() => buildTrackExportOptions(studio), [studio])
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3')
  const [selected, setSelected] = useState<Record<number, boolean>>(() =>
    buildDefaultTrackSelection(buildTrackExportOptions(studio)),
  )
  const [sources, setSources] = useState<Record<number, 'original' | 'guide'>>(() =>
    buildDefaultTrackSources(buildTrackExportOptions(studio)),
  )

  const exportTracks = options
    .filter((option) => selected[option.track.slot_id])
    .map((option) => ({
      slot_id: option.track.slot_id,
      source: sources[option.track.slot_id] ?? option.defaultSource,
    }))
  const canCreate =
    !busy &&
    exportTracks.length > 0 &&
    exportTracks.every((track) => {
      const option = options.find((item) => item.track.slot_id === track.slot_id)
      return track.source === 'original' ? option?.originalAvailable : option?.guideAvailable
    })

  return (
    <div
      aria-labelledby="audio-export-title"
      aria-modal="true"
      className="audio-export-backdrop"
      data-testid="audio-export-dialog"
      role="dialog"
    >
      <div className="audio-export-panel">
        <header className="audio-export-panel__heading">
          <p className="eyebrow">내보내기</p>
          <h2 id="audio-export-title">오디오 내보내기</h2>
        </header>

        <fieldset className="audio-export-format">
          <legend>형식</legend>
          <label className={format === 'mp3' ? 'is-selected' : ''}>
            <input
              checked={format === 'mp3'}
              disabled={busy}
              name="audio-export-format"
              type="radio"
              value="mp3"
              onChange={() => setFormat('mp3')}
            />
            <span>MP3</span>
          </label>
          <label className={format === 'wav' ? 'is-selected' : ''}>
            <input
              checked={format === 'wav'}
              disabled={busy}
              name="audio-export-format"
              type="radio"
              value="wav"
              onChange={() => setFormat('wav')}
            />
            <span>WAV</span>
          </label>
        </fieldset>

        <div className="audio-export-track-list">
          {options.map((option) => {
            const slotId = option.track.slot_id
            const available = option.originalAvailable || option.guideAvailable
            const source = sources[slotId] ?? option.defaultSource
            return (
              <article className="audio-export-track" key={slotId}>
                <label className="audio-export-track__check">
                  <input
                    checked={selected[slotId] === true}
                    disabled={busy || !available}
                    type="checkbox"
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [slotId]: event.target.checked,
                      }))
                    }
                  />
                  <span>{formatTrackName(option.track.name)}</span>
                </label>
                {available ? (
                  <div className="audio-export-track__sources" role="group" aria-label={`${option.track.name} 음원 선택`}>
                    <button
                      className={source === 'original' ? 'is-selected' : ''}
                      disabled={busy || !option.originalAvailable || selected[slotId] !== true}
                      type="button"
                      onClick={() =>
                        setSources((current) => ({
                          ...current,
                          [slotId]: 'original',
                        }))
                      }
                    >
                      원음
                    </button>
                    <button
                      className={source === 'guide' ? 'is-selected' : ''}
                      disabled={busy || !option.guideAvailable || selected[slotId] !== true}
                      type="button"
                      onClick={() =>
                        setSources((current) => ({
                          ...current,
                          [slotId]: 'guide',
                        }))
                      }
                    >
                      연주음
                    </button>
                  </div>
                ) : (
                  <span className="audio-export-track__empty">내보낼 음원이 없습니다.</span>
                )}
              </article>
            )
          })}
        </div>

        <div className="audio-export-actions">
          <button
            className="app-button app-button--secondary"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            닫기
          </button>
          <button
            className="app-button"
            data-testid="audio-export-create"
            disabled={!canCreate}
            type="button"
            onClick={() => onCreate({ format, tracks: exportTracks })}
          >
            내보내기 만들기
          </button>
        </div>
      </div>
    </div>
  )
}

function buildTrackExportOptions(studio: Studio): TrackExportOption[] {
  return studio.tracks.map((track) => {
    const regions = studio.regions.filter((region) => region.track_slot_id === track.slot_id)
    const originalAvailable = Boolean(track.audio_source_path) || regions.some((region) => Boolean(region.audio_source_path))
    const guideAvailable = regions.some((region) =>
      region.pitch_events.some((event) => event.is_rest !== true),
    )
    return {
      track,
      originalAvailable,
      guideAvailable,
      defaultSource: originalAvailable ? 'original' : 'guide',
    }
  })
}

function buildDefaultTrackSelection(options: TrackExportOption[]): Record<number, boolean> {
  const result: Record<number, boolean> = {}
  for (const option of options) {
    result[option.track.slot_id] = option.originalAvailable || option.guideAvailable
  }
  return result
}

function buildDefaultTrackSources(options: TrackExportOption[]): Record<number, 'original' | 'guide'> {
  const result: Record<number, 'original' | 'guide'> = {}
  for (const option of options) {
    result[option.track.slot_id] = option.defaultSource
  }
  return result
}
