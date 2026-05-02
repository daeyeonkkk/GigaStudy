import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_UPLOAD_ACCEPT,
  formatDurationSeconds,
  formatSeconds,
  getArrangementRegionDurationSeconds,
  getJobStatusLabel,
  getPitchEventRange,
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

function getMeasureStarts(timelineSeconds: number, bpm: number, beatsPerMeasure: number): number[] {
  const beatSeconds = 60 / Math.max(1, bpm)
  const measureSeconds = Math.max(beatSeconds, beatSeconds * Math.max(1, beatsPerMeasure))
  const measureCount = Math.max(2, Math.ceil(timelineSeconds / measureSeconds) + 1)
  return Array.from({ length: measureCount }, (_, index) => index * measureSeconds)
}

function getTimelinePercent(seconds: number, timelineSeconds: number): number {
  return Math.max(0, Math.min(100, (seconds / Math.max(0.25, timelineSeconds)) * 100))
}

function getRegionStyle(region: ArrangementRegion, timelineSeconds: number, laneIndex: number): CSSProperties {
  return {
    '--region-left': `${getTimelinePercent(region.start_seconds, timelineSeconds)}%`,
    '--region-top': `${10 + laneIndex * 36}px`,
    '--region-width': `${Math.max(1.5, getTimelinePercent(region.duration_seconds, timelineSeconds))}%`,
  } as CSSProperties
}

function getRegionLaneStyle(
  isPlaying: boolean,
  playheadSeconds: number | null,
  timelineSeconds: number,
  regionCount: number,
): CSSProperties {
  return {
    '--lane-min-height': `${Math.max(94, 24 + regionCount * 38)}px`,
    '--playhead-left': `${getTimelinePercent(isPlaying ? playheadSeconds ?? 0 : 0, timelineSeconds)}%`,
  } as CSSProperties
}

function getPlayheadStyle(playheadSeconds: number | null, timelineSeconds: number): CSSProperties {
  return {
    '--playhead-left': `${getTimelinePercent(playheadSeconds ?? 0, timelineSeconds)}%`,
  } as CSSProperties
}

function getEventLeftPercent(event: PitchEvent, region: ArrangementRegion): number {
  return getTimelinePercent(event.start_seconds - region.start_seconds, region.duration_seconds)
}

function getEventWidthPercent(event: PitchEvent, region: ArrangementRegion): number {
  return Math.max(1.4, getTimelinePercent(event.duration_seconds, region.duration_seconds))
}

function getEventTopPercent(event: PitchEvent, events: PitchEvent[]): number {
  const pitchRange = getPitchEventRange(events)
  const midi = typeof event.pitch_midi === 'number' ? event.pitch_midi : pitchRange.minMidi
  const span = Math.max(1, pitchRange.maxMidi - pitchRange.minMidi)
  return Math.max(3, Math.min(91, ((pitchRange.maxMidi - midi) / span) * 88 + 3))
}

function getGridSeconds(bpm: number): number {
  return (60 / Math.max(1, bpm)) / 2
}

function roundToGrid(value: number, gridSeconds: number): number {
  return Math.max(0, Math.round(value / gridSeconds) * gridSeconds)
}

function clampRegionStart(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000)
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
      <span>Vol</span>
      <input
        aria-label={`${track.name} volume`}
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
        aria-label={`${track.name} volume percent`}
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

