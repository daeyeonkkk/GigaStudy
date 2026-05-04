import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { StudioRouteState } from '../components/studio/StudioRouteState'
import { TrackBoard } from '../components/studio/TrackBoard'
import type { RegionEditorDraft } from '../components/studio/TrackBoardEditor'
import { StudioPurposeNav } from '../components/studio/StudioPurposeNav'
import type { StudioActionState } from '../components/studio/studioActionState'
import { useStudioResource } from '../components/studio/useStudioResource'
import {
  copyRegion,
  deleteRegion,
  restoreRegionRevision,
  saveRegionRevision,
  splitRegion,
} from '../lib/api'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  formatTrackName,
  getStudioMeter,
} from '../lib/studio'
import type {
  ArrangementRegion,
  Studio,
} from '../types/studio'
import './StudioPage.css'

const EMPTY_PLAYING_SLOTS = new Set<number>()
const EMPTY_RECORDING_METER = { durationSeconds: 0, level: 0 }

export function StudioEditPage() {
  const { studioId } = useParams()
  const [searchParams] = useSearchParams()
  const focusedRegionId = searchParams.get('region')
  const focusedEventId = searchParams.get('event')
  const [actionState, setActionState] = useState<StudioActionState>({ phase: 'idle' })
  const studioActionInFlightRef = useRef(false)
  const {
    activeExtractionJobs,
    loadState,
    pendingCandidates,
    registeredTracks,
    setStudio,
    studio,
    visibleExtractionJobs,
  } = useStudioResource(
    studioId,
    (message) => setActionState({ phase: 'error', message }),
    (message, phase = 'busy') => setActionState({ phase, message }),
  )
  const studioMeter = useMemo(
    () => (studio ? getStudioMeter(studio) : DEFAULT_METER),
    [studio],
  )
  const activeJobSlotIds = useMemo(() => {
    const next = new Set<number>()
    for (const job of activeExtractionJobs) {
      if (job.parse_all_parts) {
        studio?.tracks.forEach((track) => {
          if (track.slot_id <= 5) {
            next.add(track.slot_id)
          }
        })
      } else {
        next.add(job.slot_id)
      }
    }
    return next
  }, [activeExtractionJobs, studio])
  const actionBusy = actionState.phase === 'busy'
  const editDisabledReason = actionBusy ? '현재 작업이 끝난 뒤 편집할 수 있습니다.' : null

  async function runStudioAction(
    action: () => Promise<Studio>,
    busyMessage: string,
    successMessage: string,
  ): Promise<boolean> {
    if (studioActionInFlightRef.current) {
      setActionState({
        phase: 'error',
        message: '다른 작업을 처리하는 중입니다. 현재 작업이 끝난 뒤 다시 시도해 주세요.',
      })
      return false
    }

    studioActionInFlightRef.current = true
    setActionState({ phase: 'busy', message: busyMessage })
    try {
      const nextStudio = await action()
      setStudio(nextStudio)
      setActionState({ phase: 'success', message: successMessage })
      return true
    } catch (error) {
      setActionState({
        phase: 'error',
        message: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.',
      })
      return false
    } finally {
      studioActionInFlightRef.current = false
    }
  }

  async function handleCopyRegion(region: ArrangementRegion, targetSlotId: number, startSeconds: number) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === targetSlotId)
    const targetName = targetTrack?.name ?? `트랙 ${targetSlotId}`
    await runStudioAction(
      () =>
        copyRegion(studio.studio_id, region.region_id, {
          start_seconds: Math.max(0, Math.round(startSeconds * 1000) / 1000),
          target_track_slot_id: targetSlotId,
        }),
      `${formatTrackName(region.track_name)} 구간을 복사하는 중입니다.`,
      `${formatTrackName(targetName)}에 구간을 복사했습니다.`,
    )
  }

  async function handleSplitRegion(region: ArrangementRegion, splitSeconds: number) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () =>
        splitRegion(studio.studio_id, region.region_id, {
          split_seconds: Math.round(splitSeconds * 1000) / 1000,
        }),
      `${formatTrackName(region.track_name)} 구간을 자르는 중입니다.`,
      `${formatTrackName(region.track_name)} 구간을 두 블록으로 나눴습니다.`,
    )
  }

  async function handleDeleteRegion(region: ArrangementRegion) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => deleteRegion(studio.studio_id, region.region_id),
      `${formatTrackName(region.track_name)} 구간을 삭제하는 중입니다.`,
      `${formatTrackName(region.track_name)} 구간을 삭제했습니다.`,
    )
  }

  async function handleSaveRegionDraft(
    region: ArrangementRegion,
    draft: RegionEditorDraft,
    revisionLabel: string | null,
  ) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === draft.target_track_slot_id)
    const targetName = targetTrack?.name ?? `트랙 ${draft.target_track_slot_id}`
    await runStudioAction(
      () =>
        saveRegionRevision(studio.studio_id, region.region_id, {
          duration_seconds: Math.max(0.08, Math.round(draft.duration_seconds * 1000) / 1000),
          events: draft.events.map((event) => ({
            duration_seconds: Math.max(0.08, Math.round(event.duration_seconds * 1000) / 1000),
            event_id: event.event_id,
            is_rest: event.is_rest,
            label: event.label.trim() || (event.is_rest ? 'Rest' : 'Note'),
            pitch_midi: event.is_rest ? null : event.pitch_midi,
            start_seconds: Math.max(-30, Math.round(event.start_seconds * 1000) / 1000),
          })),
          revision_label: revisionLabel,
          source_label: draft.source_label.trim() || null,
          start_seconds: Math.max(-30, Math.round(draft.start_seconds * 1000) / 1000),
          target_track_slot_id: draft.target_track_slot_id,
          volume_percent: Math.max(0, Math.min(100, Math.round(draft.volume_percent))),
        }),
      `${formatTrackName(region.track_name)} 편집 내용을 저장하는 중입니다.`,
      `${formatTrackName(targetName)} 구간을 저장했습니다.`,
    )
  }

  async function handleRestoreRegionRevision(region: ArrangementRegion, revisionId: string) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => restoreRegionRevision(studio.studio_id, region.region_id, revisionId),
      `${formatTrackName(region.track_name)} 이전 버전을 복원하는 중입니다.`,
      `${formatTrackName(region.track_name)} 이전 버전을 복원했습니다.`,
    )
  }

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message="스튜디오 주소가 올바르지 않습니다."
        title="음표 편집 화면을 열 수 없습니다"
        tone="오류"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="음표 편집 화면을 준비하는 중입니다"
        tone="불러오는 중"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message={loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}
        title="음표 편집 화면을 열 수 없습니다"
        tone="오류"
      />
    )
  }

  return (
    <main className="app-shell studio-page studio-editor-page">
      <section className="composer-window composer-window--editor" aria-label="GigaStudy 음표 편집">
        <header className="composer-titlebar">
          <Link className="composer-app-mark" to="/" aria-label="홈으로">
            GS
          </Link>
          <span>GigaStudy 음표 편집 - {studio.title}</span>
        </header>

        <StudioPurposeNav
          active="editor"
          studioId={studio.studio_id}
        />

        {actionState.phase !== 'idle' ? (
          <section className="studio-status-line" aria-live="polite">
            <span className={`studio-status-line__dot studio-status-line__dot--${actionState.phase}`} />
            <p>{actionState.message}</p>
          </section>
        ) : null}

        <section className="composer-arrange-viewport composer-arrange-viewport--editor">
          <div className="composer-arrange-paper composer-arrange-paper--editor">
            <div className="composer-arrange-heading">
              <h1>{studio.title}</h1>
              <p>
                음표 편집 · {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/
                {studio.time_signature_denominator ?? 4} · 구간{' '}
                {studio.regions.length} · 검토 {pendingCandidates.length}
              </p>
            </div>

            <TrackBoard
              mode="editor"
              beatsPerMeasure={studioMeter.beatsPerMeasure}
              bpm={studio.bpm}
              draftStorageScope={studio.studio_id}
              metronomeEnabled={false}
              pendingCandidateCount={pendingCandidates.length}
              extractionJobs={visibleExtractionJobs}
              focusedEventId={focusedEventId}
              focusedRegionId={focusedRegionId}
              playingSlots={EMPTY_PLAYING_SLOTS}
              playheadSeconds={null}
              arrangementRegions={studio.regions}
              activeJobSlotIds={activeJobSlotIds}
              editDisabled={actionBusy}
              editDisabledReason={editDisabledReason}
              registeredTracks={registeredTracks}
              syncStepSeconds={0.01}
              trackCountIn={null}
              recordingSlotId={null}
              trackRecordingMeter={EMPTY_RECORDING_METER}
              tracks={studio.tracks}
              onCopyRegion={(region, targetSlotId, startSeconds) =>
                void handleCopyRegion(region, targetSlotId, startSeconds)
              }
              onDeleteRegion={(region) => void handleDeleteRegion(region)}
              onGenerate={() => undefined}
              onRecord={() => undefined}
              onRestoreRegionRevision={(region, revisionId) => void handleRestoreRegionRevision(region, revisionId)}
              onSaveRegionDraft={(region, draft, revisionLabel) =>
                void handleSaveRegionDraft(region, draft, revisionLabel)
              }
              onSplitRegion={(region, splitSeconds) => void handleSplitRegion(region, splitSeconds)}
              onStopPlayback={() => undefined}
              onSync={() => undefined}
              onTogglePlayback={() => undefined}
              onUpload={() => undefined}
              onVolumeChange={() => undefined}
            />
          </div>
        </section>

        <footer className="composer-statusbar">
          <span>음표 편집</span>
          <span>구간 {studio.regions.length}</span>
          <span>트랙 {studio.tracks.length}</span>
          <span>{formatDurationSeconds(Math.max(0, ...studio.regions.map((region) => region.start_seconds + region.duration_seconds)))}</span>
        </footer>
      </section>
    </main>
  )
}
