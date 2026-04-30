import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_UPLOAD_ACCEPT,
  buildEngravingMeasureWidths,
  formatDurationSeconds,
  formatSeconds,
  getTrackSourceLabel,
  getTrackRenderModel,
  getJobStatusLabel,
  statusLabels,
} from '../../lib/studio'
import type { TrackExtractionJob, TrackSlot } from '../../types/studio'
import './TrackBoard.css'

const EngravedScoreStrip = lazy(() =>
  import('./EngravedScoreStrip').then((module) => ({ default: module.EngravedScoreStrip })),
)

type TrackRecordingMeter = {
  durationSeconds: number
  level: number
}

type TrackCountInState = {
  pulsesRemaining: number
  slotId: number
  totalPulses: number
}

type TrackBoardProps = {
  beatsPerMeasure: number
  bpm: number
  metronomeEnabled: boolean
  pendingCandidateCount: number
  extractionJobs: TrackExtractionJob[]
  playingSlots: Set<number>
  playheadSeconds: number | null
  registeredTracks: TrackSlot[]
  recordingSlotId: number | null
  syncStepSeconds: number
  trackCountIn: TrackCountInState | null
  trackRecordingMeter: TrackRecordingMeter
  tracks: TrackSlot[]
  onGenerate: (track: TrackSlot) => void
  onOpenScore: (track: TrackSlot) => void
  onRecord: (track: TrackSlot) => void
  onStopPlayback: (track: TrackSlot) => void
  onSync: (track: TrackSlot, nextOffset: number) => void
  onTogglePlayback: (track: TrackSlot) => void
  onUpload: (track: TrackSlot, file: File | null) => void
  onVolumeChange: (track: TrackSlot, nextVolumePercent: number) => void
}

function getRegisteredTrackKeySignature(track: TrackSlot): string | null {
  const keySignature = track.notes.find((note) => note.key_signature)?.key_signature
  return keySignature && keySignature !== 'C' ? keySignature : null
}

function formatSyncStep(seconds: number): string {
  const rounded = Number(seconds.toFixed(3))
  return rounded.toString()
}

function clampVolumePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 100
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getTrackVolumePercent(track: TrackSlot): number {
  return clampVolumePercent(track.volume_percent)
}

function getTrackActiveJob(track: TrackSlot, jobs: TrackExtractionJob[]): TrackExtractionJob | null {
  return (
    jobs.find(
      (job) =>
        job.slot_id === track.slot_id &&
        (job.status === 'queued' ||
          job.status === 'running' ||
          job.status === 'needs_review' ||
          job.status === 'failed'),
    ) ?? null
  )
}

function TrackVolumeControl({
  track,
  onVolumeChange,
}: {
  track: TrackSlot
  onVolumeChange: (track: TrackSlot, nextVolumePercent: number) => void
}) {
  const volumePercent = getTrackVolumePercent(track)
  const [draftVolume, setDraftVolume] = useState(() => String(volumePercent))
  const draftParsedVolume = Number.parseFloat(draftVolume)
  const rangeVolume = Number.isFinite(draftParsedVolume)
    ? clampVolumePercent(draftParsedVolume)
    : volumePercent

  useEffect(() => {
    setDraftVolume(String(volumePercent))
  }, [volumePercent])

  function commitVolume(rawValue = draftVolume) {
    const parsedValue = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsedValue)) {
      setDraftVolume(String(volumePercent))
      return
    }
    const nextVolumePercent = clampVolumePercent(parsedValue)
    setDraftVolume(String(nextVolumePercent))
    if (nextVolumePercent !== volumePercent) {
      onVolumeChange(track, nextVolumePercent)
    }
  }

  return (
    <label className="track-volume-control">
      <span>Vol</span>
      <input
        aria-label={`${track.name} volume`}
        data-testid={`track-volume-range-${track.slot_id}`}
        max="100"
        min="0"
        step="1"
        type="range"
        value={rangeVolume}
        onChange={(event) => setDraftVolume(event.currentTarget.value)}
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
            commitVolume(event.currentTarget.value)
          }
        }}
        onPointerUp={(event) => commitVolume(event.currentTarget.value)}
      />
      <input
        aria-label={`${track.name} volume percent`}
        data-testid={`track-volume-input-${track.slot_id}`}
        inputMode="numeric"
        max="100"
        min="0"
        step="1"
        type="number"
        value={draftVolume}
        onBlur={() => commitVolume()}
        onChange={(event) => setDraftVolume(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitVolume(event.currentTarget.value)
          }
        }}
      />
      <span>%</span>
    </label>
  )
}

function EngravingFallback({ track }: { track: TrackSlot }) {
  return (
    <div
      aria-label={`${track.name} 악보 엔진을 불러오는 중입니다`}
      className="track-card__measure-strip track-card__engraved-strip track-card__engraved-strip--loading"
      data-testid={`track-score-strip-loading-${track.slot_id}`}
    />
  )
}

