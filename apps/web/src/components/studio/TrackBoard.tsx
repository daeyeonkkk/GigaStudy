import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_UPLOAD_ACCEPT,
  formatBeatInMeasure,
  formatDurationSeconds,
  formatSeconds,
  getClefSymbol,
  getScoreBeatLineStyle,
  getScoreMeasureBoundaryStyle,
  getScoreMeasureLabelStyle,
  getScoreTimelineStyle,
  getTimelineNoteStyle,
  getTrackRenderModel,
  getTrackSourceLabel,
  statusLabels,
} from '../../lib/studio'
import type { TrackSlot } from '../../types/studio'

type TrackRecordingMeter = {
  durationSeconds: number
  level: number
}

type TrackBoardProps = {
  beatsPerMeasure: number
  bpm: number
  globalPlaying: boolean
  metronomeEnabled: boolean
  pendingCandidateCount: number
  playingSlots: Set<number>
  registeredTracks: TrackSlot[]
  recordingSlotId: number | null
  trackRecordingMeter: TrackRecordingMeter
  tracks: TrackSlot[]
  onGenerate: (track: TrackSlot) => void
  onOpenScore: (track: TrackSlot) => void
  onRecord: (track: TrackSlot) => void
  onStopPlayback: (track: TrackSlot) => void
  onSync: (track: TrackSlot, nextOffset: number) => void
  onTogglePlayback: (track: TrackSlot) => void
  onUpload: (track: TrackSlot, file: File | null) => void
}

function ScoreStrip({
  beatsPerMeasure,
  bpm,
  track,
}: {
  beatsPerMeasure: number
  bpm: number
  track: TrackSlot
}) {
  const scoreModel = getTrackRenderModel(track, bpm, beatsPerMeasure)

  return (
    <div
      className="track-card__measure-strip"
      data-testid={`track-score-strip-${track.slot_id}`}
      style={getScoreTimelineStyle(scoreModel)}
    >
      <span className="track-card__clef" aria-hidden="true">
        {getClefSymbol(track.slot_id)}
      </span>
      {scoreModel.beatGuideOffsets.map((beatOffset) => (
        <span
          aria-hidden="true"
          className="track-card__beat-line"
          key={`${track.slot_id}-beat-line-${beatOffset}`}
          style={getScoreBeatLineStyle(beatOffset, scoreModel)}
        />
      ))}
      {scoreModel.measureBoundaryOffsets.map((beatOffset) => (
        <span
          aria-hidden="true"
          className="track-card__beat-line track-card__beat-line--measure"
          key={`${track.slot_id}-measure-line-${beatOffset}`}
          style={getScoreMeasureBoundaryStyle(beatOffset, scoreModel)}
        />
      ))}
      {scoreModel.measures.map((measureIndex) => (
        <span
          className="track-card__measure-label"
          key={`${track.slot_id}-measure-label-${measureIndex}`}
          style={getScoreMeasureLabelStyle(measureIndex, scoreModel)}
        >
          {measureIndex}
        </span>
      ))}
      {scoreModel.notes.map((renderNote) => (
        <span
          className={
            renderNote.note.is_rest === true
              ? 'track-card__measure-note track-card__note--rest'
              : 'track-card__measure-note'
          }
          key={renderNote.note.id}
          style={getTimelineNoteStyle(track.slot_id, renderNote, scoreModel)}
        >
          <small>{formatBeatInMeasure(renderNote.displayBeat, beatsPerMeasure)}</small>
          <strong>{renderNote.note.label}</strong>
        </span>
      ))}
    </div>
  )
}

