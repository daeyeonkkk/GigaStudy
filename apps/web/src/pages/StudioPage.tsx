import { useMemo, useState } from 'react'
import { useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { CandidateReviewPanel } from '../components/studio/CandidateReviewPanel'
import { ExtractionJobsPanel } from '../components/studio/ExtractionJobsPanel'
import { PendingRecordingDialog } from '../components/studio/PendingRecordingDialog'
import { ReportFeed } from '../components/studio/ReportFeed'
import { ScoringDrawer } from '../components/studio/ScoringDrawer'
import { StudioRouteState } from '../components/studio/StudioRouteState'
import { StudioToolbar } from '../components/studio/StudioToolbar'
import { TrackBoard } from '../components/studio/TrackBoard'
import type { StudioActionState } from '../components/studio/studioActionState'
import { useCandidateReviewState } from '../components/studio/useCandidateReviewState'
import { useStudioPlayback } from '../components/studio/useStudioPlayback'
import { useStudioRecording } from '../components/studio/useStudioRecording'
import { useStudioResource } from '../components/studio/useStudioResource'
import { useStudioScoring } from '../components/studio/useStudioScoring'
import { useStudioTrackActions } from '../components/studio/useStudioTrackActions'

import {
  copyRegion,
  deleteRegion,
  getDocumentJobSourcePreviewUrl,
  splitRegion,
  updatePitchEvent,
  updateRegion,
} from '../lib/api'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  formatSeconds,
  getStudioMeter,
} from '../lib/studio'
import type {
  ArrangementRegion,
  PitchEvent,
  Studio,
  TrackSlot,
  UpdatePitchEventRequest,
} from '../types/studio'
import './StudioPage.css'