export function TrackBoard({
  beatsPerMeasure,
  bpm,
  metronomeEnabled,
  pendingCandidateCount,
  extractionJobs,
  playingSlots,
  playheadSeconds,
  registeredTracks,
  recordingSlotId,
  syncStepSeconds,
  trackCountIn,
  trackRecordingMeter,
  tracks,
  onGenerate,
  onOpenScore,
  onRecord,
  onStopPlayback,
  onSync,
  onTogglePlayback,
  onUpload,
  onVolumeChange,
}: TrackBoardProps) {
  const sharedMeasureWidths = useMemo(() => {
    const registeredModels = registeredTracks.map((track) =>
      getTrackRenderModel(
        {
          ...track,
          sync_offset_seconds: 0,
        },
        bpm,
        beatsPerMeasure,
      ),
    )
    const measureCount = Math.max(1, ...registeredModels.map((model) => model.measureCount))
    const widthSets = registeredModels.map((model, index) => {
      const track = registeredTracks[index]
      return buildEngravingMeasureWidths(
        model.notes,
        measureCount,
        beatsPerMeasure,
        track ? getRegisteredTrackKeySignature(track) : null,
      )
    })

    return Array.from({ length: measureCount }, (_, measureIndex) =>
      Math.max(260, ...widthSets.map((widths) => widths[measureIndex] ?? 0)),
    )
  }, [beatsPerMeasure, bpm, registeredTracks])

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
          <span>{playingSlots.size} playing</span>
        </div>
      </div>

      <div className="track-stack">
        {tracks.map((track) => {
          const isRegistered = track.status === 'registered'
          const needsReview = track.status === 'needs_review'
          const isRecording = recordingSlotId === track.slot_id
          const isCountingIn = trackCountIn?.slotId === track.slot_id
          const isPlaying = playingSlots.has(track.slot_id)
          const activeJob = getTrackActiveJob(track, extractionJobs)
          const canGenerateTrack = registeredTracks.some(
            (registeredTrack) => registeredTrack.slot_id !== track.slot_id,
          )
          const canScoreTrack =
            isRegistered ||
            registeredTracks.some((registeredTrack) => registeredTrack.slot_id !== track.slot_id)
          const recordingMeterStyle = {
            '--recording-level': `${getRecordingLevelPercent(isRecording || isCountingIn ? trackRecordingMeter.level : 0)}%`,
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
                  {activeJob ? (
                    <span className={`track-card__job-state track-card__job-state--${activeJob.status}`}>
                      {getJobStatusLabel(activeJob.status)}
                    </span>
                  ) : null}
                  <span>sync {formatSeconds(track.sync_offset_seconds)}</span>
                  <span>vol {getTrackVolumePercent(track)}%</span>
                </div>
              </header>

              <div className="track-card__score" aria-label={`${track.name} 악보`}>
                {isRegistered ? (
                  <Suspense fallback={<EngravingFallback track={track} />}>
                    <EngravedScoreStrip
                      beatsPerMeasure={beatsPerMeasure}
                      bpm={bpm}
                      playheadSeconds={isPlaying ? playheadSeconds : null}
                      sharedMeasureWidths={sharedMeasureWidths}
                      track={track}
                    />
                  </Suspense>
                ) : (
                  <p>{needsReview ? '검토 대기 트랙' : '공란 트랙'}</p>
                )}
              </div>

              <div className="track-card__controls">
                <div className="track-card__primary-actions">
                  <button
                    className={`app-button app-button--record ${isRecording || isCountingIn ? 'is-active' : ''}`}
                    data-testid={`track-record-${track.slot_id}`}
                    type="button"
                    onClick={() => onRecord(track)}
                  >
                    <span aria-hidden="true">{isRecording || isCountingIn ? '■' : '●'}</span>
                    {isRecording ? '중지' : isCountingIn ? '취소' : '녹음'}
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
                    aria-label={`${track.name} 싱크 ${formatSyncStep(syncStepSeconds)}초 빠르게`}
                    className="studio-step-button"
                    data-testid={`track-sync-earlier-${track.slot_id}`}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds - syncStepSeconds)}
                  >
                    -{formatSyncStep(syncStepSeconds)}
                  </button>
                  <button
                    aria-label={`${track.name} 싱크 ${formatSyncStep(syncStepSeconds)}초 느리게`}
                    className="studio-step-button"
                    data-testid={`track-sync-later-${track.slot_id}`}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds + syncStepSeconds)}
                  >
                    +{formatSyncStep(syncStepSeconds)}
                  </button>
                  <TrackVolumeControl track={track} onVolumeChange={onVolumeChange} />
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
                    disabled={!canScoreTrack}
                    type="button"
                    onClick={() => onOpenScore(track)}
                  >
                    채점
                  </button>
                </div>
                {isCountingIn ? (
                  <div
                    className="track-card__count-in"
                    data-testid={`track-count-in-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>1마디 준비</span>
                    <strong>{trackCountIn.pulsesRemaining}</strong>
                    <i aria-hidden="true" />
                    <em>{metronomeEnabled ? 'metronome on' : 'silent clock'}</em>
                  </div>
                ) : isRecording ? (
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