export function TrackBoard({
  beatsPerMeasure,
  bpm,
  globalPlaying,
  metronomeEnabled,
  pendingCandidateCount,
  playingSlots,
  registeredTracks,
  recordingSlotId,
  trackRecordingMeter,
  tracks,
  onGenerate,
  onOpenScore,
  onRecord,
  onStopPlayback,
  onSync,
  onTogglePlayback,
  onUpload,
}: TrackBoardProps) {
  return (
    <section className="studio-tracks" aria-label="6개 트랙">
      <div className="studio-tracks__header">
        <div>
          <p className="eyebrow">Track board</p>
          <h2>6 Track Score</h2>
        </div>
        <div className="studio-tracks__summary">
          <span>{registeredTracks.length} registered</span>
          <span>{pendingCandidateCount} review</span>
          <span>{playingSlots.size + (globalPlaying ? registeredTracks.length : 0)} playing</span>
        </div>
      </div>

      <div className="track-stack">
        {tracks.map((track) => {
          const isRegistered = track.status === 'registered'
          const needsReview = track.status === 'needs_review'
          const isRecording = recordingSlotId === track.slot_id
          const isPlaying = globalPlaying || playingSlots.has(track.slot_id)
          const canGenerateTrack = registeredTracks.some(
            (registeredTrack) => registeredTrack.slot_id !== track.slot_id,
          )
          const recordingMeterStyle = {
            '--recording-level': `${getRecordingLevelPercent(isRecording ? trackRecordingMeter.level : 0)}%`,
          } as CSSProperties

          return (
            <article
              className={`track-card track-card--slot-${track.slot_id} ${
                isRegistered ? 'track-card--ready' : needsReview ? 'track-card--review' : 'track-card--empty'
              }`}
              data-testid={`track-card-${track.slot_id}`}
              key={track.slot_id}
            >
              <header className="track-card__header">
                <div className="track-card__identity">
                  <span>{String(track.slot_id).padStart(2, '0')}</span>
                  <div>
                    <h3>{track.name}</h3>
                    <p>{getTrackSourceLabel(track)}</p>
                  </div>
                </div>
                <div className="track-card__state">
                  <strong>{statusLabels[track.status]}</strong>
                  <span>sync {formatSeconds(track.sync_offset_seconds)}</span>
                </div>
              </header>

              <div className="track-card__score" aria-label={`${track.name} 악보`}>
                {isRegistered ? (
                  <ScoreStrip
                    beatsPerMeasure={beatsPerMeasure}
                    bpm={bpm}
                    track={track}
                  />
                ) : (
                  <p>{needsReview ? '검토 대기 트랙' : '공란 트랙'}</p>
                )}
              </div>

              <div className="track-card__controls">
                <div className="track-card__primary-actions">
                  <button
                    className={`app-button app-button--record ${isRecording ? 'is-active' : ''}`}
                    data-testid={`track-record-${track.slot_id}`}
                    type="button"
                    onClick={() => onRecord(track)}
                  >
                    <span aria-hidden="true">{isRecording ? '■' : '●'}</span>
                    {isRecording ? '중지' : '녹음'}
                  </button>
                  <label className="app-button app-button--secondary track-upload">
                    <span aria-hidden="true">↑</span>
                    업로드
                    <input
                      accept={TRACK_UPLOAD_ACCEPT}
                      aria-label={`${track.name} 업로드`}
                      type="file"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0] ?? null
                        event.currentTarget.value = ''
                        onUpload(track, file)
                      }}
                    />
                  </label>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`track-generate-${track.slot_id}`}
                    disabled={!canGenerateTrack}
                    type="button"
                    onClick={() => onGenerate(track)}
                  >
                    <span aria-hidden="true">✦</span>
                    AI 생성
                  </button>
                </div>

                <div className="track-card__secondary-actions">
                  <button
                    aria-label={`${track.name} 싱크 0.01초 빠르게`}
                    className="studio-step-button"
                    data-testid={`track-sync-earlier-${track.slot_id}`}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds - 0.01)}
                  >
                    -0.01
                  </button>
                  <button
                    aria-label={`${track.name} 싱크 0.01초 느리게`}
                    className="studio-step-button"
                    data-testid={`track-sync-later-${track.slot_id}`}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds + 0.01)}
                  >
                    +0.01
                  </button>
                  <button
                    aria-label={isPlaying ? `${track.name} 일시정지` : `${track.name} 재생`}
                    className="studio-icon-button"
                    disabled={!isRegistered}
                    type="button"
                    onClick={() => onTogglePlayback(track)}
                  >
                    <span aria-hidden="true">{isPlaying ? 'II' : '▶'}</span>
                  </button>
                  <button
                    aria-label={`${track.name} 중지`}
                    className="studio-icon-button"
                    disabled={!isRegistered}
                    type="button"
                    onClick={() => onStopPlayback(track)}
                  >
                    <span aria-hidden="true">■</span>
                  </button>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`track-score-${track.slot_id}`}
                    disabled={!isRegistered}
                    type="button"
                    onClick={() => onOpenScore(track)}
                  >
                    채점
                  </button>
                </div>
                {isRecording ? (
                  <div
                    className="track-card__recording-meter"
                    data-testid={`track-recording-meter-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>{formatDurationSeconds(trackRecordingMeter.durationSeconds)}</span>
                    <i aria-hidden="true" />
                    <em>{metronomeEnabled ? 'metronome on' : 'metronome off'}</em>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
