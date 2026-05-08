import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { getRecordingLevelPercent } from '../../lib/audio'
import {
  TRACK_RECORDING_UPLOAD_ACCEPT,
  formatDurationSeconds,
  formatDate,
  formatSeconds,
  formatTrackName,
  getArrangementTimelineBounds,
  getJobStatusLabel,
  getTrackArchiveDisplayLabel,
  sortTrackArchivesForDisplay,
  statusLabels,
} from '../../lib/studio'
import type {
  ArrangementRegion,
  PitchEvent,
  TrackMaterialArchiveSummary,
  TrackExtractionJob,
  TrackSlot,
} from '../../types/studio'
import {
  getEventMiniAriaLabel,
  getEventMiniLaneHeight,
  getEventMiniTitle,
  getEventMiniTopPercent,
  getRenderableMiniEvents,
} from './eventMiniLayout'
import { PianoRollPanel, RegionTools, type RegionEditorDraft } from './TrackBoardEditor'
import { getGridSeconds } from './TrackBoardEditorGrid'
import {
  getBeatUnitWidthPixels,
  getDurationPercent,
  getFollowScrollLeft,
  getMeasureStarts,
  getRegionHitAreaStyle,
  getRegionLaneStyle,
  getTimelinePixelForSeconds,
  getTimelineWidthPixels,
  getTimelinePercent,
} from './TrackBoardTimelineLayout'
import {
  clampTrackVolumePercent,
  parseTrackVolumeDraft,
  shouldSaveTrackVolumeDraft,
} from './trackVolumeDraft'
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

type TrackMiniEvent = {
  event: PitchEvent
  region: ArrangementRegion
}

type TrackBoardProps = {
  activeJobSlotIds: Set<number>
  beatsPerMeasure: number
  bpm: number
  draftStorageScope?: string
  mode?: 'studio' | 'editor'
  editDisabled: boolean
  editDisabledReason: string | null
  volumeDisabled?: boolean
  pendingCandidateCount: number
  extractionJobs: TrackExtractionJob[]
  playingSlots: Set<number>
  playheadSeconds: number | null
  followPlayhead?: boolean
  focusedEventId?: string | null
  focusedRegionId?: string | null
  arrangementRegions: ArrangementRegion[]
  registeredTracks: TrackSlot[]
  recordingGuideLabel: string
  recordingSetupSlotId: number | null
  recordingSlotId: number | null
  syncStepSeconds: number
  trackCountIn: TrackCountInState | null
  trackRecordingMeter: TrackRecordingMeter
  trackMaterialArchives?: TrackMaterialArchiveSummary[]
  tracks: TrackSlot[]
  onCopyRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onDeleteRegion: (region: ArrangementRegion) => void
  onGenerate: (track: TrackSlot) => void
  onOpenRegionEditor?: (region: ArrangementRegion) => void
  onOpenTrackArchive?: (track: TrackSlot) => void
  onCreateTuningRender?: (track: TrackSlot) => void
  onUseTrackMaterialVersion?: (track: TrackSlot, archive: TrackMaterialArchiveSummary) => void
  onRenameTrackMaterialVersion?: (archive: TrackMaterialArchiveSummary, label: string) => void
  onDeleteTrackMaterialVersion?: (archive: TrackMaterialArchiveSummary) => void
  onRecord: (track: TrackSlot) => void
  onRestoreRegionRevision?: (region: ArrangementRegion, revisionId: string) => void
  onSaveRegionDraft?: (region: ArrangementRegion, draft: RegionEditorDraft, revisionLabel: string | null) => void
  onSplitRegion: (region: ArrangementRegion, splitSeconds: number) => void
  onStopPlayback: (track: TrackSlot) => void
  onSync: (track: TrackSlot, nextOffset: number) => void
  onTogglePlayback: (track: TrackSlot) => void
  onUpload: (track: TrackSlot, file: File | null) => void
  onVolumePreview: (track: TrackSlot, nextVolumePercent: number) => void
  onVolumeChange: (track: TrackSlot, nextVolumePercent: number) => void
}

