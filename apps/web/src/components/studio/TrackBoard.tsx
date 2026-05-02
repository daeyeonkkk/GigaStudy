import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_UPLOAD_ACCEPT,
  buildArrangementRegions,
  formatDurationSeconds,
  formatSeconds,
  getArrangementRegionDurationSeconds,
  getJobStatusLabel,
  getPitchEventRange,
  getPitchedEvents,
  getTrackSourceLabel,
  statusLabels,
} from '../../lib/studio'
import type { ArrangementRegion, PitchEvent, TrackExtractionJob, TrackSlot } from '../../types/studio'
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
  beatsPerMeasure: number
  bpm: number
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
  onGenerate: (track: TrackSlot) => void
  onOpenScore: (track: TrackSlot) => void
  onRecord: (track: TrackSlot) => void
  onStopPlayback: (track: TrackSlot) => void
  onSync: (track: TrackSlot, nextOffset: number) => void
  onTogglePlayback: (track: TrackSlot) => void
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

function getRegionStyle(region: ArrangementRegion, timelineSeconds: number): CSSProperties {
  return {
    '--region-left': `${getTimelinePercent(region.start_seconds, timelineSeconds)}%`,
    '--region-width': `${Math.max(1.5, getTimelinePercent(region.duration_seconds, timelineSeconds))}%`,
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

function PianoRollPanel({
  focusedEventId,
  region,
}: {
  focusedEventId?: string | null
  region: ArrangementRegion | null
}) {
  const events = region ? getPitchedEvents(region.pitch_events) : []
  const pitchRange = getPitchEventRange(events)
  const pitchLabels = Array.from({ length: 5 }, (_, index) => {
    const midi = Math.round(
      pitchRange.maxMidi - ((pitchRange.maxMidi - pitchRange.minMidi) / 4) * index,
    )
    return `M${midi}`
  })

  return (
    <section className="piano-roll-panel" aria-label="피아노 롤 편집기">
      <header>
        <div>
          <p className="eyebrow">Micro editor</p>
          <h3>{region ? `${region.track_name} Piano Roll` : 'Piano Roll'}</h3>
        </div>
        <div className="piano-roll-panel__tools" aria-label="피아노 롤 도구">
          <button type="button">Snap</button>
          <button type="button">Quantize</button>
          <button type="button">Pitch</button>
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
                className={`piano-roll__event ${event.event_id === focusedEventId ? 'is-focused' : ''}`}
                data-testid={`piano-event-${event.event_id}`}
                key={event.event_id}
                style={
                  {
                    '--event-left': `${getEventLeftPercent(event, region)}%`,
                    '--event-top': `${getEventTopPercent(event, events)}%`,
                    '--event-width': `${getEventWidthPercent(event, region)}%`,
                  } as CSSProperties
                }
                title={`${event.label} · ${formatDurationSeconds(event.duration_seconds)}`}
                type="button"
              >
                {event.label}
              </button>
            ))
          ) : (
            <p>선택한 리전에 피치 이벤트가 없습니다.</p>
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
    <section className="practice-waterfall" aria-label="폭포수 연습 미리보기">
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
            title={`${region.track_name} · ${event.label}`}
          />
        ))}
      </div>
    </section>
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
  focusedEventId,
  focusedRegionId,
  arrangementRegions,
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
  const regions = useMemo(
    () => (arrangementRegions.length > 0 ? arrangementRegions : buildArrangementRegions(tracks, bpm)),
    [arrangementRegions, bpm, tracks],
  )
  const regionsByTrack = useMemo(
    () => new Map(regions.map((region) => [region.track_slot_id, region])),
    [regions],
  )
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
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const focusedRegionExists = focusedRegionId
    ? regions.some((region) => region.region_id === focusedRegionId)
    : false
  const effectiveSelectedRegionId = selectedRegionId ?? (focusedRegionExists ? focusedRegionId : null)
  const selectedRegion =
    regions.find((region) => region.region_id === effectiveSelectedRegionId) ?? regions[0] ?? null

  return (
    <section className="studio-tracks" aria-label="6트랙 리전 편곡">
      <div className="studio-tracks__header">
        <div>
          <p className="eyebrow">Arrangement</p>
          <h2>Region View + Piano Roll</h2>
        </div>
        <div className="studio-tracks__summary">
          <span>{registeredTracks.length} registered</span>
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
          const region = regionsByTrack.get(track.slot_id) ?? null
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
                aria-label={`${track.name} 리전 레인`}
                style={getPlayheadStyle(isPlaying ? playheadSeconds : null, timelineSeconds)}
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
                {region ? (
                  <button
                    aria-pressed={selectedRegion?.region_id === region.region_id}
                    className={`track-card__region-block ${focusedRegionId === region.region_id ? 'is-focused' : ''}`}
                    data-testid={`track-region-${track.slot_id}`}
                    style={getRegionStyle(region, timelineSeconds)}
                    type="button"
                    onClick={() => setSelectedRegionId(region.region_id)}
                    onDoubleClick={() => setSelectedRegionId(region.region_id)}
                  >
                    <span>{region.source_label ?? track.name}</span>
                    <strong>{getPitchedEvents(region.pitch_events).length} events</strong>
                    <em>{formatDurationSeconds(region.duration_seconds)}</em>
                  </button>
                ) : (
                  <p>{needsReview ? '검토 대기 트랙' : '비어 있는 트랙'}</p>
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
                    <span aria-hidden="true">↥</span>
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
                    <span aria-hidden="true">AI</span>
                    생성
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
                    data-testid={`track-play-${track.slot_id}`}
                    disabled={!isRegistered}
                    type="button"
                    onClick={() => onTogglePlayback(track)}
                  >
                    <span aria-hidden="true">{isPlaying ? 'II' : '▶'}</span>
                  </button>
                  <button
                    aria-label={`${track.name} 중지`}
                    className="studio-icon-button"
                    data-testid={`track-stop-${track.slot_id}`}
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

      <div className="editor-panels">
        <PianoRollPanel focusedEventId={focusedEventId} region={selectedRegion} />
        <PracticeWaterfall
          playheadSeconds={playheadSeconds}
          regions={regions}
          timelineSeconds={timelineSeconds}
        />
      </div>
    </section>
  )
}
