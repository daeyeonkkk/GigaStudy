import { useMemo, useState } from 'react'
import { useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { CandidateReviewPanel } from '../components/studio/CandidateReviewPanel'
import { ExtractionJobsPanel } from '../components/studio/ExtractionJobsPanel'
import { PendingRecordingDialog } from '../components/studio/PendingRecordingDialog'
import { ReportFeed } from '../components/studio/ReportFeed'
import { StudioRouteState } from '../components/studio/StudioRouteState'
import { StudioToolbar } from '../components/studio/StudioToolbar'
import { TrackBoard } from '../components/studio/TrackBoard'
import type { StudioActionState } from '../components/studio/studioActionState'
import { useCandidateReviewState } from '../components/studio/useCandidateReviewState'
import { useStudioPlayback } from '../components/studio/useStudioPlayback'
import { useStudioRecording } from '../components/studio/useStudioRecording'
import { useStudioResource } from '../components/studio/useStudioResource'
import { useStudioTrackActions } from '../components/studio/useStudioTrackActions'

import {
  copyRegion,
  deleteRegion,
  getDocumentJobSourcePreviewUrl,
  getStudioMidiExportUrl,
  splitRegion,
  updateStudioTiming,
} from '../lib/api'
import {
  DEFAULT_METER,
  formatDurationSeconds,
  formatSeconds,
  formatTrackName,
  getStudioMeter,
} from '../lib/studio'
import type {
  ArrangementRegion,
  Studio,
  TrackSlot,
} from '../types/studio'
import './StudioPage.css'

export function StudioPage() {
  const { studioId } = useParams()
  const navigate = useNavigate()
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
    playbackPickerOpen,
    playbackSource,
    playbackTimeline,
    playingSlots,
    playheadSeconds,
    seekSelectedPlayback,
    selectAllPlaybackTracks,
    selectedPlaybackSlotIds,
    setActiveTrackVolume,
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
  const recordingInteractionLocked = recordingSlotId !== null || trackCountIn !== null || pendingTrackRecording !== null
  const playbackInteractionLocked = globalPlaying || playingSlots.size > 0
  const actionBusy = actionState.phase === 'busy'
  const arrangementEditDisabled =
    actionBusy || recordingInteractionLocked || playbackInteractionLocked
  const trackVolumeDisabled = actionBusy || recordingInteractionLocked
  const arrangementEditDisabledReason = actionBusy
    ? '현재 작업이 끝난 뒤 편집할 수 있습니다.'
    : recordingInteractionLocked
        ? '녹음 작업이 진행 중입니다. 녹음을 저장하거나 폐기한 뒤 편집할 수 있습니다.'
        : playbackInteractionLocked
          ? '재생 중에는 편집을 잠시 멈춥니다. 정지 후 다시 시도해 주세요.'
          : null
  const transportDisabled = actionBusy || recordingInteractionLocked
  const transportDisabledReason = actionBusy
    ? '현재 작업이 끝난 뒤 재생할 수 있습니다.'
    : recordingInteractionLocked
      ? '녹음 중에는 일반 재생을 잠시 멈춥니다.'
      : null

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
      `${targetName}에 구간을 복사했습니다.`,
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

  async function handleTimingChange(payload: Parameters<typeof updateStudioTiming>[1]) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => updateStudioTiming(studio.studio_id, payload),
      '스튜디오 템포를 저장하는 중입니다.',
      '스튜디오 템포를 저장했습니다.',
      ['음표 위치를 새 BPM 기준으로 다시 맞추는 중입니다.', '마디 눈금과 재생 타임라인을 갱신하는 중입니다.'],
    )
  }

  function handleOpenRegionEditor(region: ArrangementRegion) {
    if (!studio) {
      return
    }
    const params = new URLSearchParams()
    params.set('region', region.region_id)
    const firstEventId = region.pitch_events.find((event) => event.is_rest !== true)?.event_id ?? region.pitch_events[0]?.event_id
    if (firstEventId) {
      params.set('event', firstEventId)
    }
    navigate(`/studios/${studio.studio_id}/edit?${params.toString()}`)
  }

  if (!studioId) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message="스튜디오 주소가 올바르지 않습니다."
        title="스튜디오를 찾을 수 없습니다"
        tone="오류"
      />
    )
  }

  if (loadState.phase === 'loading') {
    return (
      <StudioRouteState
        pulseCount={6}
        title="트랙을 불러오는 중입니다"
        tone="불러오는 중"
      />
    )
  }

  if (loadState.phase === 'error' || !studio) {
    return (
      <StudioRouteState
        homeLabel="홈으로"
        message={loadState.phase === 'error' ? loadState.message : '알 수 없는 오류가 발생했습니다.'}
        title="스튜디오를 찾을 수 없습니다"
        tone="오류"
      />
    )
  }

  return (
    <main className="app-shell studio-page">
      <section
        className={`composer-window ${playbackPickerOpen || globalPlaying ? 'composer-window--playback-panel' : ''}`}
        aria-label="GigaStudy 스튜디오"
      >
        <StudioToolbar
          actionState={actionState}
          bpm={studio.bpm}
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
          tempoChanges={studio.tempo_changes}
          timingDisabled={arrangementEditDisabled}
          timingDisabledReason={arrangementEditDisabledReason}
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
          onTimingChange={(payload) => void handleTimingChange(payload)}
          onTogglePlaybackSelection={togglePlaybackSelection}
          onToggleGlobalPlayback={() => void toggleGlobalPlayback()}
        />
        <section className="composer-arrange-viewport">
          <div className="composer-arrange-paper">
            <div className="composer-arrange-heading">
              <h1>{studio.title}</h1>
              <p>
                {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} · 등록{' '}
                {registeredTracks.length}/6 · 템포 변경 {studio.tempo_changes.length} · 리포트 {studio.reports.length}
              </p>
              <a className="app-button app-button--secondary" href={getStudioMidiExportUrl(studio.studio_id)}>
                MIDI 내보내기
              </a>
            </div>

            <TrackBoard
              beatsPerMeasure={studioBeatsPerMeasure}
              bpm={studio.bpm}
              tempoChanges={studio.tempo_changes}
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
              volumeDisabled={trackVolumeDisabled}
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
              onOpenRegionEditor={handleOpenRegionEditor}
              onRecord={(track) => void handleRecord(track)}
              onSplitRegion={(region, splitSeconds) => void handleSplitRegion(region, splitSeconds)}
              onStopPlayback={stopTrackPlayback}
              onSync={(track, nextOffset) => void handleSync(track, nextOffset)}
              onTogglePlayback={(track) => void toggleTrackPlayback(track)}
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
          <span>{globalPlaying || playingSlots.size > 0 ? '재생 중' : '준비 완료'}</span>
          <span>1마디</span>
          <span>
            {playheadSeconds === null ? '0:00' : formatDurationSeconds(playheadSeconds)} /{' '}
            {playbackTimeline ? formatDurationSeconds(playbackTimeline.maxSeconds) : '0:00'}
          </span>
          <span>싱크 단위 {formatSeconds(syncStepSeconds).replace(/^\+/, '')}</span>
        </footer>
      </section>

      <ReportFeed reports={studio.reports} studioId={studio.studio_id} tracks={studio.tracks} />

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