function RegionTools({
  disabled,
  disabledReason,
  gridSeconds,
  region,
  tracks,
  onCopyRegion,
  onDeleteRegion,
  onMoveRegion,
  onSplitRegion,
}: {
  disabled: boolean
  disabledReason: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  tracks: TrackSlot[]
  onCopyRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onDeleteRegion: (region: ArrangementRegion) => void
  onMoveRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onSplitRegion: (region: ArrangementRegion, splitSeconds: number) => void
}) {
  if (!region) {
    return <p className="piano-roll-panel__hint">Select a region to edit arrangement blocks.</p>
  }

  const canMoveUp = region.track_slot_id > Math.min(...tracks.map((track) => track.slot_id))
  const canMoveDown = region.track_slot_id < Math.max(...tracks.map((track) => track.slot_id))
  const midpoint = region.start_seconds + region.duration_seconds / 2

  return (
    <div className="region-tools" aria-label="Region editing tools">
      {disabled && disabledReason ? <p className="region-tools__hint">{disabledReason}</p> : null}
      <button
        disabled={disabled}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id, clampRegionStart(region.start_seconds - gridSeconds))}
      >
        Move left
      </button>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id, clampRegionStart(region.start_seconds + gridSeconds))}
      >
        Move right
      </button>
      <button disabled={disabled} type="button" onClick={() => onSplitRegion(region, midpoint)}>
        Split
      </button>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onCopyRegion(region, region.track_slot_id, region.start_seconds + region.duration_seconds)}
      >
        Copy
      </button>
      <button
        disabled={disabled || !canMoveUp}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id - 1, region.start_seconds)}
      >
        Track up
      </button>
      <button
        disabled={disabled || !canMoveDown}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id + 1, region.start_seconds)}
      >
        Track down
      </button>
      <button className="region-tools__danger" disabled={disabled} type="button" onClick={() => onDeleteRegion(region)}>
        Delete
      </button>
    </div>
  )
}

