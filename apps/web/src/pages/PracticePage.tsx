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
  formatTrackName,
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
    '--event-left': `${getTimelinePercent(event.start_seconds, minSeconds, maxSeconds)}%`,
    '--event-width': `${Math.max(1.4, (event.duration_seconds / Math.max(0.25, maxSeconds - minSeconds)) * 100)}%`,
  } as CSSProperties
}

function getPlayheadStyle(
  playheadSeconds: number | null,
  minSeconds: number,
  maxSeconds: number,
): CSSProperties {
  return {
    '--playhead-left': `${getTimelinePercent(playheadSeconds ?? minSeconds, minSeconds, maxSeconds)}%`,
  } as CSSProperties
}

function PracticeStatus({ actionState }: { actionState: StudioActionState }) {
  return (
    <section className="studio-status-line practice-status-line" aria-live="polite">
      <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
      <p>
        {actionState.phase === 'idle'
          ? '연습 준비 완료'
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
    <section className="practice-stage" aria-label="연습 타이밍 타임라인">
      <div className="practice-stage__labels" aria-hidden="true">
        <span>{formatDurationSeconds(minSeconds)}</span>
        <span>
          음역 M{pitchRange.maxMidi} - M{pitchRange.minMidi}
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
            <span>{formatTrackName(track.name)}</span>
          </div>
        ))}
        {events.length === 0 ? (
          <p className="practice-stage__empty">등록된 음표가 아직 없습니다.</p>
        ) : (
          events.map((item) => (
            <i
              aria-label={`${formatTrackName(item.region.track_name)} ${item.event.label}`}
              className="practice-stage__event"
              key={`${item.region.region_id}-${item.event.event_id}`}
              style={getEventStyle(item, minSeconds, maxSeconds)}
              title={`${formatTrackName(item.region.track_name)} - ${item.event.label}`}
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
  const actionBusy = actionState.phase === 'busy'

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="홈"
        message="스튜디오 주소가 올바르지 않습니다."
        title="연습 모드를 열 수 없습니다"
        tone="연습 오류"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="연습 화면을 준비하는 중입니다"
        tone="연습 로딩"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="홈"
        message={loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}
        title="연습 모드를 열 수 없습니다"
        tone="연습 오류"
      />
    )
  }

  return (
    <main className="app-shell practice-page">
      <section className="practice-window" aria-label="GigaStudy 연습 모드">
        <header className="composer-titlebar">
          <Link className="composer-app-mark" to="/" aria-label="홈으로">
            GS
          </Link>
          <span>GigaStudy 연습 - {studio.title}</span>
          <div className="composer-window-buttons" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </header>

        <div className="practice-toolbar" aria-label="연습 재생 제어">
          <Link className="composer-tool composer-tool--text" to={`/studios/${studio.studio_id}`}>
            편집
          </Link>
          <button
            className="composer-tool composer-tool--primary"
            data-testid="practice-play-button"
            disabled={selectedTrackCount === 0 || actionBusy}
            type="button"
            onClick={() => void startSelectedPlayback()}
          >
            {globalPlaying ? '처음부터' : '재생'}
          </button>
          <button
            className="composer-tool"
            data-testid="practice-stop-button"
            disabled={!globalPlaying}
            type="button"
            onClick={stopGlobalPlayback}
          >
            중지
          </button>
          <button
            className="composer-tool composer-tool--text"
            disabled={registeredTracks.length === 0 || globalPlaying || actionBusy}
            type="button"
            onClick={selectAllPlaybackTracks}
          >
            전체 선택
          </button>
          <label className="composer-metronome">
            <input
              checked={metronomeEnabled}
              disabled={actionBusy}
              type="checkbox"
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            메트로놈
          </label>
          <div className="composer-source-toggle" role="group" aria-label="재생 방식">
            <button
              aria-pressed={playbackSource === 'audio'}
              className={playbackSource === 'audio' ? 'is-active' : ''}
              disabled={globalPlaying || actionBusy}
              type="button"
              onClick={() => changePlaybackSource('audio')}
            >
              원음 우선
            </button>
            <button
              aria-pressed={playbackSource === 'events'}
              className={playbackSource === 'events' ? 'is-active' : ''}
              disabled={globalPlaying || actionBusy}
              type="button"
              onClick={() => changePlaybackSource('events')}
            >
              연주음만
            </button>
          </div>
        </div>

        <section className="practice-track-picker" aria-label="연습 트랙 선택">
          {registeredTracks.length === 0 ? (
            <p>등록된 트랙이 아직 없습니다.</p>
          ) : (
            registeredTracks.map((track) => (
              <label key={track.slot_id}>
                <input
                  checked={selectedPlaybackSlotIds.has(track.slot_id)}
                  data-testid={`practice-track-checkbox-${track.slot_id}`}
                  disabled={globalPlaying || actionBusy}
                  type="checkbox"
                  onChange={() => togglePlaybackSelection(track.slot_id)}
                />
                <span>{formatTrackName(track.name)}</span>
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
          <span>{globalPlaying ? '재생 중' : '준비 완료'}</span>
          <span>{selectedTrackCount}/{registeredTracks.length} 트랙</span>
          <span>{playbackSource === 'audio' ? '원음 우선 재생' : '연주음만 재생'}</span>
          <span>
            {formatDurationSeconds(playheadSeconds ?? 0)} /{' '}
            {formatDurationSeconds(playbackTimeline?.maxSeconds ?? timelineBounds.maxSeconds)}
          </span>
        </footer>
      </section>
    </main>
  )
}