function formatSyncStep(seconds: number): string {
  const rounded = Number(seconds.toFixed(3))
  return rounded.toString()
}

function getTrackVolumePercent(track: TrackSlot): number {
  return clampTrackVolumePercent(track.volume_percent)
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

function getTrackMiniEvents(regions: ArrangementRegion[]): TrackMiniEvent[] {
  return regions.flatMap((region) =>
    getRenderableMiniEvents(region.pitch_events).map((event) => ({
      event,
      region,
    })),
  )
}

function getTrackMiniStyle(
  item: TrackMiniEvent,
  trackMiniEvents: TrackMiniEvent[],
  timelineBounds: { durationSeconds: number; maxSeconds: number; minSeconds: number },
): CSSProperties {
  const trackEvents = trackMiniEvents.map((miniEvent) => miniEvent.event)
  return {
    '--event-left': `${getTimelinePercent(item.event.start_seconds, timelineBounds)}%`,
    '--event-top': `${getEventMiniTopPercent(item.event, trackEvents)}%`,
    '--event-width': `${getDurationPercent(item.event.duration_seconds, timelineBounds.durationSeconds)}%`,
  } as CSSProperties
}

function getTrackLaneStyle(
  trackMiniEvents: TrackMiniEvent[],
  isPlaying: boolean,
  playheadSeconds: number | null,
  timelineBounds: { durationSeconds: number; maxSeconds: number; minSeconds: number },
): CSSProperties {
  const laneStyle = getRegionLaneStyle(isPlaying, playheadSeconds, timelineBounds)
  const laneHeight = getEventMiniLaneHeight(trackMiniEvents.map((miniEvent) => miniEvent.event))
  return {
    ...laneStyle,
    '--lane-min-height': `${laneHeight}px`,
  } as CSSProperties
}

function TrackVolumeControl({
  disabled,
  track,
  onVolumePreview,
  onVolumeChange,
}: {
  disabled: boolean
  track: TrackSlot
  onVolumePreview: (track: TrackSlot, nextVolumePercent: number) => void
  onVolumeChange: (track: TrackSlot, nextVolumePercent: number) => void
}) {
  const volumePercent = getTrackVolumePercent(track)
  const [draftVolume, setDraftVolume] = useState(() => String(volumePercent))
  const [lastCommittedVolume, setLastCommittedVolume] = useState(volumePercent)
  const parsedDraftVolume = parseTrackVolumeDraft(draftVolume)
  const rangeVolume = parsedDraftVolume ?? volumePercent

  useEffect(() => {
    setDraftVolume(String(volumePercent))
    setLastCommittedVolume(volumePercent)
  }, [volumePercent])

  function previewVolume(rawValue: string) {
    setDraftVolume(rawValue)
    const parsedValue = parseTrackVolumeDraft(rawValue)
    if (parsedValue !== null) {
      onVolumePreview(track, parsedValue)
    }
  }

  function commitVolume(rawValue = draftVolume) {
    const parsedValue = parseTrackVolumeDraft(rawValue)
    if (parsedValue === null) {
      setDraftVolume(String(volumePercent))
      return
    }
    const nextVolumePercent = clampTrackVolumePercent(parsedValue)
    setDraftVolume(String(nextVolumePercent))
    if (shouldSaveTrackVolumeDraft(nextVolumePercent, lastCommittedVolume)) {
      setLastCommittedVolume(nextVolumePercent)
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
        onBlur={() => commitVolume()}
        onChange={(event) => previewVolume(event.currentTarget.value)}
        onKeyUp={(event) => {
          if (event.key === 'Enter') {
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
        onChange={(event) => previewVolume(event.currentTarget.value)}
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

function TrackMaterialVersionControls({
  archives,
  canCreateTuning,
  disabled,
  track,
  onCreateTuningRender,
  onDeleteTrackMaterialVersion,
  onRenameTrackMaterialVersion,
  onUseTrackMaterialVersion,
}: {
  archives: TrackMaterialArchiveSummary[]
  canCreateTuning: boolean
  disabled: boolean
  track: TrackSlot
  onCreateTuningRender?: (track: TrackSlot) => void
  onUseTrackMaterialVersion?: (track: TrackSlot, archive: TrackMaterialArchiveSummary) => void
  onRenameTrackMaterialVersion?: (archive: TrackMaterialArchiveSummary, label: string) => void
  onDeleteTrackMaterialVersion?: (archive: TrackMaterialArchiveSummary) => void
}) {
  const sortedArchives = useMemo(() => sortTrackArchivesForDisplay(archives), [archives])
  const fallbackArchiveId = sortedArchives[0]?.archive_id ?? ''
  const [userSelectedArchiveId, setUserSelectedArchiveId] = useState<string | null>(null)
  const selectedArchiveId =
    userSelectedArchiveId && sortedArchives.some((archive) => archive.archive_id === userSelectedArchiveId)
      ? userSelectedArchiveId
      : track.active_material_version_id ?? fallbackArchiveId

  const selectedArchive =
    sortedArchives.find((archive) => archive.archive_id === selectedArchiveId) ?? null
  const selectedIsActive = Boolean(
    selectedArchive && selectedArchive.archive_id === track.active_material_version_id,
  )
  const selectedLabel = selectedArchive ? getTrackArchiveDisplayLabel(selectedArchive) : ''

  return (
    <div className="track-version-control" data-testid={`track-version-control-${track.slot_id}`}>
      <span>사용 중인 버전</span>
      <div className="track-version-control__row">
        <select
          aria-label={`${formatTrackName(track.name)} 버전 선택`}
          data-testid={`track-version-select-${track.slot_id}`}
          disabled={disabled || sortedArchives.length === 0}
          value={selectedArchiveId}
          onChange={(event) => setUserSelectedArchiveId(event.currentTarget.value)}
        >
          {sortedArchives.length === 0 ? (
            <option value="">저장된 버전 없음</option>
          ) : (
            sortedArchives.map((archive) => (
              <option key={archive.archive_id} value={archive.archive_id}>
                {getTrackArchiveDisplayLabel(archive)} · {formatDate(archive.archived_at)}
              </option>
            ))
          )}
        </select>
        <button
          className="studio-step-button"
          data-testid={`track-version-use-${track.slot_id}`}
          disabled={disabled || !selectedArchive || selectedIsActive || !onUseTrackMaterialVersion}
          type="button"
          onClick={() => {
            if (!selectedArchive) {
              return
            }
            if (
              window.confirm('현재 편집 상태는 보관 후 교체됩니다. 이 버전을 사용하시겠습니까?')
            ) {
              onUseTrackMaterialVersion?.(track, selectedArchive)
            }
          }}
        >
          이 Track을 사용
        </button>
      </div>
      <div className="track-version-control__actions">
        <button
          className="studio-step-button"
          data-testid={`track-tuning-render-${track.slot_id}`}
          disabled={disabled || !canCreateTuning || !onCreateTuningRender}
          type="button"
          onClick={() => onCreateTuningRender?.(track)}
        >
          편집 반영본 만들기
        </button>
        <button
          className="studio-step-button"
          data-testid={`track-version-rename-${track.slot_id}`}
          disabled={disabled || !selectedArchive || !onRenameTrackMaterialVersion}
          type="button"
          onClick={() => {
            if (!selectedArchive) {
              return
            }
            const nextLabel = window.prompt('버전 이름', selectedLabel)
            if (nextLabel?.trim()) {
              onRenameTrackMaterialVersion?.(selectedArchive, nextLabel.trim())
            }
          }}
        >
          이름 변경
        </button>
        <button
          className="studio-step-button"
          data-testid={`track-version-delete-${track.slot_id}`}
          disabled={
            disabled ||
            !selectedArchive ||
            selectedArchive.pinned ||
            selectedIsActive ||
            !onDeleteTrackMaterialVersion
          }
          type="button"
          onClick={() => {
            if (!selectedArchive) {
              return
            }
            if (window.confirm(`${selectedLabel}을 삭제하시겠습니까?`)) {
              onDeleteTrackMaterialVersion?.(selectedArchive)
            }
          }}
        >
          삭제
        </button>
      </div>
    </div>
  )
}

export function TrackBoard({
  activeJobSlotIds,
  beatsPerMeasure,
  bpm,
  draftStorageScope,
  mode = 'studio',
  editDisabled,
  editDisabledReason,
  volumeDisabled = false,
  pendingCandidateCount,
  extractionJobs,
  playingSlots,
  playheadSeconds,
  followPlayhead = false,
  focusedEventId,
  focusedRegionId,
  arrangementRegions,
  registeredTracks,
  recordingGuideLabel,
  recordingSetupSlotId,
  recordingSlotId,
  syncStepSeconds,
  trackCountIn,
  trackRecordingMeter,
  trackMaterialArchives = [],
  tracks,
  onCopyRegion,
  onDeleteRegion,
  onGenerate,
  onCreateTuningRender,
  onDeleteTrackMaterialVersion,
  onOpenRegionEditor,
  onOpenTrackArchive,
  onRecord,
  onRenameTrackMaterialVersion,
  onRestoreRegionRevision,
  onSaveRegionDraft,
  onSplitRegion,
  onStopPlayback,
  onSync,
  onTogglePlayback,
  onUpload,
  onUseTrackMaterialVersion,
  onVolumePreview,
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
  const timelineWidthPixels = useMemo(() => {
    return getTimelineWidthPixels(timelineBounds.durationSeconds, bpm)
  }, [bpm, timelineBounds.durationSeconds])
  const timelineStyle = {
    '--timeline-beat-width': `${getBeatUnitWidthPixels()}px`,
    '--timeline-width': `${timelineWidthPixels}px`,
  } as CSSProperties
  const gridSeconds = getGridSeconds(bpm)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
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
  const isEditorMode = mode === 'editor'
  const selectedRegionTrack = selectedRegion
    ? tracks.find((track) => track.slot_id === selectedRegion.track_slot_id)
    : null
  const canOpenSelectedRegionEditor = Boolean(selectedRegion && !isEditorMode && onOpenRegionEditor)

  useEffect(() => {
    if (!followPlayhead || playheadSeconds === null) {
      return
    }
    const scrollElement = timelineScrollRef.current
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
    <section className={`studio-tracks studio-tracks--${mode}`} aria-label={isEditorMode ? '구간 편집기' : '6트랙 스튜디오'}>
      <div className="studio-tracks__header">
        <div className="studio-tracks__summary">
          <span>등록 {registeredTracks.length}</span>
          <span>구간 {regions.length}</span>
          <span>검토 {pendingCandidateCount}</span>
          <span>재생 {playingSlots.size}</span>
        </div>
      </div>

      <div className="track-timeline-scroll" ref={timelineScrollRef} style={timelineStyle}>
        <div className="arrangement-ruler" aria-hidden="true">
          {measureStarts.map((measure) => (
            <span
              key={`measure-${measure.measureIndex}`}
              style={{ '--measure-left': `${getTimelinePercent(measure.seconds, timelineBounds)}%` } as CSSProperties}
            >
              {measure.measureIndex}
            </span>
          ))}
        </div>

      <div className="track-stack">
        {tracks.map((track) => {
          const isRegistered = track.status === 'registered'
          const needsReview = track.status === 'needs_review'
          const isSettingUpRecording = recordingSetupSlotId === track.slot_id
          const isRecording = recordingSlotId === track.slot_id
          const isCountingIn = trackCountIn?.slotId === track.slot_id
          const isPlaying = playingSlots.has(track.slot_id)
          const activeJob = getTrackActiveJob(track, extractionJobs)
          const activeJobLocked = activeJobSlotIds.has(track.slot_id) || track.status === 'extracting'
          const isRecordToggleAvailable = isRecording || isCountingIn || isSettingUpRecording
          const trackEditDisabled = editDisabled || activeJobLocked
          const trackVolumeDisabled = volumeDisabled || activeJobLocked
          const trackEditDisabledReason = activeJobLocked
            ? `${formatTrackName(track.name)} 트랙은 추출 작업이 끝난 뒤 편집할 수 있습니다.`
            : editDisabledReason
          const trackRegions = regionsByTrack.get(track.slot_id) ?? []
          const trackMiniEvents = getTrackMiniEvents(trackRegions)
          const trackArchives = trackMaterialArchives.filter(
            (archive) => archive.track_slot_id === track.slot_id,
          )
          const trackArchiveCount = trackArchives.length
          const canCreateTuning =
            isEditorMode &&
            isRegistered &&
            trackRegions.some((region) => region.audio_source_path) &&
            trackMiniEvents.length > 0
          const canGenerateTrack = registeredTracks.some(
            (registeredTrack) => registeredTrack.slot_id !== track.slot_id,
          )
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
                  </div>
                </div>
                <div className="track-card__state">
                  {isRegistered || needsReview || activeJob ? <strong>{statusLabels[track.status]}</strong> : null}
                  {activeJob ? (
                    <span className={`track-card__job-state track-card__job-state--${activeJob.status}`}>
                      {getJobStatusLabel(activeJob.status)}
                    </span>
                  ) : null}
                  {isRegistered ? <span>{formatSeconds(track.sync_offset_seconds)}</span> : null}
                </div>
                {!isEditorMode && isRegistered ? (
                  <div className="track-card__settings">
                    <div className="track-card__sync-controls">
                      <button
                        aria-label={`${formatTrackName(track.name)} 싱크를 ${formatSyncStep(syncStepSeconds)}초 앞으로 이동`}
                        className="studio-step-button"
                        data-testid={`track-sync-earlier-${track.slot_id}`}
                        disabled={trackEditDisabled}
                        type="button"
                        onClick={() => onSync(track, track.sync_offset_seconds - syncStepSeconds)}
                      >
                        -{formatSyncStep(syncStepSeconds)}
                      </button>
                      <button
                        aria-label={`${formatTrackName(track.name)} 싱크를 ${formatSyncStep(syncStepSeconds)}초 뒤로 이동`}
                        className="studio-step-button"
                        data-testid={`track-sync-later-${track.slot_id}`}
                        disabled={trackEditDisabled}
                        type="button"
                        onClick={() => onSync(track, track.sync_offset_seconds + syncStepSeconds)}
                      >
                        +{formatSyncStep(syncStepSeconds)}
                      </button>
                    </div>
                    <TrackVolumeControl
                      disabled={trackVolumeDisabled}
                      track={track}
                      onVolumePreview={onVolumePreview}
                      onVolumeChange={onVolumeChange}
                    />
                  </div>
                ) : null}
                {isEditorMode && isRegistered ? (
                  <TrackMaterialVersionControls
                    archives={trackArchives}
                    canCreateTuning={canCreateTuning}
                    disabled={trackEditDisabled}
                    track={track}
                    onCreateTuningRender={onCreateTuningRender}
                    onDeleteTrackMaterialVersion={onDeleteTrackMaterialVersion}
                    onRenameTrackMaterialVersion={onRenameTrackMaterialVersion}
                    onUseTrackMaterialVersion={onUseTrackMaterialVersion}
                  />
                ) : null}
              </header>

              <div
                className="track-card__timeline track-card__region-lane"
                aria-label={`${formatTrackName(track.name)} 구간`}
                style={getTrackLaneStyle(trackMiniEvents, isPlaying, playheadSeconds, timelineBounds)}
              >
                <div className="track-card__measure-grid" aria-hidden="true">
                  {measureStarts.map((measure) => (
                    <i
                      key={`${track.slot_id}-${measure.measureIndex}`}
                      style={{ '--measure-left': `${getTimelinePercent(measure.seconds, timelineBounds)}%` } as CSSProperties}
                    />
                  ))}
                </div>
                {isPlaying && playheadSeconds !== null ? (
                  <i className="track-card__playhead" aria-hidden="true" />
                ) : null}
                {trackRegions.length > 0 ? (
                  <>
                    {trackRegions.map((region, index) => (
                      <button
                        aria-label={`${formatTrackName(track.name)} 구간 ${index + 1}: ${formatDurationSeconds(
                          region.start_seconds,
                        )}부터 ${formatDurationSeconds(region.start_seconds + region.duration_seconds)}까지`}
                        aria-pressed={selectedRegion?.region_id === region.region_id}
                        className={`track-card__region-hit-area ${focusedRegionId === region.region_id ? 'is-focused' : ''}`}
                        data-region-id={region.region_id}
                        data-testid={index === 0 ? `track-region-${track.slot_id}` : `track-region-${track.slot_id}-${index + 1}`}
                        key={region.region_id}
                        style={getRegionHitAreaStyle(region, timelineBounds)}
                        type="button"
                        onClick={() => {
                          setSelectedRegionId(region.region_id)
                          setSelectedEventId(getRenderableMiniEvents(region.pitch_events)[0]?.event_id ?? null)
                        }}
                        onDoubleClick={() => {
                          setSelectedRegionId(region.region_id)
                          setSelectedEventId(getRenderableMiniEvents(region.pitch_events)[0]?.event_id ?? null)
                          onOpenRegionEditor?.(region)
                        }}
                      >
                        <span className="event-mini__sr">
                          {formatTrackName(track.name)} 구간 {index + 1}
                        </span>
                      </button>
                    ))}
                    {trackMiniEvents.map((item) => (
                      <button
                        aria-label={getEventMiniAriaLabel(item.event, track.name)}
                        aria-pressed={
                          item.event.event_id === effectiveSelectedEventId ||
                          item.event.event_id === focusedEventId
                        }
                        className={`track-card__event-mini ${
                          item.event.event_id === effectiveSelectedEventId ||
                          item.event.event_id === focusedEventId
                            ? 'is-focused'
                            : ''
                        }`}
                        data-testid={`track-event-mini-${item.event.event_id}`}
                        data-track-slot-id={track.slot_id}
                        key={`${item.region.region_id}-${item.event.event_id}`}
                        style={getTrackMiniStyle(item, trackMiniEvents, timelineBounds)}
                        title={getEventMiniTitle(item.event, track.name)}
                        type="button"
                        onClick={() => {
                          setSelectedRegionId(item.region.region_id)
                          setSelectedEventId(item.event.event_id)
                        }}
                        onDoubleClick={() => {
                          setSelectedRegionId(item.region.region_id)
                          setSelectedEventId(item.event.event_id)
                          onOpenRegionEditor?.(item.region)
                        }}
                      >
                        <span className="event-mini__sr">{item.event.label}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="track-card__empty-lane" aria-hidden="true" />
                )}
              </div>

              {!isEditorMode ? (
              <div className="track-card__controls">
                <div className="track-card__primary-actions">
                  <button
                    className={`app-button app-button--record ${
                      isRecording || isCountingIn || isSettingUpRecording ? 'is-active' : ''
                    }`}
                    data-testid={`track-record-${track.slot_id}`}
                    disabled={!isRecordToggleAvailable && trackEditDisabled}
                    type="button"
                    title={!isRecordToggleAvailable ? trackEditDisabledReason ?? undefined : undefined}
                    onClick={() => onRecord(track)}
                  >
                    <span aria-hidden="true">{isRecording ? '■' : isCountingIn || isSettingUpRecording ? '×' : '●'}</span>
                    {isRecording ? '녹음 중' : isCountingIn || isSettingUpRecording ? '취소' : '녹음'}
                  </button>
                  <label className={`app-button app-button--secondary track-upload ${trackEditDisabled ? 'is-disabled' : ''}`}>
                    <span aria-hidden="true">↑</span>
                    녹음파일
                    <input
                      accept={TRACK_RECORDING_UPLOAD_ACCEPT}
                      aria-label={`${formatTrackName(track.name)} 녹음파일 업로드`}
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
                  {trackArchiveCount > 0 && onOpenTrackArchive ? (
                    <button
                      className="app-button app-button--secondary"
                      data-testid={`track-archives-${track.slot_id}`}
                      disabled={trackEditDisabled}
                      type="button"
                      title={trackEditDisabledReason ?? undefined}
                      onClick={() => onOpenTrackArchive(track)}
                    >
                      보관본 {trackArchiveCount}
                    </button>
                  ) : null}
                </div>

                {isRegistered ? (
                <div className="track-card__secondary-actions">
                  <button
                    aria-label={isPlaying ? `${formatTrackName(track.name)} 일시정지` : `${formatTrackName(track.name)} 재생`}
                    className="studio-icon-button"
                    data-testid={`track-play-${track.slot_id}`}
                    disabled={editDisabled && !isPlaying}
                    type="button"
                    onClick={() => onTogglePlayback(track)}
                  >
                    <span aria-hidden="true">{isPlaying ? '일시정지' : '재생'}</span>
                  </button>
                  <button
                    aria-label={`${formatTrackName(track.name)} 중지`}
                    className="studio-icon-button"
                    data-testid={`track-stop-${track.slot_id}`}
                    disabled={!isPlaying}
                    type="button"
                    onClick={() => onStopPlayback(track)}
                  >
                    <span aria-hidden="true">중지</span>
                  </button>
                </div>
                ) : null}
                {isCountingIn ? (
                  <div
                    className="track-card__count-in"
                    data-testid={`track-count-in-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>1마디 카운트인</span>
                    <strong>{trackCountIn.pulsesRemaining}</strong>
                    <i aria-hidden="true" />
                    <em>{recordingGuideLabel}</em>
                  </div>
                ) : isRecording ? (
                  <div
                    className="track-card__recording-meter"
                    data-testid={`track-recording-meter-${track.slot_id}`}
                    style={recordingMeterStyle}
                  >
                    <span>{formatDurationSeconds(trackRecordingMeter.durationSeconds)}</span>
                    <i aria-hidden="true" />
                    <em>{recordingGuideLabel}</em>
                  </div>
                ) : null}
              </div>
              ) : null}
            </article>
          )
        })}
      </div>
      </div>

      {!isEditorMode ? (
        <section className="studio-tracks__purpose-actions" aria-label="선택 구간 작업">
          <span>
            {selectedRegion
              ? `${formatTrackName(selectedRegionTrack?.name ?? selectedRegion.track_name)} 구간`
              : '구간 선택'}
          </span>
          <button
            className="app-button app-button--secondary"
            data-testid="open-note-editor-button"
            disabled={!canOpenSelectedRegionEditor}
            type="button"
            onClick={() => {
              if (selectedRegion) {
                onOpenRegionEditor?.(selectedRegion)
              }
            }}
          >
            편집
          </button>
        </section>
      ) : null}

      {isEditorMode ? (
      <div className="editor-panels editor-panels--note-editor">
        <div className="piano-roll-shell">
          <RegionTools
            disabled={selectedRegionEditDisabled}
            disabledReason={selectedRegionDisabledReason}
            gridSeconds={gridSeconds}
            region={selectedRegion}
            tracks={tracks}
            onCopyRegion={onCopyRegion}
            onDeleteRegion={onDeleteRegion}
            onSplitRegion={onSplitRegion}
          />
          <PianoRollPanel
            bpm={bpm}
            draftStorageKey={
              selectedRegion
                ? `gigastudy.regionDraft.v1:${draftStorageScope ?? 'local'}:${selectedRegion.region_id}`
                : null
            }
            disabled={selectedRegionEditDisabled}
            disabledReason={selectedRegionDisabledReason}
            focusedEventId={focusedEventId}
            gridSeconds={gridSeconds}
            region={selectedRegion}
            selectedEventId={effectiveSelectedEventId}
            tracks={tracks}
            onRestoreRevision={onRestoreRegionRevision ?? (() => undefined)}
            onSaveDraft={onSaveRegionDraft ?? (() => undefined)}
            onSelectEvent={setSelectedEventId}
          />
        </div>
      </div>
      ) : null}
    </section>
  )
}
