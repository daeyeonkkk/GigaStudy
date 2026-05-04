import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_UPLOAD_ACCEPT,
  formatDurationSeconds,
  formatSeconds,
  formatSourceLabel,
  formatTrackName,
  getArrangementTimelineBounds,
  getJobStatusLabel,
  getPitchedEvents,
  getTrackSourceLabel,
  statusLabels,
} from '../../lib/studio'
import type {
  ArrangementRegion,
  PitchEvent,
  TrackExtractionJob,
  TrackSlot,
  UpdatePitchEventRequest,
} from '../../types/studio'
import { PianoRollPanel, RegionTools } from './TrackBoardEditor'
import { getGridSeconds } from './TrackBoardEditorGrid'
import { PracticeWaterfall } from './TrackBoardTimeline'
import {
  getMeasureStarts,
  getRegionLaneStyle,
  getRegionStyle,
  getTimelinePercent,
} from './TrackBoardTimelineLayout'
import './TrackBoard.css'

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
  activeJobSlotIds: Set<number>
  beatsPerMeasure: number
  bpm: number
  editDisabled: boolean
  editDisabledReason: string | null
  metronomeEnabled: boolean
  pendingCandidateCount: number
  extractionJobs: TrackExtractionJob[]
  playingSlots: Set<number>
  playheadSeconds: number | null
  focusedEventId?: string | null
  focusedRegionId?: string | null
  arrangementRegions: ArrangementRegion[]
  registeredTracks: TrackSlot[]
  recordingSlotId: number | null
  syncStepSeconds: number
  trackCountIn: TrackCountInState | null
  trackRecordingMeter: TrackRecordingMeter
  tracks: TrackSlot[]
  onCopyRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onDeleteRegion: (region: ArrangementRegion) => void
  onGenerate: (track: TrackSlot) => void
  onMoveRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onOpenScore: (track: TrackSlot) => void
  onRecord: (track: TrackSlot) => void
  onSplitRegion: (region: ArrangementRegion, splitSeconds: number) => void
  onStopPlayback: (track: TrackSlot) => void
  onSync: (track: TrackSlot, nextOffset: number) => void
  onTogglePlayback: (track: TrackSlot) => void
  onUpdateEvent: (region: ArrangementRegion, event: PitchEvent, patch: UpdatePitchEventRequest) => void
  onUpload: (track: TrackSlot, file: File | null) => void
  onVolumeChange: (track: TrackSlot, nextVolumePercent: number) => void
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
  disabled,
  track,
  onVolumeChange,
}: {
  disabled: boolean
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
      <span>음량</span>
      <input
        aria-label={`${formatTrackName(track.name)} 음량`}
        data-testid={`track-volume-range-${track.slot_id}`}
        max="100"
        min="0"
        step="1"
        type="range"
        disabled={disabled}
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
        aria-label={`${formatTrackName(track.name)} 음량 퍼센트`}
        data-testid={`track-volume-input-${track.slot_id}`}
        inputMode="numeric"
        max="100"
        min="0"
        step="1"
        type="number"
        disabled={disabled}
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

export function TrackBoard({
  activeJobSlotIds,
  beatsPerMeasure,
  bpm,
  editDisabled,
  editDisabledReason,
  metronomeEnabled,
  pendingCandidateCount,
  extractionJobs,
  playingSlots,
  playheadSeconds,
  focusedEventId,
  focusedRegionId,
  arrangementRegions,
  registeredTracks,
  recordingSlotId,
  syncStepSeconds,
  trackCountIn,
  trackRecordingMeter,
  tracks,
  onCopyRegion,
  onDeleteRegion,
  onGenerate,
  onMoveRegion,
  onOpenScore,
  onRecord,
  onSplitRegion,
  onStopPlayback,
  onSync,
  onTogglePlayback,
  onUpdateEvent,
  onUpload,
  onVolumeChange,
}: TrackBoardProps) {
  const regions = useMemo(
    () =>
      arrangementRegions
        .slice()
        .sort((left, right) =>
          left.track_slot_id === right.track_slot_id
            ? left.start_seconds - right.start_seconds || left.region_id.localeCompare(right.region_id)
            : left.track_slot_id - right.track_slot_id,
        ),
    [arrangementRegions],
  )
  const regionsByTrack = useMemo(() => {
    const next = new Map<number, ArrangementRegion[]>()
    for (const region of regions) {
      const trackRegions = next.get(region.track_slot_id) ?? []
      trackRegions.push(region)
      next.set(region.track_slot_id, trackRegions)
    }
    return next
  }, [regions])
  const timelineBounds = useMemo(
    () => {
      const regionBounds = getArrangementTimelineBounds(regions, 12)
      const minSeconds = Math.min(regionBounds.minSeconds, playheadSeconds ?? 0, 0)
      const maxSeconds = Math.max(regionBounds.maxSeconds, playheadSeconds ?? 0, minSeconds + 12)
      return {
        minSeconds,
        maxSeconds,
        durationSeconds: Math.max(0.25, maxSeconds - minSeconds),
      }
    },
    [playheadSeconds, regions],
  )
  const measureStarts = useMemo(
    () => getMeasureStarts(timelineBounds, bpm, beatsPerMeasure),
    [beatsPerMeasure, bpm, timelineBounds],
  )
  const gridSeconds = getGridSeconds(bpm)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const focusedRegionExists = focusedRegionId
    ? regions.some((region) => region.region_id === focusedRegionId)
    : false
  const effectiveSelectedRegionId = selectedRegionId ?? (focusedRegionExists ? focusedRegionId : null)
  const selectedRegion =
    regions.find((region) => region.region_id === effectiveSelectedRegionId) ??
    regions[0] ??
    null
  const effectiveSelectedEventId =
    selectedRegion?.pitch_events.some((event) => event.event_id === selectedEventId)
      ? selectedEventId
      : selectedRegion?.pitch_events.some((event) => event.event_id === focusedEventId)
        ? focusedEventId ?? null
        : selectedRegion?.pitch_events[0]?.event_id ?? null
  const selectedRegionJobLocked = selectedRegion ? activeJobSlotIds.has(selectedRegion.track_slot_id) : false
  const selectedRegionEditDisabled = editDisabled || selectedRegionJobLocked
  const selectedRegionDisabledReason = selectedRegionJobLocked
    ? `${formatTrackName(selectedRegion?.track_name)} 추출 작업이 끝난 뒤 편집할 수 있습니다.`
    : editDisabledReason

  return (
    <section className="studio-tracks" aria-label="6트랙 편집기">
      <div className="studio-tracks__header">
        <div>
          <p className="eyebrow">편곡</p>
          <h2>트랙 편집</h2>
        </div>
        <div className="studio-tracks__summary">
          <span>등록 {registeredTracks.length}</span>
          <span>구간 {regions.length}</span>
          <span>검토 {pendingCandidateCount}</span>
          <span>재생 {playingSlots.size}</span>
        </div>
      </div>

      <div className="arrangement-ruler" aria-hidden="true">
        {measureStarts.map((seconds, index) => (
          <span
            key={`measure-${seconds}`}
            style={{ '--measure-left': `${getTimelinePercent(seconds, timelineBounds)}%` } as CSSProperties}
          >
            {index + 1}
          </span>
        ))}
      </div>

      <div className="track-stack">
        {tracks.map((track) => {
          const isRegistered = track.status === 'registered'
          const needsReview = track.status === 'needs_review'
          const isRecording = recordingSlotId === track.slot_id
          const isCountingIn = trackCountIn?.slotId === track.slot_id
          const isPlaying = playingSlots.has(track.slot_id)
          const activeJob = getTrackActiveJob(track, extractionJobs)
          const activeJobLocked = activeJobSlotIds.has(track.slot_id) || track.status === 'extracting'
          const isRecordToggleAvailable = isRecording || isCountingIn
          const trackEditDisabled = editDisabled || activeJobLocked
          const trackEditDisabledReason = activeJobLocked
            ? `${formatTrackName(track.name)} 트랙은 추출 작업이 끝난 뒤 편집할 수 있습니다.`
            : editDisabledReason
          const trackRegions = regionsByTrack.get(track.slot_id) ?? []
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
                    <h3>{formatTrackName(track.name)}</h3>
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
                  <span>싱크 {formatSeconds(track.sync_offset_seconds)}</span>
                  <span>음량 {getTrackVolumePercent(track)}%</span>
                </div>
              </header>

              <div
                className="track-card__timeline track-card__region-lane"
                aria-label={`${formatTrackName(track.name)} 구간 타임라인`}
                style={getRegionLaneStyle(isPlaying, playheadSeconds, timelineBounds, trackRegions.length)}
              >
                <div className="track-card__measure-grid" aria-hidden="true">
                  {measureStarts.map((seconds) => (
                    <i
                      key={`${track.slot_id}-${seconds}`}
                      style={{ '--measure-left': `${getTimelinePercent(seconds, timelineBounds)}%` } as CSSProperties}
                    />
                  ))}
                </div>
                {isPlaying && playheadSeconds !== null ? (
                  <i className="track-card__playhead" aria-hidden="true" />
                ) : null}
                {trackRegions.length > 0 ? (
                  trackRegions.map((region, index) => (
                    <button
                      aria-label={`${formatTrackName(track.name)} 구간 ${index + 1}`}
                      aria-pressed={selectedRegion?.region_id === region.region_id}
                      className={`track-card__region-block ${focusedRegionId === region.region_id ? 'is-focused' : ''}`}
                      data-region-id={region.region_id}
                      data-testid={index === 0 ? `track-region-${track.slot_id}` : `track-region-${track.slot_id}-${index + 1}`}
                      key={region.region_id}
                      style={getRegionStyle(region, timelineBounds, index)}
                      type="button"
                      onClick={() => {
                        setSelectedRegionId(region.region_id)
                        setSelectedEventId(region.pitch_events[0]?.event_id ?? null)
                      }}
                      onDoubleClick={() => {
                        setSelectedRegionId(region.region_id)
                        setSelectedEventId(region.pitch_events[0]?.event_id ?? null)
                      }}
                    >
                      <span>{region.source_label ? formatSourceLabel(region.source_label) : formatTrackName(track.name)}</span>
                      <strong>{getPitchedEvents(region.pitch_events).length}개 음표</strong>
                      <em>
                        {formatDurationSeconds(region.start_seconds)} -{' '}
                        {formatDurationSeconds(region.start_seconds + region.duration_seconds)}
                      </em>
                    </button>
                  ))
                ) : (
                  <p>{needsReview ? '검토할 후보가 있습니다' : '아직 비어 있음'}</p>
                )}
              </div>

              <div className="track-card__controls">
                <div className="track-card__primary-actions">
                  <button
                    className={`app-button app-button--record ${isRecording || isCountingIn ? 'is-active' : ''}`}
                    data-testid={`track-record-${track.slot_id}`}
                    disabled={!isRecordToggleAvailable && trackEditDisabled}
                    type="button"
                    title={!isRecordToggleAvailable ? trackEditDisabledReason ?? undefined : undefined}
                    onClick={() => onRecord(track)}
                  >
                    <span aria-hidden="true">{isRecording ? '■' : isCountingIn ? '×' : '●'}</span>
                    {isRecording ? '녹음 중' : isCountingIn ? '취소' : '녹음'}
                  </button>
                  <label className={`app-button app-button--secondary track-upload ${trackEditDisabled ? 'is-disabled' : ''}`}>
                    <span aria-hidden="true">↑</span>
                    업로드
                    <input
                      accept={TRACK_UPLOAD_ACCEPT}
                      aria-label={`${formatTrackName(track.name)} 업로드`}
                      disabled={trackEditDisabled}
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
                    disabled={!canGenerateTrack || trackEditDisabled}
                    type="button"
                    title={trackEditDisabledReason ?? undefined}
                    onClick={() => onGenerate(track)}
                  >
                    <span aria-hidden="true">AI</span>
                    생성
                  </button>
                </div>

                <div className="track-card__secondary-actions">
                  <button
                    aria-label={`${formatTrackName(track.name)} 싱크를 ${formatSyncStep(syncStepSeconds)}초 앞으로 이동`}
                    className="studio-step-button"
                    data-testid={`track-sync-earlier-${track.slot_id}`}
                    disabled={trackEditDisabled || !isRegistered}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds - syncStepSeconds)}
                  >
                    -{formatSyncStep(syncStepSeconds)}
                  </button>
                  <button
                    aria-label={`${formatTrackName(track.name)} 싱크를 ${formatSyncStep(syncStepSeconds)}초 뒤로 이동`}
                    className="studio-step-button"
                    data-testid={`track-sync-later-${track.slot_id}`}
                    disabled={trackEditDisabled || !isRegistered}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds + syncStepSeconds)}
                  >
                    +{formatSyncStep(syncStepSeconds)}
                  </button>
                  <TrackVolumeControl disabled={trackEditDisabled} track={track} onVolumeChange={onVolumeChange} />
                  <button
                    aria-label={isPlaying ? `${formatTrackName(track.name)} 일시정지` : `${formatTrackName(track.name)} 재생`}
                    className="studio-icon-button"
                    data-testid={`track-play-${track.slot_id}`}
                    disabled={!isRegistered || (editDisabled && !isPlaying)}
                    type="button"
                    onClick={() => onTogglePlayback(track)}
                  >
                    <span aria-hidden="true">{isPlaying ? '일시정지' : '재생'}</span>
                  </button>
                  <button
                    aria-label={`${formatTrackName(track.name)} 중지`}
                    className="studio-icon-button"
                    data-testid={`track-stop-${track.slot_id}`}
                    disabled={!isRegistered || !isPlaying}
                    type="button"
                    onClick={() => onStopPlayback(track)}
                  >
                    <span aria-hidden="true">중지</span>
                  </button>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`track-score-${track.slot_id}`}
                    disabled={!canScoreTrack || trackEditDisabled}
                    type="button"
                    title={trackEditDisabledReason ?? undefined}
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
                    <span>1마디 카운트인</span>
                    <strong>{trackCountIn.pulsesRemaining}</strong>
                    <i aria-hidden="true" />
                    <em>{metronomeEnabled ? '메트로놈 켜짐' : '무음 카운트'}</em>
                  </div>
                ) : isRecording ? (
                  <div
                    className="track-card__recording-meter"
                    data-testid={`track-recording-meter-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>{formatDurationSeconds(trackRecordingMeter.durationSeconds)}</span>
                    <i aria-hidden="true" />
                    <em>{metronomeEnabled ? '메트로놈 켜짐' : '메트로놈 꺼짐'}</em>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <div className="editor-panels">
        <div className="piano-roll-shell">
          <RegionTools
            disabled={selectedRegionEditDisabled}
            disabledReason={selectedRegionDisabledReason}
            gridSeconds={gridSeconds}
            region={selectedRegion}
            tracks={tracks}
            onCopyRegion={onCopyRegion}
            onDeleteRegion={onDeleteRegion}
            onMoveRegion={onMoveRegion}
            onSplitRegion={onSplitRegion}
          />
          <PianoRollPanel
            disabled={selectedRegionEditDisabled}
            disabledReason={selectedRegionDisabledReason}
            focusedEventId={focusedEventId}
            gridSeconds={gridSeconds}
            region={selectedRegion}
            selectedEventId={effectiveSelectedEventId}
            onSelectEvent={setSelectedEventId}
            onUpdateEvent={onUpdateEvent}
          />
        </div>
        <PracticeWaterfall
          playheadSeconds={playheadSeconds}
          regions={regions}
          timelineBounds={timelineBounds}
        />
      </div>
    </section>
  )
}
