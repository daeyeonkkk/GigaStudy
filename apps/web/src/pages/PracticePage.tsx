import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ReportFeed } from '../components/studio/ReportFeed'
import { PendingRecordingDialog } from '../components/studio/PendingRecordingDialog'
import { ScoringDrawer } from '../components/studio/ScoringDrawer'
import { StudioRouteState } from '../components/studio/StudioRouteState'
import { StudioPurposeNav } from '../components/studio/StudioPurposeNav'
import { StudioNoticeLine } from '../components/studio/StudioNoticeLine'
import {
  getEventMiniAriaLabel,
  getEventMiniLaneHeight,
  getEventMiniTitle,
  getEventMiniTopPercent,
  getRenderableMiniEvents,
} from '../components/studio/eventMiniLayout'
import type { StudioActionState } from '../components/studio/studioActionState'
import {
  getBeatUnitWidthPixels,
  getFollowScrollLeft,
  getTimelinePixelForSeconds,
  getTimelineWidthPixels,
} from '../components/studio/TrackBoardTimelineLayout'
import { useStudioPlayback } from '../components/studio/useStudioPlayback'
import { useStudioResource } from '../components/studio/useStudioResource'
import { useStudioScoring } from '../components/studio/useStudioScoring'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  formatTrackName,
  getPitchEventRange,
  getStudioMeter,
  STUDIO_TIME_PRECISION_SECONDS,
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
    .flatMap((region) => getRenderableMiniEvents(region.pitch_events).map((event) => ({ event, region })))
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
  eventsByTrack: Map<number, WaterfallEvent[]>,
  minSeconds: number,
  maxSeconds: number,
): CSSProperties {
  const { event, region } = item
  const laneHeightPercent = 100 / 6
  const trackEvents = (eventsByTrack.get(region.track_slot_id) ?? []).map((trackItem) => trackItem.event)
  const pitchTopPercent = getEventMiniTopPercent(event, trackEvents)
  return {
    '--event-hue': getEventHue(event),
    '--event-left': `${getTimelinePercent(event.start_seconds, minSeconds, maxSeconds)}%`,
    '--event-top': `${((region.track_slot_id - 1) * laneHeightPercent) + ((pitchTopPercent / 100) * laneHeightPercent)}%`,
    '--event-width': `${(event.duration_seconds / Math.max(STUDIO_TIME_PRECISION_SECONDS, maxSeconds - minSeconds)) * 100}%`,
  } as CSSProperties
}

function getPlayheadStyle(
  playheadSeconds: number | null,
  minSeconds: number,
  maxSeconds: number,
  laneHeight: number,
  timelineWidthPixels: number,
): CSSProperties {
  return {
    '--practice-lane-height': `${laneHeight}px`,
    '--timeline-beat-width': `${getBeatUnitWidthPixels()}px`,
    '--timeline-width': `${timelineWidthPixels}px`,
    '--playhead-left': `${getTimelinePercent(playheadSeconds ?? minSeconds, minSeconds, maxSeconds)}%`,
  } as CSSProperties
}

function getPracticeLaneHeight(eventsByTrack: Map<number, WaterfallEvent[]>): number {
  const trackHeights = Array.from(eventsByTrack.values()).map((trackEvents) =>
    getEventMiniLaneHeight(
      trackEvents.map((item) => item.event),
      { baseHeight: 70, rowHeight: 10, verticalPadding: 36, maxHeight: 260 },
    ),
  )
  return Math.max(70, ...trackHeights)
}