function PianoRollPanel({
  disabled,
  disabledReason,
  focusedEventId,
  gridSeconds,
  region,
  selectedEventId,
  onSelectEvent,
  onUpdateEvent,
}: {
  disabled: boolean
  disabledReason: string | null
  focusedEventId?: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  selectedEventId: string | null
  onSelectEvent: (eventId: string) => void
  onUpdateEvent: (region: ArrangementRegion, event: PitchEvent, patch: UpdatePitchEventRequest) => void
}) {
  const events = region ? getPitchedEvents(region.pitch_events) : []
  const selectedEvent =
    events.find((event) => event.event_id === selectedEventId) ??
    events.find((event) => event.event_id === focusedEventId) ??
    events[0] ??
    null
  const pitchRange = getPitchEventRange(events)
  const pitchLabels = Array.from({ length: 5 }, (_, index) => {
    const midi = Math.round(
      pitchRange.maxMidi - ((pitchRange.maxMidi - pitchRange.minMidi) / 4) * index,
    )
    return `M${midi}`
  })

  function updateSelectedEvent(patch: UpdatePitchEventRequest) {
    if (!region || !selectedEvent) {
      return
    }
    onUpdateEvent(region, selectedEvent, patch)
  }

  return (
    <section className="piano-roll-panel" aria-label="Piano roll editor">
      <header>
        <div>
          <p className="eyebrow">Micro editor</p>
          <h3>{region ? `${region.track_name} Piano Roll` : 'Piano Roll'}</h3>
        </div>
        <div className="piano-roll-panel__tools" aria-label="Piano roll tools">
          {disabled && disabledReason ? <span className="piano-roll-panel__lock">{disabledReason}</span> : null}
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() => {
              if (selectedEvent?.pitch_midi !== null && selectedEvent?.pitch_midi !== undefined) {
                updateSelectedEvent({ pitch_midi: Math.max(0, selectedEvent.pitch_midi - 1) })
              }
            }}
          >
            Pitch -
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() => {
              if (selectedEvent?.pitch_midi !== null && selectedEvent?.pitch_midi !== undefined) {
                updateSelectedEvent({ pitch_midi: Math.min(127, selectedEvent.pitch_midi + 1) })
              }
            }}
          >
            Pitch +
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    start_seconds: clampRegionStart(selectedEvent.start_seconds - gridSeconds),
                  })
                : undefined
            }
          >
            Nudge -
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    start_seconds: clampRegionStart(selectedEvent.start_seconds + gridSeconds),
                  })
                : undefined
            }
          >
            Nudge +
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: Math.max(0.08, selectedEvent.duration_seconds - gridSeconds),
                  })
                : undefined
            }
          >
            Shorter
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: selectedEvent.duration_seconds + gridSeconds,
                  })
                : undefined
            }
          >
            Longer
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: Math.max(gridSeconds, roundToGrid(selectedEvent.duration_seconds, gridSeconds)),
                    start_seconds: roundToGrid(selectedEvent.start_seconds, gridSeconds),
                  })
                : undefined
            }
          >
            Snap
          </button>
        </div>
      </header>

      <div className="piano-roll">
        <div className="piano-roll__keys" aria-hidden="true">
          {pitchLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="piano-roll__grid">
          {region && events.length > 0 ? (
            events.map((event) => (
              <button
                aria-pressed={event.event_id === selectedEvent?.event_id}
                className={`piano-roll__event ${
                  event.event_id === focusedEventId || event.event_id === selectedEvent?.event_id
                    ? 'is-focused'
                    : ''
                }`}
                data-testid={`piano-event-${event.event_id}`}
                key={event.event_id}
                style={
                  {
                    '--event-left': `${getEventLeftPercent(event, region)}%`,
                    '--event-top': `${getEventTopPercent(event, events)}%`,
                    '--event-width': `${getEventWidthPercent(event, region)}%`,
                  } as CSSProperties
                }
                title={`${event.label} - ${formatDurationSeconds(event.duration_seconds)}`}
                type="button"
                onClick={() => onSelectEvent(event.event_id)}
              >
                {event.label}
              </button>
            ))
          ) : (
            <p>Select a region with pitch events.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function PracticeWaterfall({
  playheadSeconds,
  regions,
  timelineSeconds,
}: {
  playheadSeconds: number | null
  regions: ArrangementRegion[]
  timelineSeconds: number
}) {
  const events = regions.flatMap((region) =>
    getPitchedEvents(region.pitch_events).map((event) => ({ event, region })),
  )

  return (
    <section className="practice-waterfall" aria-label="Practice preview">
      <header>
        <div>
          <p className="eyebrow">Practice mode</p>
          <h3>Waterfall</h3>
        </div>
        <span>{events.length} events</span>
      </header>
      <div className="practice-waterfall__stage" style={getPlayheadStyle(playheadSeconds, timelineSeconds)}>
        <i className="practice-waterfall__playhead" aria-hidden="true" />
        {regions.map((region) => (
          <div className="practice-waterfall__lane" key={region.region_id}>
            <span>{region.track_name}</span>
          </div>
        ))}
        {events.map(({ event, region }) => (
          <i
            aria-label={`${region.track_name} ${event.label}`}
            className="practice-waterfall__note"
            key={`${region.region_id}-${event.event_id}`}
            style={
              {
                '--waterfall-left': `${getTimelinePercent(region.track_slot_id - 1, 6)}%`,
                '--waterfall-top': `${getTimelinePercent(event.start_seconds, timelineSeconds)}%`,
                '--waterfall-height': `${Math.max(1.2, getTimelinePercent(event.duration_seconds, timelineSeconds))}%`,
              } as CSSProperties
            }
            title={`${region.track_name} - ${event.label}`}
          />
        ))}
      </div>
    </section>
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
  const timelineSeconds = useMemo(
    () =>
      Math.max(
        getArrangementRegionDurationSeconds(regions, 12),
        playheadSeconds ?? 0,
      ),
    [playheadSeconds, regions],
  )
  const measureStarts = useMemo(
    () => getMeasureStarts(timelineSeconds, bpm, beatsPerMeasure),
    [beatsPerMeasure, bpm, timelineSeconds],
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
    ? `${selectedRegion?.track_name ?? '선택한 트랙'} 추출 작업이 끝난 뒤 편집할 수 있습니다.`
    : editDisabledReason

  return (
    <section className="studio-tracks" aria-label="Six-track region editor">
      <div className="studio-tracks__header">
        <div>
          <p className="eyebrow">Arrangement</p>
          <h2>Region View + Piano Roll</h2>
        </div>
        <div className="studio-tracks__summary">
          <span>{registeredTracks.length} registered</span>
          <span>{regions.length} regions</span>
          <span>{pendingCandidateCount} review</span>
          <span>{playingSlots.size} playing</span>
        </div>
      </div>

      <div className="arrangement-ruler" aria-hidden="true">
        {measureStarts.map((seconds, index) => (
          <span
            key={`measure-${seconds}`}
            style={{ '--measure-left': `${getTimelinePercent(seconds, timelineSeconds)}%` } as CSSProperties}
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
            ? `${track.name} 트랙은 추출 작업이 끝난 뒤 편집할 수 있습니다.`
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

              <div
                className="track-card__timeline track-card__region-lane"
                aria-label={`${track.name} region lane`}
                style={getRegionLaneStyle(isPlaying, playheadSeconds, timelineSeconds, trackRegions.length)}
              >
                <div className="track-card__measure-grid" aria-hidden="true">
                  {measureStarts.map((seconds) => (
                    <i
                      key={`${track.slot_id}-${seconds}`}
                      style={{ '--measure-left': `${getTimelinePercent(seconds, timelineSeconds)}%` } as CSSProperties}
                    />
                  ))}
                </div>
                {isPlaying && playheadSeconds !== null ? (
                  <i className="track-card__playhead" aria-hidden="true" />
                ) : null}
                {trackRegions.length > 0 ? (
                  trackRegions.map((region, index) => (
                    <button
                      aria-label={`${track.name} region ${index + 1}`}
                      aria-pressed={selectedRegion?.region_id === region.region_id}
                      className={`track-card__region-block ${focusedRegionId === region.region_id ? 'is-focused' : ''}`}
                      data-region-id={region.region_id}
                      data-testid={index === 0 ? `track-region-${track.slot_id}` : `track-region-${track.slot_id}-${index + 1}`}
                      key={region.region_id}
                      style={getRegionStyle(region, timelineSeconds, index)}
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
                      <span>{region.source_label ?? track.name}</span>
                      <strong>{getPitchedEvents(region.pitch_events).length} events</strong>
                      <em>
                        {formatDurationSeconds(region.start_seconds)} -{' '}
                        {formatDurationSeconds(region.start_seconds + region.duration_seconds)}
                      </em>
                    </button>
                  ))
                ) : (
                  <p>{needsReview ? 'Review pending for this track' : 'Empty track'}</p>
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
                    <span aria-hidden="true">{isRecording || isCountingIn ? 'Stop' : 'Rec'}</span>
                    {isRecording ? 'Recording' : isCountingIn ? 'Cancel' : 'Record'}
                  </button>
                  <label className={`app-button app-button--secondary track-upload ${trackEditDisabled ? 'is-disabled' : ''}`}>
                    <span aria-hidden="true">Up</span>
                    Upload
                    <input
                      accept={TRACK_UPLOAD_ACCEPT}
                      aria-label={`${track.name} upload`}
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
                    Generate
                  </button>
                </div>

                <div className="track-card__secondary-actions">
                  <button
                    aria-label={`${track.name} sync ${formatSyncStep(syncStepSeconds)} seconds earlier`}
                    className="studio-step-button"
                    data-testid={`track-sync-earlier-${track.slot_id}`}
                    disabled={trackEditDisabled || !isRegistered}
                    type="button"
                    onClick={() => onSync(track, track.sync_offset_seconds - syncStepSeconds)}
                  >
                    -{formatSyncStep(syncStepSeconds)}
                  </button>
                  <button
                    aria-label={`${track.name} sync ${formatSyncStep(syncStepSeconds)} seconds later`}
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
                    aria-label={isPlaying ? `${track.name} pause` : `${track.name} play`}
                    className="studio-icon-button"
                    data-testid={`track-play-${track.slot_id}`}
                    disabled={!isRegistered || (editDisabled && !isPlaying)}
                    type="button"
                    onClick={() => onTogglePlayback(track)}
                  >
                    <span aria-hidden="true">{isPlaying ? 'II' : 'Play'}</span>
                  </button>
                  <button
                    aria-label={`${track.name} stop`}
                    className="studio-icon-button"
                    data-testid={`track-stop-${track.slot_id}`}
                    disabled={!isRegistered || !isPlaying}
                    type="button"
                    onClick={() => onStopPlayback(track)}
                  >
                    <span aria-hidden="true">Stop</span>
                  </button>
                  <button
                    className="app-button app-button--secondary"
                    data-testid={`track-score-${track.slot_id}`}
                    disabled={!canScoreTrack || trackEditDisabled}
                    type="button"
                    title={trackEditDisabledReason ?? undefined}
                    onClick={() => onOpenScore(track)}
                  >
                    Score
                  </button>
                </div>
                {isCountingIn ? (
                  <div
                    className="track-card__count-in"
                    data-testid={`track-count-in-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>One-bar count-in</span>
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
          timelineSeconds={timelineSeconds}
        />
      </div>
    </section>
  )
}
