import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

import { StudioRouteState } from '../components/studio/StudioRouteState'
import type { StudioActionState } from '../components/studio/studioActionState'
import { useStudioPlayback } from '../components/studio/useStudioPlayback'
import { useStudioResource } from '../components/studio/useStudioResource'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  getPitchEventRange,
  getPitchedEvents,
  getStudioMeter,
} from '../lib/studio'
import type { ArrangementRegion, PitchEvent, TrackSlot } from '../types/studio'
import './StudioPage.css'
import './PracticePage.css'

type WaterfallEvent = {
  event: PitchEvent
  region: ArrangementRegion
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

function getTimelinePercent(seconds: number, minSeconds: number, maxSeconds: number): number {
  const durationSeconds = Math.max(0.25, maxSeconds - minSeconds)
  return clampPercent(((seconds - minSeconds) / durationSeconds) * 100)
}

function getTimelineBounds(regions: ArrangementRegion[], playheadSeconds: number | null) {
  const minSeconds = Math.min(0, ...regions.map((region) => region.start_seconds), playheadSeconds ?? 0)
  const maxSeconds = Math.max(
    12,
    playheadSeconds ?? 0,
    ...regions.map((region) => region.start_seconds + region.duration_seconds),
    ...regions.flatMap((region) =>
      region.pitch_events.map((event) => event.start_seconds + event.duration_seconds),
    ),
  )
  return { maxSeconds, minSeconds }
}

function getWaterfallEvents(regions: ArrangementRegion[]): WaterfallEvent[] {
  return regions
    .flatMap((region) => getPitchedEvents(region.pitch_events).map((event) => ({ event, region })))
    .sort(
      (left, right) =>
        left.event.start_seconds - right.event.start_seconds ||
        left.region.track_slot_id - right.region.track_slot_id ||
        left.event.event_id.localeCompare(right.event.event_id),
    )
}

function getTrackLaneStyle(track: TrackSlot): CSSProperties {
  return {
    '--track-lane-index': track.slot_id - 1,
  } as CSSProperties
}

function getEventHue(event: PitchEvent): number {
  if (typeof event.pitch_midi !== 'number') {
    return 204
  }
  return 188 + ((event.pitch_midi % 12) * 12)
}

function getEventStyle(
  item: WaterfallEvent,
  minSeconds: number,
  maxSeconds: number,
): CSSProperties {
  const { event, region } = item
  return {
    '--event-hue': getEventHue(event),
    '--event-lane-index': region.track_slot_id - 1,
    '--event-top': `${getTimelinePercent(event.start_seconds, minSeconds, maxSeconds)}%`,
    '--event-height': `${Math.max(
      1.3,
      getTimelinePercent(
        event.start_seconds + event.duration_seconds,
        event.start_seconds,
        event.start_seconds + Math.max(0.25, maxSeconds - minSeconds),
      ),
    )}%`,
  } as CSSProperties
}

function getPlayheadStyle(
  playheadSeconds: number | null,
  minSeconds: number,
  maxSeconds: number,
): CSSProperties {
  return {
    '--playhead-top': `${getTimelinePercent(playheadSeconds ?? minSeconds, minSeconds, maxSeconds)}%`,
  } as CSSProperties
}

function PracticeStatus({ actionState }: { actionState: StudioActionState }) {
  return (
    <section className="studio-status-line practice-status-line" aria-live="polite">
      <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
      <p>
        {actionState.phase === 'idle'
          ? 'Practice ready.'
          : actionState.message}
      </p>
    </section>
  )
}

function PracticeWaterfallStage({
  maxSeconds,
  minSeconds,
  playheadSeconds,
  regions,
  tracks,
}: {
  maxSeconds: number
  minSeconds: number
  playheadSeconds: number | null
  regions: ArrangementRegion[]
  tracks: TrackSlot[]
}) {
  const events = useMemo(() => getWaterfallEvents(regions), [regions])
  const pitchRange = useMemo(
    () => getPitchEventRange(events.map((item) => item.event)),
    [events],
  )

  return (
    <section className="practice-stage" aria-label="Waterfall practice timing view">
      <div className="practice-stage__labels" aria-hidden="true">
        <span>{formatDurationSeconds(minSeconds)}</span>
        <span>
          M{pitchRange.maxMidi} - M{pitchRange.minMidi}
        </span>
        <span>{formatDurationSeconds(maxSeconds)}</span>
      </div>
      <div
        className="practice-stage__grid"
        data-testid="practice-waterfall-stage"
        style={getPlayheadStyle(playheadSeconds, minSeconds, maxSeconds)}
      >
        <i className="practice-stage__playhead" aria-hidden="true" />
        {tracks.map((track) => (
          <div
            className="practice-stage__lane"
            key={track.slot_id}
            style={getTrackLaneStyle(track)}
          >
            <span>{track.name}</span>
          </div>
        ))}
        {events.length === 0 ? (
          <p className="practice-stage__empty">No registered pitch events yet.</p>
        ) : (
          events.map((item) => (
            <i
              aria-label={`${item.region.track_name} ${item.event.label}`}
              className="practice-stage__event"
              key={`${item.region.region_id}-${item.event.event_id}`}
              style={getEventStyle(item, minSeconds, maxSeconds)}
              title={`${item.region.track_name} - ${item.event.label}`}
            >
              <span>{item.event.label}</span>
            </i>
          ))
        )}
      </div>
    </section>
  )
}

export function PracticePage() {
  const { studioId } = useParams()
  const [actionState, setActionState] = useState<StudioActionState>({ phase: 'idle' })
  const {
    loadState,
    registeredSlotIds,
    registeredTracks,
    studio,
  } = useStudioResource(studioId, (message) => setActionState({ phase: 'error', message }))
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const studioMeter = useMemo(
    () => (studio ? getStudioMeter(studio) : DEFAULT_METER),
    [studio],
  )
  const {
    changePlaybackSource,
    globalPlaying,
    playbackSource,
    playbackTimeline,
    playheadSeconds,
    selectAllPlaybackTracks,
    selectedPlaybackSlotIds,
    startSelectedPlayback,
    stopGlobalPlayback,
    togglePlaybackSelection,
  } = useStudioPlayback({
    metronomeEnabled,
    registeredSlotIds,
    registeredTracks,
    setActionState,
    studio,
    studioMeter,
  })

  const regions = useMemo(() => studio?.regions ?? [], [studio])
  const timelineBounds = useMemo(
    () => getTimelineBounds(regions, playheadSeconds),
    [playheadSeconds, regions],
  )
  const selectedTrackCount = registeredTracks.filter((track) =>
    selectedPlaybackSlotIds.has(track.slot_id),
  ).length

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="Home"
        message="The studio address is invalid."
        title="Practice mode cannot be opened"
        tone="Practice error"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="Preparing the practice view"
        tone="Practice loading"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="Home"
        message={loadState.phase === 'error' ? loadState.message : 'An unknown error occurred.'}
        title="Practice mode cannot be opened"
        tone="Practice error"
      />
    )
  }

  return (
    <main className="app-shell practice-page">
      <section className="practice-window" aria-label="GigaStudy practice mode">
        <header className="composer-titlebar">
          <Link className="composer-app-mark" to="/" aria-label="Home">
            GS
          </Link>
          <span>GigaStudy Practice - {studio.title}</span>
          <div className="composer-window-buttons" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </header>

        <div className="practice-toolbar" aria-label="Practice playback controls">
          <Link className="composer-tool composer-tool--text" to={`/studios/${studio.studio_id}`}>
            Edit
          </Link>
          <button
            className="composer-tool composer-tool--primary"
            data-testid="practice-play-button"
            disabled={selectedTrackCount === 0 || actionState.phase === 'busy'}
            type="button"
            onClick={() => void startSelectedPlayback()}
          >
            {globalPlaying ? 'Restart' : 'Play'}
          </button>
          <button
            className="composer-tool"
            data-testid="practice-stop-button"
            type="button"
            onClick={stopGlobalPlayback}
          >
            Stop
          </button>
          <button
            className="composer-tool composer-tool--text"
            disabled={registeredTracks.length === 0}
            type="button"
            onClick={selectAllPlaybackTracks}
          >
            All
          </button>
          <label className="composer-metronome">
            <input
              checked={metronomeEnabled}
              type="checkbox"
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            Metronome
          </label>
          <div className="composer-source-toggle" role="group" aria-label="Playback source">
            <button
              aria-pressed={playbackSource === 'audio'}
              className={playbackSource === 'audio' ? 'is-active' : ''}
              type="button"
              onClick={() => changePlaybackSource('audio')}
            >
              Audio
            </button>
            <button
              aria-pressed={playbackSource === 'events'}
              className={playbackSource === 'events' ? 'is-active' : ''}
              type="button"
              onClick={() => changePlaybackSource('events')}
            >
              Events
            </button>
          </div>
        </div>

        <section className="practice-track-picker" aria-label="Practice track selection">
          {registeredTracks.length === 0 ? (
            <p>No registered tracks yet.</p>
          ) : (
            registeredTracks.map((track) => (
              <label key={track.slot_id}>
                <input
                  checked={selectedPlaybackSlotIds.has(track.slot_id)}
                  data-testid={`practice-track-checkbox-${track.slot_id}`}
                  type="checkbox"
                  onChange={() => togglePlaybackSelection(track.slot_id)}
                />
                <span>{track.name}</span>
              </label>
            ))
          )}
        </section>

        <PracticeStatus actionState={actionState} />

        <PracticeWaterfallStage
          maxSeconds={playbackTimeline?.maxSeconds ?? timelineBounds.maxSeconds}
          minSeconds={playbackTimeline?.minSeconds ?? timelineBounds.minSeconds}
          playheadSeconds={playheadSeconds}
          regions={regions}
          tracks={studio.tracks}
        />

        <footer className="composer-statusbar">
          <span>{globalPlaying ? 'Playing' : 'Ready'}</span>
          <span>{selectedTrackCount}/{registeredTracks.length} tracks</span>
          <span>{playbackSource === 'audio' ? 'Audio source' : 'Event source'}</span>
          <span>
            {formatDurationSeconds(playheadSeconds ?? 0)} /{' '}
            {formatDurationSeconds(playbackTimeline?.maxSeconds ?? timelineBounds.maxSeconds)}
          </span>
        </footer>
      </section>
    </main>
  )
}
