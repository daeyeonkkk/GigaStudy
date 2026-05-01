import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

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
  getDocumentJobSourcePreviewUrl,
} from '../lib/api'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  formatSeconds,
  getStudioMeter,
} from '../lib/studio'
import type {
  Studio,
  TrackSlot,
} from '../types/studio'
import './StudioPage.css'

export function StudioPage() {
  const { studioId } = useParams()
  const [actionState, setActionState] = useState<StudioActionState>({ phase: 'idle' })
  const {
    activeExtractionJobs,
    loadState,
    pendingCandidates,
    registeredSlotIds,
    registeredTracks,
    setStudio,
    studio,
    visibleExtractionJobs,
  } = useStudioResource(studioId, (message) => setActionState({ phase: 'error', message }))
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
  ): Promise<boolean> {
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
              playingSlots={playingSlots}
              playheadSeconds={playheadSeconds}
              arrangementRegions={studio.regions}
              registeredTracks={registeredTracks}
              syncStepSeconds={syncStepSeconds}
              trackCountIn={trackCountIn}
              recordingSlotId={recordingSlotId}
              trackRecordingMeter={trackRecordingMeter}
              tracks={studio.tracks}
              onGenerate={(track) => void handleGenerate(track)}
              onOpenScore={openScoreSession}
              onRecord={(track) => void handleRecord(track)}
              onStopPlayback={stopTrackPlayback}
              onSync={(track, nextOffset) => void handleSync(track, nextOffset)}
              onTogglePlayback={(track) => void toggleTrackPlayback(track)}
              onUpload={(track, file) => void handleUpload(track, file)}
              onVolumeChange={(track, nextVolume) => void handleVolume(track, nextVolume)}
            />
            <ExtractionJobsPanel
              activeJobCount={activeExtractionJobs.length}
              jobOverwriteApprovals={jobOverwriteApprovals}
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
              candidateOverwriteApprovals={candidateOverwriteApprovals}
              candidates={pendingCandidates}
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