function PracticeWaterfallStage({
  bpm,
  maxSeconds,
  minSeconds,
  playheadSeconds,
  followPlayhead,
  regions,
  tracks,
}: {
  maxSeconds: number
  minSeconds: number
  bpm: number
  followPlayhead: boolean
  playheadSeconds: number | null
  regions: ArrangementRegion[]
  tracks: TrackSlot[]
}) {
  const stageRef = useRef<HTMLElement | null>(null)
  const events = useMemo(() => getWaterfallEvents(regions), [regions])
  const eventsByTrack = useMemo(() => {
    const next = new Map<number, WaterfallEvent[]>()
    for (const item of events) {
      const trackEvents = next.get(item.region.track_slot_id) ?? []
      trackEvents.push(item)
      next.set(item.region.track_slot_id, trackEvents)
    }
    return next
  }, [events])
  const pitchRange = useMemo(
    () => getPitchEventRange(events.map((item) => item.event)),
    [events],
  )
  const laneHeight = useMemo(() => getPracticeLaneHeight(eventsByTrack), [eventsByTrack])
  const timelineWidthPixels = useMemo(
    () => getTimelineWidthPixels(maxSeconds - minSeconds, bpm),
    [bpm, maxSeconds, minSeconds],
  )
  const timelineBounds = useMemo(
    () => ({
      durationSeconds: Math.max(0.25, maxSeconds - minSeconds),
      maxSeconds,
      minSeconds,
    }),
    [maxSeconds, minSeconds],
  )

  useEffect(() => {
    if (!followPlayhead || playheadSeconds === null) {
      return
    }
    const scrollElement = stageRef.current
    if (!scrollElement) {
      return
    }
    const animationFrameId = window.requestAnimationFrame(() => {
      const playheadPixels = getTimelinePixelForSeconds(playheadSeconds, timelineBounds, bpm)
      const nextScrollLeft = getFollowScrollLeft({
        playheadPixels,
        scrollWidth: scrollElement.scrollWidth,
        viewportWidth: scrollElement.clientWidth,
      })
      if (Math.abs(scrollElement.scrollLeft - nextScrollLeft) > 2) {
        scrollElement.scrollLeft = nextScrollLeft
      }
    })
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [bpm, followPlayhead, playheadSeconds, timelineBounds])

  return (
    <section className="practice-stage" ref={stageRef} aria-label="연습 화면">
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
        style={getPlayheadStyle(playheadSeconds, minSeconds, maxSeconds, laneHeight, timelineWidthPixels)}
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
          <p className="practice-stage__empty">음표 없음</p>
        ) : (
          events.map((item) => (
            <i
              aria-label={getEventMiniAriaLabel(item.event, item.region.track_name)}
              className="practice-stage__event"
              key={`${item.region.region_id}-${item.event.event_id}`}
              style={getEventStyle(item, eventsByTrack, minSeconds, maxSeconds)}
              title={getEventMiniTitle(item.event, item.region.track_name)}
            >
              <span className="event-mini__sr">{item.event.label}</span>
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
    setStudio,
    studio,
  } = useStudioResource(
    studioId,
    (notice) =>
      setActionState((current) =>
        current.phase === 'busy' && notice.phase === 'warning'
          ? { ...current, detail: notice.message }
          : notice,
      ),
    (notice) => setActionState(notice),
    'practice',
  )

  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [selectedScoreTargetSlotId, setSelectedScoreTargetSlotId] = useState<number | null>(null)
  const studioMeter = useMemo(
    () => (studio ? getStudioMeter(studio) : DEFAULT_METER),
    [studio],
  )
  const {
    changePlaybackSource,
    markReferencePlayback,
    playbackSource,
    playbackTransportState,
    playbackTimeline,
    playheadSeconds,
    selectAllPlaybackTracks,
    selectedPlaybackSlotIds,
    startPlaybackSession,
    startSelectedPlayback,
    stopGlobalPlayback,
    stopPlaybackSession,
    toggleGlobalPlayback,
    togglePlaybackSelection,
  } = useStudioPlayback({
    metronomeEnabled,
    registeredSlotIds,
    registeredTracks,
    setActionState,
    studio,
    studioMeter,
  })
  const {
    cancelScoreSession,
    handleDiscardPendingScoreRecording,
    handleStartPendingScoreRecording,
    openScoreSession,
    pendingScoreRecording,
    scoreSession,
    scoreTargetTrack,
    setScoreIncludeMetronome,
    startScoreListening,
    stopScoreListening,
    toggleScoreReference,
    toggleScoreReferencePlayback,
    updateScoreMode,
  } = useStudioScoring({
    markReferencePlayback,
    metronomeEnabled,
    recordingSlotId: null,
    registeredSlotIds,
    setActionState,
    setStudio,
    startPlaybackSession,
    stopPlaybackSession,
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
  const practiceControlsLocked = actionBusy || scoreSession !== null || pendingScoreRecording !== null
  const playbackActive = playbackTransportState === 'playing'
  const playbackPaused = playbackTransportState === 'paused'
  const playbackIdle = playbackTransportState === 'idle'
  const selectedScoreTargetTrack =
    studio?.tracks.find((track) => track.slot_id === selectedScoreTargetSlotId) ??
    registeredTracks[0] ??
    studio?.tracks[0] ??
    null
  const canScoreSelectedTrack = selectedScoreTargetTrack
    ? selectedScoreTargetTrack.status === 'registered' ||
      registeredTracks.some((track) => track.slot_id !== selectedScoreTargetTrack.slot_id)
    : false
  const scoreControlsLocked = practiceControlsLocked || !playbackIdle

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="홈"
        message="스튜디오 주소가 올바르지 않습니다."
        title="연습 모드를 열 수 없습니다"
        tone="오류"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="연습 화면을 준비하는 중입니다"
        tone="불러오는 중"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="홈"
        message={loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}
        title="연습 모드를 열 수 없습니다"
        tone="오류"
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
        </header>

        <StudioPurposeNav
          active="practice"
          studioId={studio.studio_id}
        />

        <section className="practice-page-brief" aria-label="연습">
          <div>
            <p className="eyebrow">연습</p>
            <h1>{studio.title}</h1>
          </div>
          <p>{studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4}</p>
        </section>

        <div className="practice-toolbar" aria-label="연습 재생 제어">
          <button
            className="composer-tool composer-tool--primary"
            data-testid="practice-play-button"
            disabled={playbackIdle && (selectedTrackCount === 0 || practiceControlsLocked)}
            type="button"
            onClick={() => void (playbackIdle ? startSelectedPlayback() : toggleGlobalPlayback())}
          >
            {playbackPaused ? '이어 재생' : playbackActive ? '일시정지' : '재생'}
          </button>
          <button
            className="composer-tool"
            data-testid="practice-stop-button"
            disabled={playbackIdle}
            type="button"
            onClick={stopGlobalPlayback}
          >
            중지
          </button>
          <button
            className="composer-tool composer-tool--text"
            disabled={registeredTracks.length === 0 || !playbackIdle || practiceControlsLocked}
            type="button"
            onClick={selectAllPlaybackTracks}
          >
            전체 선택
          </button>
          <label className="composer-metronome">
            <input
              checked={metronomeEnabled}
              disabled={practiceControlsLocked || !playbackIdle}
              type="checkbox"
              onChange={(event) => setMetronomeEnabled(event.target.checked)}
            />
            메트로놈
          </label>
          <div className="composer-source-toggle" role="group" aria-label="재생 방식">
            <button
              aria-pressed={playbackSource === 'audio'}
              className={playbackSource === 'audio' ? 'is-active' : ''}
              disabled={!playbackIdle || practiceControlsLocked}
              type="button"
              onClick={() => changePlaybackSource('audio')}
            >
              원음 우선
            </button>
            <button
              aria-pressed={playbackSource === 'events'}
              className={playbackSource === 'events' ? 'is-active' : ''}
              disabled={!playbackIdle || practiceControlsLocked}
              type="button"
              onClick={() => changePlaybackSource('events')}
            >
              연주음만
            </button>
          </div>
        </div>

        <section className="practice-track-picker" aria-label="연습 트랙 선택">
          {studio.tracks.map((track) => {
            const isRegistered = registeredSlotIds.includes(track.slot_id)
            return (
              <label className={isRegistered ? '' : 'is-empty'} key={track.slot_id}>
                <input
                  checked={isRegistered && selectedPlaybackSlotIds.has(track.slot_id)}
                  data-testid={`practice-track-checkbox-${track.slot_id}`}
                  disabled={!isRegistered || !playbackIdle || practiceControlsLocked}
                  type="checkbox"
                  onChange={() => togglePlaybackSelection(track.slot_id)}
                />
                <span>{formatTrackName(track.name)}</span>
                {!isRegistered ? <em>비어 있음</em> : null}
              </label>
            )
          })}
        </section>

        <section className="practice-score-panel" aria-label="채점">
          <div className="practice-score-panel__heading">
            <span>채점할 파트</span>
            <strong>{selectedScoreTargetTrack ? formatTrackName(selectedScoreTargetTrack.name) : '파트 선택'}</strong>
          </div>
          <div className="practice-score-targets" role="group" aria-label="채점할 파트 선택">
            {studio.tracks.map((track) => {
              const isSelected = selectedScoreTargetTrack?.slot_id === track.slot_id
              const hasReference = registeredTracks.some((registeredTrack) => registeredTrack.slot_id !== track.slot_id)
              const canUseTrack = track.status === 'registered' || hasReference
              return (
                <button
                  aria-pressed={isSelected}
                  className={isSelected ? 'is-selected' : ''}
                  data-testid={`practice-score-target-${track.slot_id}`}
                  disabled={!canUseTrack || scoreControlsLocked}
                  key={track.slot_id}
                  type="button"
                  onClick={() => setSelectedScoreTargetSlotId(track.slot_id)}
                >
                  <strong>{formatTrackName(track.name)}</strong>
                  <span>{track.status === 'registered' ? '정답' : hasReference ? '화음' : '비어 있음'}</span>
                </button>
              )
            })}
          </div>
          <button
            className="app-button"
            data-testid="practice-score-button"
            disabled={!selectedScoreTargetTrack || !canScoreSelectedTrack || scoreControlsLocked}
            type="button"
            onClick={() => {
              if (selectedScoreTargetTrack) {
                openScoreSession(selectedScoreTargetTrack)
              }
            }}
          >
            채점
          </button>
        </section>

        <StudioNoticeLine className="practice-status-line" notice={actionState} />

        <PracticeWaterfallStage
          bpm={studio.bpm}
          followPlayhead={playbackActive}
          maxSeconds={playbackTimeline?.maxSeconds ?? timelineBounds.maxSeconds}
          minSeconds={playbackTimeline?.minSeconds ?? timelineBounds.minSeconds}
          playheadSeconds={playheadSeconds}
          regions={regions}
          tracks={studio.tracks}
        />

        <footer className="composer-statusbar">
          <span>{playbackPaused ? '일시정지' : playbackActive ? '재생 중' : '준비 완료'}</span>
          <span>{selectedTrackCount}/{studio.tracks.length} 트랙</span>
          <span>{playbackSource === 'audio' ? '원음 우선 재생' : '연주음만 재생'}</span>
          <span>
            {formatDurationSeconds(playheadSeconds ?? 0)} /{' '}
            {formatDurationSeconds(playbackTimeline?.maxSeconds ?? timelineBounds.maxSeconds)}
          </span>
        </footer>
      </section>

      <ReportFeed reports={studio.reports} studioId={studio.studio_id} tracks={studio.tracks} />

      <ScoringDrawer
        busy={actionBusy}
        scoreSession={scoreSession}
        targetTrack={scoreTargetTrack}
        tracks={studio.tracks}
        onCancel={cancelScoreSession}
        onIncludeMetronomeChange={setScoreIncludeMetronome}
        onScoreModeChange={updateScoreMode}
        onStart={() => void startScoreListening()}
        onStop={() => void stopScoreListening()}
        onToggleReference={toggleScoreReference}
        onToggleReferencePlayback={toggleScoreReferencePlayback}
      />

      {pendingScoreRecording ? (
        <PendingRecordingDialog
          busy={actionBusy}
          description="아직 채점을 시작하지 않았습니다. 들어보고 채점을 시작하거나 삭제하세요."
          eyebrow="채점 녹음 확인"
          registerLabel="채점 시작"
          recording={pendingScoreRecording}
          title={`${formatTrackName(pendingScoreRecording.trackName)} 채점 녹음`}
          onDiscard={handleDiscardPendingScoreRecording}
          onRegister={() => void handleStartPendingScoreRecording()}
        />
      ) : null}
    </main>
  )
}