export function StudioPage() {
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
    registeredSlotIds,
    registeredTracks,
    setStudio,
    studio,
    visibleExtractionJobs,
  } = useStudioResource(
    studioId,
    (message) => setActionState({ phase: 'error', message }),
    (message, phase = 'busy') => setActionState({ phase, message }),
  )
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const studioMeter = useMemo(
    () => (studio ? getStudioMeter(studio) : DEFAULT_METER),
    [studio],
  )
  const studioBeatsPerMeasure = studioMeter.beatsPerMeasure
  const {
    changePlaybackSource,
    globalPlaying,
    markReferencePlayback,
    openPlaybackPicker,
    playbackPickerOpen,
    playbackSource,
    playbackTimeline,
    playingSlots,
    playheadSeconds,
    seekSelectedPlayback,
    selectAllPlaybackTracks,
    selectedPlaybackSlotIds,
    setActiveTrackVolume,
    startPlaybackSession,
    startSelectedPlayback,
    stopGlobalPlayback,
    stopPlaybackSession,
    stopTrackPlayback,
    syncStepSeconds,
    toggleGlobalPlayback,
    togglePlaybackSelection,
    toggleTrackPlayback,
    updateSyncStep,
  } = useStudioPlayback({
    metronomeEnabled,
    registeredSlotIds,
    registeredTracks,
    setActionState,
    studio,
    studioMeter,
  })
  const {
    handleDiscardPendingRecording,
    handleRecord: handleTrackRecording,
    handleRegisterPendingRecording,
    pendingTrackRecording,
    recordingSlotId,
    trackCountIn,
    trackRecordingMeter,
  } = useStudioRecording({
    metronomeEnabled,
    runStudioAction,
    setActionState,
    studio,
    studioMeter,
  })
  const {
    cancelScoreSession,
    openScoreSession,
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
    recordingSlotId,
    registeredSlotIds,
    setActionState,
    setStudio,
    startPlaybackSession,
    stopPlaybackSession,
    studio,
    studioMeter,
  })
  const {
    handleGenerate,
    handleShiftAllSync,
    handleSync,
    handleUpload,
    handleVolume,
  } = useStudioTrackActions({
    globalPlaying,
    playingSlots,
    registeredSlotIds,
    runStudioAction,
    setActionState,
    setActiveTrackVolume,
    stopPlaybackSession,
    studio,
  })

  async function runStudioAction(
    action: () => Promise<Studio>,
    busyMessage: string,
    successMessage: string,
    progressMessages: string[] = [],
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
    let progressMessageIndex = 0
    const progressIntervalId =
      progressMessages.length > 0
        ? window.setInterval(() => {
            progressMessageIndex = (progressMessageIndex + 1) % progressMessages.length
            setActionState({ phase: 'busy', message: progressMessages[progressMessageIndex] })
          }, 2600)
        : null
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
      if (progressIntervalId !== null) {
        window.clearInterval(progressIntervalId)
      }
      studioActionInFlightRef.current = false
    }
  }

  const {
    candidateOverwriteApprovals,
    candidateWouldOverwrite,
    getPendingJobCandidates,
    getSelectedCandidateSlotId,
    handleApproveCandidate,
    handleApproveJobCandidates,
    handleRejectCandidate,
    handleRetryJob,
    jobOverwriteApprovals,
    jobWouldOverwrite,
    updateCandidateOverwriteApproval,
    updateCandidateTargetSlot,
    updateJobOverwriteApproval,
  } = useCandidateReviewState({
    pendingCandidates,
    runStudioAction,
    setActionError: (message) => setActionState({ phase: 'error', message }),
    studio,
  })

  async function handleRecord(track: TrackSlot) {
    if (
      scoreSession?.phase === 'counting_in' ||
      scoreSession?.phase === 'listening' ||
      scoreSession?.phase === 'analyzing'
    ) {
      setActionState({
        phase: 'error',
        message: '채점 녹음이 진행 중입니다. 먼저 채점을 중지한 뒤 트랙 녹음을 시작해 주세요.',
      })
      return
    }

    await handleTrackRecording(track)
  }

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
  const scoringInteractionLocked = scoreSession !== null
  const recordingInteractionLocked = recordingSlotId !== null || trackCountIn !== null || pendingTrackRecording !== null
  const playbackInteractionLocked = globalPlaying || playingSlots.size > 0
  const actionBusy = actionState.phase === 'busy'
  const arrangementEditDisabled =
    actionBusy || scoringInteractionLocked || recordingInteractionLocked || playbackInteractionLocked
  const arrangementEditDisabledReason = actionBusy
    ? '현재 작업이 끝난 뒤 편집할 수 있습니다.'
    : scoringInteractionLocked
      ? '채점 패널이 열려 있습니다. 채점을 끝내거나 닫은 뒤 편집할 수 있습니다.'
      : recordingInteractionLocked
        ? '녹음 작업이 진행 중입니다. 녹음을 저장하거나 폐기한 뒤 편집할 수 있습니다.'
        : playbackInteractionLocked
          ? '재생 중에는 편집을 잠시 멈춥니다. 정지 후 다시 시도해 주세요.'
          : null
  const transportDisabled = actionBusy || scoringInteractionLocked || recordingInteractionLocked
  const transportDisabledReason = actionBusy
    ? '현재 작업이 끝난 뒤 재생할 수 있습니다.'
    : scoringInteractionLocked
      ? '채점 중에는 일반 재생을 잠시 멈춥니다.'
      : recordingInteractionLocked
        ? '녹음 중에는 일반 재생을 잠시 멈춥니다.'
        : null

  async function handleMoveRegion(region: ArrangementRegion, targetSlotId: number, startSeconds: number) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === targetSlotId)
    const targetName = targetTrack?.name ?? `Track ${targetSlotId}`
    await runStudioAction(
      () =>
        updateRegion(studio.studio_id, region.region_id, {
          start_seconds: Math.max(0, Math.round(startSeconds * 1000) / 1000),
          target_track_slot_id: targetSlotId,
        }),
      `${region.track_name} region을 이동하는 중입니다.`,
      `${targetName} 위치로 region을 이동했습니다.`,
    )
  }

  async function handleCopyRegion(region: ArrangementRegion, targetSlotId: number, startSeconds: number) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === targetSlotId)
    const targetName = targetTrack?.name ?? `Track ${targetSlotId}`
    await runStudioAction(
      () =>
        copyRegion(studio.studio_id, region.region_id, {
          start_seconds: Math.max(0, Math.round(startSeconds * 1000) / 1000),
          target_track_slot_id: targetSlotId,
        }),
      `${region.track_name} region을 복사하는 중입니다.`,
      `${targetName}에 region을 복사했습니다.`,
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
      `${region.track_name} region을 자르는 중입니다.`,
      `${region.track_name} region을 두 블록으로 나눴습니다.`,
    )
  }

  async function handleDeleteRegion(region: ArrangementRegion) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => deleteRegion(studio.studio_id, region.region_id),
      `${region.track_name} region을 삭제하는 중입니다.`,
      `${region.track_name} region을 삭제했습니다.`,
    )
  }

  async function handleUpdateEvent(
    region: ArrangementRegion,
    event: PitchEvent,
    patch: UpdatePitchEventRequest,
  ) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => updatePitchEvent(studio.studio_id, region.region_id, event.event_id, patch),
      `${event.label} 이벤트를 저장하는 중입니다.`,
      `${event.label} 이벤트를 업데이트했습니다.`,
    )
  }

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message="스튜디오 주소가 올바르지 않습니다."
        title="스튜디오를 찾을 수 없습니다"
        tone="Studio error"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="트랙을 불러오는 중입니다"
        tone="Studio loading"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message={loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}
        title="스튜디오를 찾을 수 없습니다"
        tone="Studio error"
      />
    )
  }

  return (
    <main className="app-shell studio-page">
      <section className="composer-window" aria-label="GigaStudy composer studio">
        <StudioToolbar
          actionState={actionState}
          globalPlaying={globalPlaying}
          metronomeEnabled={metronomeEnabled}
          playbackPickerOpen={playbackPickerOpen}
          playbackRange={
            playbackTimeline
              ? { maxSeconds: playbackTimeline.maxSeconds, minSeconds: playbackTimeline.minSeconds }
              : null
          }
          playbackSource={playbackSource}
          playheadSeconds={playheadSeconds}
          registeredTrackCount={registeredTracks.length}
          registeredTracks={registeredTracks}
          selectedPlaybackSlotIds={selectedPlaybackSlotIds}
          studioId={studio.studio_id}
          studioTitle={studio.title}
          syncStepSeconds={syncStepSeconds}
          transportDisabled={transportDisabled}
          transportDisabledReason={transportDisabledReason}
          onMetronomeChange={setMetronomeEnabled}
          onPlaybackSourceChange={changePlaybackSource}
          onSeekPlayback={seekSelectedPlayback}
          onSelectAllPlaybackTracks={selectAllPlaybackTracks}
          onStartSelectedPlayback={() => void startSelectedPlayback()}
          onStopGlobalPlayback={stopGlobalPlayback}
          onShiftAllSync={(deltaSeconds) => void handleShiftAllSync(deltaSeconds)}
          onSyncStepChange={updateSyncStep}
          onTogglePlaybackPicker={openPlaybackPicker}
          onTogglePlaybackSelection={togglePlaybackSelection}
          onToggleGlobalPlayback={() => void toggleGlobalPlayback()}
        />
        <section className="composer-arrange-viewport">
          <div className="composer-arrange-paper">
            <div className="composer-arrange-heading">
              <h1>{studio.title}</h1>
              <p>
                {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} · 등록{' '}
                {registeredTracks.length}/6 · 리포트 {studio.reports.length}
              </p>
            </div>

            <TrackBoard
              beatsPerMeasure={studioBeatsPerMeasure}
              bpm={studio.bpm}
              metronomeEnabled={metronomeEnabled}
              pendingCandidateCount={pendingCandidates.length}
              extractionJobs={visibleExtractionJobs}
              focusedEventId={focusedEventId}
              focusedRegionId={focusedRegionId}
              playingSlots={playingSlots}
              playheadSeconds={playheadSeconds}
              arrangementRegions={studio.regions}
              activeJobSlotIds={activeJobSlotIds}
              editDisabled={arrangementEditDisabled}
              editDisabledReason={arrangementEditDisabledReason}
              registeredTracks={registeredTracks}
              syncStepSeconds={syncStepSeconds}
              trackCountIn={trackCountIn}
              recordingSlotId={recordingSlotId}
              trackRecordingMeter={trackRecordingMeter}
              tracks={studio.tracks}
              onCopyRegion={(region, targetSlotId, startSeconds) =>
                void handleCopyRegion(region, targetSlotId, startSeconds)
              }
              onDeleteRegion={(region) => void handleDeleteRegion(region)}
              onGenerate={(track) => void handleGenerate(track)}
              onMoveRegion={(region, targetSlotId, startSeconds) =>
                void handleMoveRegion(region, targetSlotId, startSeconds)
              }
              onOpenScore={openScoreSession}
              onRecord={(track) => void handleRecord(track)}
              onSplitRegion={(region, splitSeconds) => void handleSplitRegion(region, splitSeconds)}
              onStopPlayback={stopTrackPlayback}
              onSync={(track, nextOffset) => void handleSync(track, nextOffset)}
              onTogglePlayback={(track) => void toggleTrackPlayback(track)}
              onUpdateEvent={(region, event, patch) => void handleUpdateEvent(region, event, patch)}
              onUpload={(track, file) => void handleUpload(track, file)}
              onVolumeChange={(track, nextVolume) => void handleVolume(track, nextVolume)}
            />
            <ExtractionJobsPanel
              activeJobCount={activeExtractionJobs.length}
              busy={arrangementEditDisabled}
              jobOverwriteApprovals={jobOverwriteApprovals}
              lockedSlotIds={activeJobSlotIds}
              tracks={studio.tracks}
              visibleJobs={visibleExtractionJobs}
              getPendingJobCandidates={getPendingJobCandidates}
              jobWouldOverwrite={jobWouldOverwrite}
              onApproveJobCandidates={(jobId) => void handleApproveJobCandidates(jobId)}
              onRetryJob={(jobId) => void handleRetryJob(jobId)}
              onUpdateJobOverwriteApproval={updateJobOverwriteApproval}
            />

            <CandidateReviewPanel
              beatsPerMeasure={studioBeatsPerMeasure}
              busy={arrangementEditDisabled}
              candidateOverwriteApprovals={candidateOverwriteApprovals}
              candidates={pendingCandidates}
              lockedSlotIds={activeJobSlotIds}
              tracks={studio.tracks}
              candidateWouldOverwrite={candidateWouldOverwrite}
              getJobSourcePreviewUrl={(jobId) => getDocumentJobSourcePreviewUrl(studio.studio_id, jobId)}
              getSelectedCandidateSlotId={getSelectedCandidateSlotId}
              onApproveCandidate={(candidate) => void handleApproveCandidate(candidate)}
              onRejectCandidate={(candidate) => void handleRejectCandidate(candidate)}
              onUpdateCandidateOverwriteApproval={updateCandidateOverwriteApproval}
              onUpdateCandidateTargetSlot={updateCandidateTargetSlot}
            />
          </div>
        </section>

        <footer className="composer-statusbar">
          <span>{globalPlaying || playingSlots.size > 0 ? 'Playing' : 'Ready'}</span>
          <span>Bar 1</span>
          <span>
            {playheadSeconds === null ? '0:00' : formatDurationSeconds(playheadSeconds)} /{' '}
            {playbackTimeline ? formatDurationSeconds(playbackTimeline.maxSeconds) : '0:00'}
          </span>
          <span>Sync step {formatSeconds(syncStepSeconds).replace(/^\+/, '')}</span>
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

      {pendingTrackRecording ? (
        <PendingRecordingDialog
          busy={actionState.phase === 'busy'}
          recording={pendingTrackRecording}
          onDiscard={handleDiscardPendingRecording}
          onRegister={() => void handleRegisterPendingRecording()}
        />
      ) : null}
    </main>
  )
}
